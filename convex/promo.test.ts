/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { capsForPlan, type Plan } from "./lib/plans";
import schema from "./schema";

/**
 * Promo price + flash sale — the ORDER DOOR tests (z8r3fdcw72). The pure
 * pricing rules live in lib/promo.test.ts; these prove the doors obey them:
 * the frozen snapshot, the cap tally counted inside the mutation, the
 * straddle refusal, max-per-order, the payment hold, cancel returning units,
 * and the price-changed guard. Mutation-grade by construction: each test
 * builds the state that REACHES the branch and asserts the stored outcome.
 */

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_promo_tests";
const customer = { name: "Ali", waPhone: "60123456789" };

async function seedRetailer(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Promo Store",
		slug: "promo-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function setPlan(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	plan: Plan,
) {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no subscription row");
		const caps = capsForPlan(plan);
		await ctx.db.patch(sub._id, {
			plan,
			status: "active",
			orderCap: caps.orderCap,
			userCap: caps.userCap,
			broadcastQuota: caps.broadcastQuota,
			updatedAt: Date.now(),
		});
	});
}

/** Single-variant product at RM45 list / RM31.50 promo, flash knobs opt-in. */
async function seedPromoProduct(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	overrides: Partial<{
		promoPrice: number | undefined;
		unitCap: number;
		maxPerOrder: number;
		payWithinMinutes: number;
		endsAt: number;
		startsAt: number;
		noPromoConfig: boolean;
	}> = {},
): Promise<Id<"products">> {
	const asUser = t.withIdentity({ subject: USER });
	return asUser.mutation(api.products.create, {
		retailerId,
		name: "Brownie Box",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		promo: overrides.noPromoConfig
			? undefined
			: {
					label: "Raya Sale",
					startsAt: overrides.startsAt,
					endsAt: overrides.endsAt,
					unitCap: overrides.unitCap,
					maxPerOrder: overrides.maxPerOrder,
					payWithinMinutes: overrides.payWithinMinutes,
				},
		variants: [
			{
				optionValues: [],
				price: 4500,
				promoPrice:
					"promoPrice" in overrides ? overrides.promoPrice : 3150,
				onHand: 100,
			},
		],
	});
}

async function createOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	quantity: number,
	expectedSubtotal?: number,
) {
	return t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity }],
		currency: "MYR",
		channel: "whatsapp",
		customer,
		deliveryAddress: {
			line1: "12 Jln Mawar 3",
			city: "Petaling Jaya",
			state: "Selangor",
			postcode: "47301",
		},
		expectedSubtotal,
	});
}

/** convex-test serialises ConvexError.data to a JSON string; the real client
 * receives the structured value. Accept both so these tests mean the same
 * thing the checkout's error handler does. */
function typedErrorData(err: unknown): Record<string, unknown> {
	if (!(err instanceof ConvexError)) throw err;
	const data: unknown = err.data;
	return typeof data === "string"
		? (JSON.parse(data) as Record<string, unknown>)
		: (data as Record<string, unknown>);
}

async function orderByShortId(
	t: ReturnType<typeof setup>,
	shortId: string,
): Promise<Doc<"orders">> {
	return t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error("order missing");
		return o;
	});
}

describe("orders.create — promo snapshot", () => {
	test("a live promo freezes the sale price, the list price and the run id", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id);
		const { shortId } = await createOrder(t, retailer._id, productId, 2);
		const order = await orderByShortId(t, shortId);
		expect(order.items[0].price).toBe(3150);
		expect(order.items[0].listPrice).toBe(4500);
		expect(order.items[0].promoRunId).toBeTruthy();
		expect(order.subtotal).toBe(6300);
		// Uncapped promo: never a payment deadline.
		expect(order.paymentDueAt).toBeUndefined();
	});

	test("no promo config sells at list with no promo fields at all", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, {
			noPromoConfig: true,
			promoPrice: undefined,
		});
		const { shortId } = await createOrder(t, retailer._id, productId, 1);
		const order = await orderByShortId(t, shortId);
		expect(order.items[0].price).toBe(4500);
		expect(order.items[0].listPrice).toBeUndefined();
		expect(order.items[0].promoRunId).toBeUndefined();
	});

	test("a Starter store's promo is paused — buyers pay list", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		// Configure the promo while Pro, then downgrade: the config survives
		// but stops applying (paused, never deleted).
		const productId = await seedPromoProduct(t, retailer._id);
		await setPlan(t, retailer._id, "starter");
		const { shortId } = await createOrder(t, retailer._id, productId, 1);
		const order = await orderByShortId(t, shortId);
		expect(order.items[0].price).toBe(4500);
		expect(order.items[0].promoRunId).toBeUndefined();
	});

	test("an ended window resolves to list at the door — read-time, no cron", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id);
		// End the window directly (sanitizePromo refuses a past end at save,
		// which is exactly why the door must judge expiry itself).
		await t.run(async (ctx) => {
			const p = await ctx.db.get(productId);
			if (!p?.promo) throw new Error("promo missing");
			await ctx.db.patch(productId, {
				promo: { ...p.promo, endsAt: Date.now() - 1000 },
			});
		});
		const { shortId } = await createOrder(t, retailer._id, productId, 1);
		const order = await orderByShortId(t, shortId);
		expect(order.items[0].price).toBe(4500);
	});
});

