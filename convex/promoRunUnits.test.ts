/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { loadPromoRunUnits, tallyPromoUnits } from "./lib/promoTally";
import schema from "./schema";

/**
 * The flash-sale units counter (`promoRunUnits`, 86eyjv002) is a CACHE of
 * `tallyPromoUnits` that the public catalogue reads instead of scanning
 * orders. The doors still gate on the tally, so the one property that
 * matters is: counter ≡ tally after every path that changes what the tally
 * counts. Every test below drives a REAL seam (the public mutation or the
 * cron), then asserts that equality — never a hand-computed number alone —
 * so a seam that forgets the counter fails here, not on a buyer's phone.
 */

const modules = import.meta.glob("./**/*.ts");
const USER = "user_promo_run_units";
const ADMIN = "user_promo_run_units_admin";
const customer = { name: "Ali", waPhone: "60123456789" };
const address = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

let prevAdminEnv: string | undefined;
beforeEach(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}
type T = ReturnType<typeof setup>;

async function seedRetailer(t: T) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Units Store",
		slug: "units-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

/** Single-variant product at RM45 list / RM31.50 sale, through the real save. */
async function seedPromoProduct(
	t: T,
	retailerId: Id<"retailers">,
	promo: { unitCap?: number; payWithinMinutes?: number; endsAt?: number } = {},
	name = "Brownie Box",
): Promise<Id<"products">> {
	return t.withIdentity({ subject: USER }).mutation(api.products.create, {
		retailerId,
		name,
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		promo: { label: "Flash", ...promo },
		variants: [{ optionValues: [], price: 4500, promoPrice: 3150, onHand: 100 }],
	});
}

async function buy(
	t: T,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	quantity: number,
): Promise<{ orderId: Id<"orders">; shortId: string }> {
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity }],
		currency: "MYR",
		channel: "whatsapp",
		customer,
		deliveryAddress: address,
	});
	const orderId = await t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error("order missing");
		return o._id;
	});
	return { orderId, shortId };
}

/** The counter row and the authoritative tally for the product's CURRENT run. */
async function counterAndTally(
	t: T,
	productId: Id<"products">,
): Promise<{ counter: number | null; tally: number }> {
	return t.run(async (ctx) => {
		const product = await ctx.db.get(productId);
		const promo = product?.promo;
		if (!product || !promo) throw new Error("no promo");
		const row = await loadPromoRunUnits(ctx, productId, promo.runId);
		const tally = await tallyPromoUnits(ctx, {
			retailerId: product.retailerId,
			productId,
			runId: promo.runId,
			startsAt: promo.startsAt ?? 0,
			endsAt: promo.endsAt,
		});
		return { counter: row?.units ?? null, tally };
	});
}

async function expectInSync(t: T, productId: Id<"products">, units: number) {
	expect(await counterAndTally(t, productId)).toEqual({
		counter: units,
		tally: units,
	});
}

async function unitsLeftOnStorefront(
	t: T,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
): Promise<number | undefined> {
	const rows = (await t.query(api.products.list, { retailerId })) as Array<{
		_id: Id<"products">;
		promoState?: { unitsLeft?: number };
	}>;
	return rows.find((r) => r._id === productId)?.promoState?.unitsLeft;
}

