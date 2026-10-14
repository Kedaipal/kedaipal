/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { PROMOTION_BATCH_WRITES } from "./lib/promotions";
import schema from "./schema";

/**
 * Bulk promotions (`z8r3fducfd`). The promotion is a HANDLE: every assertion
 * here reads the product and variant rows the storefront prices from, never
 * the promotion's own bookkeeping alone — a promotion that says "applied"
 * while a product still carries the old price is the bug this file exists
 * to catch.
 */

const modules = import.meta.glob("./**/*.ts");
const USER = "user_promotions";
const HOUR = 60 * 60 * 1000;

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

afterEach(() => {
	vi.useRealTimers();
});

async function seedRetailer(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Promotions Store",
		slug: "promotions-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function setStarter(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
) {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no subscription row");
		await ctx.db.patch(sub._id, { plan: "starter", status: "active" });
	});
}

/**
 * A product with `prices.length` choices (list prices in sen), inserted
 * directly so a test can seed dozens without tripping the product rate
 * limit. Returns the product and its variant ids, in order.
 */
async function seedProduct(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	name: string,
	prices: number[] = [2000],
	extra: Partial<Doc<"products">> = {},
): Promise<{ productId: Id<"products">; variantIds: Id<"productVariants">[] }> {
	return t.run(async (ctx) => {
		const now = Date.now();
		const productId = await ctx.db.insert("products", {
			retailerId,
			name,
			currency: "MYR",
			imageStorageIds: [],
			active: true,
			blockWhenOutOfStock: false,
			channel: "whatsapp",
			sortOrder: now,
			createdAt: now,
			updatedAt: now,
			...extra,
		} as Omit<Doc<"products">, "_id" | "_creationTime">);
		const variantIds: Id<"productVariants">[] = [];
		for (const [i, price] of prices.entries())
			variantIds.push(
				await ctx.db.insert("productVariants", {
					productId,
					retailerId,
					optionValues: prices.length > 1 ? [`Size ${i + 1}`] : [],
					price,
					onHand: 10,
					reserved: 0,
					parcelWeightG: 0,
					imageStorageIds: [],
					active: true,
					sortOrder: i,
					createdAt: now,
					updatedAt: now,
				}),
			);
		return { productId, variantIds };
	});
}

const product = (t: ReturnType<typeof setup>, id: Id<"products">) =>
	t.run((ctx) => ctx.db.get(id));
const variant = (t: ReturnType<typeof setup>, id: Id<"productVariants">) =>
	t.run((ctx) => ctx.db.get(id));

/** 20% off every line, as the review step would send it. */
const twentyOff = (p: { productId: Id<"products">; variantIds: Id<"productVariants">[] }, list: number[]) => ({
	productId: p.productId,
	prices: p.variantIds.map((variantId, i) => ({
		variantId,
		promoPrice: Math.round(list[i] * 0.8),
	})),
});