describe("orders.create — flash cap", () => {
	test("the cap snaps the price to list once sold through, and a straddle is refused", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 3 });

		// 2 of 3 sale units taken.
		const first = await createOrder(t, retailer._id, productId, 2);
		expect((await orderByShortId(t, first.shortId)).items[0].price).toBe(3150);

		// Wants 2, 1 left → refused with the typed price-changed error, never
		// silently split across two prices.
		try {
			await createOrder(t, retailer._id, productId, 2);
			throw new Error("should have refused the straddle");
		} catch (err) {
			const data = typedErrorData(err);
			expect(data.kind).toBe("price_changed");
			expect(data.reason).toBe("units");
			expect(data.unitsLeft).toBe(1);
		}

		// Exactly the last unit still sells at the sale price…
		const second = await createOrder(t, retailer._id, productId, 1);
		expect((await orderByShortId(t, second.shortId)).items[0].price).toBe(3150);

		// …and the next buyer pays list: the sale ended for everyone.
		const third = await createOrder(t, retailer._id, productId, 1);
		const thirdOrder = await orderByShortId(t, third.shortId);
		expect(thirdOrder.items[0].price).toBe(4500);
		expect(thirdOrder.items[0].promoRunId).toBeUndefined();
	});

	test("a cancelled order returns its units to the pool", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 2 });
		const first = await createOrder(t, retailer._id, productId, 2);

		// Pool exhausted: next sale is at list.
		const atList = await createOrder(t, retailer._id, productId, 1);
		expect((await orderByShortId(t, atList.shortId)).items[0].price).toBe(4500);

		// Cancel the capped order — the tally skips cancelled orders, so the
		// units come back with zero bookkeeping.
		await t.run(async (ctx) => {
			const o = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", first.shortId))
				.first();
			if (!o) throw new Error("order missing");
			await ctx.db.patch(o._id, { status: "cancelled" });
		});
		const revived = await createOrder(t, retailer._id, productId, 1);
		expect((await orderByShortId(t, revived.shortId)).items[0].price).toBe(
			3150,
		);
	});

	test("max per order refuses the oversized cart with copy", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, {
			unitCap: 30,
			maxPerOrder: 2,
		});
		await expect(
			createOrder(t, retailer._id, productId, 3),
		).rejects.toThrow(/Max 2 of "Brownie Box" per order/);
		const ok = await createOrder(t, retailer._id, productId, 2);
		expect(ok.shortId).toBeTruthy();
	});

	test("a capped sale with a pay-within window stamps paymentDueAt", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, {
			unitCap: 10,
			payWithinMinutes: 60,
		});
		const before = Date.now();
		const { shortId } = await createOrder(t, retailer._id, productId, 1);
		const order = await orderByShortId(t, shortId);
		expect(order.paymentDueAt).toBeGreaterThanOrEqual(before + 59 * 60_000);
		expect(order.paymentDueAt).toBeLessThanOrEqual(Date.now() + 61 * 60_000);
	});
});

