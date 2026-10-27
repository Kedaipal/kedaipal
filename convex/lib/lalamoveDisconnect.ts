/**
 * When a store's Lalamove keys may NOT be removed (z8r3fdy5ht) — one author
 * for the mutation that removes them (`retailers.updateSettings` with
 * `deliveryBooking: null`) and the read that greys the card's Disconnect out
 * with the reason BEFORE the tap (`lalamove.getDisconnectState`).
 *
 * Removing the keys is never plan-gated (a downgrade never traps). It is
 * refused only where it would break something the seller can't see:
 *
 *  - `pricing` — the buyer's delivery charge is quoted by Lalamove: either
 *    the Lalamove-quote mode itself, or LIVE pricing where Lalamove is the
 *    only courier bidding. Without the keys every delivery checkout would
 *    refuse, so the seller switches the charge (or arms another courier) first.
 *  - `rider_out` — a booked rider is still on the road. Cancelling it and
 *    following it both need these keys; removing them would strand the order
 *    mid-delivery with no way back.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { delyvaBidsAtCheckout, lalamoveBookingArmed } from "./courierBooking";
import { isActiveJobStatus } from "./deliveryJobs";

/** How many of the store's newest jobs to look through for a rider still out.
 * A Lalamove trip finishes (or expires) within the day, so an active one is
 * always among the newest — this bounds the read without a new index. */
const RECENT_JOBS = 50;

export type LalamoveDisconnectBlock =
	| { reason: "pricing"; message: string }
	| { reason: "rider_out"; message: string; shortIds: string[] };

type PricingRetailer = Pick<
	Doc<"retailers">,
	"country" | "deliveryBooking" | "delyva"
> & { deliveryConfig?: unknown };

/**
 * The pricing half — pure, so `updateSettings` can judge the EFFECTIVE
 * delivery config of the same call (a seller switching the charge mode and
 * disconnecting together is fine).
 */
export function lalamovePricingBlock(
	retailer: PricingRetailer,
	effectiveMode: string | undefined,
): LalamoveDisconnectBlock | null {
	if (effectiveMode === "lalamove") {
		return {
			reason: "pricing",
			message:
				"Lalamove is quoting your delivery charge — switch the delivery charge to another mode under Delivery pricing first.",
		};
	}
	if (
		effectiveMode === "live" &&
		lalamoveBookingArmed(retailer) &&
		!delyvaBidsAtCheckout(retailer)
	) {
		return {
			reason: "pricing",
			message:
				"Lalamove is the only courier pricing your live delivery charge — switch the delivery charge to another mode, or turn on another courier, under Delivery pricing first.",
		};
	}
	return null;
}

/** The rider half — the store's Lalamove jobs still on the road. */
export async function lalamoveRiderOutBlock(
	ctx: Pick<QueryCtx, "db">,
	retailerId: Id<"retailers">,
): Promise<LalamoveDisconnectBlock | null> {
	const jobs = await ctx.db
		.query("deliveryJobs")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.order("desc")
		.take(RECENT_JOBS);
	const out = jobs.filter(
		(job) => job.provider === "lalamove" && isActiveJobStatus(job.status),
	);
	if (out.length === 0) return null;
	const shortIds: string[] = [];
	for (const job of out) {
		const order = await ctx.db.get(job.orderId);
		if (order?.shortId && !shortIds.includes(order.shortId))
			shortIds.push(order.shortId);
	}
	const named =
		shortIds.length === 0
			? "an order"
			: shortIds.length === 1
				? shortIds[0]
				: `${shortIds.slice(0, -1).join(", ")} and ${shortIds[shortIds.length - 1]}`;
	return {
		reason: "rider_out",
		shortIds,
		message: `A Lalamove rider is still out on ${named} — wait for ${
			shortIds.length > 1 ? "those trips" : "it"
		} to finish, or cancel the booking on the order, first. Removing the keys now would leave no way to follow or cancel it.`,
	};
}
