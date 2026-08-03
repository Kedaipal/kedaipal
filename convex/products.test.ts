/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { todayMytMidnight } from "./lib/fulfilmentDate";
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

/** Build a single-variant import product (the grouped bulkUpsert shape). */
function importSingle(
	name: string,
	opts: { sku?: string; price: number; stock: number; description?: string },
) {
	return {
		name,
		description: opts.description,
		options: [] as { name: string; values: string[] }[],
		variants: [
			{
				optionValues: [] as string[],
				sku: opts.sku,
				price: opts.price,
				onHand: opts.stock,
				active: true,
			},
		],
	};
}

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
		const create = asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Salmon",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [{ name: "Weight", values: ["500g", "1kg"] }],
			// Only one of the two required combinations.
			variants: [{ optionValues: ["500g"], price: 4500, onHand: 0 }],
		});
		// The message must name the axes it rebuilt from AND the combos it got —
		// the bare count was a dead end with nothing to act on (86eyex5vk).
		await expect(create).rejects.toThrow(/Options \[Weight: 500g, 1kg\]/);
		await expect(create).rejects.toThrow(/2 combinations \("500g", "1kg"\)/);
		await expect(create).rejects.toThrow(/1 variant arrived \("500g"\)/);
	});

	test("no-axes product reports the empty combo readably, not as a bare count", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		// The shape Arif hit: zero axes, two non-custom rows (86eyex5vk).
		await expect(
			asA.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Kuih",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				options: [],
				variants: [
					{ optionValues: [], price: 1200, onHand: 0 },
					{ optionValues: [], price: 1800, onHand: 0 },
				],
			}),
		).rejects.toThrow(
			/A product with no options makes 1 combination \(\(no options\)\), but 2 variants arrived/,
		);
	});

	test("a no-axes product with a custom line saves — the custom line is not matrix", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		// Two variants arrive but only one is matrix, so expected===1 holds.
		const productId = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Custom cake",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [],
			variants: [
				{ optionValues: [], price: 12000, onHand: 0 },
				{
					optionValues: [],
					price: 0,
					onHand: 0,
					isCustom: true,
					customLabel: "Tell us your design",
				},
			],
		});
		const product = await asA.query(api.products.get, { productId });
		expect(product?.variants).toHaveLength(2);
		expect(product?.variants.filter((vr) => vr.isCustom)).toHaveLength(1);
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

	test("create rejects a non-integer price (fractional sen)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Frac",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				variants: [{ optionValues: [], price: 9.999, onHand: 1 }],
			}),
		).rejects.toThrow(/price must be a non-negative integer/);
	});

	test("inStock ignores inactive variants on the dashboard read", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		// Hard-block product: the only ACTIVE variant is sold out; an inactive
		// variant still has stock. inStock must be false on both read paths.
		const id = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tee",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			blockWhenOutOfStock: true,
			options: [{ name: "Size", values: ["S", "M"] }],
			variants: [
				{ optionValues: ["S"], price: 5000, onHand: 0 }, // active, sold out
				{ optionValues: ["M"], price: 5000, onHand: 9, active: false }, // hidden, in stock
			],
		});
		const dash = await asA.query(api.products.get, { productId: id });
		expect(dash?.inStock).toBe(false);
		const store = await t.query(api.products.list, { retailerId: retailer._id });
		expect(store.find((p) => p._id === id)?.inStock).toBe(false);
	});

	test("get exposes inactive variants to the owner but not to others", async () => {
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
		// Owner sees both variants (for editing).
		const asOwner = await asA.query(api.products.get, { productId: id });
		expect(asOwner?.variants).toHaveLength(2);
		// Unauthenticated / non-owner caller gets active variants only.
		const anon = await t.query(api.products.get, { productId: id });
		expect(anon?.variants).toHaveLength(1);
		expect(anon?.variants[0]?.optionValues).toEqual(["M"]);
	});

	test("saveVariantGrid soft-deactivates a removed variant held by an open order, hard-deletes the rest", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tee",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [{ name: "Size", values: ["S", "M", "L"] }],
			variants: [
				{ optionValues: ["S"], price: 5000, onHand: 5 },
				{ optionValues: ["M"], price: 5000, onHand: 5 },
				{ optionValues: ["L"], price: 5000, onHand: 5 },
			],
		});
		const before = await asA.query(api.products.get, { productId: id });
		const sId = before?.variants.find((v) => v.optionValues[0] === "S")?._id;
		const lId = before?.variants.find((v) => v.optionValues[0] === "L")?._id;

		// A pending order references variant S.
		await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId: sId as Id<"productVariants">, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali" },
			deliveryAddress: {
				line1: "12 Jln Mawar",
				city: "PJ",
				state: "Selangor",
				postcode: "47301",
			},
		});

		// Drop S and L from the grid, keep M.
		await asA.mutation(api.products.saveVariantGrid, {
			productId: id,
			options: [{ name: "Size", values: ["M"] }],
			variants: [{ optionValues: ["M"], price: 5000, onHand: 5 }],
		});

		const rows = await t.run((ctx) =>
			ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", id))
				.collect(),
		);
		// S is referenced by an open order → kept but deactivated (stock restorable).
		const s = rows.find((r) => r._id === sId);
		expect(s).toBeTruthy();
		expect(s?.active).toBe(false);
		// L had no order → hard-deleted.
		expect(rows.find((r) => r._id === lId)).toBeUndefined();
		// M survives, active.
		expect(rows.find((r) => r.optionValues[0] === "M")?.active).toBe(true);
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

	// --- Hidden (counter-only) products --------------------------------------

	test("create + update persist the hidden flag", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		// Defaults to visible (undefined) when the arg is omitted.
		const id = await asA.mutation(api.products.create, baseProduct(retailer._id));
		const created = await t.run((ctx) => ctx.db.get(id));
		expect(created?.hidden).toBeUndefined();

		await asA.mutation(api.products.update, { productId: id, hidden: true });
		expect((await t.run((ctx) => ctx.db.get(id)))?.hidden).toBe(true);

		// And can be flipped back to visible.
		await asA.mutation(api.products.update, { productId: id, hidden: false });
		expect((await t.run((ctx) => ctx.db.get(id)))?.hidden).toBe(false);
	});

	test("create can set hidden at creation time", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, {
			...baseProduct(retailer._id, { name: "Lekor Event" }),
			hidden: true,
		});
		expect((await t.run((ctx) => ctx.db.get(id)))?.hidden).toBe(true);
	});

	test("storefront list excludes hidden products", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const visibleId = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Regular Lekor" }),
		);
		await asA.mutation(api.products.create, {
			...baseProduct(retailer._id, { name: "Lekor Event" }),
			hidden: true,
		});

		const store = await t.query(api.products.list, { retailerId: retailer._id });
		expect(store).toHaveLength(1);
		expect(store[0]?._id).toBe(visibleId);
	});

	test("listForCounter includes hidden products but still excludes archived", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const visibleId = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Regular Lekor" }),
		);
		const hiddenId = await asA.mutation(api.products.create, {
			...baseProduct(retailer._id, { name: "Lekor Event" }),
			hidden: true,
		});
		const archivedId = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Old SKU" }),
		);
		await asA.mutation(api.products.archive, { productId: archivedId });

		const counter = await asA.query(api.products.listForCounter, {
			retailerId: retailer._id,
		});
		const ids = counter.map((p) => p._id).sort();
		expect(ids).toEqual([visibleId, hiddenId].sort());
	});

	test("listForCounter is owner-OR-admin gated (rejects a stranger)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const asB = t.withIdentity({ subject: USER_B });
		await expect(
			asB.query(api.products.listForCounter, { retailerId: retailer._id }),
		).rejects.toThrow();
	});

	test("get returns null for a hidden product to a non-owner, full to the owner", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, {
			...baseProduct(retailer._id, { name: "Lekor Event" }),
			hidden: true,
		});

		// Owner (dashboard) still reads it to edit.
		const asOwner = await asA.query(api.products.get, { productId: id });
		expect(asOwner?._id).toBe(id);
		// Unauthenticated / non-owner caller gets nothing — no leak.
		expect(await t.query(api.products.get, { productId: id })).toBeNull();
		const asB = t.withIdentity({ subject: USER_B });
		expect(await asB.query(api.products.get, { productId: id })).toBeNull();
	});

	// Same promise as `hidden` above, for the archive flag. Every other public
	// read scopes to `active` (`list`, `getPublicBySlug`), so a bare id was the
	// one way to pull an archived product's public payload. Found in the PR #155
	// review; the owner must still read it, or archived products couldn't be
	// opened to restore them.
	test("get returns null for an archived product to a non-owner, full to the owner", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Retired Tent" }),
		);
		await asA.mutation(api.products.archive, { productId: id });

		expect((await asA.query(api.products.get, { productId: id }))?._id).toBe(id);
		expect(await t.query(api.products.get, { productId: id })).toBeNull();
		const asB = t.withIdentity({ subject: USER_B });
		expect(await asB.query(api.products.get, { productId: id })).toBeNull();
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

	test("create + saveVariantGrid persist per-variant block + requiresProof", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Art print",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [{ name: "Size", values: ["10x10", "Custom"] }],
			variants: [
				{
					optionValues: ["10x10"],
					price: 5000,
					onHand: 3,
					blockWhenOutOfStock: true,
					requiresProof: false,
				},
				{
					optionValues: ["Custom"],
					price: 0,
					onHand: 0,
					blockWhenOutOfStock: false,
					requiresProof: true,
				},
			],
		});

		// products.get resolves the per-variant flags onto each returned variant.
		const product = await asA.query(api.products.get, { productId: id });
		const fixed = product?.variants.find((v) => v.optionValues[0] === "10x10");
		const custom = product?.variants.find((v) => v.optionValues[0] === "Custom");
		expect(fixed?.blockWhenOutOfStock).toBe(true);
		expect(fixed?.requiresProof).toBe(false);
		expect(custom?.blockWhenOutOfStock).toBe(false);
		expect(custom?.requiresProof).toBe(true);

		// saveVariantGrid round-trips the flags (flip Custom to hard-block).
		await asA.mutation(api.products.saveVariantGrid, {
			productId: id,
			options: [{ name: "Size", values: ["10x10", "Custom"] }],
			variants: [
				{
					optionValues: ["10x10"],
					price: 5000,
					onHand: 3,
					blockWhenOutOfStock: true,
					requiresProof: false,
				},
				{
					optionValues: ["Custom"],
					price: 9000,
					onHand: 0,
					blockWhenOutOfStock: true,
					requiresProof: true,
				},
			],
		});
		const saved = await t.run((ctx) =>
			ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", id))
				.collect(),
		);
		const savedCustom = saved.find((v) => v.optionValues[0] === "Custom");
		expect(savedCustom?.blockWhenOutOfStock).toBe(true);
		expect(savedCustom?.requiresProof).toBe(true);
	});

	test("get falls back to product-level flags for variants without their own", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		// Single-variant product carrying product-level flags; the variant row is
		// created WITHOUT per-variant flags (legacy shape).
		const id = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Legacy made-to-order",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			blockWhenOutOfStock: false,
			requiresProof: true,
			variants: [{ optionValues: [], price: 5000, onHand: 0 }],
		});
		const product = await asA.query(api.products.get, { productId: id });
		// Resolved from the product-level defaults.
		expect(product?.variants[0]?.blockWhenOutOfStock).toBe(false);
		expect(product?.variants[0]?.requiresProof).toBe(true);
		// Made-to-order ⇒ in stock at zero on-hand.
		expect(product?.inStock).toBe(true);
	});

	// --- Bulk import (single-variant) ---------------------------------------
	// --- Bulk import (variant-aware) ----------------------------------------

	test("bulkUpsert creates single-variant products when no sku matches", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const result = await asA.mutation(api.products.bulkUpsert, {
			retailerId: retailer._id,
			currency: "MYR",
			products: [
				importSingle("Tent", { price: 49900, stock: 12 }),
				importSingle("Headlamp", { sku: "HL-200", description: "USB-C", price: 8950, stock: 30 }),
			],
		});
		expect(result).toEqual({ created: 2, updated: 0 });
		const all = await asA.query(api.products.listAll, { retailerId: retailer._id });
		expect(all).toHaveLength(2);
		for (const p of all) expect(p.variants).toHaveLength(1);
		const headlamp = all.find((p) => p.name === "Headlamp");
		expect(headlamp?.variants[0]?.price).toBe(8950);
		expect(headlamp?.variants[0]?.onHand).toBe(30);
		expect(headlamp?.variants[0]?.sku).toBe("HL-200");
	});

	test("bulkUpsert creates a multi-variant product, keeping auto-filled combos inactive", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const result = await asA.mutation(api.products.bulkUpsert, {
			retailerId: retailer._id,
			currency: "MYR",
			products: [
				{
					name: "Salmon",
					options: [
						{ name: "Weight", values: ["500g", "1kg"] },
						{ name: "Cut", values: ["Fillet", "Whole"] },
					],
					variants: [
						{ optionValues: ["500g", "Fillet"], sku: "S-5F", price: 4500, onHand: 3, active: true },
						{ optionValues: ["500g", "Whole"], sku: undefined, price: 0, onHand: 0, active: false },
						{ optionValues: ["1kg", "Fillet"], sku: "S-1F", price: 8500, onHand: 2, active: true },
						{ optionValues: ["1kg", "Whole"], sku: undefined, price: 0, onHand: 0, active: false },
					],
				},
			],
		});
		expect(result).toEqual({ created: 1, updated: 0 });
		const all = await asA.query(api.products.listAll, { retailerId: retailer._id });
		const salmon = all.find((p) => p.name === "Salmon");
		expect(salmon?.variants).toHaveLength(4);
		expect(salmon?.variants.filter((vr) => vr.active)).toHaveLength(2);
	});

	test("bulkUpsert aborts the whole batch on an invalid row", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.products.bulkUpsert, {
				retailerId: retailer._id,
				currency: "MYR",
				products: [
					importSingle("Tent", { price: 49900, stock: 12 }),
					importSingle("Bad", { price: -1, stock: 5 }),
				],
			}),
		).rejects.toThrow(/price must be/);
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
				products: [importSingle("Tent", { price: 49900, stock: 12 })],
			}),
		).rejects.toThrow(/Forbidden/);
	});

	test("bulkUpsert updates a matched variant by SKU and never deletes unlisted ones", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		// A 2-variant product; the sheet only updates one of them.
		const id = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tee",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [{ name: "Size", values: ["S", "M"] }],
			variants: [
				{ optionValues: ["S"], sku: "TEE-S", price: 5000, onHand: 3 },
				{ optionValues: ["M"], sku: "TEE-M", price: 5000, onHand: 9 },
			],
		});

		const result = await asA.mutation(api.products.bulkUpsert, {
			retailerId: retailer._id,
			currency: "MYR",
			products: [
				{
					name: "Tee",
					options: [{ name: "Size", values: ["S"] }],
					variants: [
						{ optionValues: ["S"], sku: "TEE-S", price: 5500, onHand: 1, active: true },
					],
				},
			],
		});
		expect(result).toEqual({ created: 0, updated: 1 });

		const after = await asA.query(api.products.get, { productId: id });
		// Still 2 variants — M was not deleted.
		expect(after?.variants).toHaveLength(2);
		const s = after?.variants.find((vr) => vr.sku === "TEE-S");
		const m = after?.variants.find((vr) => vr.sku === "TEE-M");
		expect(s?.price).toBe(5500); // updated
		expect(s?.onHand).toBe(1);
		expect(m?.onHand).toBe(9); // untouched
	});

	test("bulkUpsert rejects intra-batch duplicate sku", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.products.bulkUpsert, {
				retailerId: retailer._id,
				currency: "MYR",
				products: [
					importSingle("A", { sku: "DUP", price: 100, stock: 1 }),
					importSingle("B", { sku: "DUP", price: 200, stock: 2 }),
				],
			}),
		).rejects.toThrow(/Duplicate SKU "DUP"/);
	});

	test("bulkUpsertPreview classifies create vs update without writing", async () => {
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
			products: [
				importSingle("Tent renamed", { sku: "TENT-4P", price: 13000, stock: 5 }),
				importSingle("Brand new", { sku: "NEW-SKU", price: 5000, stock: 1 }),
			],
		});
		expect(preview.summary.creates).toBe(1);
		expect(preview.summary.updates).toBe(1);
		const update = preview.plan.find((p) => p.action === "update");
		const create = preview.plan.find((p) => p.action === "create");
		expect(update?.changedVariants).toBe(1); // price changed
		expect(create?.name).toBe("Brand new");

		const after = await asA.query(api.products.listAll, { retailerId: retailer._id });
		expect(after).toHaveLength(before.length); // no write
	});

	test("bulkUpsertPreview reports 0 changed variants for a no-op update", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { sku: "TENT-4P", name: "Tent", price: 12000, stock: 5 }),
		);
		const preview = await asA.query(api.products.bulkUpsertPreview, {
			retailerId: retailer._id,
			products: [importSingle("Tent", { sku: "TENT-4P", price: 12000, stock: 5 })],
		});
		expect(preview.summary.updates).toBe(1);
		expect(preview.plan[0]?.action).toBe("update");
		expect(preview.plan[0]?.changedVariants).toBe(0);
	});

	test("bulkUpsertPreview warns on a new variant aimed at an existing product", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { sku: "TENT-4P", name: "Tent", price: 12000, stock: 5 }),
		);
		const preview = await asA.query(api.products.bulkUpsertPreview, {
			retailerId: retailer._id,
			products: [
				{
					name: "Tent",
					options: [],
					variants: [
						{ optionValues: [], sku: "TENT-4P", price: 12000, onHand: 5, active: true },
						{ optionValues: [], sku: "TENT-NEW", price: 9000, onHand: 2, active: true },
					],
				},
			],
		});
		// Matched on TENT-4P → update; TENT-NEW is unmatched → skipped + warning.
		expect(preview.plan[0]?.action).toBe("update");
		expect(preview.plan[0]?.skippedVariants).toBe(1);
		expect(preview.plan[0]?.warnings[0]).toMatch(/dashboard/);
	});

	test("reorder assigns sortOrder by position; listAll reflects it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const a = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "A", sku: "A" }),
		);
		const b = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "B", sku: "B" }),
		);
		const c = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "C", sku: "C" }),
		);

		await asA.mutation(api.products.reorder, {
			retailerId: retailer._id,
			orderedIds: [c, a, b],
		});

		const sorted = await asA.query(api.products.listAll, {
			retailerId: retailer._id,
		});
		expect(sorted.map((p) => p.name)).toEqual(["C", "A", "B"]);
		expect(sorted.map((p) => p.sortOrder)).toEqual([0, 1, 2]);
	});

	test("reorder rejects a list that isn't exactly the product set", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const a = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { sku: "A" }),
		);
		await asA.mutation(api.products.create, baseProduct(retailer._id, { sku: "B" }));

		// Missing one id.
		await expect(
			asA.mutation(api.products.reorder, {
				retailerId: retailer._id,
				orderedIds: [a],
			}),
		).rejects.toThrow(/every product exactly once/i);

		// Duplicate id.
		await expect(
			asA.mutation(api.products.reorder, {
				retailerId: retailer._id,
				orderedIds: [a, a],
			}),
		).rejects.toThrow(/Duplicate/i);
	});

	test("reorder is rejected for a non-owner", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const a = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { sku: "A" }),
		);
		const asB = t.withIdentity({ subject: USER_B });
		await expect(
			asB.mutation(api.products.reorder, {
				retailerId: retailer._id,
				orderedIds: [a],
			}),
		).rejects.toThrow();
	});

	test("listAll sorts archived products to the end; reorder keeps active first", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const a = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "A", sku: "A" }),
		);
		const b = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "B", sku: "B" }),
		);
		const c = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "C", sku: "C" }),
		);

		// Archive B → it sinks to the end of the dashboard list, no renumber needed.
		await asA.mutation(api.products.archive, { productId: b });
		expect(
			(await asA.query(api.products.listAll, { retailerId: retailer._id })).map(
				(p) => p.name,
			),
		).toEqual(["A", "C", "B"]);

		// Reorder the active products (C before A); the mutation gets the full set
		// with the archived id kept last.
		await asA.mutation(api.products.reorder, {
			retailerId: retailer._id,
			orderedIds: [c, a, b],
		});
		expect(
			(await asA.query(api.products.listAll, { retailerId: retailer._id })).map(
				(p) => p.name,
			),
		).toEqual(["C", "A", "B"]);
		// Storefront (active only) shows the active order; archived excluded.
		expect(
			(await asA.query(api.products.list, { retailerId: retailer._id })).map(
				(p) => p.name,
			),
		).toEqual(["C", "A"]);
	});

	test("reorder only patches products whose position changed", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const a = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "A", sku: "A" }),
		);
		const b = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "B", sku: "B" }),
		);
		const c = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "C", sku: "C" }),
		);

		// Lock in positions 0, 1, 2.
		await asA.mutation(api.products.reorder, {
			retailerId: retailer._id,
			orderedIds: [a, b, c],
		});
		const updatedAtOf = (id: Id<"products">) =>
			t.run(async (ctx) => (await ctx.db.get(id))?.updatedAt);
		const cBefore = await updatedAtOf(c);

		// Swap A and B; C stays at index 2 → must NOT be re-patched.
		await asA.mutation(api.products.reorder, {
			retailerId: retailer._id,
			orderedIds: [b, a, c],
		});

		// C's position didn't change → not re-patched (updatedAt untouched), even
		// though the order DID change (A and B swapped) — proving selective writes.
		expect(await updatedAtOf(c)).toBe(cBefore);
		expect(
			(await asA.query(api.products.listAll, { retailerId: retailer._id })).map(
				(p) => p.name,
			),
		).toEqual(["B", "A", "C"]);
	});

	// --- Custom / made-to-order line (docs/custom-option.md) -----------------

	describe("custom option", () => {
		test("create adds the custom line outside the cartesian, coerced made-to-order", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const asA = t.withIdentity({ subject: USER_A });
			const id = await asA.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Cake",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				options: [{ name: "Size", values: ["S", "M"] }],
				variants: [
					{ optionValues: ["S"], price: 1000, onHand: 3 },
					{ optionValues: ["M"], price: 1500, onHand: 2 },
					{
						optionValues: [],
						price: 0,
						onHand: 0,
						isCustom: true,
						customLabel: "Bespoke",
						customPrompt: "Tell us your theme",
					},
				],
			});
			const product = await asA.query(api.products.get, { productId: id });
			// 2 matrix variants + 1 custom — custom does NOT multiply across sizes.
			expect(product?.variants).toHaveLength(3);
			const custom = product?.variants.find((v) => v.isCustom);
			expect(custom?.customLabel).toBe("Bespoke");
			expect(custom?.customPrompt).toBe("Tell us your theme");
			// Coerced server-side regardless of input: made-to-order + mockup-gated.
			expect(custom?.blockWhenOutOfStock).toBe(false);
			expect(custom?.requiresProof).toBe(true);
			expect(custom?.price).toBe(0);
			// A RM0 quote variant is excluded from the displayed price range.
			expect(product?.priceFrom).toBe(1000);
			expect(product?.priceTo).toBe(1500);
			expect(product?.hasQuotePricing).toBe(true);
		});

		test("a product can be JUST a custom line — the made-to-order type", async () => {
			// 86eyfq04j: the type IS one bespoke offer, so it carries no matrix at
			// all. Modelling it as `isCustom` is what earns it the storefront's
			// existing bespoke flow instead of a parallel path.
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const asA = t.withIdentity({ subject: USER_A });
			const id = await asA.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Tent wash",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				options: [],
				variants: [
					{
						optionValues: [],
						price: 0,
						onHand: 0,
						isCustom: true,
						customPrompt: "Tent size, model & how dirty",
					},
				],
			});
			const product = await asA.query(api.products.get, { productId: id });
			expect(product?.variants).toHaveLength(1);
			expect(product?.variants[0].isCustom).toBe(true);
			expect(product?.variants[0].requiresProof).toBe(true);
			expect(product?.variants[0].blockWhenOutOfStock).toBe(false);
			// Price-on-quote, and never "free".
			expect(product?.hasQuotePricing).toBe(true);
			// Always orderable — made on demand, so it can't sell out.
			expect(product?.inStock).toBe(true);
		});

		test("an EMPTY variant set is still rejected", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const asA = t.withIdentity({ subject: USER_A });
			await expect(
				asA.mutation(api.products.create, {
					retailerId: retailer._id,
					name: "Nothing",
					currency: "MYR",
					imageStorageIds: [],
					sortOrder: 0,
					options: [],
					variants: [],
				}),
			).rejects.toThrow(/at least one variant/i);
		});

		test("axes with no matrix are still rejected — a grid selling nothing", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const asA = t.withIdentity({ subject: USER_A });
			await expect(
				asA.mutation(api.products.create, {
					retailerId: retailer._id,
					name: "Cake",
					currency: "MYR",
					imageStorageIds: [],
					sortOrder: 0,
					options: [{ name: "Size", values: ["S", "M"] }],
					variants: [{ optionValues: [], price: 0, onHand: 0, isCustom: true }],
				}),
			).rejects.toThrow(/at least one variant/i);
		});

		test("blank custom label defaults to \"Custom\"", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const asA = t.withIdentity({ subject: USER_A });
			const id = await asA.mutation(api.products.create, {
				...baseProduct(retailer._id),
				variants: [
					{ optionValues: [], price: 2000, onHand: 5 },
					{ optionValues: [], price: 0, onHand: 0, isCustom: true },
				],
			});
			const product = await asA.query(api.products.get, { productId: id });
			expect(product?.variants.find((v) => v.isCustom)?.customLabel).toBe(
				"Custom",
			);
		});

		test("a no-axes default and a custom line coexist and reconcile by identity", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const asA = t.withIdentity({ subject: USER_A });
			// Both rows have optionValues [] — only isCustom tells them apart.
			const id = await asA.mutation(api.products.create, {
				...baseProduct(retailer._id),
				variants: [
					{ optionValues: [], price: 2000, onHand: 5 },
					{ optionValues: [], price: 0, onHand: 0, isCustom: true },
				],
			});
			const before = await asA.query(api.products.get, { productId: id });
			expect(before?.variants).toHaveLength(2);
			const defaultId = before?.variants.find((v) => !v.isCustom)?._id;

			// Edit both via the grid save: change the default + custom price. The
			// two []-keyed rows must NOT fuse — reconciliation keys on isCustom.
			await asA.mutation(api.products.saveVariantGrid, {
				productId: id,
				options: [],
				variants: [
					{ optionValues: [], price: 2500, onHand: 8 },
					{ optionValues: [], price: 500, onHand: 0, isCustom: true },
				],
			});
			const after = await asA.query(api.products.get, { productId: id });
			expect(after?.variants).toHaveLength(2);
			// The default variant kept its _id (historical orders stay valid).
			expect(after?.variants.find((v) => !v.isCustom)?._id).toBe(defaultId);
			expect(after?.variants.find((v) => !v.isCustom)?.price).toBe(2500);
			expect(after?.variants.find((v) => v.isCustom)?.price).toBe(500);
		});

		test("rejects more than one custom line", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const asA = t.withIdentity({ subject: USER_A });
			await expect(
				asA.mutation(api.products.create, {
					...baseProduct(retailer._id),
					variants: [
						{ optionValues: [], price: 2000, onHand: 5 },
						{ optionValues: [], price: 0, onHand: 0, isCustom: true },
						{ optionValues: [], price: 0, onHand: 0, isCustom: true },
					],
				}),
			).rejects.toThrow(/at most one custom option/i);
		});

		test("rejects a custom line tied to option values", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const asA = t.withIdentity({ subject: USER_A });
			await expect(
				asA.mutation(api.products.create, {
					retailerId: retailer._id,
					name: "Cake",
					currency: "MYR",
					imageStorageIds: [],
					sortOrder: 0,
					options: [{ name: "Size", values: ["S"] }],
					variants: [
						{ optionValues: ["S"], price: 1000, onHand: 3 },
						{ optionValues: ["S"], price: 0, onHand: 0, isCustom: true },
					],
				}),
			).rejects.toThrow(/must not be tied to any option values/i);
		});
	});
});

