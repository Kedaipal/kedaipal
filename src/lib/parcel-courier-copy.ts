/**
 * How a PARCEL courier (Delyva, EasyParcel) confirms delivery — one author for
 * the settings card that sets the expectation and the order card that meets
 * it (z8r3fdytmq).
 *
 * A Lalamove rider sends a drop-off photo, and the order page shows it. A
 * parcel network confirms delivery with a tracking scan: Delyva sends no
 * photo, and EasyParcel's parcel API has no proof-of-delivery field at all
 * (its `pod` exists only on OnDemand rider orders). A seller who uses both
 * would otherwise read the missing photo as a bug.
 */

/** Before connecting: what the seller gets instead of a photo. */
export const PARCEL_NO_PHOTO_NOTE =
	"Delivery is confirmed by the courier's tracking scan, not a photo — parcel couriers don't send one the way Lalamove riders do.";

/**
 * The order card's delivered line. Points at the tracking link when the order
 * has one, and at the courier's own page otherwise. Never claims the buyer
 * was messaged: a buyer gets one WhatsApp per order, the confirmation.
 */
export function parcelDeliveredCopy(hasTrackingLink: boolean): string {
	return `Delivered — your buyer's order page shows it. Parcel couriers confirm delivery with a tracking scan, not a photo: ${
		hasTrackingLink ? "Track parcel" : "the courier's tracking page"
	} shows it.`;
}

/**
 * Pre-scan (z8r3fe0t4e, z8r3fe11x3): the tracking NUMBER is on the order,
 * the courier's page isn't live yet. A parcel courier indexes a waybill at
 * its FIRST SCAN — at collection for a pickup service, at the branch counter
 * for a drop-off one — so the link is written then, not at booking, and
 * until then every surface says in one line when it comes instead of
 * showing a link that answers "information not found". Three audiences, one
 * vocabulary, so the seller's dispatch card, the Shipment tracking card and
 * the buyer's page never disagree about the moment.
 *
 * The moment is worded by who knows what: the dispatch card knows the
 * service's handoff and names it ("collects" / "scans it in at the branch");
 * the Shipment tracking card and the buyer's page don't carry the handoff,
 * so they say "first scan", which is true of both kinds — "collected" on a
 * parcel the seller walked to a counter would be the wrong story.
 */

/** How a parcel leaves the seller — mirrors `DelyvaHandoff` without loading
 * the Convex module (the storefront bundle must never import one). */
export type CourierHandoff = "pickup" | "dropoff";

/** The dispatch card's line under the tracking number while booked. The
 * handoff picks the moment; a legacy booking with no handoff on record claims
 * neither and says only what Delyva will do. */
export function courierLinkPendingSellerCopy(
	serviceName: string | undefined,
	handoff?: CourierHandoff,
): string {
	const courier = serviceName ?? "The courier";
	const moment =
		handoff === "dropoff"
			? "once the branch scans the parcel in"
			: handoff === "pickup"
				? "once the parcel is collected"
				: "at the courier's first scan";
	return `Your buyer already has this number. ${courier}'s tracking page goes live ${moment}; the order marks itself Shipped then.`;
}

/** The Shipment tracking card's line, where the link will appear. */
export const COURIER_LINK_PENDING_SELLER_LINE =
	"Tracking link appears once the courier scans the parcel in";

/** The buyer's page, under the courier/number card. */
export const COURIER_LINK_PENDING_BUYER_LINE =
	"Use this number on the courier's app once your parcel has been scanned in. We'll add the tracking link here then.";

/** The buyer's page, in the tracking button's slot while the link waits. */
export function courierLinkPendingBuyerButton(
	courierName: string | undefined,
): string {
	return `Track with ${courierName ?? "carrier"} · after first scan`;
}

// ---------------------------------------------------------------------------
// Pickup vs drop-off (z8r3fe11x3)
// ---------------------------------------------------------------------------

/** The pill on every courier row and on the booked card. The drop-off pill
 * has a short form for a phone-width row and the full claim where it fits. */
export const HANDOFF_PILL_COPY: Record<
	CourierHandoff,
	{ short: string; full: string }
> = {
	pickup: { short: "Courier picks up", full: "Courier picks up" },
	dropoff: { short: "You drop off", full: "You drop off at a branch" },
};

/** One line under the courier picker: what the two pills mean, and that
 * neither kind tracks before the first scan. */
export const HANDOFF_PICKER_NOTE =
	"Courier picks up means they collect from your pickup address. You drop off means you take the parcel to one of their branches. Either way, tracking starts at the courier's first scan.";

/** The booked drop-off card's three steps, in the order the seller does them.
 * Step 1 names the button beside it; step 2 names the courier so the seller
 * knows whose branch; step 3 says what they do NOT have to do. */
export function dropoffSteps(
	serviceName: string | undefined,
): ReadonlyArray<{ title: string; detail: string }> {
	const courier = serviceName ?? "the courier";
	return [
		{
			title: "Print the shipping label",
			detail: "Stick it on the parcel — this is the label the branch scans.",
		},
		{
			title: `Take it to any ${courier} branch`,
			detail: "Hand it over the counter and have it scanned in.",
		},
		{
			title: "The order ships itself",
			detail:
				"Shipped at that scan, Delivered on arrival — your buyer's order page follows along. Nothing to tap here.",
		},
	];
}

/** The booked pickup card's collection line: where the courier collects
 * from. Delyva schedules the pickup on the courier's own cadence, so the
 * line promises a place, never a time. */
export function pickupCollectionCopy(
	serviceName: string | undefined,
	pickupSummary: string | undefined,
): string {
	const courier = serviceName ?? "The courier";
	return pickupSummary
		? `${courier} collects from ${pickupSummary} — Delyva arranges the pickup, so keep the parcel ready and labelled.`
		: `${courier} collects from your pickup address — Delyva arranges the pickup, so keep the parcel ready and labelled.`;
}

/** The booked card's line for a booking from before the handoff was stored:
 * claims neither kind, says only what Delyva will do. */
export const LEGACY_BOOKED_COPY =
	"Delyva will update this order when the courier scans the parcel.";

/** Why Print shipping label is disabled right now — shown under the button,
 * never only in a tooltip (a phone has no hover). */
export const LABEL_UNAVAILABLE_COPY: Record<
	"not_booked" | "collected" | "ended",
	string
> = {
	not_booked: "Available once Delyva confirms the booking.",
	collected: "The courier has the parcel — no label needed now.",
	ended: "This booking has ended.",
};