describe("minting — the counter starts equal to the tally", () => {
	test("a capped product's save mints its run's counter at 0", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 10 });
		await expectInSync(t, productId, 0);
	});

	test("an UNCAPPED promo mints nothing — no cap, nothing to count", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id);
		expect((await counterAndTally(t, productId)).counter).toBeNull();
	});

	test("a cap ADDED to a running sale mints from the tally — and the sales before it stay out", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id);
		const early = await buy(t, retailer._id, productId, 3); // uncapped sale
		const before = await t.run((ctx) => ctx.db.get(productId));

		await t.withIdentity({ subject: USER }).mutation(api.products.update, {
			productId,
			promo: { label: "Flash", endsAt: before?.promo?.endsAt, unitCap: 10 },
		});
		const after = await t.run((ctx) => ctx.db.get(productId));
		// The run is KEPT, but the cap stamps `startsAt = now`, which moves the
		// tally's window past the 3 earlier units. The counter follows the
		// tally (the doors' answer), not the runId.
		expect(after?.promo?.runId).toBe(before?.promo?.runId);
		await expectInSync(t, productId, 0);
		await buy(t, retailer._id, productId, 2);
		await expectInSync(t, productId, 2);

		// Cancelling an order from BEFORE the window must not move the counter
		// — the tally never counted it.
		await t
			.withIdentity({ subject: USER })
			.mutation(api.orders.updateStatus, {
				orderId: early.orderId,
				status: "cancelled",
			});
		await expectInSync(t, productId, 2);
	});

	test("a re-run (new window) mints a fresh pool and leaves the old run's row alone", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 10 });
		await buy(t, retailer._id, productId, 2);
		const oldRun = (await t.run((ctx) => ctx.db.get(productId)))?.promo?.runId;

		await t.withIdentity({ subject: USER }).mutation(api.products.update, {
			productId,
			promo: {
				label: "Flash",
				unitCap: 10,
				endsAt: Date.now() + 2 * 60 * 60 * 1000,
			},
		});
		await expectInSync(t, productId, 0);
		const oldRow = await t.run((ctx) =>
			loadPromoRunUnits(ctx, productId, oldRun ?? ""),
		);
		expect(oldRow?.units).toBe(2);
	});

	test("an edit that KEEPS a legacy run (no row yet) mints it from the tally, not 0", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 10 });
		await buy(t, retailer._id, productId, 3);
		// A run live before the table shipped: sales, no row.
		await t.run(async (ctx) => {
			for (const r of await ctx.db.query("promoRunUnits").collect())
				await ctx.db.delete(r._id);
		});
		const before = await t.run((ctx) => ctx.db.get(productId));
		// Label-only edit on the stored window — sanitizePromo keeps the run.
		await t.withIdentity({ subject: USER }).mutation(api.products.update, {
			productId,
			promo: {
				label: "Flash Friday",
				startsAt: before?.promo?.startsAt,
				endsAt: before?.promo?.endsAt,
				unitCap: 10,
			},
		});
		const after = await t.run((ctx) => ctx.db.get(productId));
		expect(after?.promo?.runId).toBe(before?.promo?.runId);
		await expectInSync(t, productId, 3);
	});

	test("cancelling an order from a DEAD run leaves that run's row frozen", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 10 });
		const old = await buy(t, retailer._id, productId, 2);
		const oldRun = (await t.run((ctx) => ctx.db.get(productId)))?.promo?.runId;
		// Re-run with a window that still COVERS the old order, so only the
		// run check (not the window check) keeps it out.
		await t.withIdentity({ subject: USER }).mutation(api.products.update, {
			productId,
			promo: {
				label: "Flash",
				unitCap: 10,
				startsAt: Date.now() - 60 * 60 * 1000,
				endsAt: Date.now() + 2 * 60 * 60 * 1000,
			},
		});
		await t
			.withIdentity({ subject: USER })
			.mutation(api.orders.updateStatus, {
				orderId: old.orderId,
				status: "cancelled",
			});
		await expectInSync(t, productId, 0);
		const oldRow = await t.run((ctx) =>
			loadPromoRunUnits(ctx, productId, oldRun ?? ""),
		);
		expect(oldRow?.units).toBe(2);
	});

	test("a bulk promotion's apply mints each capped member at 0", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await t.run(async (ctx) => {
			const now = Date.now();
			const id = await ctx.db.insert("products", {
				retailerId: retailer._id,
				name: "Kuih lapis",
				currency: "MYR",
				imageStorageIds: [],
				active: true,
				blockWhenOutOfStock: false,
				channel: "whatsapp",
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			return id;
		});
		const variantId = await t.run((ctx) =>
			ctx.db.insert("productVariants", {
				productId,
				retailerId: retailer._id,
				optionValues: [],
				price: 2000,
				onHand: 10,
				reserved: 0,
				parcelWeightG: 0,
				imageStorageIds: [],
				active: true,
				sortOrder: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}),
		);
		await t.withIdentity({ subject: USER }).mutation(api.promotions.create, {
			retailerId: retailer._id,
			percentOff: 20,
			unitCap: 5,
			endsAt: Date.now() + 60 * 60 * 1000,
			members: [{ productId, prices: [{ variantId, promoPrice: 1600 }] }],
		});
		await expectInSync(t, productId, 0);
		await buy(t, retailer._id, productId, 2);
		await expectInSync(t, productId, 2);
	});
});

