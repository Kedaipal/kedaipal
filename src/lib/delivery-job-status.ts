import type { DeliveryJobStatus } from "../../convex/lib/deliveryJobs";

/**
 * What a booking's status is CALLED (86eye9xd4) — one author for the order
 * page's rider card and the Deliveries page, which had drifted toward two
 * vocabularies the day the second surface appeared.
 *
 * Collection trips (86eyg0n8e) run backwards — the rider collects FROM the
 * buyer and ends at the seller's outlet — so "Delivered" would misread there:
 * it's "Arrived". A Delyva parcel has no rider to find, so its early states
 * speak courier, not rider.
 */
export function jobStatusLabel(
	status: DeliveryJobStatus,
	opts: { provider: "lalamove" | "delyva"; collection: boolean },
): string {
	const { provider, collection } = opts;
	switch (status) {
		case "assigning":
			return provider === "delyva" ? "Booked" : "Finding rider";
		case "ongoing":
			if (provider === "delyva") return "Awaiting pickup";
			return collection ? "Heading to customer" : "Rider on the way";
		case "picked_up":
			if (provider === "delyva") return "In transit";
			return collection ? "Collected" : "Picked up";
		case "completed":
			return collection ? "Arrived" : "Delivered";
		case "canceled":
			return "Cancelled";
		case "expired":
			return "Expired";
		case "rejected":
			return "Rejected";
	}
}

/** The status's colour family: settled green, in-progress mint, failed amber. */
export function jobStatusTone(
	status: DeliveryJobStatus,
): "done" | "active" | "failed" {
	if (status === "completed") return "done";
	if (status === "canceled" || status === "expired" || status === "rejected")
		return "failed";
	return "active";
}

export const JOB_TONE_CLASS: Record<"done" | "active" | "failed", string> = {
	done: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
	active: "bg-accent/15 text-accent-emphasis",
	failed: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};
