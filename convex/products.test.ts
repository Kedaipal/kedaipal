/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER_A = "user_test_a";
const USER_B = "user_test_b";

async function seedRetailer(t: ReturnType<typeof convexTest>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const safeSuffix = userId.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Test Store",
		slug: `test-store-${safeSuffix}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

type BaseOpts = {
	name?: string;
	sku?: string;
	price?: number;
	stock?: number;
	sortOrder?: number;
	imageStorageIds?: string[];
	blockWhenOutOfStock?: boolean;
};

/** Single-variant (no axes) product create args in the variant API shape. */
const baseProduct = (retailerId: string, opts: BaseOpts = {}) => ({
	retailerId: retailerId as Id<"retailers">,
	name: opts.name ?? "Tent 2P",
	currency: "MYR",
	imageStorageIds: opts.imageStorageIds ?? [],
	sortOrder: opts.sortOrder ?? 0,
	blockWhenOutOfStock: opts.blockWhenOutOfStock ?? true,
	variants: [
		{
			optionValues: [],
			price: opts.price ?? 12000,
			onHand: opts.stock ?? 5,
			sku: opts.sku,
		},
	],
});

describe("products", () => {
	test("owner can create a single-variant product and read it back", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, baseProduct(retailer._id));
		const product = await asA.query(api.products.get, { productId: id });
		expect(product?.name).toBe("Tent 2P");
		expect(product?.active).toBe(true);
		expect(product?.channel).toBe("whatsapp");
		// Exactly one implicit default variant.
		expect(product?.variants).toHaveLength(1);
		expect(product?.variants[0]?.optionValues).toEqual([]);
		expect(product?.variants[0]?.price).toBe(12000);
		expect(product?.variants[0]?.onHand).toBe(5);
		expect(product?.priceFrom).toBe(12000);
	});

	test("non-owner create throws Forbidden", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asB = t.withIdentity({ subject: USER_B });
		await expect(
			asB.mutation(api.products.create, baseProduct(retailer._id)),
		).rejects.toThrow(/Forbidden/);
	});

	test("imageStorageIds > 5 throws", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.products.create, {
				...baseProduct(retailer._id),
				imageStorageIds: ["a", "b", "c", "d", "e", "f"],
			}),
		).rejects.toThrow(/Maximum 5 images/);
	});

	// --- Option axes + variant generation -----------------------------------

	test("create with one axis stores all variants and a price range", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Metal Print",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [{ name: "Size", values: ["5x7", "8x12", "10x10"] }],
			variants: [
				{ optionValues: ["5x7"], price: 5000, onHand: 0 },
				{ optionValues: ["8x12"], price: 8000, onHand: 0 },
				{ optionValues: ["10x10"], price: 9000, onHand: 0 },
			],
		});
		const product = await asA.query(api.products.get, { productId: id });
		expect(product?.variants).toHaveLength(3);
		expect(product?.priceFrom).toBe(5000);
		expect(product?.priceTo).toBe(9000);
		expect(product?.variants.map((vr) => vr.optionValues)).toEqual([
			["5x7"],
			["8x12"],
			["10x10"],
		]);
	});

	test("create rejects a variant set that doesn't cover the cartesian", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Salmon",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				options: [{ name: "Weight", values: ["500g", "1kg"] }],
				// Only one of the two required combinations.
				variants: [{ optionValues: ["500g"], price: 4500, onHand: 0 }],
			}),
		).rejects.toThrow(/Expected 2 variants/);
	});

	test("create rejects an invalid combination value", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Salmon",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				options: [{ name: "Weight", values: ["500g", "1kg"] }],
				variants: [
					{ optionValues: ["500g"], price: 4500, onHand: 0 },
					{ optionValues: ["2kg"], price: 9000, onHand: 0 }, // not a declared value
				],
			}),
		).rejects.toThrow(/not a valid option combination/);
	});

	test("create rejects more than 2 option axes", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Overspecified",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				options: [
					{ name: "Size", values: ["S"] },
					{ name: "Color", values: ["Red"] },
					{ name: "Material", values: ["Cotton"] },
				],
				variants: [{ optionValues: ["S", "Red", "Cotton"], price: 100, onHand: 1 }],
			}),
		).rejects.toThrow(/At most 2 option axes/);
	});

	test("create rejects a grid exceeding the 50-variant cap", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const values = Array.from({ length: 8 }, (_, i) => `v${i}`);
		await expect(
			asA.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Too many",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				options: [
					{ name: "A", values }, // 8 × 8 = 64 > 50
					{ name: "B", values },
				],
				variants: [],
			}),
		).rejects.toThrow(/max 50 per product/);
	});

	// --- SKU uniqueness (now on the variant) --------------------------------

	test("variant SKU must be unique across the retailer's catalog", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.products.create, baseProduct(retailer._id, { sku: "DUP" }));
		await expect(
			asA.mutation(
				api.products.create,
				baseProduct(retailer._id, { sku: "DUP", name: "Other" }),
			),
		).rejects.toThrow(/already used by another variant/);
	});

	// --- Reads ---------------------------------------------------------------

	test("list hides archived products from storefront", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const archivedId = await asA.mutation(api.products.create, baseProduct(retailer._id));
		const activeId = await asA.mutation(api.products.create, baseProduct(retailer._id));
		await asA.mutation(api.products.archive, { productId: archivedId });

		const list = await t.query(api.products.list, { retailerId: retailer._id });
		expect(list).toHaveLength(1);
		expect(list[0]?._id).toBe(activeId);
	});

	test("storefront list returns only active variants", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tee",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [{ name: "Size", values: ["S", "M"] }],
			variants: [
				{ optionValues: ["S"], price: 5000, onHand: 1, active: false },
				{ optionValues: ["M"], price: 5000, onHand: 1 },
			],
		});
		const list = await t.query(api.products.list, { retailerId: retailer._id });
		const tee = list.find((p) => p._id === id);
		// Inactive S variant hidden from the storefront read.
		expect(tee?.variants).toHaveLength(1);
		expect(tee?.variants[0]?.optionValues).toEqual(["M"]);

		// Owner's listAll sees both.
		const all = await asA.query(api.products.listAll, { retailerId: retailer._id });
		expect(all.find((p) => p._id === id)?.variants).toHaveLength(2);
	});

	test("archive sets active to false", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, baseProduct(retailer._id));
		await asA.mutation(api.products.archive, { productId: id });
		const product = await asA.query(api.products.get, { productId: id });
		expect(product?.active).toBe(false);
	});

	test("update patches product-level fields without touching variants", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, baseProduct(retailer._id));
		await asA.mutation(api.products.update, { productId: id, name: "Tent 3P" });
		const product = await asA.query(api.products.get, { productId: id });
		expect(product?.name).toBe("Tent 3P");
		expect(product?.variants[0]?.price).toBe(12000); // unchanged
		expect(product?.variants[0]?.onHand).toBe(5); // unchanged
	});

	// --- Per-variant edits ---------------------------------------------------

	test("updateVariant changes price + stock", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, baseProduct(retailer._id));
		const product = await asA.query(api.products.get, { productId: id });
		const variantId = product?.variants[0]?._id as Id<"productVariants">;
		await asA.mutation(api.products.updateVariant, {
			variantId,
			price: 13500,
			onHand: 9,
		});
		const after = await asA.query(api.products.get, { productId: id });
		expect(after?.variants[0]?.price).toBe(13500);
		expect(after?.variants[0]?.onHand).toBe(9);
	});

	test("updateVariant rejects negative stock", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, baseProduct(retailer._id));
		const product = await asA.query(api.products.get, { productId: id });
		const variantId = product?.variants[0]?._id as Id<"productVariants">;
		await expect(
			asA.mutation(api.products.updateVariant, { variantId, onHand: -3 }),
		).rejects.toThrow(/non-negative integer/);
	});

	// --- saveVariantGrid reconcile ------------------------------------------

	test("saveVariantGrid reconciles: patches matched, adds new, drops removed", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tee",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [{ name: "Size", values: ["S", "M"] }],
			variants: [
				{ optionValues: ["S"], price: 5000, onHand: 1 },
				{ optionValues: ["M"], price: 5000, onHand: 2 },
			],
		});
		const before = await asA.query(api.products.get, { productId: id });
		const mVariantId = before?.variants.find((vr) => vr.optionValues[0] === "M")?._id;

		// Drop S, keep M (new price), add L.
		await asA.mutation(api.products.saveVariantGrid, {
			productId: id,
			options: [{ name: "Size", values: ["M", "L"] }],
			variants: [
				{ optionValues: ["M"], price: 5500, onHand: 2 },
				{ optionValues: ["L"], price: 6000, onHand: 4 },
			],
		});
		const after = await asA.query(api.products.get, { productId: id });
		expect(after?.variants.map((vr) => vr.optionValues[0]).sort()).toEqual(["L", "M"]);
		const mAfter = after?.variants.find((vr) => vr.optionValues[0] === "M");
		// Matched M kept its identity (so historical orders' variantId stays valid).
		expect(mAfter?._id).toBe(mVariantId);
		expect(mAfter?.price).toBe(5500);
	});

	test("create + saveVariantGrid persist per-variant active and images", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tee",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [{ name: "Size", values: ["S", "M"] }],
			variants: [
				{ optionValues: ["S"], price: 5000, onHand: 1, active: false },
				{
					optionValues: ["M"],
					price: 5000,
					onHand: 1,
					imageStorageIds: ["img-m"],
				},
			],
		});

		// Raw read — fake storage ids aren't resolvable via products.get.
		const created = await t.run((ctx) =>
			ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", id))
				.collect(),
		);
		const sCreated = created.find((v) => v.optionValues[0] === "S");
		const mCreated = created.find((v) => v.optionValues[0] === "M");
		expect(sCreated?.active).toBe(false);
		expect(mCreated?.imageStorageIds).toEqual(["img-m"]);

		// saveVariantGrid round-trips active + images too.
		await asA.mutation(api.products.saveVariantGrid, {
			productId: id,
			options: [{ name: "Size", values: ["S", "M"] }],
			variants: [
				{ optionValues: ["S"], price: 5000, onHand: 1, active: true },
				{ optionValues: ["M"], price: 5000, onHand: 1, imageStorageIds: [] },
			],
		});
		const saved = await t.run((ctx) =>
			ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", id))
				.collect(),
		);
		expect(saved.find((v) => v.optionValues[0] === "S")?.active).toBe(true);
		expect(saved.find((v) => v.optionValues[0] === "M")?.imageStorageIds).toEqual(
			[],
		);
	});

	// --- Bulk import (single-variant) ---------------------------------------

	test("bulkUpsert inserts single-variant products when no sku matches", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const result = await asA.mutation(api.products.bulkUpsert, {
			retailerId: retailer._id,
			currency: "MYR",
			items: [
				{ name: "Tent", price: 49900, stock: 12 },
				{ sku: "HL-200", name: "Headlamp", description: "USB-C", price: 8950, stock: 30 },
			],
		});
		expect(result).toEqual({ created: 2, updated: 0 });
		const all = await asA.query(api.products.listAll, { retailerId: retailer._id });
		expect(all).toHaveLength(2);
		// Each imported product owns exactly one default variant.
		for (const p of all) expect(p.variants).toHaveLength(1);
		const headlamp = all.find((p) => p.name === "Headlamp");
		expect(headlamp?.variants[0]?.price).toBe(8950);
		expect(headlamp?.variants[0]?.onHand).toBe(30);
		expect(headlamp?.variants[0]?.sku).toBe("HL-200");
	});

	test("bulkUpsert aborts the entire batch if any row is invalid", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.products.bulkUpsert, {
				retailerId: retailer._id,
				currency: "MYR",
				items: [
					{ name: "Tent", price: 49900, stock: 12 },
					{ name: "Bad", price: -1, stock: 5 },
				],
			}),
		).rejects.toThrow(/Row 2.*price/);
		const all = await asA.query(api.products.listAll, { retailerId: retailer._id });
		expect(all).toHaveLength(0);
	});

	test("bulkUpsert enforces non-owner Forbidden", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asB = t.withIdentity({ subject: USER_B });
		await expect(
			asB.mutation(api.products.bulkUpsert, {
				retailerId: retailer._id,
				currency: "MYR",
				items: [{ name: "Tent", price: 49900, stock: 12 }],
			}),
		).rejects.toThrow(/Forbidden/);
	});

	test("bulkUpsert patches an existing product+variant when sku matches", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const originalId = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { sku: "TENT-4P", sortOrder: 42 }),
		);
		await asA.mutation(api.products.archive, { productId: originalId });
		await t.run(async (ctx) => {
			await ctx.db.patch(originalId, { imageStorageIds: ["fake-storage-id"] });
		});

		const result = await asA.mutation(api.products.bulkUpsert, {
			retailerId: retailer._id,
			currency: "MYR",
			items: [{ sku: "TENT-4P", name: "Tent 2P Updated", price: 13000, stock: 7 }],
		});
		expect(result).toEqual({ created: 0, updated: 1 });

		// Raw db reads — the fake storage id isn't resolvable via products.get.
		const { product, variant } = await t.run(async (ctx) => {
			const p = await ctx.db.get(originalId);
			const vr = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", originalId))
				.first();
			return { product: p, variant: vr };
		});
		expect(product?.name).toBe("Tent 2P Updated");
		expect(variant?.price).toBe(13000);
		expect(variant?.onHand).toBe(7);
		// Preserved product-level fields:
		expect(product?.active).toBe(false);
		expect(product?.channel).toBe("whatsapp");
		expect(product?.imageStorageIds).toEqual(["fake-storage-id"]);
		expect(product?.sortOrder).toBe(42);
	});

	test("bulkUpsert rejects intra-batch duplicate sku", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.products.bulkUpsert, {
				retailerId: retailer._id,
				currency: "MYR",
				items: [
					{ sku: "DUP", name: "A", price: 100, stock: 1 },
					{ sku: "DUP", name: "B", price: 200, stock: 2 },
				],
			}),
		).rejects.toThrow(/Duplicate sku "DUP"/);
	});

	test("bulkUpsertPreview does not write and returns correct plan", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { sku: "TENT-4P", name: "Tent original", price: 12000, stock: 5 }),
		);
		const before = await asA.query(api.products.listAll, { retailerId: retailer._id });
		const preview = await asA.query(api.products.bulkUpsertPreview, {
			retailerId: retailer._id,
			items: [
				{ sku: "TENT-4P", name: "Tent renamed", price: 13000, stock: 5 },
				{ sku: "NEW-SKU", name: "Brand new", price: 5000, stock: 1 },
			],
		});
		expect(preview.summary).toEqual({ inserts: 1, updates: 1, noChange: 0 });
		expect(preview.plan[0]?.action).toBe("update");
		expect(preview.plan[0]?.diff).toMatchObject({
			name: { before: "Tent original", after: "Tent renamed" },
			price: { before: 12000, after: 13000 },
		});
		expect(preview.plan[0]?.diff.stock).toBeUndefined();
		expect(preview.plan[1]?.action).toBe("insert");

		const after = await asA.query(api.products.listAll, { retailerId: retailer._id });
		expect(after).toHaveLength(before.length);
	});

	test("bulkUpsertPreview classifies a no-op upsert as noChange", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.products.create, {
			...baseProduct(retailer._id, { sku: "TENT-4P", name: "Tent" }),
			description: "4-season",
		});
		const preview = await asA.query(api.products.bulkUpsertPreview, {
			retailerId: retailer._id,
			items: [
				{ sku: "TENT-4P", name: "Tent", description: "4-season", price: 12000, stock: 5 },
			],
		});
		expect(preview.summary).toEqual({ inserts: 0, updates: 0, noChange: 1 });
		expect(preview.plan[0]?.action).toBe("update");
		expect(preview.plan[0]?.diff).toEqual({});
	});

	test("reorder updates sortOrder", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, baseProduct(retailer._id));
		await asA.mutation(api.products.reorder, { productId: id, sortOrder: 99 });
		const product = await asA.query(api.products.get, { productId: id });
		expect(product?.sortOrder).toBe(99);
	});
});
