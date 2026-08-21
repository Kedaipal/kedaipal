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

	test("opt-out matches across phone-number formatting (compliance)", async () => {
		const t = setup();
		const retailerId = await seedRetailer(t);
		// STOP comes in as Meta's bare digits…
		await t.mutation(internal.wabaProtection.registerOptOut, {
			waPhone: "60111222333",
			source: "stop_keyword",
		});
		// …a later send targets the same person stored with '+', spaces, dashes.
		const decision = await t.mutation(internal.wabaProtection.canSend, {
			retailerId,
			toPhone: "+60 111-222 333",
			category: "session_message",
		});
		expect(decision).toEqual({ allowed: false, status: "blocked_optout" });
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

describe("admin manual opt-out (86eyn25gu)", () => {
	test("non-admin rejected; opt-out registers manual_admin + audits last-4 only; re-activate restores", async () => {
		const t = setup();

		// Non-admin is rejected (ADMIN_USER_IDS unset → no one is admin).
		await expect(
			t
				.withIdentity({ subject: "not_admin" })
				.mutation(api.wabaProtection.adminRegisterOptOut, { waPhone: BUYER }),
		).rejects.toThrow();

		process.env.ADMIN_USER_IDS = USER;
		const asAdmin = t.withIdentity({ subject: USER });

		// Garbage input is refused before touching the table.
		await expect(
			asAdmin.mutation(api.wabaProtection.adminRegisterOptOut, {
				waPhone: "not-a-phone",
			}),
		).rejects.toThrow();

		expect(
			await asAdmin.query(api.wabaProtection.adminOptOutStatus, {
				waPhone: BUYER,
			}),
		).toMatchObject({ optedOut: false });

		await asAdmin.mutation(api.wabaProtection.adminRegisterOptOut, {
			waPhone: BUYER,
		});
		// Idempotent — a double-tap never inserts a second row.
		await asAdmin.mutation(api.wabaProtection.adminRegisterOptOut, {
			waPhone: BUYER,
		});

		expect(
			await asAdmin.query(api.wabaProtection.adminOptOutStatus, {
				waPhone: BUYER,
			}),
		).toMatchObject({ optedOut: true, source: "manual_admin" });
		const optRows = await t.run(async (ctx) =>
			ctx.db.query("optOuts").collect(),
		);
		expect(optRows).toHaveLength(1);

		// Audited globally (no retailerId) with the LAST FOUR digits only — the
		// audit log has no retention, so a full phone must never land in it.
		const audits = await t.run(async (ctx) =>
			ctx.db.query("adminAuditLog").collect(),
		);
		const optOutAudits = audits.filter(
			(a) => a.action === "wabaProtection.manualOptOut",
		);
		expect(optOutAudits).toHaveLength(1);
		expect(optOutAudits[0].targetId).toBe(`…${BUYER.slice(-4)}`);
		expect(optOutAudits[0].targetId).not.toContain(BUYER);
		expect(optOutAudits[0].retailerId).toBeUndefined();

		// Re-activate restores sends and is audited the same way.
		await asAdmin.mutation(api.wabaProtection.adminReactivateOptIn, {
			waPhone: BUYER,
		});
		expect(
			await asAdmin.query(api.wabaProtection.adminOptOutStatus, {
				waPhone: BUYER,
			}),
		).toMatchObject({ optedOut: false });
		const audits2 = await t.run(async (ctx) =>
			ctx.db.query("adminAuditLog").collect(),
		);
		expect(
			audits2.some((a) => a.action === "wabaProtection.manualOptIn"),
		).toBe(true);
	});

	// PR #191 review finding: the panel's placeholder suggests the LOCAL format
	// ("011-2345 6789"), but every key the send gate checks is international
	// (Meta's inbound `from`, checkout/counter numbers) — so a local-keyed row
	// would suppress nothing while the status panel claimed it did. Red on the
	// digits-only-strip version, green with assertValidMyMobile canonicalization.
	test("local-format input canonicalizes to the 60… form the send gate and START both key on", async () => {
		const t = setup();
		process.env.ADMIN_USER_IDS = USER;
		const asAdmin = t.withIdentity({ subject: USER });

		// BUYER ("60111222333") typed the way the placeholder suggests.
		await asAdmin.mutation(api.wabaProtection.adminRegisterOptOut, {
			waPhone: "011-1222 333",
		});

		// Stored under the INTERNATIONAL key — the one isOptedOut checks.
		const rows = await t.run(async (ctx) => ctx.db.query("optOuts").collect());
		expect(rows).toHaveLength(1);
		expect(rows[0].waPhone).toBe(BUYER);

		// Both spellings of the same number agree on the status.
		expect(
			await asAdmin.query(api.wabaProtection.adminOptOutStatus, {
				waPhone: BUYER,
			}),
		).toMatchObject({ optedOut: true, source: "manual_admin" });
		expect(
			await asAdmin.query(api.wabaProtection.adminOptOutStatus, {
				waPhone: "011-1222 333",
			}),
		).toMatchObject({ optedOut: true });

		// The keyword path (buyer texts START — always the international form)
		// can undo an admin opt-out: the two paths share one key.
		await t.mutation(internal.wabaProtection.reactivateOptIn, {
			waPhone: BUYER,
		});
		expect(
			await asAdmin.query(api.wabaProtection.adminOptOutStatus, {
				waPhone: "011-1222 333",
			}),
		).toMatchObject({ optedOut: false });
	});

	test("non-MY / partial input is invalid: status says so, register refuses", async () => {
		const t = setup();
		process.env.ADMIN_USER_IDS = USER;
		const asAdmin = t.withIdentity({ subject: USER });

		// A Singapore number is out of scope for this panel (counter buyers are
		// MY-mobile validated); the panel disables with reason instead of
		// registering a key no send-gate check would ever match.
		expect(
			await asAdmin.query(api.wabaProtection.adminOptOutStatus, {
				waPhone: "+65 9123 4567",
			}),
		).toMatchObject({ optedOut: false, invalid: true });
		await expect(
			asAdmin.mutation(api.wabaProtection.adminRegisterOptOut, {
				waPhone: "+65 9123 4567",
			}),
		).rejects.toThrow();
		expect(
			await t.run(async (ctx) => ctx.db.query("optOuts").collect()),
		).toHaveLength(0);
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
