// The ONE seat-tally authority for event RSVPs (`z8r3fdff9u`), following the
// `bookingAvailability` precedent: the storefront's "12 seats left", the
// seller's RSVPs panel, `orders.create`'s cap refusal and the counter's
// walk-in RSVP all read THIS module, so no two surfaces can disagree about how
// many seats are taken.
//
// Model: an event's seats are consumed by the SUM of `items[].quantity` for
// that productId across every non-cancelled order whose `fulfilmentDate` is the
// event date. Quantity, not order count — a guest RSVPing for themselves plus
// two colleagues takes three seats, which is what "30 seats" means to the
// seller standing in the room.
//
// No new index and no reservation table: `by_retailer_fulfilment` already keys
// exactly the window we need, and Convex mutations are OCC transactions, so
// counting inside the mutation IS the lock — two carts racing for the last seat
// serialise, and the loser sees the seats-left refusal.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** An order still occupying seats. `cancelled` is the ONLY release — cancelling
 * an RSVP frees the seat immediately, with no separate bookkeeping. Mirrors
 * `bookingAvailability.holdsCapacity` deliberately: same question, same answer. */
export function holdsSeats(status: Doc<"orders">["status"]): boolean {
	return status !== "cancelled";
}

/** Per-option headcount: the chosen option label ("Set A") → seats taken.
 * Single-variant events (no option axes) land under `UNLABELLED_OPTION`. */
export type SeatTally = {
	/** Total seats consumed across every option. */
	taken: number;
	/** Seats per `items[].variantLabel`, insertion-ordered by first appearance
	 * so a seller reading the panel sees them in the order guests picked them
	 * rather than a hash order that reshuffles on every render. */
	byOption: Map<string, number>;
};

/** Label used when an event product has no option axes, so there is nothing
 * for the guest to choose. Rendered as a plain total, never as this string. */
export const UNLABELLED_OPTION = "";

/**
 * Tally the seats an event has already taken.
 *
 * Scans `by_retailer_fulfilment` for the event's single date — bounded by one
 * day of one seller's orders, so it stays cheap enough for the public
 * storefront read. `excludeOrderId` lets a caller re-tally while ignoring an
 * order it is about to change (unused today; the reschedule path will want it).
 */
export async function tallyEventSeats(
	ctx: QueryCtx | MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		productId: Id<"products">;
		date: number;
		excludeOrderId?: Id<"orders">;
	},
): Promise<SeatTally> {
	const sameDay = await ctx.db
		.query("orders")
		.withIndex("by_retailer_fulfilment", (q) =>
			q.eq("retailerId", args.retailerId).eq("fulfilmentDate", args.date),
		)
		.collect();

	const byOption = new Map<string, number>();
	let taken = 0;
	for (const order of sameDay) {
		if (!holdsSeats(order.status)) continue;
		if (args.excludeOrderId !== undefined && order._id === args.excludeOrderId)
			continue;
		for (const item of order.items) {
			if (item.productId !== args.productId) continue;
			const label = item.variantLabel ?? UNLABELLED_OPTION;
			byOption.set(label, (byOption.get(label) ?? 0) + item.quantity);
			taken += item.quantity;
		}
	}
	return { taken, byOption };
}

/**
 * Seats a cart is about to consume for one event product — the same
 * quantity-sum rule the tally applies, so the "before" and the "about to" can
 * never be counted two different ways.
 */
export function seatsRequested(
	items: ReadonlyArray<{ productId: Id<"products">; quantity: number }>,
	productId: Id<"products">,
): number {
	return items
		.filter((item) => item.productId === productId)
		.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Buyer-facing refusal when a cart would overshoot the cap. Kept next to the
 * arithmetic so the number in the sentence is always the number the gate
 * computed — a refusal that says "2 left" while the gate thought 1 is worse
 * than no message at all.
 */
export function seatsExhaustedMessage(
	productName: string,
	left: number,
): string {
	if (left <= 0)
		return `${productName} is fully booked — no seats left for this event.`;
	return `Only ${left} seat${left === 1 ? "" : "s"} left for ${productName}.`;
}
