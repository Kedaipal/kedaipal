/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

async function seedRetailer(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: "user_mig" });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Mig Store",
		slug: "mig-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

/** Insert a pre-variant (flat) product directly, bypassing the variant-aware
 * create mutation — simulates rows that existed before this feature. */
async function insertFlatProduct(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	fields: { sku?: string; price: number; stock: number },
): Promise<Id<"products">> {
	return t.run(async (ctx) => {
		const now = Date.now();
		return ctx.db.insert("products", {
			retailerId,
			sku: fields.sku,
			name: "Legacy Product",
			price: fields.price,
			currency: "MYR",
			stock: fields.stock,
			imageStorageIds: [],
			active: true,
			channel: "whatsapp",
			sortOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
	});
}

async function variantsOf(t: ReturnType<typeof setup>, productId: Id<"products">) {
	return t.run((ctx) =>
		ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.collect(),
	);
}

describe("backfillDefaultVariants migration", () => {
	test("creates one default variant copying price/stock/sku and sets options:[]", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await insertFlatProduct(t, retailer._id, {
			sku: "OLD-1",
			price: 12000,
			stock: 7,
		});

		await t.mutation(internal.migrations.backfillDefaultVariants, {});

		const variants = await variantsOf(t, productId);
		expect(variants).toHaveLength(1);
		expect(variants[0].optionValues).toEqual([]);
		expect(variants[0].price).toBe(12000);
		expect(variants[0].onHand).toBe(7);
		expect(variants[0].sku).toBe("OLD-1");
		expect(variants[0].active).toBe(true);

		const product = await t.run((ctx) => ctx.db.get(productId));
		expect(product?.options).toEqual([]);
	});

	test("is idempotent — re-running creates no duplicate variant", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await insertFlatProduct(t, retailer._id, {
			price: 5000,
			stock: 3,
		});

		await t.mutation(internal.migrations.backfillDefaultVariants, {});
		await t.mutation(internal.migrations.backfillDefaultVariants, {});

		expect(await variantsOf(t, productId)).toHaveLength(1);
	});

	test("leaves already-migrated (variant-aware) products untouched", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const asUser = t.withIdentity({ subject: "user_mig" });
		// A product created the new way already owns its variant.
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "New Product",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 9900, onHand: 2 }],
		});

		await t.mutation(internal.migrations.backfillDefaultVariants, {});

		const variants = await variantsOf(t, productId);
		expect(variants).toHaveLength(1);
		expect(variants[0].price).toBe(9900); // not overwritten
	});
});

describe("backfillVariantFlags migration", () => {
	/** Insert a product with product-level flags + a variant lacking its own. */
	async function seedLegacyFlagShape(
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
		product: { blockWhenOutOfStock?: boolean; requiresProof?: boolean },
	): Promise<Id<"products">> {
		return t.run(async (ctx) => {
			const now = Date.now();
			const productId = await ctx.db.insert("products", {
				retailerId,
				name: "Legacy",
				currency: "MYR",
				imageStorageIds: [],
				options: [],
				blockWhenOutOfStock: product.blockWhenOutOfStock,
				requiresProof: product.requiresProof,
				active: true,
				channel: "whatsapp",
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.insert("productVariants", {
				productId,
				retailerId,
				optionValues: [],
				price: 5000,
				onHand: 0,
				reserved: 0,
				parcelWeightG: 0,
				imageStorageIds: [],
				active: true,
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			return productId;
		});
	}

	test("materializes both flags from the product onto a flagless variant", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedLegacyFlagShape(t, retailer._id, {
			blockWhenOutOfStock: false,
			requiresProof: true,
		});

		await t.mutation(internal.migrations.backfillVariantFlags, {});

		const [variant] = await variantsOf(t, productId);
		expect(variant.blockWhenOutOfStock).toBe(false);
		expect(variant.requiresProof).toBe(true);
	});

	test("defaults to false when the product never set a flag", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const productId = await seedLegacyFlagShape(t, retailer._id, {});

		await t.mutation(internal.migrations.backfillVariantFlags, {});

		const [variant] = await variantsOf(t, productId);
		expect(variant.blockWhenOutOfStock).toBe(false);
		expect(variant.requiresProof).toBe(false);
	});

	test("never overwrites a flag the seller already set per-row", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const asUser = t.withIdentity({ subject: "user_mig" });
		// Created the new way: the variant already carries blockWhenOutOfStock:true.
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Already set",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [
				{
					optionValues: [],
					price: 5000,
					onHand: 3,
					blockWhenOutOfStock: true,
					requiresProof: false,
				},
			],
		});

		await t.mutation(internal.migrations.backfillVariantFlags, {});

		const [variant] = await variantsOf(t, productId);
		expect(variant.blockWhenOutOfStock).toBe(true);
		expect(variant.requiresProof).toBe(false);
	});
});

