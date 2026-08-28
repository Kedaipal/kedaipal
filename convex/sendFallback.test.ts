/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * The seam's guarantee (ClickUp 86eyrtz9t): a WhatsApp send that reaches nobody
 * tells somebody. Exercised through REAL call sites rather than by poking
 * `deliver()` directly — the thing worth pinning is that a Meta rejection turns
 * into an email a seller actually receives, not that a helper returned a shape.
 *
 * The founding welcome is the sharpest case: before this it was the one message
 * where a failure was logged and nothing else, on the day a seller had just
 * paid and taken a Founding rank.
 */

const modules = import.meta.glob("./**/*.ts");
const USER = "user_fallback_test";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

type FetchCall = { url: string; body: unknown };

/**
 * @param waStatus  HTTP status Meta answers the send with.
 * @param metaCode  Meta's own error code — 131026 ("not on WhatsApp") is
 *                  terminal, so it must never be retried.
 */
function installFetchMock(
	opts: { waStatus?: number; metaCode?: number } = {},
): {
	calls: FetchCall[];
	waCalls: () => FetchCall[];
	resendCalls: () => FetchCall[];
	restore: () => void;
} {
	const calls: FetchCall[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(init.body as string) : null;
		calls.push({ url: u, body });
		if (u.includes("graph.facebook.com") && opts.waStatus !== undefined) {
			return new Response(
				JSON.stringify({ error: { code: opts.metaCode ?? 131026 } }),
				{ status: opts.waStatus },
			);
		}
		return new Response("{}", { status: 200 });
	}) as unknown as typeof fetch;
	return {
		calls,
		waCalls: () => calls.filter((c) => c.url.includes("graph.facebook.com")),
		resendCalls: () => calls.filter((c) => c.url.includes("api.resend.com")),
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

beforeEach(() => {
	// convex-test drives the scheduler through the timer queue, so
	// finishAllScheduledFunctions needs fake timers installed first.
	vi.useFakeTimers();
	process.env.WHATSAPP_PHONE_NUMBER_ID = "111";
	process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
	process.env.RESEND_API_KEY = "test-resend";
	process.env.EMAIL_FROM = "Kedaipal <orders@kedaipal.test>";
});

afterEach(() => {
	vi.useRealTimers();
	delete process.env.WHATSAPP_PHONE_NUMBER_ID;
	delete process.env.WHATSAPP_ACCESS_TOKEN;
	delete process.env.RESEND_API_KEY;
	delete process.env.EMAIL_FROM;
	vi.restoreAllMocks();
});

async function seedFoundingRetailer(
	t: ReturnType<typeof setup>,
	opts: { waPhone?: string; notifyEmail?: string },
): Promise<Id<"retailers">> {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Founding Store",
		slug: "founding-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await t.run(async (ctx) => {
		await ctx.db.patch(retailer._id, {
			waPhone: opts.waPhone,
			notifyEmail: opts.notifyEmail,
		});
		await ctx.db.insert("foundingMembers", {
			retailerId: retailer._id,
			rank: 3,
			plan: "pro",
			paidAt: Date.now(),
		});
	});
	return retailer._id;
}

/** Whether the founding row has been stamped. Boolean rather than the raw
 * field because t.run's return value crosses Convex's value encoding, where an
 * absent optional comes back as `null`, not `undefined`. */
async function hasWelcomed(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
): Promise<boolean> {
	return t.run(async (ctx) => {
		const row = await ctx.db
			.query("foundingMembers")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		return row?.welcomedAt !== undefined && row?.welcomedAt !== null;
	});
}

describe("founding welcome — WhatsApp fails, email covers (86eyrtz9t)", () => {
	test("a terminal Meta rejection emails the seller and still stamps welcomedAt", async () => {
		const t = setup();
		const retailerId = await seedFoundingRetailer(t, {
			waPhone: "60123456789",
			notifyEmail: "owner@store.test",
		});
		const fetchMock = installFetchMock({ waStatus: 400, metaCode: 131026 });
		try {
			await t.action(internal.whatsapp.notifyFoundingWelcome, {
				retailerId,
				rank: 3,
			});
			await t.finishAllScheduledFunctions(vi.runAllTimers);
		} finally {
			fetchMock.restore();
		}
		// 131026 is terminal — exactly one attempt, no retry storm.
		expect(fetchMock.waCalls()).toHaveLength(1);
		const emails = fetchMock.resendCalls();
		expect(emails).toHaveLength(1);
		const email = emails[0]?.body as { to: string[]; subject: string };
		expect(email.to).toEqual(["owner@store.test"]);
		expect(email.subject).toContain("#3");
		// Stamped by the EMAIL path, so a re-run can't double-send.
		expect(await hasWelcomed(t, retailerId)).toBe(true);
	});

	test("a successful WhatsApp send sends NO email — the fallback stays quiet", async () => {
		const t = setup();
		const retailerId = await seedFoundingRetailer(t, {
			waPhone: "60123456789",
			notifyEmail: "owner@store.test",
		});
		const fetchMock = installFetchMock();
		try {
			await t.action(internal.whatsapp.notifyFoundingWelcome, {
				retailerId,
				rank: 3,
			});
			await t.finishAllScheduledFunctions(vi.runAllTimers);
		} finally {
			fetchMock.restore();
		}
		expect(fetchMock.waCalls()).toHaveLength(1);
		expect(fetchMock.resendCalls()).toHaveLength(0);
		expect(await hasWelcomed(t, retailerId)).toBe(true);
	});

	test("no WhatsApp number at all → email is the channel, not a fallback", async () => {
		const t = setup();
		const retailerId = await seedFoundingRetailer(t, {
			waPhone: undefined,
			notifyEmail: "owner@store.test",
		});
		const fetchMock = installFetchMock();
		try {
			await t.action(internal.whatsapp.notifyFoundingWelcome, {
				retailerId,
				rank: 3,
			});
			await t.finishAllScheduledFunctions(vi.runAllTimers);
		} finally {
			fetchMock.restore();
		}
		expect(fetchMock.waCalls()).toHaveLength(0);
		expect(fetchMock.resendCalls()).toHaveLength(1);
		expect(await hasWelcomed(t, retailerId)).toBe(true);
	});

	test("neither channel reachable → welcomedAt stays unstamped so a later run can still reach them", async () => {
		const t = setup();
		const retailerId = await seedFoundingRetailer(t, {
			waPhone: "60123456789",
			notifyEmail: undefined,
		});
		const fetchMock = installFetchMock({ waStatus: 400, metaCode: 131026 });
		try {
			await t.action(internal.whatsapp.notifyFoundingWelcome, {
				retailerId,
				rank: 3,
			});
			await t.finishAllScheduledFunctions(vi.runAllTimers);
		} finally {
			fetchMock.restore();
		}
		expect(fetchMock.resendCalls()).toHaveLength(0);
		expect(await hasWelcomed(t, retailerId)).toBe(false);
	});
});
