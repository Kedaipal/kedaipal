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

/**
 * The filterable ATOM of the inbox's status axis (1 Sep) — every order resolves
 * to exactly one, and a bucket is defined as the union of its leaves.
 *
 * This exists because a bucket was never a set of statuses. `orderBucket` routes
 * an unseen push-path order (born `confirmed`, never opened — 86eyf1rck) to
 * **new**, so "New" ⊅ {pending, booking_requested} and no amount of syncing could
 * make the chip row and the filter panel agree while one filtered on buckets and
 * the other on raw `status`. They were two filter states wearing the same word,
 * ANDed together: ticking every row under the panel's NEW heading could not light
 * the New chip, and on a store with unseen orders the two disagreed outright.
 *
 * Splitting `confirmed` into seen/unseen makes the leaf set a true partition, so
 * bucket = Σ leaves both in membership AND in the counts. The seller sees the
 * split as a real row — "Not yet opened" under New — which is also the first time
 * that rule has been visible anywhere in the product rather than inferred from an
 * order mysteriously sitting in New.
 *
 * NOT an `OrderStatus`, and deliberately absent from `ORDER_STATUS_KEYS`: that
 * list is the seller's RENAME list, and "not yet opened" is a fact about the
 * seller's attention, not a pipeline stage they name.
 */
export const INBOX_LEAF_KEYS = [
	"pending",
	"booking_requested",
	"confirmed_unseen",
	"confirmed",
	"packed",
	"shipped",
	"delivered",
	"cancelled",
] as const;

export type InboxStatusLeaf = (typeof INBOX_LEAF_KEYS)[number];

/**
 * Which leaves make up each bucket. Flattened this is exactly `INBOX_LEAF_KEYS`
 * (pinned by a test) — the partition property the counts rely on.
 *
 * Note `confirmed` here means confirmed AND SEEN: the unseen half is its own
 * leaf, one group up. That is the single place the leaf vocabulary diverges from
 * `orders.status`, and the reason `orderLeaf` is the only way to derive one.
 */
export const BUCKET_LEAVES: Record<OrderBucket, InboxStatusLeaf[]> = {
	// A booking request IS the needs-action new order — it has a 24 h clock on
	// it, which is exactly what the New bucket's age escalation was built for.
	// An unseen push-path order joins them for the same reason: nobody has
	// looked at it yet.
	new: ["pending", "booking_requested", "confirmed_unseen"],
	in_progress: ["confirmed", "packed", "shipped"],
	completed: ["delivered"],
	cancelled: ["cancelled"],
};

/** Seller-facing name for a leaf that has no `OrderStatus` behind it. Not
 * renameable (see `INBOX_LEAF_KEYS`), so it needs no label resolver. */
export const UNSEEN_LEAF_LABEL = "Not yet opened";

/** Bucket a leaf belongs to. Total by construction over `INBOX_LEAF_KEYS`. */
export function leafBucket(leaf: InboxStatusLeaf): OrderBucket {
	if (leaf === "pending" || leaf === "booking_requested") return "new";
	if (leaf === "confirmed_unseen") return "new";
	if (leaf === "delivered") return "completed";
	if (leaf === "cancelled") return "cancelled";
	return "in_progress"; // confirmed (seen) / packed / shipped
}

/**
 * Seller-facing label for a leaf. Takes the caller's status resolver rather than
 * importing one, so the same helper serves the dashboard (which speaks the
 * seller's renamed labels) without this module depending on the label layer.
 */
export function leafLabel(
	leaf: InboxStatusLeaf,
	resolveStatus: (status: OrderStatus) => string,
): string {
	return leaf === "confirmed_unseen"
		? UNSEEN_LEAF_LABEL
		: resolveStatus(leaf);
}

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

/**
 * The leaf an order occupies — exactly one, so leaf counts partition the inbox.
 *
 * THE only way to derive a leaf. `o.status` is not a leaf: a `confirmed` order
 * is `confirmed_unseen` until the seller opens it, and reading the raw status
 * instead is precisely how the panel and the chip row came to disagree.
 */
export function orderLeaf(order: BucketableOrder): InboxStatusLeaf {
	if (isUnseenOrder(order)) return "confirmed_unseen";
	return order.status;
}

/** Bucket for a whole order: `statusToBucket`, except an unseen push-path
 * order counts as "new" until the seller opens it. Exactly one bucket per
 * order, so counts never double. Derived from the leaf since 1 Sep, so a
 * bucket is definitionally the union of its leaves and the two can't drift. */
export function orderBucket(order: BucketableOrder): OrderBucket {
	return leafBucket(orderLeaf(order));
}

/**
 * Collapse the pre-1-Sep `buckets` + `statuses` PAIR onto the single leaf set.
 *
 * The two used to AND (a bucket narrowed, statuses narrowed further), so a
 * client still holding that shape gets the intersection — anything else would
 * silently widen a stale tab's list. New clients send only `statuses` and take
 * the first branch.
 *
 * Two things it cannot recover exactly, both self-healing on refresh:
 *
 * - A legacy `statuses: ["confirmed"]` used to include unseen push-path orders
 *   and now means confirmed-AND-SEEN, because `confirmed` is a valid leaf and
 *   nothing distinguishes an old client sending it from a new one deliberately
 *   picking "Ok go" alone. The orders never went anywhere — they are in New,
 *   under "Not yet opened".
 * - A CONTRADICTORY pair ("New" chip + "Packed" ticked) intersected to nothing
 *   and showed an empty list. An empty array here would read as "no status
 *   filter" and widen that to the whole inbox — the one outcome worse than
 *   either — so the panel's own selection wins instead. Narrower than the
 *   bucket, never everything, and it is what the seller last ticked.
 */
export function foldLegacyBuckets(
	buckets: OrderBucket[] | undefined,
	statuses: InboxStatusLeaf[] | undefined,
): InboxStatusLeaf[] | undefined {
	if (!buckets || buckets.length === 0) return statuses;
	const fromBuckets = buckets.flatMap((b) => BUCKET_LEAVES[b]);
	if (!statuses || statuses.length === 0) return fromBuckets;
	const wanted = new Set(statuses);
	const both = fromBuckets.filter((leaf) => wanted.has(leaf));
	return both.length > 0 ? both : statuses;
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