// ---------------------------------------------------------------------------
// Product slugs + public product page (86eybrhrt PR2)
// ---------------------------------------------------------------------------

describe("product slugs", () => {
	test("create derives a slug from the name; collisions suffix -2, -3", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });

		const first = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Kek Batik Premium!" }),
		);
		const second = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Kek Batik Premium", sortOrder: 1 }),
		);

		const rows = await t.run(async (ctx) => ({
			first: await ctx.db.get(first),
			second: await ctx.db.get(second),
		}));
		expect(rows.first?.slug).toBe("kek-batik-premium");
		expect(rows.second?.slug).toBe("kek-batik-premium-2");
	});

	test("renaming keeps the slug stable (shared links keep working)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Pavlova Mini" }),
		);

		await asA.mutation(api.products.update, {
			productId: id,
			name: "Pavlova Mini (New Recipe)",
		});

		const row = await t.run((ctx) => ctx.db.get(id));
		expect(row?.slug).toBe("pavlova-mini");
	});

	test("a degenerate name still gets a valid slug", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "🎂" }),
		);
		const row = await t.run((ctx) => ctx.db.get(id));
		expect(row?.slug).toBe("item");
	});

	test("editing a legacy slug-less product assigns its permanent slug", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Old Timer" }),
		);
		// Simulate a pre-slug row.
		await t.run((ctx) => ctx.db.patch(id, { slug: undefined }));

		await asA.mutation(api.products.update, { productId: id, hidden: false });

		const row = await t.run((ctx) => ctx.db.get(id));
		expect(row?.slug).toBe("old-timer");
	});

	test("backfillProductSlugs fills only slug-less rows, idempotently", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const keep = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Keeps Slug" }),
		);
		const legacy = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Legacy Row", sortOrder: 1 }),
		);
		await t.run((ctx) => ctx.db.patch(legacy, { slug: undefined }));

		await t.mutation(internal.products.backfillProductSlugs, {});

		const rows = await t.run(async (ctx) => ({
			keep: await ctx.db.get(keep),
			legacy: await ctx.db.get(legacy),
		}));
		expect(rows.keep?.slug).toBe("keeps-slug");
		expect(rows.legacy?.slug).toBe("legacy-row");
	});
});

