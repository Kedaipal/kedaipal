// The ONE flash-sale unit tally (z8r3fdcw72), the `eventSeats` posture: the
// storefront's "12 of 30 left", the seller's products-list badge and
// `orders.create`'s cap refusal all count through THIS function, so the
// number a buyer saw and the number the gate enforced can never disagree.
//
// No counter row and no lock table: Convex mutations are OCC transactions,
// so tallying inside the order mutation IS the lock — two carts racing for
// the last sale unit serialise, and the loser gets the price-changed
// refusal. Cancelled and auto-expired orders simply drop out of the tally,
// which is how their units return to the pool with zero bookkeeping.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** An order still holding its flash units. `cancelled` is the ONLY release —
 * mirrors `eventSeats.holdsSeats` / `bookingAvailability.holdsCapacity`
 * deliberately: same question, same answer. */
export function holdsPromoUnits(status: Doc<"orders">["status"]): boolean {
	return status !== "cancelled";
}

/**
 * Units already sold under one promo run. Bounded read: `by_retailer` from
 * the run's `startsAt` (sanitizePromo guarantees a capped promo has one), so
 * the scan covers one seller's orders inside the sale window — cheap enough
 * for the public storefront read that shows units left.
 *
 * Counts `items[].quantity` where the line's frozen `promoRunId` matches:
 * product-level, summed across variants (the cap's mental model), and only
 * lines that actually SOLD at the sale price count against it — a line
 * bought at list during the sale (cap already hit, or added pre-start)
 * carries no runId and never consumes a unit.
 */
export async function tallyPromoUnits(
	ctx: QueryCtx | MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		productId: Id<"products">;
		runId: string;
		startsAt: number;
	},
): Promise<number> {
	const inWindow = await ctx.db
		.query("orders")
		.withIndex("by_retailer", (q) =>
			q.eq("retailerId", args.retailerId).gte("_creationTime", args.startsAt),
		)
		.collect();

	let taken = 0;
	for (const order of inWindow) {
		if (!holdsPromoUnits(order.status)) continue;
		for (const item of order.items) {
			if (item.promoRunId !== args.runId) continue;
			if (item.productId !== args.productId) continue;
			taken += item.quantity;
		}
	}
	return taken;
}

/**
 * Sale units a cart is about to consume for one product — the same
 * quantity-sum rule as the tally (the `seatsRequested` posture), so "taken"
 * and "about to take" are counted one way.
 */
export function promoUnitsRequested(
	items: ReadonlyArray<{ productId: Id<"products">; quantity: number }>,
	productId: Id<"products">,
): number {
	return items
		.filter((item) => item.productId === productId)
		.reduce((sum, item) => sum + item.quantity, 0);
}
