// Provider-agnostic delivery-job status machinery (86eyjpv6z). Extracted from
// lib/lalamove.ts when Delyva became the second booking provider: these rules
// are about OUR deliveryJobs ledger (one active job per order, which statuses
// free the slot, when a webhook-driven job owns the order's status), not about
// any provider's wire format — so both provider modules import them from here.
// lib/lalamove.ts re-exports the lot, keeping its existing importers working.

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

/** A job in one of these states still occupies the order's "one active job"
 * slot; anything terminal frees it for a rebook. */
export function isActiveJobStatus(status: DeliveryJobStatus): boolean {
	return !TERMINAL_JOB_STATUSES.has(status);
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
