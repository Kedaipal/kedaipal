// Provider-agnostic delivery-job status machinery (86eyjpv6z). Extracted from
// lib/lalamove.ts when Delyva became the second booking provider: these rules
// are about OUR deliveryJobs ledger (one active job per order, which statuses
// free the slot, when a webhook-driven job owns the order's status), not about
// any provider's wire format — so both provider modules import them from here.
// lib/lalamove.ts re-exports the lot, keeping its existing importers working.

import type { CourierProviderId } from "./courierProviders";

/** Our normalized job status (deliveryJobs.status). */
export type DeliveryJobStatus =
	| "assigning"
	| "ongoing"
	| "picked_up"
	| "completed"
	| "canceled"
	| "expired"
	| "rejected";

export const TERMINAL_JOB_STATUSES: ReadonlySet<DeliveryJobStatus> = new Set([
	"completed",
	"canceled",
	"expired",
	"rejected",
]);

/** The complement of `TERMINAL_JOB_STATUSES`, as a list — for reads that
 * walk the active jobs by index (`deliveryJobs.by_retailer_status`, one query
 * per status) instead of filtering a window. Kept in step with the union by
 * `deliveryJobs.test.ts`: a status is in exactly one of the two sets. */
export const ACTIVE_JOB_STATUSES = [
	"assigning",
	"ongoing",
	"picked_up",
] as const satisfies readonly DeliveryJobStatus[];

/** A job in one of these states still occupies the order's "one active job"
 * slot; anything terminal frees it for a rebook. */
export function isActiveJobStatus(status: DeliveryJobStatus): boolean {
	return !TERMINAL_JOB_STATUSES.has(status);
}

/** The courier has the parcel (or had it): the job-status half of the
 * "tracking page is live" rule (z8r3fe0t4e), for an AWB that arrives AFTER
 * the collection event did — a stale `order.created` replayed after the 500
 * must still land the link, since the job already knows it was collected. */
export function isCollectedJobStatus(status: DeliveryJobStatus): boolean {
	return status === "picked_up" || status === "completed";
}

/**
 * "The number is on the order, the courier's page isn't live yet"
 * (z8r3fe0t4e) — the one state every surface words the same way: the
 * seller's dispatch card, the Shipment tracking card and the buyer's /track
 * page. True only while a booked job that already has its AWB is still
 * waiting for collection, the order's number IS that AWB (a seller's own
 * manual entry is theirs — no link is ever promised on its behalf, which is
 * what keeps a name-only cold-chain courier honest), and no link exists yet.
 * A booking from before the link moved to collection keeps the link it was
 * born with and never reads as pending.
 *
 * Only a provider that GUARANTEES the link at collection may say so
 * (`LINK_LANDS_AT_COLLECTION`): "appears once the courier collects" is a
 * promise, and a number without a link is the honest state wherever that
 * promise can't be kept. Delyva always has a link to write (the registry's
 * deep link, else Delyva's own tracking page). EasyParcel writes whatever
 * link it has at booking — none when EasyParcel sends no `tracking_url` and
 * the courier has no registry deep link — and its pickup sync may still
 * have none, so an EasyParcel number-without-link stays a plain number
 * rather than a dated promise. A provider joins the set when its collection
 * path writes a link unconditionally.
 */
export const LINK_LANDS_AT_COLLECTION: ReadonlySet<CourierProviderId> = new Set([
	"delyva",
]);

export function isCourierLinkPending(
	job:
		| { provider: CourierProviderId; status: DeliveryJobStatus; awb?: string }
		| null
		| undefined,
	order: { trackingNo?: string; carrierTrackingUrl?: string },
): boolean {
	if (!job?.awb) return false;
	if (!LINK_LANDS_AT_COLLECTION.has(job.provider)) return false;
	if (job.status !== "assigning" && job.status !== "ongoing") return false;
	if (order.trackingNo !== job.awb) return false;
	return !order.carrierTrackingUrl;
}

/**
 * Whether the courier (via webhook) currently drives the order's canonical
 * status — an ACTIVE job whose webhook has demonstrably delivered events
 * (`lastEventAt` is only ever written by a webhook handler, and the first
 * event lands seconds after booking when the webhook URL is registered).
 * While true, picked-up → shipped and completed → delivered arrive on their
 * own, so the seller's manual advance into those statuses sits behind a
 * disabled-with-reason gate: a manual "shipped" would message the buyer early
 * and WITHOUT the tracking link.
 *
 * NOTE (3 Aug): this is no longer the GATE — it only decides the wording. The
 * gate is now "an ACTIVE job exists" (see the order-detail stepper), because
 * requiring a webhook event left it off between booking and the first event,
 * which is exactly when a seller can click a live trip through to delivered.
 * A webhook-less seller is protected by the confirm-gated escape instead, and
 * this predicate picks the honest copy for them.
 */
export function riderDrivesOrderStatus(job: {
	status: DeliveryJobStatus;
	lastEventAt?: number;
}): boolean {
	return isActiveJobStatus(job.status) && job.lastEventAt !== undefined;
}

/**
 * Whether an advance into `targetAnchor` is one the courier's webhook manages
 * (shipped at pickup, delivered at drop-off). Same-anchor moves (a seller's
 * custom stages within the shipped band) don't change canonical status and
 * stay free.
 */
export function isRiderManagedTransition(
	targetAnchor: "confirmed" | "packed" | "shipped" | "delivered",
	orderStatus: string,
): boolean {
	return (
		(targetAnchor === "shipped" || targetAnchor === "delivered") &&
		targetAnchor !== orderStatus
	);
}
