import type { DelyvaDispatchBlock } from "../../convex/delyva";

/**
 * Why a Delyva courier can't be booked on an order right now, in the seller's
 * words — the Lalamove `dispatch-block.ts` sibling (86eyjpv6z). Every reason
 * names its own fix path, so the disabled Book button is never a dead end.
 *
 * A `Record` rather than a switch: a new `DelyvaDispatchBlock` member is then a
 * compile error here instead of silently falling through to the generic line.
 */
const BLOCK_COPY: Record<DelyvaDispatchBlock, string> = {
	// The only reason with no fix to offer — the card hides itself for this one;
	// the line is the fallback for surfaces that can't.
	country_unsupported:
		"Delyva courier booking is only available for Malaysian stores right now — arrange the courier yourself and add the tracking number below.",
	not_delivery:
		"This is a self-collect order — there's no parcel to send out.",
	bad_status:
		"A courier can only be booked while the order is confirmed or packed.",
	job_active: "A courier is already booked on this order.",
	lalamove_active:
		"Your delivery charge is set to Lalamove live quotes, so riders handle every delivery — parcels can't be booked while it's on.",
	not_connected:
		"Connect your Delyva account first — Settings → Fulfilment → Delyva courier.",
	disabled:
		"Delyva booking is paused — resume it under Settings → Fulfilment → Delyva courier.",
	plan_gated:
		"Delyva courier booking is a Pro feature. Upgrade to book couriers in one tap.",
	no_pickup_address:
		"Add your pickup address under Settings → Fulfilment → Delyva courier — couriers need somewhere to collect from.",
	no_address:
		"This order has no delivery address, so there's nowhere to send the parcel.",
};

/** Generic line for a reason outside the union — the booking actions widen it
 * with their own failures (`"not_found"`, `"no_weight"`, `"quote_failed"`). */
export const UNKNOWN_DELYVA_BLOCK_COPY =
	"Courier booking isn't available for this order.";

export function delyvaBlockCopy(
	reason: DelyvaDispatchBlock | "not_found" | string,
): string {
	return (
		BLOCK_COPY[reason as DelyvaDispatchBlock] ?? UNKNOWN_DELYVA_BLOCK_COPY
	);
}

/** Normalized job status → what the seller should understand is happening.
 * Delyva's own vocabulary is courier-side ("collected"); this is order-side. */
const STATUS_LABEL: Record<string, string> = {
	assigning: "Booked",
	ongoing: "Courier assigned",
	picked_up: "In transit",
	completed: "Delivered",
	canceled: "Cancelled",
	expired: "Expired",
	rejected: "Pickup failed",
};

export function delyvaStatusLabel(status: string): string {
	return STATUS_LABEL[status] ?? status;
}
