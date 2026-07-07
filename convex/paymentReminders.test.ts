/// <reference types="vite/client" />
// Unpaid-order payment reminder cron — see docs/payment-reminder.md.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { PAYMENT_REMINDER_AFTER_MS } from "./lib/paymentReminder";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_payment_reminder_test";

type FetchCall = { url: string; body: unknown };

function installFetchMock(): { calls: FetchCall[]; restore: () => void } {
	const calls: FetchCall[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
		const body = init?.body ? JSON.parse(init.body as string) : null;
		calls.push({ url: String(url), body });
		return new Response("{}", { status: 200 });
	}) as unknown as typeof fetch;
	return {
		calls,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

/**
 * Seed a retailer + one confirmed order with a reachable buyer, returning the
 * order doc. The order's payment is untouched (unpaid).
 */
async function seedConfirmedOrder(
	t: ReturnType<typeof setup>,
): Promise<Doc<"orders">> {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Reminder Test Store",
		slug: "reminder-test",
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
	return await t.run(async (ctx) => {
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!order) throw new Error("order vanished");
		await ctx.db.patch(order._id, { status: "confirmed" });
		return (await ctx.db.get(order._id)) as Doc<"orders">;
	});
}

beforeEach(() => {
	// Fake timers keep scheduled runAfter(0) actions from auto-firing inside
	// the mutation transaction (same convex-test caveat as whatsapp.test.ts).
	vi.useFakeTimers();
	process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
	process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("sendDuePaymentReminders (cron)", () => {
	test("stamps + schedules exactly once for a due unpaid order", async () => {
		const t = setup();
		const order = await seedConfirmedOrder(t);
		const now = order._creationTime + PAYMENT_REMINDER_AFTER_MS + 1000;

		const first = await t.mutation(
			internal.paymentReminders.sendDuePaymentReminders,
			{ now },
		);
		expect(first.scheduled).toBe(1);
		const stamped = await t.run(async (ctx) => ctx.db.get(order._id));
		expect(stamped?.paymentReminderSentAt).toBe(now);

		// Second sweep is a no-op — one nudge, ever.
		const second = await t.mutation(
			internal.paymentReminders.sendDuePaymentReminders,
			{ now: now + 60_000 },
		);
		expect(second.scheduled).toBe(0);
	});

	test("skips orders that are too young, paid, or aged past the window", async () => {
		const t = setup();
		const order = await seedConfirmedOrder(t);

		// Day 5 — not due yet.
		const early = await t.mutation(
			internal.paymentReminders.sendDuePaymentReminders,
			{ now: order._creationTime + 5 * 24 * 60 * 60 * 1000 },
		);
		expect(early.scheduled).toBe(0);

		// Day 20 — past the 14-day window; the deadline it references is gone.
		const late = await t.mutation(
			internal.paymentReminders.sendDuePaymentReminders,
			{ now: order._creationTime + 20 * 24 * 60 * 60 * 1000 },
		);
		expect(late.scheduled).toBe(0);

		// Day 11 but payment already received → skipped.
		await t.run(async (ctx) => {
			await ctx.db.patch(order._id, { paymentStatus: "received" });
		});
		const paid = await t.mutation(
			internal.paymentReminders.sendDuePaymentReminders,
			{ now: order._creationTime + PAYMENT_REMINDER_AFTER_MS + 1000 },
		);
		expect(paid.scheduled).toBe(0);
	});

	test("still sweeps a delivered-but-unpaid order — F&B pay-on-credit case", async () => {
		// A seller delivered the stock but settles payment at week's end — the
		// order is `delivered`, not `pending`/`cancelled`, so it must still be
		// nudged (PR feedback, 86ey570am).
		const t = setup();
		const order = await seedConfirmedOrder(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(order._id, { status: "delivered" });
		});
		const swept = await t.mutation(
			internal.paymentReminders.sendDuePaymentReminders,
			{ now: order._creationTime + PAYMENT_REMINDER_AFTER_MS + 1000 },
		);
		expect(swept.scheduled).toBe(1);
	});
});

describe("notifyPaymentReminder (send action)", () => {
	test("sends the nudge with amount + tracking link", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const order = await seedConfirmedOrder(t);
		await t.action(internal.whatsapp.notifyPaymentReminder, {
			orderId: order._id as Id<"orders">,
		});
		const wa = fetchMock.calls.filter((c) =>
			c.url.includes("graph.facebook.com"),
		);
		expect(wa).toHaveLength(1);
		const body = (wa[0].body as { text: { body: string } }).text.body;
		expect(body).toContain("still awaiting payment");
		expect(body).toContain(order.shortId);
		expect(body).toContain("MYR 120.00");
		expect(body).toContain("/track/");
		fetchMock.restore();
	});

	test("sends even when the order has been delivered but stays unpaid", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const order = await seedConfirmedOrder(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(order._id, { status: "delivered" });
		});
		await t.action(internal.whatsapp.notifyPaymentReminder, {
			orderId: order._id as Id<"orders">,
		});
		expect(
			fetchMock.calls.filter((c) => c.url.includes("graph.facebook.com")),
		).toHaveLength(1);
		fetchMock.restore();
	});

	test("re-checks at send time — a buyer who claimed payment is never nagged", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const order = await seedConfirmedOrder(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(order._id, { paymentStatus: "claimed" });
		});
		await t.action(internal.whatsapp.notifyPaymentReminder, {
			orderId: order._id as Id<"orders">,
		});
		expect(
			fetchMock.calls.filter((c) => c.url.includes("graph.facebook.com")),
		).toHaveLength(0);
		fetchMock.restore();
	});
});
