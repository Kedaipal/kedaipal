/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const USER = "user_waba_test";
const BUYER = "60111222333";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

beforeEach(() => {
	process.env.WHATSAPP_PHONE_NUMBER_ID = "111";
	process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
});

afterEach(() => {
	delete process.env.WHATSAPP_PHONE_NUMBER_ID;
	delete process.env.WHATSAPP_ACCESS_TOKEN;
	delete process.env.ADMIN_USER_IDS;
	vi.restoreAllMocks();
});

async function seedRetailer(
	t: ReturnType<typeof setup>,
): Promise<Id<"retailers">> {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Guarded Store",
		slug: "guarded-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await t.run(async (ctx) => {
		await ctx.db.patch(retailer._id, { waPhone: "60123456789" });
	});
	return retailer._id;
}

function installFetchMock() {
	const calls: string[] = [];
	globalThis.fetch = vi.fn(async (url: unknown) => {
		calls.push(String(url));
		return new Response("{}", { status: 200 });
	}) as unknown as typeof fetch;
	return { waCalls: () => calls.filter((u) => u.includes("graph.facebook.com")) };
}

async function logRows(
	t: ReturnType<typeof setup>,
): Promise<Doc<"outboundMessageLog">[]> {
	return t.run(async (ctx) =>
		ctx.db.query("outboundMessageLog").order("desc").collect(),
	);
}

describe("canSend — category policy", () => {
	test("transactional is ALWAYS allowed (paused + opted-out + quality LOW)", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);
		await t.mutation(internal.wabaProtection.pauseRetailer, { retailerId });
		await t.mutation(internal.wabaProtection.registerOptOut, {
			waPhone: BUYER,
			source: "stop_keyword",
		});
		await t.mutation(internal.wabaProtection.recordWabaHealth, {
			qualityRating: "LOW",
			messagingTier: 250,
		});
		const decision = await t.mutation(internal.wabaProtection.canSend, {
			retailerId,
			toPhone: BUYER,
			category: "transactional",
		});
		expect(decision).toEqual({ allowed: true });
	});

	test("session blocked when retailer is paused", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);
		await t.mutation(internal.wabaProtection.pauseRetailer, {
			retailerId,
			reason: "spam",
		});
		const decision = await t.mutation(internal.wabaProtection.canSend, {
			retailerId,
			toPhone: BUYER,
			category: "session_message",
		});
		expect(decision).toEqual({ allowed: false, status: "blocked_retailer_paused" });
	});

	test("non-transactional blocked for an opted-out phone", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);
		await t.mutation(internal.wabaProtection.registerOptOut, {
			waPhone: BUYER,
			source: "stop_keyword",
		});
		const decision = await t.mutation(internal.wabaProtection.canSend, {
			retailerId,
			toPhone: BUYER,
			category: "session_message",
		});
		expect(decision).toEqual({ allowed: false, status: "blocked_optout" });
	});

	test("non-transactional blocked when quality is LOW", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);
		await t.mutation(internal.wabaProtection.recordWabaHealth, {
			qualityRating: "LOW",
			messagingTier: 250,
		});
		const decision = await t.mutation(internal.wabaProtection.canSend, {
			retailerId,
			toPhone: BUYER,
			category: "session_message",
		});
		expect(decision).toEqual({ allowed: false, status: "blocked_quality" });
	});

	test("burst cap blocks the 3rd send in a window", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);
		await t.run(async (ctx) => {
			await ctx.db.insert("retailerSendingLimits", {
				retailerId,
				burstCap5min: 2,
				updatedAt: Date.now(),
			});
		});
		const send = () =>
			t.mutation(internal.wabaProtection.canSend, {
				retailerId,
				toPhone: BUYER,
				category: "session_message",
			});
		expect((await send()).allowed).toBe(true);
		expect((await send()).allowed).toBe(true);
		expect(await send()).toEqual({
			allowed: false,
			status: "blocked_capreached",
		});
	});
});

