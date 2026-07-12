// Denormalized category product-count upkeep. Lives in its own module (imports
// nothing from products.ts or categories.ts) so both can use it without an
// import cycle. `categories.productCount` mirrors the customers-aggregate
// pattern: a hot public read (the storefront rail) reads a stored number
// instead of scanning every junction's product on each load.
//
// The stored count = number of storefront-VISIBLE (active && !hidden) products
// currently assigned to the category. Maintained on:
//   - membership add/remove          → categories.setProductCategories
//   - product visibility flip         → products.archive + products.update
// See docs/product-categories.md.

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** A product is "storefront-visible" — and so counts toward a category tile —
 * when it's active AND not hidden, the same rule `products.list` uses. */
export function isProductVisible(product: {
	active: boolean;
	hidden?: boolean;
}): boolean {
	return product.active && product.hidden !== true;
}

/**
 * Adjust the denormalized `productCount` on EVERY category a product is linked
 * to by `delta` (floored at 0). Call when a product's storefront visibility
 * flips (archive/restore, hide/unhide). Bounded by the product's membership
 * (≤ MAX_CATEGORIES_PER_PRODUCT active + any preserved archived links).
 */
export async function bumpCategoryCountsForProduct(
	ctx: MutationCtx,
	productId: Id<"products">,
	delta: number,
): Promise<void> {
	if (delta === 0) return;
	const junctions = await ctx.db
		.query("productCategories")
		.withIndex("by_product", (q) => q.eq("productId", productId))
		.collect();
	for (const junction of junctions) {
		const category = await ctx.db.get(junction.categoryId);
		if (!category) continue;
		await ctx.db.patch(junction.categoryId, {
			productCount: Math.max(0, (category.productCount ?? 0) + delta),
		});
	}
}

/**
 * Recompute a single category's visible-product count from scratch (scans its
 * junctions once — bounded by its membership). Used on restore (products may
 * have been archived/hidden while the category was off the storefront) and by
 * the one-off backfill/repair mutation. NOT a hot-path call.
 */
export async function recomputeCategoryCount(
	ctx: MutationCtx,
	categoryId: Id<"categories">,
): Promise<void> {
	const junctions = await ctx.db
		.query("productCategories")
		.withIndex("by_category_sort", (q) => q.eq("categoryId", categoryId))
		.collect();
	let count = 0;
	for (const junction of junctions) {
		const product = await ctx.db.get(junction.productId);
		if (product && isProductVisible(product)) count++;
	}
	await ctx.db.patch(categoryId, { productCount: count });
}
