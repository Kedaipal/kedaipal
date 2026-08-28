/// <reference types="vite/client" />
/**
 * End-to-end tests for the seller's manual payment reminder — the ONE
 * deliberate exception to one-message-per-order (86eyd63r8, revised 8 Aug):
 * seller-driven, day 11–14 only, once per 24h, closed forever after day 14.
 * The automatic day-11 cron is gone; these tests also pin that nothing
 * schedules the reminder without a human tap.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	MANUAL_REMINDER_COOLDOWN_MS,
	MANUAL_REMINDER_UNLOCK_AFTER_MS,
} from "./lib/paymentReminder";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const USER = "user_manual_reminder";
const DAY = 24 * 60 * 60 * 1000;

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

beforeEach(() => {
	vi.useFakeTimers();
	process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
	process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
	process.env.RESEND_API_KEY = "test-resend";
	process.env.EMAIL_FROM = "Kedaipal <orders@kedaipal.test>";
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function installFetchMock(opts: { waStatus?: number; metaCode?: number } = {}) {
	const calls: Array<{ url: string; body: unknown }> = [];
	const original = globalThis.fetch;
	globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
		calls.push({
			url: String(url),
			body: init?.body ? JSON.parse(init.body as string) : null,
		});
		if (
			String(url).includes("graph.facebook.com") &&
			opts.waStatus !== undefined
		) {
			return new Response(
				JSON.stringify({ error: { code: opts.metaCode ?? 131026 } }),
				{ status: opts.waStatus },
			);
		}
		return new Response("{}", { status: 200 });
	}) as unknown as typeof fetch;
	return {
		waCalls: () => calls.filter((c) => c.url.includes("graph.facebook.com")),
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

/** A confirmed, unpaid order back-dated so "now" falls on the given order age. */
async function seedAgedOrder(
	t: ReturnType<typeof setup>,
	slug: string,
	ageMs: number,
): Promise<{ shortId: string; orderId: Id<"orders"> }> {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Reminder Test Store",
		slug,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	const productId = await asUser.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Tent 2P",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		variants: [{ optionValues: [], price: 12000, onHand: 100 }],
	});
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId: retailer._id,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Ali", waPhone: "60123456789" },
		deliveryAddress: {
			line1: "12 Jln Mawar 3",
			city: "Petaling Jaya",
			state: "Selangor",
			postcode: "47301",
		},
	});
	const orderId = await t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error("order missing");
		// Back-date creation + confirm it, as a real aged unpaid order would be.
		await ctx.db.patch(o._id, {
			createdAt: Date.now() - ageMs,
			status: "confirmed",
		});
		return o._id;
	});
	return { shortId, orderId };
}

