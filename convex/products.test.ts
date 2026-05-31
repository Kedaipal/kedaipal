/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
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

const baseProduct = (retailerId: string) => ({
	retailerId: retailerId as never,
	name: "Tent 2P",
	price: 12000,
	currency: "MYR",
	stock: 5,
	imageStorageIds: [],
	sortOrder: 0,
});

describe("products", () => {
	test("owner can create a product and read it back", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, baseProduct(retailer._id));
		const product = await asA.query(api.products.get, { productId: id });
		expect(product?.name).toBe("Tent 2P");
		expect(product?.active).toBe(true);
		expect(product?.channel).toBe("whatsapp");
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
		expect(list.some((p) => p._id === archivedId)).toBe(false);
	});

	test("listAll returns active and inactive for owner", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id1 = await asA.mutation(api.products.create, baseProduct(retailer._id));
		await asA.mutation(api.products.create, baseProduct(retailer._id));
		await asA.mutation(api.products.archive, { productId: id1 });

		const all = await asA.query(api.products.listAll, {
			retailerId: retailer._id,
		});
		expect(all).toHaveLength(2);
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

	test("update patches only specified fields", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const id = await asA.mutation(api.products.create, baseProduct(retailer._id));
		await asA.mutation(api.products.update, { productId: id, name: "Tent 3P" });
		const product = await asA.query(api.products.get, { productId: id });
		expect(product?.name).toBe("Tent 3P");
		expect(product?.price).toBe(12000); // unchanged
		expect(product?.stock).toBe(5); // unchanged
	});

	test("bulkUpsert inserts all rows when no sku matches exist", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const result = await asA.mutation(api.products.bulkUpsert, {
			retailerId: retailer._id,
			currency: "MYR",
			items: [
				{ name: "Tent", price: 49900, stock: 12 },
				{
					sku: "HL-200",
					name: "Headlamp",
					description: "USB-C",
					price: 8950,
					stock: 30,
				},
			],
		});
		expect(result).toEqual({ created: 2, updated: 0 });
		const all = await asA.query(api.products.listAll, {
			retailerId: retailer._id,
		});
		expect(all).toHaveLength(2);
		expect(all.map((p) => p.name).sort()).toEqual(["Headlamp", "Tent"]);
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
		const all = await asA.query(api.products.listAll, {
			retailerId: retailer._id,
		});
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

	test("bulkUpsert patches an existing row when sku matches, preserving channel+active+images+sortOrder", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const originalId = await asA.mutation(api.products.create, {
			...baseProduct(retailer._id),
			sku: "TENT-4P",
			sortOrder: 42,
		});
		await asA.mutation(api.products.archive, { productId: originalId });

		// Seed `imageStorageIds` directly — the create mutation always starts
		// with []; we want to verify that bulkUpsert doesn't overwrite an
		// existing images list. Using raw db access keeps us off the storage
		// system (test setup doesn't have real storage IDs).
		await t.run(async (ctx) => {
			await ctx.db.patch(originalId, { imageStorageIds: ["fake-storage-id"] });
		});

		const result = await asA.mutation(api.products.bulkUpsert, {
			retailerId: retailer._id,
			currency: "MYR",
			items: [
				{
					sku: "TENT-4P",
					name: "Tent 2P Updated",
					price: 13000,
					stock: 7,
				},
			],
		});

		expect(result).toEqual({ created: 0, updated: 1 });
		const updated = await t.run(async (ctx) => ctx.db.get(originalId));
		expect(updated?.name).toBe("Tent 2P Updated");
		expect(updated?.price).toBe(13000);
		expect(updated?.stock).toBe(7);
		// Preserved fields:
		expect(updated?.active).toBe(false);
		expect(updated?.channel).toBe("whatsapp");
		expect(updated?.imageStorageIds).toEqual(["fake-storage-id"]);
		expect(updated?.sortOrder).toBe(42);
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

	test("bulkUpsert: pure-update batch is not blocked by product cap", async () => {
		// Seed the retailer right at the 50-product cap, all with SKUs,
		// then send a 50-row upsert that all match existing rows. No new
		// inserts — should succeed despite the cap.
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const items = Array.from({ length: 50 }, (_, i) => ({
			sku: `SKU-${i}`,
			name: `Product ${i}`,
			price: 1000,
			stock: 1,
		}));
		await asA.mutation(api.products.bulkUpsert, {
			retailerId: retailer._id,
			currency: "MYR",
			items,
		});
		// Re-send the same 50 — all updates, no inserts.
		const result = await asA.mutation(api.products.bulkUpsert, {
			retailerId: retailer._id,
			currency: "MYR",
			items: items.map((i) => ({ ...i, stock: 5 })),
		});
		expect(result).toEqual({ created: 0, updated: 50 });
	});

	test("bulkUpsertPreview does not write and returns correct plan", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.products.create, {
			...baseProduct(retailer._id),
			sku: "TENT-4P",
			name: "Tent original",
			price: 12000,
			stock: 5,
		});
		const before = await asA.query(api.products.listAll, {
			retailerId: retailer._id,
		});
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
		// stock unchanged → not in diff
		expect(preview.plan[0]?.diff.stock).toBeUndefined();
		expect(preview.plan[1]?.action).toBe("insert");

		const after = await asA.query(api.products.listAll, {
			retailerId: retailer._id,
		});
		expect(after).toHaveLength(before.length);
	});

	test("bulkUpsertPreview classifies a no-op upsert as noChange", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.products.create, {
			...baseProduct(retailer._id),
			sku: "TENT-4P",
			name: "Tent",
			description: "4-season",
			price: 12000,
			stock: 5,
		});
		const preview = await asA.query(api.products.bulkUpsertPreview, {
			retailerId: retailer._id,
			items: [
				{
					sku: "TENT-4P",
					name: "Tent",
					description: "4-season",
					price: 12000,
					stock: 5,
				},
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