describe("backfillOrderCategoryNames", () => {
	/** A store with one categorised product, plus a placed order whose lines have
	 * been stripped of `categoryNames` — exactly the shape of an order that
	 * predates the field. */
	async function seedLegacyOrder(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t);
		const asUser = t.withIdentity({ subject: "user_mig" });
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Kek Lapis",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 2500, onHand: 50 }],
		});
		const { categoryId: kuih } = await asUser.mutation(api.categories.create, {
			retailerId: retailer._id,
			name: "Kuih",
			slug: "kuih",
		});
		const { categoryId: best } = await asUser.mutation(api.categories.create, {
			retailerId: retailer._id,
			name: "Bestseller",
			slug: "bestseller",
		});
		await asUser.mutation(api.categories.setProductCategories, {
			productId,
			categoryIds: [kuih, best],
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Aisha", waPhone: "60123456789" },
			deliveryAddress: {
				line1: "12 Jln Mawar 3",
				city: "Petaling Jaya",
				state: "Selangor",
				postcode: "47301",
			},
		});
		// Rewind to the pre-field shape: strip the stamp the create path just made.
		const orderId = await t.run(async (ctx) => {
			const order = await ctx.db
				.query("orders")
				.filter((q) => q.eq(q.field("shortId"), shortId))
				.first();
			if (!order) throw new Error("seed failed");
			await ctx.db.patch(order._id, {
				items: order.items.map(({ categoryNames: _drop, ...rest }) => rest),
				updatedAt: 1000,
			});
			return order._id;
		});
		return { retailer, asUser, productId, orderId };
	}

	function readOrder(t: ReturnType<typeof setup>, orderId: Id<"orders">) {
		return t.run((ctx) => ctx.db.get(orderId));
	}

	test("stamps today's categories onto an order that predates the field", async () => {
		const t = setup();
		const { orderId } = await seedLegacyOrder(t);

		await t.mutation(internal.migrations.backfillOrderCategoryNames, {});

		const after = await readOrder(t, orderId);
		expect(after?.items[0].categoryNames).toEqual(["Bestseller", "Kuih"]);
	});

	test("does NOT bump updatedAt — recording metadata isn't a change to the sale", async () => {
		const t = setup();
		const { orderId } = await seedLegacyOrder(t);

		await t.mutation(internal.migrations.backfillOrderCategoryNames, {});

		const after = await readOrder(t, orderId);
		expect(after?.updatedAt).toBe(1000);
	});

	test("records an uncategorised product as an empty list, so it is never rescanned", async () => {
		const t = setup();
		const { orderId, productId, asUser } = await seedLegacyOrder(t);
		// Strip the product's categories BEFORE the backfill runs.
		await asUser.mutation(api.categories.setProductCategories, {
			productId,
			categoryIds: [],
		});

		await t.mutation(internal.migrations.backfillOrderCategoryNames, {});

		const after = await readOrder(t, orderId);
		// Present-and-empty, not absent: the next run skips this order entirely.
		expect(after?.items[0].categoryNames).toEqual([]);
	});

	test("is idempotent — a second run never re-dates an order", async () => {
		const t = setup();
		const { orderId, productId, asUser } = await seedLegacyOrder(t);

		await t.mutation(internal.migrations.backfillOrderCategoryNames, {});
		// The seller reorganises the catalogue AFTER the catch-up. A second run
		// must not overwrite what is now a frozen record.
		await asUser.mutation(api.categories.setProductCategories, {
			productId,
			categoryIds: [],
		});
		const second = await t.mutation(
			internal.migrations.backfillOrderCategoryNames,
			{},
		);

		expect(second.patched).toBe(0);
		const after = await readOrder(t, orderId);
		expect(after?.items[0].categoryNames).toEqual(["Bestseller", "Kuih"]);
	});

	test("fills the gaps in a half-stamped order without re-dating its stamped lines", async () => {
		// The case `every` (rather than `some`) exists for: an order interrupted
		// mid-run, or one whose lines were added at different times. Only the
		// unstamped line may be written.
		const t = setup();
		const { retailer, productId, asUser, orderId } = await seedLegacyOrder(t);
		const otherId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Karipap",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			variants: [{ optionValues: [], price: 500, onHand: 50 }],
		});
		// Put the FIRST line back to a frozen state, leave the second bare.
		await t.run(async (ctx) => {
			const order = await ctx.db.get(orderId);
			if (!order) throw new Error("seed failed");
			const line = order.items[0];
			await ctx.db.patch(orderId, {
				items: [
					{ ...line, categoryNames: ["Raya 2024"] },
					{ ...line, productId: otherId, name: "Karipap" },
				],
			});
		});
		// Today's catalogue disagrees with the frozen line.
		await asUser.mutation(api.categories.setProductCategories, {
			productId,
			categoryIds: [],
		});

		await t.mutation(internal.migrations.backfillOrderCategoryNames, {});

		const after = await readOrder(t, orderId);
		expect(after?.items[0].categoryNames).toEqual(["Raya 2024"]);
		expect(after?.items[1].categoryNames).toEqual([]);
	});

	test("touches only the legacy orders, not ones already frozen at checkout", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedLegacyOrder(t);
		// A second, modern order — stamped by the create path — placed after the
		// catalogue changed. The catch-up must not drag it back to today's names.
		await asUser.mutation(api.categories.setProductCategories, {
			productId,
			categoryIds: [],
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Bala", waPhone: "60129998888" },
			deliveryAddress: {
				line1: "9 Jln Melur",
				city: "Shah Alam",
				state: "Selangor",
				postcode: "40000",
			},
		});

		const run = await t.mutation(
			internal.migrations.backfillOrderCategoryNames,
			{},
		);

		expect(run.patched).toBe(1); // the legacy order only
		const modern = await t.run(async (ctx) =>
			ctx.db
				.query("orders")
				.filter((q) => q.eq(q.field("shortId"), shortId))
				.first(),
		);
		expect(modern?.items[0].categoryNames).toEqual([]);
	});
});