describe("create — applies the terms to every product", () => {
	test("writes the window to each product and the sale price to each line", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const a = await seedProduct(t, retailer._id, "Kuih lapis", [2000, 3000]);
		const b = await seedProduct(t, retailer._id, "Seri muka", [1500]);
		const endsAt = Date.now() + 3 * HOUR;

		const promotionId = await t
			.withIdentity({ subject: USER })
			.mutation(api.promotions.create, {
				retailerId: retailer._id,
				label: "Happy Hour",
				percentOff: 20,
				endsAt,
				members: [twentyOff(a, [2000, 3000]), twentyOff(b, [1500])],
			});

		for (const id of [a.productId, b.productId]) {
			const row = await product(t, id);
			expect(row?.promo?.label).toBe("Happy Hour");
			expect(row?.promo?.endsAt).toBe(endsAt);
		}
		expect((await variant(t, a.variantIds[0]))?.promoPrice).toBe(1600);
		expect((await variant(t, a.variantIds[1]))?.promoPrice).toBe(2400);
		expect((await variant(t, b.variantIds[0]))?.promoPrice).toBe(1200);

		const { promotions } = await t
			.withIdentity({ subject: USER })
			.query(api.promotions.list, { retailerId: retailer._id });
		expect(promotions).toHaveLength(1);
		expect(promotions[0]._id).toBe(promotionId);
		expect(promotions[0].productCount).toBe(2);
		expect(promotions[0].queue.pending).toBe(0);
		expect(promotions[0].queue.clearing).toBe(0);
	});

	test("a line the review left out is written with NO sale price — even one it had before", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "Cake", [5000, 8000]);
		await t.run((ctx) => ctx.db.patch(p.variantIds[1], { promoPrice: 6000 }));

		await t.withIdentity({ subject: USER }).mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 10,
			members: [
				{
					productId: p.productId,
					prices: [{ variantId: p.variantIds[0], promoPrice: 4500 }],
				},
			],
			// The product carries its own sale on line 2; joining replaces it.
			move: [p.productId],
		});

		expect((await variant(t, p.variantIds[0]))?.promoPrice).toBe(4500);
		expect((await variant(t, p.variantIds[1]))?.promoPrice).toBeUndefined();
	});

	test("a booking or event listing gets the price but never the flash extras", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const tent = await seedProduct(t, retailer._id, "Tent stay", [10000], {
			kind: "booking",
		});
		const tart = await seedProduct(t, retailer._id, "Tart", [1000]);

		await t.withIdentity({ subject: USER }).mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 20,
			endsAt: Date.now() + HOUR,
			unitCap: 30,
			maxPerOrder: 2,
			members: [twentyOff(tent, [10000]), twentyOff(tart, [1000])],
		});

		const booking = await product(t, tent.productId);
		expect(booking?.promo?.unitCap).toBeUndefined();
		expect(booking?.promo?.maxPerOrder).toBeUndefined();
		expect((await variant(t, tent.variantIds[0]))?.promoPrice).toBe(8000);
		const plain = await product(t, tart.productId);
		expect(plain?.promo?.unitCap).toBe(30);
		expect(plain?.promo?.maxPerOrder).toBe(2);
	});

	test("refuses a sale price at or above the line's normal price", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "Cake", [5000]);
		await expect(
			t.withIdentity({ subject: USER }).mutation(api.promotions.create, {
				retailerId: retailer._id,
				percentOff: 10,
				members: [
					{
						productId: p.productId,
						prices: [{ variantId: p.variantIds[0], promoPrice: 5000 }],
					},
				],
			}),
		).rejects.toThrow(/below its normal price/);
	});

	test("refuses more sale prices than one promotion can carry, before reading a product", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "Cake", [5000]);
		const line = { variantId: p.variantIds[0], promoPrice: 4000 };
		await expect(
			t.withIdentity({ subject: USER }).mutation(api.promotions.create, {
				retailerId: retailer._id,
				percentOff: 10,
				members: [
					{ productId: p.productId, prices: Array.from({ length: 4001 }, () => line) },
				],
			}),
		).rejects.toThrow(/split it into two/);
	});
});

describe("a product is never taken over silently", () => {
	test("one already on another open promotion is refused unless moved", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "Kuih", [2000]);
		const asUser = t.withIdentity({ subject: USER });
		const first = await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			label: "Raya Sale",
			percentOff: 20,
			endsAt: Date.now() + 24 * HOUR,
			members: [twentyOff(p, [2000])],
		});

		await expect(
			asUser.mutation(api.promotions.create, {
				retailerId: retailer._id,
				label: "Happy Hour",
				percentOff: 50,
				members: [{ productId: p.productId, prices: [{ variantId: p.variantIds[0], promoPrice: 1000 }] }],
			}),
		).rejects.toThrow(/already on Raya Sale/);

		await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			label: "Happy Hour",
			percentOff: 50,
			members: [{ productId: p.productId, prices: [{ variantId: p.variantIds[0], promoPrice: 1000 }] }],
			move: [p.productId],
		});
		expect((await product(t, p.productId))?.promo?.label).toBe("Happy Hour");
		expect((await variant(t, p.variantIds[0]))?.promoPrice).toBe(1000);
		// The count on each row follows the product: it left Raya Sale.
		const { promotions } = await asUser.query(api.promotions.list, {
			retailerId: retailer._id,
		});
		const byLabel = new Map(promotions.map((p) => [p.label, p.productCount]));
		expect(byLabel.get("Raya Sale")).toBe(0);
		expect(byLabel.get("Happy Hour")).toBe(1);
		// The old promotion let go without clearing over the new price.
		const old = await asUser.query(api.promotions.get, { promotionId: first });
		expect(old?.products).toHaveLength(0);
	});

	test("one carrying its OWN live sale is refused unless moved", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "Kuih", [2000], {
			promo: { runId: "own", label: "Own sale" },
		});
		await expect(
			t.withIdentity({ subject: USER }).mutation(api.promotions.create, {
				retailerId: retailer._id,
				percentOff: 20,
				members: [twentyOff(p, [2000])],
			}),
		).rejects.toThrow(/its own sale/);
	});

	test("a promotion whose window has passed no longer holds its products", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "Kuih", [2000]);
		const asUser = t.withIdentity({ subject: USER });
		const first = await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 20,
			endsAt: Date.now() + HOUR,
			members: [twentyOff(p, [2000])],
		});
		await t.run((ctx) => ctx.db.patch(first, { endsAt: Date.now() - 1 }));
		await t.run(async (ctx) => {
			const row = await ctx.db.get(p.productId);
			if (row?.promo)
				await ctx.db.patch(p.productId, {
					promo: { ...row.promo, endsAt: Date.now() - 1 },
				});
		});

		await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 10,
			members: [{ productId: p.productId, prices: [{ variantId: p.variantIds[0], promoPrice: 1800 }] }],
		});
		expect((await variant(t, p.variantIds[0]))?.promoPrice).toBe(1800);
	});
});