describe("the order lifecycle keeps counter ≡ tally", () => {
	test("create adds the sale units; a list-price line after the cap adds none", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 3 });
		await buy(t, retailer._id, productId, 2);
		await expectInSync(t, productId, 2);
		await buy(t, retailer._id, productId, 1);
		await expectInSync(t, productId, 3);
		// Cap hit — this sells at list, carries no run, consumes nothing.
		await buy(t, retailer._id, productId, 4);
		await expectInSync(t, productId, 3);
	});

	test("a seller cancel gives the units back, and a repeat cancel can't double-release", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 10 });
		const { orderId } = await buy(t, retailer._id, productId, 4);
		await buy(t, retailer._id, productId, 1);
		await t
			.withIdentity({ subject: USER })
			.mutation(api.orders.updateStatus, { orderId, status: "cancelled" });
		await expectInSync(t, productId, 1);
		// A repeat cancel is a no-op at the door — and must stay one here.
		await t
			.withIdentity({ subject: USER })
			.mutation(api.orders.updateStatus, { orderId, status: "cancelled" });
		await expectInSync(t, productId, 1);
	});

	test("the unpaid-flash expiry gives the units back", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, {
			unitCap: 10,
			payWithinMinutes: 30,
		});
		const { orderId } = await buy(t, retailer._id, productId, 3);
		await t.run((ctx) =>
			ctx.db.patch(orderId, { paymentDueAt: Date.now() - 1000 }),
		);
		const result = await t.mutation(
			internal.orderClaims.cancelUnpaidDueOrders,
			{},
		);
		expect(result.cancelled).toBe(1);
		await expectInSync(t, productId, 0);
	});

	test("an admin hard-deleting a LIVE order gives the units back; deleting a cancelled one doesn't", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 10 });
		const live = await buy(t, retailer._id, productId, 2);
		const dead = await buy(t, retailer._id, productId, 3);
		await t
			.withIdentity({ subject: USER })
			.mutation(api.orders.updateStatus, {
				orderId: dead.orderId,
				status: "cancelled",
			});
		await expectInSync(t, productId, 2);
		const asAdmin = t.withIdentity({ subject: ADMIN });
		await asAdmin.mutation(api.orders.deleteOrder, { orderId: dead.orderId });
		await expectInSync(t, productId, 2);
		await asAdmin.mutation(api.orders.deleteOrder, { orderId: live.orderId });
		await expectInSync(t, productId, 0);
	});

	test("declining a custom line that carried sale units hands them back", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await t
			.withIdentity({ subject: USER })
			.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Mixed",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				promo: { label: "Flash", unitCap: 10 },
				variants: [
					{ optionValues: [], price: 10_000, promoPrice: 8000, onHand: 10 },
					{
						optionValues: [],
						price: 0,
						onHand: 0,
						isCustom: true,
						customLabel: "Bespoke",
					},
				],
			});
		const variants = await t.run((ctx) =>
			ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", productId))
				.collect(),
		);
		const fixed = variants.find((v) => !v.isCustom)?._id;
		const custom = variants.find((v) => v.isCustom)?._id;
		if (!fixed || !custom) throw new Error("variants missing");
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [
				{ variantId: fixed, quantity: 2 },
				{ variantId: custom, quantity: 1 },
			],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: address,
		});
		const order = await t.run(async (ctx) =>
			ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first(),
		);
		if (!order) throw new Error("order missing");
		await expectInSync(t, productId, 2);

		// A quoted custom line never prices on promo today (it's 0 at create),
		// so stamp one the way a future door could — line AND counter, as the
		// create seam would — to reach the drop path's release.
		const runId = order.items[0].promoRunId;
		if (!runId) throw new Error("fixed line should have sold on promo");
		await t.run(async (ctx) => {
			await ctx.db.patch(order._id, {
				items: order.items.map((i) =>
					i.variantId === custom ? { ...i, promoRunId: runId } : i,
				),
			});
			const row = await loadPromoRunUnits(ctx, productId, runId);
			if (row) await ctx.db.patch(row._id, { units: row.units + 1 });
		});
		await expectInSync(t, productId, 3);

		await t.mutation(api.orders.declineMockupItem, {
			token: order.trackingToken ?? "",
		});
		const after = await t.run((ctx) => ctx.db.get(order._id));
		expect(after?.status).not.toBe("cancelled");
		expect(after?.items).toHaveLength(1);
		await expectInSync(t, productId, 2);
	});
});