describe("manual payment reminder — the day-11–14 window, enforced server-side", () => {
	test("day 5: blocked too_early, nothing stamped, nothing sent", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		try {
			const { shortId, orderId } = await seedAgedOrder(t, "early", 5 * DAY);
			const asUser = t.withIdentity({ subject: USER });

			const res = await asUser.action(api.orders.sendPaymentReminder, {
				shortId,
			});

			expect(res).toEqual({ ok: false, reason: "too_early" });
			const order = await t.run((ctx) => ctx.db.get(orderId));
			expect(order?.lastManualReminderAt).toBeUndefined();
			expect(fetchMock.waCalls()).toEqual([]);
		} finally {
			fetchMock.restore();
		}
	});

	test("a send that reaches nobody reports send_failed and hands the attempt back (86eyrtz9t)", async () => {
		const t = setup();
		// 131026 — the buyer's number isn't on WhatsApp. Both the cta and its
		// text degrade fail, so nothing reached them.
		const fetchMock = installFetchMock({ waStatus: 400, metaCode: 131026 });
		try {
			const { shortId, orderId } = await seedAgedOrder(t, "open", 11 * DAY);
			const asUser = t.withIdentity({ subject: USER });

			const res = await asUser.action(api.orders.sendPaymentReminder, {
				shortId,
			});

			// The seller pressed a button; telling them "sent ✓" for a message
			// that never left is the one answer they can't act on.
			expect(res).toEqual({ ok: false, reason: "send_failed" });
			// And the 24h cooldown is rolled back — an order gets at most four of
			// these, and a failure on OUR side must not burn one of them.
			const order = await t.run((ctx) => ctx.db.get(orderId));
			expect(order?.lastManualReminderAt ?? undefined).toBeUndefined();
		} finally {
			fetchMock.restore();
		}
	});

	test("day 12: sends the full payment message and stamps the cooldown", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		try {
			const { shortId, orderId } = await seedAgedOrder(t, "open", 11 * DAY);
			const asUser = t.withIdentity({ subject: USER });

			const res = await asUser.action(api.orders.sendPaymentReminder, {
				shortId,
			});

			expect(res).toEqual({ ok: true });
			const wa = fetchMock.waCalls();
			expect(wa).toHaveLength(1);
			const body = wa[0].body as {
				interactive?: { body?: { text?: string } };
				text?: { body?: string };
			};
			const text =
				body.interactive?.body?.text ?? body.text?.body ?? "";
			expect(text).toContain("still awaiting payment");
			expect(text).toContain(shortId);
			expect(text).toMatch(/\/track\//);
			const order = await t.run((ctx) => ctx.db.get(orderId));
			expect(order?.lastManualReminderAt).toBeDefined();
		} finally {
			fetchMock.restore();
		}
	});

	test("a second tap the same day is refused; 24h later it sends again", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		try {
			const { shortId, orderId } = await seedAgedOrder(t, "cooldown", 11 * DAY);
			const asUser = t.withIdentity({ subject: USER });

			expect(
				await asUser.action(api.orders.sendPaymentReminder, { shortId }),
			).toEqual({ ok: true });
			expect(
				await asUser.action(api.orders.sendPaymentReminder, { shortId }),
			).toEqual({ ok: false, reason: "cooldown" });
			expect(fetchMock.waCalls()).toHaveLength(1);

			// A day passes (rewind the stamp rather than advancing fake time, so
			// the order's age stays inside the window).
			await t.run(async (ctx) => {
				const o = await ctx.db.get(orderId);
				if (!o?.lastManualReminderAt) throw new Error("stamp missing");
				await ctx.db.patch(orderId, {
					lastManualReminderAt:
						o.lastManualReminderAt - MANUAL_REMINDER_COOLDOWN_MS,
				});
			});
			expect(
				await asUser.action(api.orders.sendPaymentReminder, { shortId }),
			).toEqual({ ok: true });
			expect(fetchMock.waCalls()).toHaveLength(2);
		} finally {
			fetchMock.restore();
		}
	});

	test("day 20: window_closed forever — no send, no stamp", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		try {
			const { shortId, orderId } = await seedAgedOrder(t, "closed", 20 * DAY);
			const asUser = t.withIdentity({ subject: USER });

			const res = await asUser.action(api.orders.sendPaymentReminder, {
				shortId,
			});

			expect(res).toEqual({ ok: false, reason: "window_closed" });
			const order = await t.run((ctx) => ctx.db.get(orderId));
			expect(order?.lastManualReminderAt).toBeUndefined();
			expect(fetchMock.waCalls()).toEqual([]);
		} finally {
			fetchMock.restore();
		}
	});

	test("a paid order is refused as paid, whatever its age", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		try {
			const { shortId, orderId } = await seedAgedOrder(t, "paid", 12 * DAY);
			await t.run((ctx) =>
				ctx.db.patch(orderId, {
					paymentStatus: "received",
					paymentReceivedAt: Date.now(),
				}),
			);
			const asUser = t.withIdentity({ subject: USER });

			expect(
				await asUser.action(api.orders.sendPaymentReminder, { shortId }),
			).toEqual({ ok: false, reason: "paid" });
			expect(fetchMock.waCalls()).toEqual([]);
		} finally {
			fetchMock.restore();
		}
	});

	test("another store's owner can't remind an order that isn't theirs", async () => {
		const t = setup();
		const { shortId } = await seedAgedOrder(t, "foreign", 11 * DAY);
		const asStranger = t.withIdentity({ subject: "user_stranger" });
		await asStranger.mutation(api.retailers.createRetailer, {
			storeName: "Other Store",
			slug: "other-store",
		});

		await expect(
			asStranger.action(api.orders.sendPaymentReminder, { shortId }),
		).rejects.toThrow();
	});
});

describe("manual payment reminder — stays manual", () => {
	test("nothing in the system ever SCHEDULES the reminder — no cron, no order-flow hook", async () => {
		const t = setup();
		const { orderId } = await seedAgedOrder(t, "no-auto", 11 * DAY);
		// Walk the states that used to trigger automatic chasing.
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.orders.updateStatus, {
			orderId,
			status: "packed",
		});

		const jobs = await t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect(),
		);
		expect(
			jobs.filter((j) => j.name.includes("Reminder")),
		).toEqual([]);
	});

	test("the sanity anchor: unlock constant is day 11 (10 full days from creation)", () => {
		// If someone retunes the window they must retune the copy that names
		// "day 11" on the seller surfaces too — this pins the pair together.
		expect(MANUAL_REMINDER_UNLOCK_AFTER_MS).toBe(10 * DAY);
	});
});
