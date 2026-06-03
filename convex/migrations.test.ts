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