describe("products.getPublicBySlug", () => {
	test("resolves a visible product with the storefront shape", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Tent 2P", price: 12000 }),
		);

		const product = await t.query(api.products.getPublicBySlug, {
			retailerId: retailer._id,
			slug: "tent-2p",
		});
		expect(product?.name).toBe("Tent 2P");
		expect(product?.priceFrom).toBe(12000);
		expect(product?.variants).toHaveLength(1);
	});

	test("is case/whitespace tolerant on the slug", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Tent 2P" }),
		);
		const product = await t.query(api.products.getPublicBySlug, {
			retailerId: retailer._id,
			slug: "  TENT-2P ",
		});
		expect(product?.name).toBe("Tent 2P");
	});

	test("answers null for hidden, archived and unknown products", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const hidden = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Event Special" }),
		);
		await asA.mutation(api.products.update, {
			productId: hidden,
			hidden: true,
		});
		const archived = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Retired Tent", sortOrder: 1 }),
		);
		await asA.mutation(api.products.archive, { productId: archived });

		expect(
			await t.query(api.products.getPublicBySlug, {
				retailerId: retailer._id,
				slug: "event-special",
			}),
		).toBeNull();
		expect(
			await t.query(api.products.getPublicBySlug, {
				retailerId: retailer._id,
				slug: "retired-tent",
			}),
		).toBeNull();
		expect(
			await t.query(api.products.getPublicBySlug, {
				retailerId: retailer._id,
				slug: "never-existed",
			}),
		).toBeNull();
	});

	test("resolves a legacy slug-less product by its derived name slug", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Tent 2P" }),
		);
		// Simulate a row created before slugs existed and not yet backfilled.
		await t.run((ctx) => ctx.db.patch(id, { slug: undefined }));

		// Still addressable — otherwise it'd be un-openable between a deploy and
		// the backfill, since the page is the storefront's only product view.
		const product = await t.query(api.products.getPublicBySlug, {
			retailerId: retailer._id,
			slug: "tent-2p",
		});
		expect(product?._id).toBe(id);
		// …and the list hands the grid a usable link for it.
		const listed = await t.query(api.products.list, {
			retailerId: retailer._id,
		});
		expect(listed.find((p) => p._id === id)?.slug).toBe("tent-2p");
	});

	test("the derived fallback still respects visibility (hidden → null)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Event Special" }),
		);
		await asA.mutation(api.products.update, { productId: id, hidden: true });
		await t.run((ctx) => ctx.db.patch(id, { slug: undefined }));

		expect(
			await t.query(api.products.getPublicBySlug, {
				retailerId: retailer._id,
				slug: "event-special",
			}),
		).toBeNull();
	});

	test("a hidden product KEEPS its slug — no takeover, and restoring revives the URL", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const original = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Signature Cake" }),
		);
		await asA.mutation(api.products.update, {
			productId: original,
			hidden: true,
		});
		// A new product with the same name must NOT steal the hidden one's URL.
		const usurper = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Signature Cake", sortOrder: 1 }),
		);
		const usurperRow = await t.run((ctx) => ctx.db.get(usurper));
		expect(usurperRow?.slug).toBe("signature-cake-2");

		await asA.mutation(api.products.update, {
			productId: original,
			hidden: false,
		});
		const revived = await t.query(api.products.getPublicBySlug, {
			retailerId: retailer._id,
			slug: "signature-cake",
		});
		expect(revived?._id).toBe(original);
	});
});

