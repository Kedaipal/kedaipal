import type { DispatchBlock } from "../../convex/lalamove";

/**
 * Why a Lalamove rider can't be booked on an order right now, in the seller's
 * words — every reason names its own fix path, so the state is never a dead
 * end. Shared by the two surfaces that render it: the Lalamove Delivery card's
 * disabled Book button and the mark-shipped prompt (86eyff02p), where it's the
 * whole explanation a rider-dispatch vendor gets before choosing to ship
 * anyway. One copy source so the two can't drift.
 *
 * Takes `string` too: the booking actions return their reason as a widened
 * union (`DispatchBlock | "not_found" | "quote_failed"`), and an unknown value
 * falls through to the generic line rather than rendering a raw enum.
 */
export function dispatchBlockCopy(
	reason: DispatchBlock | "not_found" | string,
): string {
	switch (reason) {
		case "no_coords":
			return "This address has no map pin, so a rider can't be routed to it. Ask the buyer to re-pick their address from the suggestions on their tracking page, or update it for them.";
		case "no_buyer_phone":
			return "This order has no buyer WhatsApp number for the rider to contact.";
		case "no_seller_phone":
			return "Add a Malaysian (+60) WhatsApp number in Settings → Store first — Lalamove riders need a local pickup contact.";
		case "plan_gated":
			return "Lalamove booking is a Pro feature. Upgrade to book riders in one tap.";
		case "no_credentials":
			return "Your Lalamove API key is missing — add it under Settings → Fulfilment → Delivery charge → Lalamove.";
		case "booking_disabled":
			return "Lalamove isn't your delivery method right now — choose it under Settings → Fulfilment → Delivery charge.";
		case "bad_status":
			return "Delivery can be booked once the order is confirmed.";
		case "job_active":
			return "A rider is already booked on this order.";
		default:
			return "Booking isn't available for this order.";
	}
}
