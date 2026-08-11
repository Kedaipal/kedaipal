/**
 * "Has this product ever been ordered?" — the one fact that decides whether a
 * product may be permanently deleted (see convex/lib/productCap.ts +
 * docs/product-cap.md). Kept here, not inline, because the stamp fires from
 * both order-create sites (storefront + counter) and must behave identically at
 * each. Mirrors the convex/lib/activation.ts pattern.
 *
 * Why a denormalized stamp rather than a lookup: `orders.items` is an ARRAY, so
 * there is no index that answers "which orders reference product X" — the only
 * alternative is scanning every order the store has ever taken and walking each
 * item list, which is unbounded and would break exactly on the high-volume
 * stores most likely to be pruning their catalog.
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Stamp `products.orderedAt` for every product on a freshly created order.
 *
 * One-time set-if-unset per product, so:
 *  - the timestamp stays at the product's true FIRST sale even though every
 *    later order calls this;
 *  - concurrent orders are safe — Convex's OCC re-runs the loser, which re-reads
 *    the now-set field and no-ops (no read-then-write gap);
 *  - it is never cleared. Cancelling or hard-deleting that order does NOT
 *    un-stamp the product: a cancelled order still holds a frozen line naming
 *    it, and "has this ever sold?" is a question about history. The cost of
 *    being wrong is asymmetric — a stale stamp only means the seller archives
 *    instead of deletes, while a wrongly-cleared one would let them erase a
 *    product that live order rows still point at.
 *
 * Deliberately deduplicates: a cart with three variants of one product patches
 * that product once. `updatedAt` is deliberately NOT bumped — that field means
 * "when the seller last edited this product", and a sale is not an edit.
 */
export async function stampProductsOrdered(
	ctx: MutationCtx,
	items: readonly { productId: Id<"products"> }[],
	now: number,
): Promise<void> {
	const seen = new Set<string>();
	for (const item of items) {
		if (seen.has(item.productId)) continue;
		seen.add(item.productId);
		const product = await ctx.db.get(item.productId);
		if (!product || product.orderedAt !== undefined) continue;
		await ctx.db.patch(item.productId, { orderedAt: now });
	}
}