describe("end — every product back to its normal price", () => {
	test("clears the window and every sale price, and keeps the promotion as history", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const a = await seedProduct(t, retailer._id, "A", [2000, 3000]);
		const b = await seedProduct(t, retailer._id, "B", [1500]);
		const asUser = t.withIdentity({ subject: USER });
		const promotionId = await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 20,
			members: [twentyOff(a, [2000, 3000]), twentyOff(b, [1500])],
		});

		await asUser.mutation(api.promotions.end, { promotionId });

		for (const id of [a.productId, b.productId])
			expect((await product(t, id))?.promo).toBeUndefined();
		for (const id of [...a.variantIds, ...b.variantIds])
			expect((await variant(t, id))?.promoPrice).toBeUndefined();
		const detail = await asUser.query(api.promotions.get, { promotionId });
		expect(detail?.promotion.endedAt).toBeDefined();
		expect(detail?.products).toHaveLength(2);
	});

	test("leaves alone a product the seller re-priced by hand since", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "A", [2000]);
		const asUser = t.withIdentity({ subject: USER });
		const promotionId = await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 20,
			members: [twentyOff(p, [2000])],
		});
		// Another run now owns the product's promo.
		await t.run(async (ctx) => {
			const row = await ctx.db.get(p.productId);
			if (row?.promo)
				await ctx.db.patch(p.productId, {
					promo: { ...row.promo, runId: "set-by-hand" },
				});
		});

		await asUser.mutation(api.promotions.end, { promotionId });

		expect((await product(t, p.productId))?.promo?.runId).toBe("set-by-hand");
		expect((await variant(t, p.variantIds[0]))?.promoPrice).toBe(1600);
	});

	test("is never Pro-gated — a store that dropped to Starter can still end a sale", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "A", [2000]);
		const asUser = t.withIdentity({ subject: USER });
		const promotionId = await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 20,
			members: [twentyOff(p, [2000])],
		});
		await setStarter(t, retailer._id);

		await asUser.mutation(api.promotions.end, { promotionId });
		expect((await product(t, p.productId))?.promo).toBeUndefined();
	});
});

describe("the Pro gate", () => {
	test("setting a promotion is Pro; a Starter store is refused", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "A", [2000]);
		await setStarter(t, retailer._id);
		await expect(
			t.withIdentity({ subject: USER }).mutation(api.promotions.create, {
				retailerId: retailer._id,
				percentOff: 20,
				members: [twentyOff(p, [2000])],
			}),
		).rejects.toThrow();
		expect((await product(t, p.productId))?.promo).toBeUndefined();
	});

	test("removing a product is open on Starter", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const a = await seedProduct(t, retailer._id, "A", [2000]);
		const b = await seedProduct(t, retailer._id, "B", [1000]);
		const asUser = t.withIdentity({ subject: USER });
		const promotionId = await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 20,
			members: [twentyOff(a, [2000]), twentyOff(b, [1000])],
		});
		await setStarter(t, retailer._id);

		await asUser.mutation(api.promotions.removeProducts, {
			promotionId,
			productIds: [a.productId],
		});
		expect((await product(t, a.productId))?.promo).toBeUndefined();
		expect((await variant(t, a.variantIds[0]))?.promoPrice).toBeUndefined();
		// The other member is untouched.
		expect((await variant(t, b.variantIds[0]))?.promoPrice).toBe(800);
		const { promotions } = await asUser.query(api.promotions.list, {
			retailerId: retailer._id,
		});
		expect(promotions[0].productCount).toBe(1);
	});
});

