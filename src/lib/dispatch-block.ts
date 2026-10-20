import type { DispatchBlock } from "../../convex/lalamove";
import type { Country } from "../../convex/lib/country";

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
	// The only reason with no fix to offer: rider booking isn't served in the
	// store's country (COUNTRY_RIDER_BOOKING — every country we sell in today,
	// so this guards the next one; naming a country here would go stale the
	// day it launches). Surfaces that can hide themselves (the dispatch card)
	// do; this line is the fallback for the ones that can't.
	country_unsupported:
		"Lalamove rider booking isn't available for stores in your country yet — mark this order shipped yourself once it's on its way.",
	not_delivery:
		"This is a self-collect order — there's nothing to send a rider for.",
	bad_status:
		"A rider can only be booked while the order is confirmed or packed.",
	job_active: "A rider is already booked on this order.",
	booking_disabled:
		"Lalamove rider booking is off — turn it on under Settings → Fulfilment → Courier booking.",
	no_business_address:
		"Add your store's pickup address under Settings → Fulfilment — riders need somewhere to collect from.",
	plan_gated:
		"Lalamove booking is a Pro feature. Upgrade to book riders in one tap.",
	no_credentials:
		"Your Lalamove API key is missing — add it under Settings → Integrations → Lalamove.",
	no_coords:
		"This address has no map pin, so a rider can't be routed to it. Ask the buyer to re-pick their address from the suggestions on their tracking page, or update it for them.",
	no_buyer_phone:
		"This order has no buyer WhatsApp number for the rider to contact.",
	no_seller_phone:
		"Add a local WhatsApp number for your store's country in Settings → Store first (+60 in Malaysia, +65 in Singapore) — Lalamove riders need a local pickup contact.",
};

/** Generic line for a reason outside the `DispatchBlock` union — the booking
 * actions widen it with their own failures (`"not_found"`, `"quote_failed"`). */
export const UNKNOWN_BLOCK_COPY = "Booking isn't available for this order.";

export function dispatchBlockCopy(
	reason: DispatchBlock | "not_found" | string,
): string {
	return BLOCK_COPY[reason as DispatchBlock] ?? UNKNOWN_BLOCK_COPY;
}

/**
 * The adjective a courier-contact notice names the store's market with
 * ("isn't a Malaysian number"). Not `MOBILE_KIND` ("Malaysian mobile"): a
 * courier takes a local landline contact too, so "mobile" would be false. Not
 * `COUNTRY_LABELS` ("Malaysia"): that is the noun. Shared with the Delyva
 * card's notice (`delyva-dispatch-block.ts`), so the two can't drift.
 */
export const MARKET_NUMBER_ADJECTIVE: Record<Country, string> = {
	MY: "Malaysian",
	SG: "Singapore",
};

/**
 * The confirm dialog's line when a booking falls back to the store's number
 * for the buyer's stop (z8r3fdh274): the buyer's WhatsApp is from outside the
 * store's market, which Lalamove refuses as a contact. Direction-aware — on a
 * collection trip the buyer's stop is the PICKUP, so the rider who can't call
 * the buyer is the one coming to collect from them.
 */
export function riderContactFallbackCopy(
	market: Country,
	collection: boolean,
): string {
	const kind = MARKET_NUMBER_ADJECTIVE[market];
	const rider = collection
		? "the rider collecting from the buyer"
		: "the rider";
	return `This buyer's WhatsApp number isn't a ${kind} number, and Lalamove only takes ${kind} contacts — ${rider} gets your store's number instead, with the buyer's real number in the rider notes.`;
}
