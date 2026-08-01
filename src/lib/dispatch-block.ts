import type { DispatchBlock } from "../../convex/lalamove";

/**
 * Why a Lalamove rider can't be booked on an order right now, in the seller's
 * words — every reason names its own fix path, so the state is never a dead
 * end. Shared by the two surfaces that render it: the Lalamove Delivery card's
 * disabled Book button and the mark-shipped prompt (86eyff02p), where it's the
 * whole explanation a rider-dispatch vendor gets before choosing to ship
 * anyway. One copy source so the two can't drift.
 *
 * A `Record` rather than a switch: a new `DispatchBlock` member is then a
 * compile error here instead of silently falling through to the generic line
 * (the posture the `Locale` sweep set for exhaustive lookups).
 */
const BLOCK_COPY: Record<DispatchBlock, string> = {
	not_delivery:
		"This is a self-collect order — there's nothing to send a rider for.",
	bad_status:
		"A rider can only be booked while the order is confirmed or packed.",
	job_active: "A rider is already booked on this order.",
	booking_disabled:
		"Lalamove isn't your delivery method right now — choose it under Settings → Fulfilment → Delivery charge.",
	plan_gated:
		"Lalamove booking is a Pro feature. Upgrade to book riders in one tap.",
	no_credentials:
		"Your Lalamove API key is missing — add it under Settings → Fulfilment → Delivery charge → Lalamove.",
	no_coords:
		"This address has no map pin, so a rider can't be routed to it. Ask the buyer to re-pick their address from the suggestions on their tracking page, or update it for them.",
	no_buyer_phone:
		"This order has no buyer WhatsApp number for the rider to contact.",
	no_seller_phone:
		"Add a Malaysian (+60) WhatsApp number in Settings → Store first — Lalamove riders need a local pickup contact.",
};

/** Generic line for a reason outside the `DispatchBlock` union — the booking
 * actions widen it with their own failures (`"not_found"`, `"quote_failed"`). */
export const UNKNOWN_BLOCK_COPY = "Booking isn't available for this order.";

export function dispatchBlockCopy(
	reason: DispatchBlock | "not_found" | string,
): string {
	return BLOCK_COPY[reason as DispatchBlock] ?? UNKNOWN_BLOCK_COPY;
}
