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
