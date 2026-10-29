import type { EasyparcelDispatchBlock } from "../../convex/easyparcel";

/**
 * Why an EasyParcel courier can't be booked on an order right now, in the
 * seller's words — the Delyva `delyva-dispatch-block.ts` sibling
 * (z8r3fdcje2). Every reason names its own fix path, so the disabled Book
 * button is never a dead end.
 *
 * A `Record` rather than a switch: a new `EasyparcelDispatchBlock` member is
 * then a compile error here instead of silently falling through.
 */
const BLOCK_COPY: Record<EasyparcelDispatchBlock, string> = {
	// The only reason with no fix to offer — the card hides itself for this
	// one; the line is the fallback for surfaces that can't. MY is closed on
	// purpose (Delyva serves it), so the alternative is named.
	// Neither has a fix the seller can make — the card hides itself for both;
	// these lines are the fallback for surfaces that can't.
	not_configured: "EasyParcel booking isn't available right now.",
	country_unsupported:
		"EasyParcel booking isn't available for stores in your country.",
	// A MY store's EasyParcel carries overseas orders only (z8r3fdr5yy).
	destination_unsupported:
		"EasyParcel is for your overseas orders — book this one with Delyva, or arrange the courier yourself and add the tracking number.",
	not_delivery: "This is a self-collect order — there's no parcel to send out.",
	bad_status:
		"A courier can only be booked while the order is confirmed or packed.",
	job_active: "A courier is already booked on this order.",
	not_connected:
		"Connect your EasyParcel account first — Settings → Integrations → EasyParcel.",
	reconnect_needed:
		"Kedaipal's access to your EasyParcel account has ended — reconnect it under Settings → Integrations → EasyParcel. It takes one sign-in.",
	wrong_country:
		"The connected EasyParcel account belongs to another country, so its prices and wallet are in the wrong currency. Switch to your account for this store's country under Settings → Integrations → EasyParcel.",
	disabled:
		"EasyParcel booking is paused — resume it under Settings → Delivery pricing → Courier booking.",
	plan_gated:
		"EasyParcel courier booking is a Pro feature. Upgrade to book couriers in one tap.",
	no_pickup_address:
		"Add your pickup address under Settings → Integrations → EasyParcel — couriers need somewhere to collect from.",
	no_address:
		"This order has no delivery address, so there's nowhere to send the parcel.",
};

/** Generic line for a reason outside the union — the booking actions widen it
 * with their own failures (`"not_found"`, `"no_weight"`, `"quote_failed"`). */
export const UNKNOWN_EASYPARCEL_BLOCK_COPY =
	"Courier booking isn't available for this order.";

export function easyparcelBlockCopy(
	reason: EasyparcelDispatchBlock | "not_found" | string,
): string {
	return (
		BLOCK_COPY[reason as EasyparcelDispatchBlock] ??
		UNKNOWN_EASYPARCEL_BLOCK_COPY
	);
}

/** Normalized job status → what the seller should understand is happening.
 * EasyParcel's own vocabulary is courier-side ("Collected"); this is
 * order-side — the same labels the Delyva card uses, one vocabulary for one
 * concept. */
const STATUS_LABEL: Record<string, string> = {
	assigning: "Booked",
	ongoing: "Courier assigned",
	picked_up: "In transit",
	completed: "Delivered",
	canceled: "Cancelled",
	expired: "Expired",
	rejected: "Returned",
};

export function easyparcelStatusLabel(status: string): string {
	return STATUS_LABEL[status] ?? status;
}