describe("opt-out lifecycle", () => {
	test("register → opted out; reactivate → opted in again", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);
		const session = () =>
			t.mutation(internal.wabaProtection.canSend, {
				retailerId,
				toPhone: BUYER,
				category: "session_message",
			});

		await t.mutation(internal.wabaProtection.registerOptOut, {
			waPhone: BUYER,
			source: "berhenti_keyword",
		});
		expect((await session()).allowed).toBe(false);

		await t.mutation(internal.wabaProtection.reactivateOptIn, { waPhone: BUYER });
		expect((await session()).allowed).toBe(true);
	});
});

describe("recordWabaHealth", () => {
	test("appends history + alerts on anything below HIGH", async () => {
		const t = setup();
		const med = await t.mutation(internal.wabaProtection.recordWabaHealth, {
			qualityRating: "MEDIUM",
			messagingTier: 1000,
		});
		expect(med.shouldAlert).toBe(true);
		const high = await t.mutation(internal.wabaProtection.recordWabaHealth, {
			qualityRating: "HIGH",
			messagingTier: 1000,
		});
		expect(high.shouldAlert).toBe(false);
		// Latest row governs.
		const latest = await t.query(internal.wabaProtection.getWabaHealth, {});
		expect(latest?.qualityRating).toBe("HIGH");
	});
});

describe("admin vendor list + at-a-glance stats", () => {
	test("gated to admins; returns pause status + 30d sent/blocked/opt-out counts", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("outboundMessageLog", {
				retailerId,
				toWaPhone: BUYER,
				category: "transactional",
				status: "sent",
				sentAt: now,
			});
			await ctx.db.insert("outboundMessageLog", {
				retailerId,
				toWaPhone: BUYER,
				category: "session_message",
				status: "blocked_optout",
				sentAt: now,
			});
			await ctx.db.insert("optOuts", {
				waPhone: BUYER,
				source: "stop_keyword",
				triggeredByRetailerId: retailerId,
				createdAt: now,
			});
		});

		// Non-admin is rejected (ADMIN_USER_IDS unset → no one is admin).
		await expect(
			t
				.withIdentity({ subject: "not_admin" })
				.query(api.wabaProtection.adminListVendors, {}),
		).rejects.toThrow();

		// Admin sees the vendor with its 30d stats.
		process.env.ADMIN_USER_IDS = USER;
		const rows = await t
			.withIdentity({ subject: USER })
			.query(api.wabaProtection.adminListVendors, {});
		const row = rows.find((r) => r._id === retailerId);
		expect(row).toMatchObject({
			paused: false,
			sent30d: 1,
			blocked30d: 1,
			optOuts30d: 1,
			statsCapped: false,
		});
	});
});

describe("guarded send end-to-end", () => {
	test("transactional diagnostic still sends while the retailer is paused", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);
		await t.mutation(internal.wabaProtection.pauseRetailer, { retailerId });
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.sendTestRetailerAlert, { retailerId });

		expect(fetchMock.waCalls()).toHaveLength(1);
		const rows = await logRows(t);
		expect(rows[0]).toMatchObject({ status: "sent", category: "transactional" });
	});

	test("session fallback to an opted-out phone never reaches Meta, logged blocked", async () => {
		const t = setup();
		await seedRetailer(t);
		await t.mutation(internal.wabaProtection.registerOptOut, {
			waPhone: BUYER,
			source: "stop_keyword",
		});
		const fetchMock = installFetchMock();

		// An unknown inbound from an opted-out buyer → the fallback reply is a
		// session_message and must be suppressed.
		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: BUYER,
			text: "random text with no order id",
		});

		expect(fetchMock.waCalls()).toHaveLength(0);
		const rows = await logRows(t);
		expect(rows.some((r) => r.status === "blocked_optout")).toBe(true);
	});

	test("STOP keyword registers opt-out and acks (transactional)", async () => {
		const t = setup();
		await seedRetailer(t);
		const fetchMock = installFetchMock();

		await t.action(internal.whatsapp.handleInbound, {
			fromPhone: BUYER,
			text: "STOP",
		});

		// Ack went out (transactional bypass)...
		expect(fetchMock.waCalls()).toHaveLength(1);
		// ...and the phone is now opted out.
		const decision = await t.mutation(internal.wabaProtection.canSend, {
			retailerId: undefined,
			toPhone: BUYER,
			category: "session_message",
		});
		expect(decision).toEqual({ allowed: false, status: "blocked_optout" });
	});
});
