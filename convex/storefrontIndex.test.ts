/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { hasVisibleProduct } from "./storefrontIndex";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * The storefront index rule at the query level (z8r3fdh2ye): the three
 * sitemap queries and the storefront's `indexable` bit all answer from
 * `convex/lib/storefrontIndex.ts`, so one store flipped out of the rule
 * must vanish from every one of them at once — and its page must say
 * `noindex` through the same bit. The pure rule is unit-tested in
 * `lib/storefrontIndex.test.ts`; this file proves the wiring.
 */

const modules = import.meta.glob("./**/*.ts");
const OWNER = "user_index_owner";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

async function seedStore(t: ReturnType<typeof setup>, slug: string) {
	const owner = t.withIdentity({ subject: OWNER });
	await owner.mutation(api.retailers.createRetailer, {
		storeName: "Kuih Corner",
		slug,
	});
	const retailer = await owner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return { owner, retailerId: retailer._id as Id<"retailers"> };
}

async function addProduct(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	name: string,
) {
	return t.withIdentity({ subject: OWNER }).mutation(api.products.create, {
		retailerId,
		name,
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		variants: [{ optionValues: [], price: 1200, onHand: 20 }],
	});
}

async function everywhere(t: ReturnType<typeof setup>, slug: string) {
	const [stores, categories, products, page] = await Promise.all([
		t.query(api.retailers.listSlugsForSitemap, {}),
		t.query(api.categories.listForSitemap, {}),
		t.query(api.products.listForSitemap, {}),
		t.query(api.retailers.getRetailerBySlug, { slug }),
	]);
	return {
		inStores: stores.some((s) => s.slug === slug),
		inCategories: categories.some((c) => c.storeSlug === slug),
		inProducts: products.some((p) => p.storeSlug === slug),
		indexable:
			page.status === "ok" ? (page.retailer.indexable ?? null) : null,
	};
}

describe("storefront index rule — the sitemaps and the robots bit agree", () => {
	test("an empty store is out everywhere and noindex; its first product brings it in", async () => {
		const t = setup();
		const { retailerId } = await seedStore(t, "kuih-corner");

		expect(await everywhere(t, "kuih-corner")).toEqual({
			inStores: false,
			inCategories: false,
			inProducts: false,
			indexable: false,
		});

		await addProduct(t, retailerId, "Kuih Lapis");
		expect(await everywhere(t, "kuih-corner")).toMatchObject({
			inStores: true,
			inProducts: true,
			indexable: true,
		});
	});

	test("a cancelled subscription takes the store out of every list and marks the page noindex", async () => {
		const t = setup();
		const { retailerId } = await seedStore(t, "kuih-corner");
		await addProduct(t, retailerId, "Kuih Lapis");
		expect((await everywhere(t, "kuih-corner")).inStores).toBe(true);

		const setSub = (patch: Partial<Doc<"subscriptions">>) =>
			t.run(async (ctx) => {
				const sub = await ctx.db
					.query("subscriptions")
					.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
					.first();
				if (!sub) throw new Error("no subscription row");
				await ctx.db.patch(sub._id, patch);
			});

		await setSub({ status: "cancelled" });
		expect(await everywhere(t, "kuih-corner")).toEqual({
			inStores: false,
			inCategories: false,
			inProducts: false,
			indexable: false,
		});

		// On hold: ordering paused, catalogue live — still a real page.
		await setSub({ status: "on_hold" });
		expect(await everywhere(t, "kuih-corner")).toMatchObject({
			inStores: true,
			indexable: true,
		});
	});

	test("category pages follow the store and the rail's own visibility rule", async () => {
		const t = setup();
		const { owner, retailerId } = await seedStore(t, "kuih-corner");
		const productId = await addProduct(t, retailerId, "Kuih Lapis");
		const { categoryId } = await owner.mutation(api.categories.create, {
			retailerId,
			name: "Kuih",
			slug: "kuih",
		});
		// Empty category: not on the rail, not in the sitemap.
		expect((await everywhere(t, "kuih-corner")).inCategories).toBe(false);

		await owner.mutation(api.categories.setProductCategories, {
			productId,
			categoryIds: [categoryId],
		});
		const categories = await t.query(api.categories.listForSitemap, {});
		expect(categories).toContainEqual(
			expect.objectContaining({ storeSlug: "kuih-corner", categorySlug: "kuih" }),
		);

		// The product's breadcrumb names that category.
		expect(
			await t.query(api.categories.primaryPublicForProduct, {
				retailerId,
				productId,
			}),
		).toEqual({ name: "Kuih", slug: "kuih" });
	});

	test("lastmod moves with the newest product write, not the store's creation", async () => {
		const t = setup();
		const { retailerId } = await seedStore(t, "kuih-corner");
		const created = (await t.run((ctx) => ctx.db.get(retailerId)))?._creationTime;
		await addProduct(t, retailerId, "Kuih Lapis");
		const later = Date.now() + 60_000;
		await t.run(async (ctx) => {
			const product = await ctx.db
				.query("products")
				.withIndex("by_retailer_active", (q) =>
					q.eq("retailerId", retailerId).eq("active", true),
				)
				.first();
			if (!product) throw new Error("no product");
			await ctx.db.patch(product._id, { updatedAt: later });
		});
		const row = (await t.query(api.retailers.listSlugsForSitemap, {})).find(
			(s) => s.slug === "kuih-corner",
		);
		expect(row?.updatedAt).toBe(later);
		expect(row?.updatedAt).not.toBe(created);
	});

	test("the single-store check finds a visible product past hidden ones, and none when all are hidden", async () => {
		// `getRetailerBySlug` runs this on every storefront load, so it walks
		// the index and stops at the first visible row (PR #400 review); the
		// walk must still reach a visible product that sits BEHIND hidden ones.
		const t = setup();
		const { owner, retailerId } = await seedStore(t, "kuih-corner");
		const first = await addProduct(t, retailerId, "Counter only");
		await owner.mutation(api.products.update, {
			productId: first,
			hidden: true,
		});
		expect(await t.run((ctx) => hasVisibleProduct(ctx, retailerId))).toBe(
			false,
		);
		await addProduct(t, retailerId, "Kuih Lapis");
		expect(await t.run((ctx) => hasVisibleProduct(ctx, retailerId))).toBe(
			true,
		);
		expect((await everywhere(t, "kuih-corner")).indexable).toBe(true);
	});
});