describe("the seams mirror the tally's window", () => {
	test("an order landing after the window closed (a price-locked claim) is never counted", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 10 });
		const { orderId } = await buy(t, retailer._id, productId, 2);
		await expectInSync(t, productId, 2);
		const { countPromoUnitsForNewOrder, releasePromoUnits } = await import(
			"./lib/promoTally"
		);
		await t.run(async (ctx) => {
			// The sale closed a moment ago — same run, so a claim sent during it
			// still commits its locked sale line now, AFTER `endsAt`.
			const product = await ctx.db.get(productId);
			if (!product?.promo) throw new Error("no promo");
			await ctx.db.patch(productId, {
				promo: { ...product.promo, endsAt: Date.now() - 1 },
			});
			const template = await ctx.db.get(orderId);
			if (!template) throw new Error("no order");
			const { _id, _creationTime, ...rest } = template;
			const lateId = await ctx.db.insert("orders", {
				...rest,
				shortId: "LATE01",
			});
			const late = await ctx.db.get(lateId);
			if (!late) throw new Error("no late order");
			await countPromoUnitsForNewOrder(ctx, late, Date.now());
			await releasePromoUnits(ctx, late, late.items, Date.now());
			await countPromoUnitsForNewOrder(ctx, late, Date.now());
		});
		// The tally's window ends at `endsAt`; the counter must agree.
		await expectInSync(t, productId, 2);
	});
});

describe("the catalogue reads the counter, never the orders", () => {
	test("products.list's units left follows the counter row", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 10 });
		await buy(t, retailer._id, productId, 3);
		expect(await unitsLeftOnStorefront(t, retailer._id, productId)).toBe(7);

		// Prove WHICH source answered: skew the row away from the orders. A
		// read that still tallied would keep saying 7.
		await t.run(async (ctx) => {
			const product = await ctx.db.get(productId);
			const row = await loadPromoRunUnits(
				ctx,
				productId,
				product?.promo?.runId ?? "",
			);
			if (row) await ctx.db.patch(row._id, { units: 9 });
		});
		expect(await unitsLeftOnStorefront(t, retailer._id, productId)).toBe(1);
	});

	test("a run with no row yet (live before the table) falls back to the tally", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 10 });
		await buy(t, retailer._id, productId, 4);
		await t.run(async (ctx) => {
			const rows = await ctx.db.query("promoRunUnits").collect();
			for (const r of rows) await ctx.db.delete(r._id);
		});
		expect(await unitsLeftOnStorefront(t, retailer._id, productId)).toBe(6);
		// …and a sale does NOT mint it: that would tally the window a second
		// time inside the door, which already did. The backfill mints it.
		await buy(t, retailer._id, productId, 1);
		expect((await counterAndTally(t, productId)).counter).toBeNull();
		expect(await unitsLeftOnStorefront(t, retailer._id, productId)).toBe(5);
	});
});

describe("migrations:backfillPromoRunUnits", () => {
	test("mints legacy runs from the tally and resets a drifted row, one product per transaction", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const legacy = await seedPromoProduct(t, retailer._id, { unitCap: 10 }, "A");
		const drifting = await seedPromoProduct(t, retailer._id, { unitCap: 10 }, "B");
		await seedPromoProduct(t, retailer._id, {}, "Uncapped");
		await buy(t, retailer._id, legacy, 2);
		await buy(t, retailer._id, drifting, 3);
		await t.run(async (ctx) => {
			const rows = await ctx.db.query("promoRunUnits").collect();
			for (const r of rows) {
				if (r.productId === legacy) await ctx.db.delete(r._id);
				else await ctx.db.patch(r._id, { units: 99 });
			}
		});

		vi.useFakeTimers();
		try {
			const page = await t.mutation(
				internal.migrations.backfillPromoRunUnits,
				{},
			);
			// The page only FINDS capped products; each is its own transaction.
			expect(page).toMatchObject({ scheduled: 2, isDone: true });
			await t.finishAllScheduledFunctions(vi.runAllTimers);
		} finally {
			vi.useRealTimers();
		}
		await expectInSync(t, legacy, 2);
		await expectInSync(t, drifting, 3);

		// Clean re-run: nothing to mint, nothing drifted.
		for (const productId of [legacy, drifting])
			expect(
				await t.mutation(internal.migrations.backfillPromoRunUnitsOne, {
					productId,
				}),
			).toEqual({ minted: false, drifted: false });
	});
});

describe("product delete cascade", () => {
	test("a permanently deleted product takes its counters with it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedPromoProduct(t, retailer._id, { unitCap: 10 });
		const { deleteProductCascade } = await import("./lib/productDelete");
		await t.run(async (ctx) => {
			const product = (await ctx.db.get(productId)) as Doc<"products">;
			await deleteProductCascade(ctx, product);
		});
		const rows = await t.run((ctx) => ctx.db.query("promoRunUnits").collect());
		expect(rows).toHaveLength(0);
	});
});
