// Pure helpers for the order inbox: fulfilment buckets + the "time in status"
// badge. No Convex imports — shared by the `searchOrders` query (server) and the
// inbox UI (client, via convex/lib import, same as isMockupGateClosed). Payment
// status is deliberately NOT a bucket (it's an orthogonal filter + badge). See
// docs/order-inbox.md.

export type OrderStatus =
	| "pending"
	// Booking kind only (86eyj70z1): a date-range request awaiting the
	// seller's approve/decline. Terminal exits are confirmed (approve) or
	// cancelled (decline / 24 h expiry / buyer cancel).
	| "booking_requested"
	| "confirmed"
	| "packed"
	| "shipped"
	| "delivered"
	| "cancelled";

/** Fulfilment buckets — the inbox's primary segmentation (excludes "all"). */
export type OrderBucket = "new" | "in_progress" | "completed" | "cancelled";

export const BUCKET_STATUSES: Record<OrderBucket, OrderStatus[]> = {
	// A booking request IS the needs-action new order — it has a 24 h clock on
	// it, which is exactly what the New bucket's age escalation was built for.
	new: ["pending", "booking_requested"],
	in_progress: ["confirmed", "packed", "shipped"],
	completed: ["delivered"],
	cancelled: ["cancelled"],
};

/** The subset of an order the bucket rules read. */
export type BucketableOrder = {
	status: OrderStatus;
	seenAt?: number;
	confirmationPushStatus?: string;
};

/**
 * An order the seller hasn't opened yet, on the confirmation-push path
 * (86eyf1rck).
 *
 * `pending` used to be the "haven't looked at this yet" signal — it's what the
 * New bucket, the Home tile and the age escalation all keyed on. Push-path
 * orders are born `confirmed`, so without this they'd land straight in
 * "in progress" and a brand-new order would be indistinguishable from one the
 * seller had already worked.
 *
 * Deliberately gated on `confirmationPushStatus` being set rather than on
 * status alone: that flag marks exactly the orders that skipped `pending`, so
 * the historical confirmed backlog can't suddenly flood the New bucket and no
 * backfill is needed. Counter orders (also born confirmed, but rung up by a
 * seller who is standing right there) never carry the flag, so they stay out.
 */
export function isUnseenOrder(order: BucketableOrder): boolean {
	return (
		order.status === "confirmed" &&
		order.confirmationPushStatus !== undefined &&
		order.seenAt === undefined
	);
}

/** UI order + labels for the bucket chips ("All" is prepended in the component). */
export const INBOX_BUCKETS: { key: OrderBucket; label: string }[] = [
	{ key: "new", label: "New" },
	{ key: "in_progress", label: "In progress" },
	{ key: "completed", label: "Completed" },
	{ key: "cancelled", label: "Cancelled" },
];

/** Which bucket a canonical status falls in, ignoring seen-state. Use
 * `orderBucket` for anything the seller sees — it also routes an unseen
 * push-path order to "new". */
export function statusToBucket(status: OrderStatus): OrderBucket {
	if (status === "pending" || status === "booking_requested") return "new";
	if (status === "delivered") return "completed";
	if (status === "cancelled") return "cancelled";
	return "in_progress"; // confirmed / packed / shipped
}

/** Bucket for a whole order: `statusToBucket`, except an unseen push-path
 * order counts as "new" until the seller opens it. Exactly one bucket per
 * order, so counts never double. */
export function orderBucket(order: BucketableOrder): OrderBucket {
	if (isUnseenOrder(order)) return "new";
	return statusToBucket(order.status);
}

// --- Time in status -------------------------------------------------------

export type StatusAgeSeverity = "normal" | "warn" | "urgent";

/** Milliseconds the order has sat in its current status. Falls back through
 * updatedAt → createdAt for orders created before `statusChangedAt` existed. */
export function statusAgeMs(
	order: { statusChangedAt?: number; updatedAt?: number; createdAt: number },
	now: number,
): number {
	const since = order.statusChangedAt ?? order.updatedAt ?? order.createdAt;
	return Math.max(0, now - since);
}

/** Compact age label: "just now", "5m", "2h", "3d". */
export function formatStatusAge(ms: number): string {
	const mins = Math.floor(ms / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h`;
	return `${Math.floor(hrs / 24)}d`;
}

/**
 * Escalation for the age badge — amber after 4h, red after 24h — for orders in
 * the "missed an order" risk window. Other statuses show their age neutrally.
 *
 * That window is `pending` on the legacy flow and **unseen** on the
 * confirmation-push flow (86eyf1rck), where orders are born `confirmed`: an
 * order the seller hasn't opened is exactly as missable as one the buyer hadn't
 * confirmed, and losing the escalation was the sharpest edge of that change.
 * Pass the order to get both; the status-only overload keeps legacy callers
 * working unchanged.
 */
export function statusAgeSeverity(
	order: OrderStatus | BucketableOrder,
	ms: number,
): StatusAgeSeverity {
	// Booking requests share the window: amber at 4 h, red at 24 h — which is
	// the moment the expiry cron kills the hold, so red means "about to lapse".
	const risky =
		typeof order === "string"
			? order === "pending" || order === "booking_requested"
			: order.status === "pending" ||
				order.status === "booking_requested" ||
				isUnseenOrder(order);
	if (!risky) return "normal";
	const hrs = ms / 3_600_000;
	if (hrs >= 24) return "urgent";
	if (hrs >= 4) return "warn";
	return "normal";
}
