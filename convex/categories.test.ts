/// <reference types="vite/client" />
// Product categories (86ey81n63) — CRUD, per-retailer slug uniqueness, the
// junction diff (setProductCategories), within-category ordering, and the
// public storefront reads (rail + category page) incl. their visibility rules:
// only ACTIVE categories with ≥1 active+visible product ever reach a shopper.
// Plan gating lives in planGating.test.ts. See docs/product-categories.md.
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

const USER_A = "user_categories_a";
const USER_B = "user_categories_b";

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const safeSuffix = userId.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Category Store",
		slug: `category-store-${safeSuffix}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedProduct(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	name = "Kuih Box",
): Promise<Id<"products">> {
	const asUser = t.withIdentity({ subject: userId });
	return asUser.mutation(api.products.create, {
		retailerId,
		name,
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 2500, onHand: 100 }],
	});
}

async function createCategory(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	name: string,
	slug?: string,
): Promise<Id<"categories">> {
	const asUser = t.withIdentity({ subject: userId });
	const { categoryId } = await asUser.mutation(api.categories.create, {
		retailerId,
		name,
		slug: slug ?? name.toLowerCase().replace(/\s+/g, "-"),
	});
	return categoryId;
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("categories.create", () => {
	test("creates active rows appended in order, with sanitized fields", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });

		await createCategory(t, USER_A, retailer._id, "Daily Meals");
		await asA.mutation(api.categories.create, {
			retailerId: retailer._id,
			name: "  Event Packages  ",
			slug: "  Event-Packages ", // shape-normalized (trim + lowercase)
			description: "  Big-day spreads  ",
		});

		const rows = await asA.query(api.categories.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows.map((r) => r.name)).toEqual(["Daily Meals", "Event Packages"]);
		expect(rows.map((r) => r.sortOrder)).toEqual([0, 1]);
		expect(rows[1].slug).toBe("event-packages");
		expect(rows[1].description).toBe("Big-day spreads");
		expect(rows.every((r) => r.active)).toBe(true);
		expect(rows.every((r) => r.productCount === 0)).toBe(true);
	});

	test("rejects invalid slugs but ALLOWS store-reserved words (no collision surface)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });

		await expect(
			asA.mutation(api.categories.create, {
				retailerId: retailer._id,
				name: "Bad",
				slug: "no spaces!",
			}),
		).rejects.toThrow(/lowercase letters/);
		await expect(
			asA.mutation(api.categories.create, {
				retailerId: retailer._id,
				name: "Bad",
				slug: "ab",
			}),
		).rejects.toThrow(/at least 3/);

		// "admin" is reserved for STORE slugs; category slugs live under
		// /$slug/c/ so it must pass.
		await expect(
			asA.mutation(api.categories.create, {
				retailerId: retailer._id,
				name: "Admin picks",
				slug: "admin",
			}),
		).resolves.toBeTruthy();
	});

	test("slug is unique per retailer, but two retailers can share one", async () => {
		const t = setup();
		const retailerA = await seedRetailer(t, USER_A);
		const retailerB = await seedRetailer(t, USER_B);

		await createCategory(t, USER_A, retailerA._id, "Meals", "meals");
		await expect(
			createCategory(t, USER_A, retailerA._id, "Meals Two", "meals"),
		).rejects.toThrow(/already uses the link/);
		// Same slug, different store — fine.
		await expect(
			createCategory(t, USER_B, retailerB._id, "Meals", "meals"),
		).resolves.toBeTruthy();
	});

	test("rejects a non-owner", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		await expect(
			createCategory(t, USER_B, retailer._id, "Sneaky"),
		).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("categories.update", () => {
	test("patches fields; empty description clears; own slug is not a conflict", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const categoryId = await createCategory(
			t,
			USER_A,
			retailer._id,
			"Meals",
			"meals",
		);

		await asA.mutation(api.categories.update, {
			categoryId,
			name: "Daily Meals",
			slug: "meals", // unchanged — must not self-conflict
			description: "Fresh every morning",
		});
		let rows = await asA.query(api.categories.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].name).toBe("Daily Meals");
		expect(rows[0].description).toBe("Fresh every morning");

		await asA.mutation(api.categories.update, {
			categoryId,
			description: "",
		});
		rows = await asA.query(api.categories.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].description).toBeUndefined();
	});

	test("rejects a slug already used by a sibling (including an archived one)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const mealsId = await createCategory(
			t,
			USER_A,
			retailer._id,
			"Meals",
			"meals",
		);
		const eventsId = await createCategory(
			t,
			USER_A,
			retailer._id,
			"Events",
			"events",
		);

		await expect(
			asA.mutation(api.categories.update, { categoryId: eventsId, slug: "meals" }),
		).rejects.toThrow(/already uses the link/);

		// Archived categories keep their slug — restoring one must find its URL
		// intact, so an archived slug still blocks reuse.
		await asA.mutation(api.categories.setActive, {
			categoryId: mealsId,
			active: false,
		});
		await expect(
			asA.mutation(api.categories.update, { categoryId: eventsId, slug: "meals" }),
		).rejects.toThrow(/already uses the link/);
	});

	test("replacing/clearing the image GCs the old blob", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const categoryId = await createCategory(t, USER_A, retailer._id, "Meals");

		const { oldImageId, newImageId } = await t.run(async (ctx) => {
			const store = () =>
				ctx.storage.store(
					new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
				);
			return { oldImageId: await store(), newImageId: await store() };
		});

		await asA.mutation(api.categories.update, {
			categoryId,
			imageStorageId: oldImageId,
		});
		await asA.mutation(api.categories.update, {
			categoryId,
			imageStorageId: newImageId,
		});
		await t.run(async (ctx) => {
			expect(await ctx.storage.getUrl(oldImageId)).toBeNull(); // GC'd
			expect(await ctx.storage.getUrl(newImageId)).not.toBeNull();
		});

		await asA.mutation(api.categories.update, {
			categoryId,
			imageStorageId: null,
		});
		await t.run(async (ctx) => {
			expect(await ctx.storage.getUrl(newImageId)).toBeNull(); // cleared → GC'd
		});
	});
});

// ---------------------------------------------------------------------------
// setActive (archive / restore)
// ---------------------------------------------------------------------------

describe("categories.setActive", () => {
	test("archiving hides the category publicly but keeps junction rows; restore appends to end and revives assignments", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const mealsId = await createCategory(t, USER_A, retailer._id, "Meals");
		await createCategory(t, USER_A, retailer._id, "Events");
		const productId = await seedProduct(t, USER_A, retailer._id);
		await asA.mutation(api.categories.setProductCategories, {
			productId,
			categoryIds: [mealsId],
		});

		await asA.mutation(api.categories.setActive, {
			categoryId: mealsId,
			active: false,
		});
		const rail = await t.query(api.categories.listActivePublic, {
			retailerId: retailer._id,
		});
		expect(rail.map((r) => r.name)).toEqual([]); // Events has no products
		const page = await t.query(api.categories.getPublicPage, {
			retailerId: retailer._id,
			categorySlug: "meals",
		});
		expect(page).toBeNull(); // archived deep link → notFound

		// Junction rows survived the archive…
		const editorIds = await asA.query(api.categories.getProductCategoryIds, {
			productId,
		});
		expect(editorIds).toEqual([mealsId]);

		// …and restore revives the tile, appended after Events.
		await asA.mutation(api.categories.setActive, {
			categoryId: mealsId,
			active: true,
		});
		const rows = await asA.query(api.categories.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows.map((r) => r.name)).toEqual(["Events", "Meals"]);
		const revived = await t.query(api.categories.listActivePublic, {
			retailerId: retailer._id,
		});
		expect(revived.map((r) => r.name)).toEqual(["Meals"]);
	});
});

// ---------------------------------------------------------------------------
// reorder + reorderProducts
// ---------------------------------------------------------------------------

describe("categories.reorder", () => {
	test("rewrites sortOrder from the full permutation; rejects partial/duplicate/foreign sets", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const a = await createCategory(t, USER_A, retailer._id, "Aaa");
		const b = await createCategory(t, USER_A, retailer._id, "Bbb");
		const c = await createCategory(t, USER_A, retailer._id, "Ccc");

		await asA.mutation(api.categories.reorder, {
			retailerId: retailer._id,
			orderedIds: [c, a, b],
		});
		const rows = await asA.query(api.categories.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows.map((r) => r.name)).toEqual(["Ccc", "Aaa", "Bbb"]);

		await expect(
			asA.mutation(api.categories.reorder, {
				retailerId: retailer._id,
				orderedIds: [a, b], // missing c
			}),
		).rejects.toThrow(/exactly once/);
		await expect(
			asA.mutation(api.categories.reorder, {
				retailerId: retailer._id,
				orderedIds: [a, a, b],
			}),
		).rejects.toThrow(/Duplicate/);
	});
});

describe("categories.reorderProducts", () => {
	test("reorders the junction rows within one category, independent of global product order", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const mealsId = await createCategory(t, USER_A, retailer._id, "Meals");
		const p1 = await seedProduct(t, USER_A, retailer._id, "Nasi Lemak");
		const p2 = await seedProduct(t, USER_A, retailer._id, "Laksa");
		const p3 = await seedProduct(t, USER_A, retailer._id, "Rendang");
		for (const productId of [p1, p2, p3]) {
			await asA.mutation(api.categories.setProductCategories, {
				productId,
				categoryIds: [mealsId],
			});
		}

		await asA.mutation(api.categories.reorderProducts, {
			categoryId: mealsId,
			orderedProductIds: [p3, p1, p2],
		});
		const page = await t.query(api.categories.getPublicPage, {
			retailerId: retailer._id,
			categorySlug: "meals",
		});
		expect(page?.products.map((p) => p.name)).toEqual([
			"Rendang",
			"Nasi Lemak",
			"Laksa",
		]);

		await expect(
			asA.mutation(api.categories.reorderProducts, {
				categoryId: mealsId,
				orderedProductIds: [p1, p2], // missing p3
			}),
		).rejects.toThrow(/exactly once/);
		await expect(
			asA.mutation(api.categories.reorderProducts, {
				categoryId: mealsId,
				orderedProductIds: [p1, p1, p2],
			}),
		).rejects.toThrow(/Duplicate/);
	});
});

// ---------------------------------------------------------------------------
// setProductCategories (the junction diff)
// ---------------------------------------------------------------------------

describe("categories.setProductCategories", () => {
	test("diffs the membership: adds append to each category's end, removals delete, kept rows keep their position", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const mealsId = await createCategory(t, USER_A, retailer._id, "Meals");
		const eventsId = await createCategory(t, USER_A, retailer._id, "Events");
		const p1 = await seedProduct(t, USER_A, retailer._id, "Nasi Lemak");
		const p2 = await seedProduct(t, USER_A, retailer._id, "Laksa");

		await asA.mutation(api.categories.setProductCategories, {
			productId: p1,
			categoryIds: [mealsId],
		});
		await asA.mutation(api.categories.setProductCategories, {
			productId: p2,
			categoryIds: [mealsId],
		});
		// Move p1's membership: keep Meals, add Events. Its Meals position (first)
		// must survive the unrelated edit.
		await asA.mutation(api.categories.setProductCategories, {
			productId: p1,
			categoryIds: [mealsId, eventsId],
		});
		let meals = await t.query(api.categories.getPublicPage, {
			retailerId: retailer._id,
			categorySlug: "meals",
		});
		expect(meals?.products.map((p) => p.name)).toEqual(["Nasi Lemak", "Laksa"]);

		// Clear p1 entirely — junction rows for it are gone, Meals keeps p2.
		await asA.mutation(api.categories.setProductCategories, {
			productId: p1,
			categoryIds: [],
		});
		expect(
			await asA.query(api.categories.getProductCategoryIds, { productId: p1 }),
		).toEqual([]);
		meals = await t.query(api.categories.getPublicPage, {
			retailerId: retailer._id,
			categorySlug: "meals",
		});
		expect(meals?.products.map((p) => p.name)).toEqual(["Laksa"]);
	});

	test("enforces the 10-category cap and rejects duplicates", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const productId = await seedProduct(t, USER_A, retailer._id);
		const ids: Id<"categories">[] = [];
		for (let i = 0; i < 11; i++) {
			ids.push(
				await createCategory(t, USER_A, retailer._id, `Cat ${i}`, `cat-${i}00`),
			);
		}
		await expect(
			asA.mutation(api.categories.setProductCategories, {
				productId,
				categoryIds: ids,
			}),
		).rejects.toThrow(/at most 10/);
		await expect(
			asA.mutation(api.categories.setProductCategories, {
				productId,
				categoryIds: [ids[0], ids[0]],
			}),
		).rejects.toThrow(/Duplicate/);
		await expect(
			asA.mutation(api.categories.setProductCategories, {
				productId,
				categoryIds: ids.slice(0, 10),
			}),
		).resolves.toBeNull();
	});

	test("rejects adding a cross-retailer or archived category", async () => {
		const t = setup();
		const retailerA = await seedRetailer(t, USER_A);
		const retailerB = await seedRetailer(t, USER_B);
		const asA = t.withIdentity({ subject: USER_A });
		const productId = await seedProduct(t, USER_A, retailerA._id);
		const foreignId = await createCategory(t, USER_B, retailerB._id, "Foreign");
		const archivedId = await createCategory(t, USER_A, retailerA._id, "Old");
		await asA.mutation(api.categories.setActive, {
			categoryId: archivedId,
			active: false,
		});

		await expect(
			asA.mutation(api.categories.setProductCategories, {
				productId,
				categoryIds: [foreignId],
			}),
		).rejects.toThrow(/not found or no longer active/);
		await expect(
			asA.mutation(api.categories.setProductCategories, {
				productId,
				categoryIds: [archivedId],
			}),
		).rejects.toThrow(/not found or no longer active/);
	});
});

// ---------------------------------------------------------------------------
// Public reads — the visibility rules shoppers actually see
// ---------------------------------------------------------------------------

describe("categories public reads", () => {
	test("listActivePublic returns only active categories with ≥1 active+visible product", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const emptyId = await createCategory(t, USER_A, retailer._id, "Empty");
		const hiddenOnlyId = await createCategory(
			t,
			USER_A,
			retailer._id,
			"Hidden only",
			"hidden-only",
		);
		const archivedOnlyId = await createCategory(
			t,
			USER_A,
			retailer._id,
			"Archived only",
			"archived-only",
		);
		const liveId = await createCategory(t, USER_A, retailer._id, "Live");
		void emptyId;

		const hiddenProduct = await seedProduct(t, USER_A, retailer._id, "Event SKU");
		await asA.mutation(api.products.update, {
			productId: hiddenProduct,
			hidden: true,
		});
		await asA.mutation(api.categories.setProductCategories, {
			productId: hiddenProduct,
			categoryIds: [hiddenOnlyId],
		});

		const archivedProduct = await seedProduct(t, USER_A, retailer._id, "Retired");
		await asA.mutation(api.categories.setProductCategories, {
			productId: archivedProduct,
			categoryIds: [archivedOnlyId],
		});
		await asA.mutation(api.products.archive, { productId: archivedProduct });

		const liveProduct = await seedProduct(t, USER_A, retailer._id, "Nasi Lemak");
		await asA.mutation(api.categories.setProductCategories, {
			productId: liveProduct,
			categoryIds: [liveId],
		});

		const rail = await t.query(api.categories.listActivePublic, {
			retailerId: retailer._id,
		});
		expect(rail.map((r) => r.name)).toEqual(["Live"]);
		expect(rail[0].productCount).toBe(1);
	});

	test("getPublicPage filters hidden/archived products and returns null for unknown slugs", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const mealsId = await createCategory(t, USER_A, retailer._id, "Meals");
		const visible = await seedProduct(t, USER_A, retailer._id, "Nasi Lemak");
		const hidden = await seedProduct(t, USER_A, retailer._id, "Event SKU");
		await asA.mutation(api.products.update, { productId: hidden, hidden: true });
		for (const productId of [visible, hidden]) {
			await asA.mutation(api.categories.setProductCategories, {
				productId,
				categoryIds: [mealsId],
			});
		}

		const page = await t.query(api.categories.getPublicPage, {
			retailerId: retailer._id,
			categorySlug: "meals",
		});
		expect(page?.category.name).toBe("Meals");
		expect(page?.products.map((p) => p.name)).toEqual(["Nasi Lemak"]);
		// Enriched to the storefront shape (variants + rollups).
		expect(page?.products[0].variants.length).toBe(1);
		expect(page?.products[0].priceFrom).toBe(2500);

		expect(
			await t.query(api.categories.getPublicPage, {
				retailerId: retailer._id,
				categorySlug: "no-such-category",
			}),
		).toBeNull();
	});
});
