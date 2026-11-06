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
 * Pre-collection (z8r3fe0t4e): the tracking NUMBER is on the order, the
 * courier's page isn't live yet. A parcel courier indexes a waybill at its
 * first scan, so the link is written at collection, not at booking — and
 * until then every surface says in one line when it comes, instead of
 * showing a link that answers "information not found". Three audiences, one
 * vocabulary, so the seller's dispatch card, the Shipment tracking card and
 * the buyer's page never disagree about the moment.
 */

/** The dispatch card's line under the tracking number while booked. */
export function courierLinkPendingSellerCopy(
	serviceName: string | undefined,
): string {
	return `Your buyer already has this number. ${serviceName ?? "The courier"}'s tracking page goes live once the parcel is collected; the order marks itself Shipped then.`;
}

/** The Shipment tracking card's line, where the link will appear. */
export const COURIER_LINK_PENDING_SELLER_LINE =
	"Tracking link appears once the courier collects the parcel";

/** The buyer's page, under the courier/number card. */
export const COURIER_LINK_PENDING_BUYER_LINE =
	"Use this number on the courier's app once your parcel is collected. We'll add the tracking link here then.";