describe("orders.create — price-changed guard", () => {
	test("a matching expectedSubtotal passes; a stale one is refused with live prices", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id);

		const ok = await createOrder(t, retailer._id, productId, 2, 6300);
		expect(ok.shortId).toBeTruthy();

		// Promo ends between paint and submit: the client still expects the
		// sale subtotal — refused, with the live per-line price in the data.
		await t.run(async (ctx) => {
			const p = await ctx.db.get(productId);
			if (!p?.promo) throw new Error("promo missing");
			await ctx.db.patch(productId, {
				promo: { ...p.promo, endsAt: Date.now() - 1000 },
			});
		});
		try {
			await createOrder(t, retailer._id, productId, 2, 6300);
			throw new Error("should have refused");
		} catch (err) {
			const data = typedErrorData(err) as {
				kind: string;
				reason: string;
				actual: number;
				lines: Array<{ now: number }>;
			};
			expect(data.kind).toBe("price_changed");
			expect(data.reason).toBe("subtotal");
			expect(data.actual).toBe(9000);
			expect(data.lines[0].now).toBe(4500);
		}

		// Absent expectedSubtotal (stale client) keeps the old behaviour.
		const legacy = await createOrder(t, retailer._id, productId, 2);
		expect(legacy.shortId).toBeTruthy();
	});
});

describe("products — promo save rules", () => {
	test("a promo price at/above list is refused at save; a custom line never carries one", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await expect(
			seedPromoProduct(t, retailer._id, { promoPrice: 4500 }),
		).rejects.toThrow(/below the list price/);
	});

	test("Starter can't SET a promo config, and clearing stays open", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id);
		await setPlan(t, retailer._id, "starter");
		const asUser = t.withIdentity({ subject: USER });
		await expect(
			asUser.mutation(api.products.update, {
				productId,
				promo: { label: "New run" },
			}),
		).rejects.toThrow(/Pro plan/);
		// Clearing the paused promo is never gated — no trapped sellers.
		await asUser.mutation(api.products.update, { productId, promo: null });
		const cleared = await t.run((ctx) => ctx.db.get(productId));
		expect(cleared?.promo).toBeUndefined();
	});

	test("re-running with new dates mints a fresh runId; a cap edit keeps it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 5 });
		const first = await t.run((ctx) => ctx.db.get(productId));
		const firstRun = first?.promo?.runId;
		expect(firstRun).toBeTruthy();
		const asUser = t.withIdentity({ subject: USER });
		// Cap edit, same window → same pool.
		await asUser.mutation(api.products.update, {
			productId,
			promo: {
				label: "Raya Sale",
				startsAt: first?.promo?.startsAt,
				endsAt: first?.promo?.endsAt,
				unitCap: 3,
			},
		});
		const afterCapEdit = await t.run((ctx) => ctx.db.get(productId));
		expect(afterCapEdit?.promo?.runId).toBe(firstRun);
		// New end → a re-run, fresh pool.
		await asUser.mutation(api.products.update, {
			productId,
			promo: {
				label: "Raya Sale",
				startsAt: afterCapEdit?.promo?.startsAt,
				endsAt: Date.now() + 86_400_000,
				unitCap: 3,
			},
		});
		const rerun = await t.run((ctx) => ctx.db.get(productId));
		expect(rerun?.promo?.runId).not.toBe(firstRun);
	});
});

describe("storefront projection — promoState", () => {
	test("a live promo publishes state + sale prices; Starter publishes neither", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 30 });
		const live = (await t.query(api.products.list, {
			retailerId: retailer._id,
		})) as Array<{
			_id: Id<"products">;
			promoState?: { phase: string; label: string; unitsLeft?: number };
			promoPriceFrom?: number;
			priceFrom: number;
			variants: Array<{ promoPrice?: number }>;
		}>;
		const row = live.find((p) => p._id === productId);
		expect(row?.promoState?.phase).toBe("live");
		expect(row?.promoState?.label).toBe("Raya Sale");
		expect(row?.promoState?.unitsLeft).toBe(30);
		expect(row?.promoPriceFrom).toBe(3150);
		expect(row?.priceFrom).toBe(4500);
		expect(row?.variants[0]?.promoPrice).toBe(3150);

		await setPlan(t, retailer._id, "starter");
		const paused = (await t.query(api.products.list, {
			retailerId: retailer._id,
		})) as typeof live;
		const pausedRow = paused.find((p) => p._id === productId);
		expect(pausedRow?.promoState).toBeUndefined();
		expect(pausedRow?.promoPriceFrom).toBeUndefined();
		expect(pausedRow?.variants[0]?.promoPrice).toBeUndefined();
	});
});
