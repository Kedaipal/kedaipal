/**
 * The one place that knows everything a product row OWNS (86eyjmf4q). Two very
 * different callers erase products — the surgical `products.deletePermanently`
 * (a seller freeing a slot under the product cap) and the account-deletion
 * cascade in `retailers.deleteUser` — and before this they each open-coded the
 * teardown, so a newly-added per-product asset could easily be freed by one and
 * leaked by the other.
 *
 * NOT included here, deliberately: the denormalized category counts. Callers
 * own that, because their needs genuinely differ — a single delete must
 * decrement each category's `productCount` (via `bumpCategoryCountsForProduct`,
 * BEFORE the junctions go), while account deletion is dropping those category
 * rows wholesale a moment later and would just be patching corpses. Both call
 * sites document which side of that they're on.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Tolerant blob delete — a missing blob is not an error worth aborting for. */
async function deleteBlob(
	ctx: MutationCtx,
	storageId: string | undefined,
): Promise<void> {
	if (!storageId) return;
	try {
		await ctx.storage.delete(storageId as Id<"_storage">);
	} catch {
		// already gone — ignore
	}
}

/**
 * Erase a product and everything it owns: its variants (and their images), its
 * own images, its category memberships, and finally the row itself.
 *
 * Does NOT touch orders — order lines carry a frozen name/price snapshot
 * alongside `items[].productId`, and erasing a product that past orders point
 * at would orphan those references. `products.deletePermanently` refuses on any
 * product with `orderedAt` set for exactly that reason; the account cascade is
 * exempt only because it deletes that store's orders too.
 */
export async function deleteProductCascade(
	ctx: MutationCtx,
	product: Doc<"products">,
): Promise<void> {
	const variants = await ctx.db
		.query("productVariants")
		.withIndex("by_product", (q) => q.eq("productId", product._id))
		.collect();
	for (const variant of variants) {
		for (const imageId of variant.imageStorageIds) await deleteBlob(ctx, imageId);
		await ctx.db.delete(variant._id);
	}
	for (const imageId of product.imageStorageIds) await deleteBlob(ctx, imageId);

	// Category memberships. The category rows' `productCount` is the caller's
	// business (see the module comment) — this only drops the junction rows so no
	// membership outlives the product.
	const junctions = await ctx.db
		.query("productCategories")
		.withIndex("by_product", (q) => q.eq("productId", product._id))
		.collect();
	for (const junction of junctions) await ctx.db.delete(junction._id);

	await ctx.db.delete(product._id);
}
