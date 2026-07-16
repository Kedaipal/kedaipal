/// <reference types="vite/client" />
// Seller-triggered manual payment reminder — see docs/payment-reminder.md.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_manual_reminder_test";

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

const waCalls = (calls: FetchCall[]) =>
	calls.filter((c) => c.url.includes("graph.facebook.com"));

/** Seed a retailer + one confirmed, unpaid order with a reachable buyer. */
async function seedConfirmedOrder(
	t: ReturnType<typeof setup>,
): Promise<Doc<"orders">> {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Manual Reminder Store",
		slug: "manual-reminder",
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
	// Fake timers freeze Date.now() so both the stamp and the cooldown re-check
	// see the same instant (same convex-test caveat as paymentReminders.test.ts).
	vi.useFakeTimers();
	process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
	process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
	process.env.APP_URL = "https://kedaipal.com";
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("orders.sendPaymentReminder (seller action)", () => {
	test("sends the full payment message + stamps the cooldown", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const order = await seedConfirmedOrder(t);

		const res = await t
			.withIdentity({ subject: USER })
			.action(api.orders.sendPaymentReminder, { shortId: order.shortId });
		expect(res).toEqual({ ok: true });

		const wa = waCalls(fetchMock.calls);
		expect(wa.length).toBeGreaterThanOrEqual(1);
		const payload = JSON.stringify(wa[0].body);
		expect(payload).toContain(order.shortId);
		expect(payload).toContain("still awaiting payment");

		const stamped = await t.run(async (ctx) => ctx.db.get(order._id));
		expect(stamped?.lastManualReminderAt).toBeDefined();
		fetchMock.restore();
	});

	test("second tap within the cooldown is rejected and sends nothing", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const order = await seedConfirmedOrder(t);
		const asUser = t.withIdentity({ subject: USER });

		await asUser.action(api.orders.sendPaymentReminder, {
			shortId: order.shortId,
		});
		const sentAfterFirst = waCalls(fetchMock.calls).length;

		const second = await asUser.action(api.orders.sendPaymentReminder, {
			shortId: order.shortId,
		});
		expect(second).toEqual({ ok: false, reason: "cooldown" });
		// No additional WhatsApp send happened.
		expect(waCalls(fetchMock.calls).length).toBe(sentAfterFirst);
		fetchMock.restore();
	});

	test("rejects a claimed order without sending (payment awaits the seller)", async () => {
		const t = setup();
		const fetchMock = installFetchMock();
		const order = await seedConfirmedOrder(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(order._id, { paymentStatus: "claimed" });
		});

		const res = await t
			.withIdentity({ subject: USER })
			.action(api.orders.sendPaymentReminder, { shortId: order.shortId });
		expect(res).toEqual({ ok: false, reason: "claimed" });
		expect(waCalls(fetchMock.calls)).toHaveLength(0);
		fetchMock.restore();
	});

	test("requires authentication", async () => {
		const t = setup();
		const order = await seedConfirmedOrder(t);
		await expect(
			t.action(api.orders.sendPaymentReminder, { shortId: order.shortId }),
		).rejects.toThrow();
	});
});