describe("products.listForSitemap", () => {
	test("emits one URL pair per storefront-visible product", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Tent 2P" }),
		);
		await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Camp Stove", sortOrder: 1 }),
		);

		const rows = await t.query(api.products.listForSitemap);
		expect(
			rows
				.filter((r) => r.storeSlug === retailer.slug)
				.map((r) => r.productSlug)
				.sort(),
		).toEqual(["camp-stove", "tent-2p"]);
	});

	// A sitemap is public: anything the storefront hides must not be advertised
	// to a crawler either, or Google indexes URLs that answer 404.
	test("omits hidden and archived products", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const hidden = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Counter Only" }),
		);
		await asA.mutation(api.products.update, {
			productId: hidden,
			hidden: true,
		});
		const archived = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Retired Tent", sortOrder: 1 }),
		);
		await asA.mutation(api.products.archive, { productId: archived });
		await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Live Tent", sortOrder: 2 }),
		);

		const slugs = (await t.query(api.products.listForSitemap))
			.filter((r) => r.storeSlug === retailer.slug)
			.map((r) => r.productSlug);
		expect(slugs).toEqual(["live-tent"]);
	});

	// A derived slug is a temporary address — publishing one to a crawler risks
	// indexing a URL the backfill is about to replace.
	test("skips legacy rows that have no stored slug yet", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Legacy Tent" }),
		);
		await t.run((ctx) => ctx.db.patch(id, { slug: undefined }));

		expect(
			(await t.query(api.products.listForSitemap)).filter(
				(r) => r.storeSlug === retailer.slug,
			),
		).toEqual([]);

		// …and picks it up the moment the backfill stamps one.
		await t.mutation(internal.products.backfillProductSlugs, {});
		expect(
			(await t.query(api.products.listForSitemap))
				.filter((r) => r.storeSlug === retailer.slug)
				.map((r) => r.productSlug),
		).toEqual(["legacy-tent"]);
	});

	test("scopes each product to its own store's slug", async () => {
		const t = setup();
		const a = await seedRetailer(t, USER_A);
		const b = await seedRetailer(t, USER_B);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.products.create, baseProduct(a._id, { name: "A Tent" }));
		await t
			.withIdentity({ subject: USER_B })
			.mutation(api.products.create, baseProduct(b._id, { name: "B Tent" }));

		const rows = await t.query(api.products.listForSitemap);
		expect(
			rows.map((r) => `${r.storeSlug}/p/${r.productSlug}`).sort(),
		).toEqual([`${a.slug}/p/a-tent`, `${b.slug}/p/b-tent`].sort());
	});
});

