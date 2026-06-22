// Pure helpers for the order inbox: fulfilment buckets + the "time in status"
// badge. No Convex imports — shared by the `searchOrders` query (server) and the
// inbox UI (client, via convex/lib import, same as isMockupGateClosed). Payment
// status is deliberately NOT a bucket (it's an orthogonal filter + badge). See
// docs/order-inbox.md.

export type OrderStatus =
	| "pending"
	| "confirmed"
	| "packed"
	| "shipped"
	| "delivered"
	| "cancelled";

/** Fulfilment buckets — the inbox's primary segmentation (excludes "all"). */
export type OrderBucket = "new" | "in_progress" | "completed" | "cancelled";

export const BUCKET_STATUSES: Record<OrderBucket, OrderStatus[]> = {
	new: ["pending"],
	in_progress: ["confirmed", "packed", "shipped"],
	completed: ["delivered"],
	cancelled: ["cancelled"],
};

/** UI order + labels for the bucket chips ("All" is prepended in the component). */
export const INBOX_BUCKETS: { key: OrderBucket; label: string }[] = [
	{ key: "new", label: "New" },
	{ key: "in_progress", label: "In progress" },
	{ key: "completed", label: "Completed" },
	{ key: "cancelled", label: "Cancelled" },
];

/** Which bucket a canonical status falls in. */
export function statusToBucket(status: OrderStatus): OrderBucket {
	if (status === "pending") return "new";
	if (status === "delivered") return "completed";
	if (status === "cancelled") return "cancelled";
	return "in_progress"; // confirmed / packed / shipped
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
 * Escalation for the age badge. Per the ticket, only **new** (pending) orders
 * escalate — amber after 4h, red after 24h — since that's the "missed an order"
 * risk window. Other statuses show their age in a neutral tone.
 */
export function statusAgeSeverity(
	status: OrderStatus,
	ms: number,
): StatusAgeSeverity {
	if (status !== "pending") return "normal";
	const hrs = ms / 3_600_000;
	if (hrs >= 24) return "urgent";
	if (hrs >= 4) return "warn";
	return "normal";
}