describe("migrateLalamoveModeToLive (z8r3fdbvdy)", () => {
	// The old mode priced with ONE provider while dispatch could use another.
	// Migrating is safe because it only bites where the leak already did: a
	// store with a single armed provider prices identically either way.
	async function seedRetailer(
		t: ReturnType<typeof setup>,
		mode: "lalamove" | "live" | "flat",
		slug: string,
	) {
		return t.run(async (ctx) => {
			const now = Date.now();
			return ctx.db.insert("retailers", {
				userId: `user_${slug}`,
				storeName: slug,
				slug,
				channel: "whatsapp",
				createdAt: now,
				updatedAt: now,
				deliveryConfig:
					mode === "flat"
						? { mode: "flat", fee: 500 }
						: { mode, onUnquotable: "block" },
			});
		});
	}

	test("flips a stored lalamove mode to live", async () => {
		const t = setup();
		const id = await seedRetailer(t, "lalamove", "old-mode");
		const result = await t.mutation(
			internal.migrations.migrateLalamoveModeToLive,
			{},
		);
		expect(result.migrated).toBe(1);
		const after = await t.run(async (ctx) => ctx.db.get(id));
		expect(after?.deliveryConfig).toEqual({
			mode: "live",
			onUnquotable: "block",
		});
	});

	test("leaves every other pricing mode alone", async () => {
		const t = setup();
		const flat = await seedRetailer(t, "flat", "flat-store");
		const result = await t.mutation(
			internal.migrations.migrateLalamoveModeToLive,
			{},
		);
		expect(result.migrated).toBe(0);
		const after = await t.run(async (ctx) => ctx.db.get(flat));
		expect(after?.deliveryConfig?.mode).toBe("flat");
	});

	test("is idempotent — a second run migrates nothing", async () => {
		const t = setup();
		await seedRetailer(t, "lalamove", "twice");
		await t.mutation(internal.migrations.migrateLalamoveModeToLive, {});
		const second = await t.mutation(
			internal.migrations.migrateLalamoveModeToLive,
			{},
		);
		expect(second.migrated).toBe(0);
	});
})