describe("popularProducts (public, storefront featured card)", () => {
	const DAY = 24 * 60 * 60 * 1000;

	/** Insert an order directly — only the fields the ranking reads matter. */
	async function insertOrder(
		t: ReturnType<typeof convexTest>,
		retailerId: Id<"retailers">,
		productId: Id<"products">,
		opts: { status?: string; quantity?: number; seq: number },
	) {
		const now = Date.now();
		await t.run(async (ctx) =>
			ctx.db.insert("orders", {
				retailerId,
				shortId: `ORD-POP${opts.seq}`,
				items: [
					{
						productId,
						name: "Tent 2P",
						price: 12000,
						quantity: opts.quantity ?? 1,
					},
				],
				subtotal: 12000,
				total: 12000,
				currency: "MYR",
				status: opts.status ?? "confirmed",
				channel: "whatsapp",
				customer: { name: "Aisyah", waPhone: "60123456789" },
				createdAt: now,
				updatedAt: now,
			}),
		);
	}

	test("ranks recent revenue orders and stays scoped to the retailer", async () => {
		const t = setup();
		const retailerA = await seedRetailer(t, USER_A);
		const retailerB = await seedRetailer(t, USER_B);
		const asA = t.withIdentity({ subject: USER_A });
		const asB = t.withIdentity({ subject: USER_B });
		const cake = await asA.mutation(
			api.products.create,
			baseProduct(retailerA._id, { name: "Cake" }),
		);
		const pie = await asA.mutation(
			api.products.create,
			baseProduct(retailerA._id, { name: "Pie", sortOrder: 1 }),
		);
		const other = await asB.mutation(
			api.products.create,
			baseProduct(retailerB._id, { name: "Other" }),
		);

		// Cake: 3 orders. Pie: 2 orders + 1 pending (doesn't count).
		await insertOrder(t, retailerA._id, cake, { seq: 1 });
		await insertOrder(t, retailerA._id, cake, { seq: 2, status: "delivered" });
		await insertOrder(t, retailerA._id, cake, { seq: 3, status: "packed" });
		await insertOrder(t, retailerA._id, pie, { seq: 4 });
		await insertOrder(t, retailerA._id, pie, { seq: 5 });
		await insertOrder(t, retailerA._id, pie, { seq: 6, status: "pending" });
		// Retailer B's own volume must never leak into A's ranking.
		await insertOrder(t, retailerB._id, other, { seq: 7 });
		await insertOrder(t, retailerB._id, other, { seq: 8 });

		const since = todayMytMidnight() - 7 * DAY;
		const ranked = await t.query(api.products.popularProducts, {
			retailerId: retailerA._id,
			since,
		});
		expect(ranked).toEqual([cake, pie]);

		const rankedB = await t.query(api.products.popularProducts, {
			retailerId: retailerB._id,
			since,
		});
		expect(rankedB).toEqual([other]);
	});

	test("a single order is not 'popular' — empty result, row hides", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const cake = await asUser.mutation(
			api.products.create,
			baseProduct(retailer._id, { name: "Cake" }),
		);
		await insertOrder(t, retailer._id, cake, { seq: 1 });
		const ranked = await t.query(api.products.popularProducts, {
			retailerId: retailer._id,
			since: todayMytMidnight() - 7 * DAY,
		});
		expect(ranked).toEqual([]);
	});

	test("rejects a since that is not an MYT midnight (cache-key discipline)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await expect(
			t.query(api.products.popularProducts, {
				retailerId: retailer._id,
				since: Date.now(),
			}),
		).rejects.toThrow(/MYT-midnight/);
	});

	// The starvation bug from the PR #155 review: ranking sees counter-only and
	// archived products (their orders are real), so capping before filtering
	// spent slots on products that can never render, with no rank-11 to
	// back-fill. A stall seller whose top sellers are counter-only got an empty
	// shelf. Visibility now filters BEFORE the cap.
	test("unlisted bestsellers never consume a slot — lower ranks back-fill", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const make = async (name: string, sortOrder: number) =>
			asUser.mutation(
				api.products.create,
				baseProduct(retailer._id, { name, sortOrder }),
			);
		// Two top sellers that the storefront does NOT list...
		const counterOnly = await make("Counter only", 0);
		const archived = await make("Retired", 1);
		// ...and one that it does, ranked below both.
		const listed = await make("Listed", 2);

		await asUser.mutation(api.products.update, {
			productId: counterOnly,
			hidden: true,
		});
		await asUser.mutation(api.products.archive, { productId: archived });

		// Ranking order: counterOnly (4) > archived (3) > listed (2).
		let seq = 0;
		for (const [productId, count] of [
			[counterOnly, 4],
			[archived, 3],
			[listed, 2],
		] as const) {
			for (let i = 0; i < count; i++) {
				await insertOrder(t, retailer._id, productId, { seq: ++seq });
			}
		}

		const ranked = await t.query(api.products.popularProducts, {
			retailerId: retailer._id,
			since: todayMytMidnight() - 7 * DAY,
		});
		// The listed product is surfaced despite ranking third, and neither
		// unlisted id is named to an unauthenticated caller.
		expect(ranked).toEqual([listed]);
	});
});