describe("update — one edit re-prices every product", () => {
	test("a window change starts a fresh run (fresh cap pool); a label edit keeps it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "A", [2000]);
		const asUser = t.withIdentity({ subject: USER });
		const endsAt = Date.now() + 2 * HOUR;
		const promotionId = await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 20,
			endsAt,
			unitCap: 10,
			members: [twentyOff(p, [2000])],
		});
		const firstRun = (await product(t, p.productId))?.promo?.runId;

		await asUser.mutation(api.promotions.update, {
			promotionId,
			label: "Renamed",
			percentOff: 20,
			endsAt,
			unitCap: 10,
			members: [twentyOff(p, [2000])],
		});
		const afterLabel = await product(t, p.productId);
		expect(afterLabel?.promo?.label).toBe("Renamed");
		expect(afterLabel?.promo?.runId).toBe(firstRun);

		await asUser.mutation(api.promotions.update, {
			promotionId,
			label: "Renamed",
			percentOff: 30,
			endsAt: endsAt + HOUR,
			unitCap: 10,
			members: [
				{ productId: p.productId, prices: [{ variantId: p.variantIds[0], promoPrice: 1400 }] },
			],
		});
		const afterWindow = await product(t, p.productId);
		expect(afterWindow?.promo?.runId).not.toBe(firstRun);
		expect((await variant(t, p.variantIds[0]))?.promoPrice).toBe(1400);
	});
});

describe("a big promotion is applied in batches", () => {
	test("past one transaction's budget, a scheduled continuation finishes the rest", async () => {
		vi.useFakeTimers();
		const t = setup();
		const retailer = await seedRetailer(t);
		// 40 products × 12 lines ≈ 560 writes, past one batch's budget.
		const list = Array.from({ length: 12 }, (_, i) => 1000 + i * 100);
		const seeded = [];
		for (let i = 0; i < 40; i++)
			seeded.push(await seedProduct(t, retailer._id, `P${i}`, list));
		expect(40 * (list.length + 2)).toBeGreaterThan(PROMOTION_BATCH_WRITES);

		const asUser = t.withIdentity({ subject: USER });
		const promotionId = await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 20,
			members: seeded.map((p) => twentyOff(p, list)),
		});
		const mid = await asUser.query(api.promotions.get, { promotionId });
		expect(mid?.queue.pending).toBeGreaterThan(0);

		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const done = await asUser.query(api.promotions.get, { promotionId });
		expect(done?.queue.pending).toBe(0);
		expect(done?.queue.applied).toBe(40);
		const last = seeded[39];
		expect((await variant(t, last.variantIds[11]))?.promoPrice).toBe(
			Math.round(list[11] * 0.8),
		);
	});
});

describe("the product form can't fight the promotion", () => {
	test("products.update refuses a promo change on a grouped product, naming the promotion", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "A", [2000]);
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			label: "Happy Hour",
			percentOff: 20,
			members: [twentyOff(p, [2000])],
		});
		await expect(
			asUser.mutation(api.products.update, {
				productId: p.productId,
				promo: null,
			}),
		).rejects.toThrow(/part of Happy Hour/);
		expect((await product(t, p.productId))?.promo).toBeDefined();
	});

	test("deleting a product takes its membership with it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const p = await seedProduct(t, retailer._id, "A", [2000]);
		const asUser = t.withIdentity({ subject: USER });
		await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 20,
			members: [twentyOff(p, [2000])],
		});
		await asUser.mutation(api.products.deletePermanently, {
			productId: p.productId,
		});
		const left = await t.run((ctx) =>
			ctx.db.query("promotionMembers").collect(),
		);
		expect(left).toHaveLength(0);
	});
});

describe("pickerCatalog", () => {
	test("says why a product can't simply be picked", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const held = await seedProduct(t, retailer._id, "Held", [2000]);
		const own = await seedProduct(t, retailer._id, "Own", [2000], {
			promo: { runId: "own", label: "Own", endsAt: Date.now() + HOUR },
		});
		const free = await seedProduct(t, retailer._id, "Free", [2000]);
		const asUser = t.withIdentity({ subject: USER });
		const promotionId = await asUser.mutation(api.promotions.create, {
			retailerId: retailer._id,
			label: "Raya Sale",
			percentOff: 20,
			members: [twentyOff(held, [2000])],
		});

		const fresh = await asUser.query(api.promotions.pickerCatalog, {
			retailerId: retailer._id,
		});
		const byName = new Map(fresh.products.map((p) => [p.name, p]));
		expect(byName.get("Held")?.elsewhere?.label).toBe("Raya Sale");
		expect(byName.get("Own")?.ownSale?.label).toBe("Own");
		expect(byName.get("Free")?.elsewhere).toBeNull();
		expect(byName.get("Free")?.ownSale).toBeNull();
		void free;
		void own;

		// Editing Raya Sale: its own product is "in this", not "elsewhere", and
		// its promo is not mistaken for an own sale.
		const editing = await asUser.query(api.promotions.pickerCatalog, {
			retailerId: retailer._id,
			promotionId,
		});
		const heldNow = editing.products.find((p) => p.name === "Held");
		expect(heldNow?.inThisPromotion).toBe(true);
		expect(heldNow?.elsewhere).toBeNull();
		expect(heldNow?.ownSale).toBeNull();
	});
});
