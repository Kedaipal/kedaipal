/**
 * Which of a store's buyable choices have no parcel weight — the ONE walk
 * behind the readiness notice (`products.missingParcelWeights`), the bulk
 * weight fill (`products.unweighedChoices`) and the arming gates
 * (`assertCatalogueWeighed`). They have to agree to the row: a notice that
 * counts 3 while the fill page lists 2 is a bug a seller finds for us.
 *
 * What counts: a LIVE physical product's ACTIVE, non-custom choice that
 * `lacksParcelWeight`. Custom choices never do — their weight is unknowable
 * by design and the floor / "arrange" rule covers them. Services and
 * bookings have no parcel, and neither does an EVENT: an RSVP is fulfilled
 * at the venue and never enters a delivery cart (`docs/event-rsvp.md`), so
 * asking a festival listing for the weight of "Set A" would be judging by
 * kind instead of by the fulfilment moment. A product or choice that is off
 * sale can't be ordered, so it can't be mispriced.
 *
 * Bounded by the product cap (z8r3fdjmf4q): one indexed variant read per
 * active product, never a table scan.
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { lacksParcelWeight } from "./delivery";
import { effectiveKind } from "./productKind";
import { variantLabel } from "./variant";
import { type WeightPricing, unweighedRefusal } from "./weightPricing";

export type UnweighedProduct = {
	productId: Id<"products">;
	name: string;
	/** The buyable choices with no weight, in grid order. */
	choices: Array<{ variantId: Id<"productVariants">; label: string }>;
};

/**
 * Every live physical product with at least one unweighed buyable choice,
 * those choices listed. A LIST of pairs, never a map keyed by a product or
 * choice NAME — Convex refuses non-ASCII object keys, and a seller's
 * "✦ DRESSES" took the inbox down once (z8r3fdv1r4).
 */
export async function collectUnweighedChoices(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<UnweighedProduct[]> {
	const products = await ctx.db
		.query("products")
		.withIndex("by_retailer_active", (q) =>
			q.eq("retailerId", retailerId).eq("active", true),
		)
		.collect();
	// Catalogue order: the seller's own sort, the way the Products list shows
	// them, so the fill page reads like the shelf they know.
	products.sort((a, b) => a.sortOrder - b.sortOrder);
	const out: UnweighedProduct[] = [];
	for (const product of products) {
		if (effectiveKind(product.kind) !== "physical") continue;
		if (product.event !== undefined) continue;
		const variants = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", product._id))
			.collect();
		const unweighed = variants.filter(
			(v) => v.active && v.isCustom !== true && lacksParcelWeight(v),
		);
		if (unweighed.length === 0) continue;
		out.push({
			productId: product._id,
			name: product.name,
			choices: unweighed.map((v) => ({
				variantId: v._id,
				label: variantLabel(v.optionValues) || product.name,
			})),
		});
	}
	return out;
}

/**
 * Refuse to switch ON something that prices by weight while buyable choices
 * are unweighed (Zaki, 23 Oct 2026: disabled-with-reason beats
 * wrong-but-enabled). Only ARMING is gated — a store already pricing by
 * weight keeps working on the floor / the "arrange" rule and is pointed at
 * the fix by the readiness notice, so legacy rows never block a buyer.
 */
export async function assertCatalogueWeighed(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
	reason: WeightPricing,
): Promise<void> {
	const unweighed = await collectUnweighedChoices(ctx, retailerId);
	if (unweighed.length === 0) return;
	throw new ConvexError(unweighedRefusal(unweighed.length, reason));
}

/** A variant row's weight is "set" once it is a positive whole number of
 * grams — the inverse of `lacksParcelWeight`, named for the write side. */
export function isWeighed(variant: Pick<Doc<"productVariants">, "parcelWeightG">) {
	return !lacksParcelWeight(variant);
}
