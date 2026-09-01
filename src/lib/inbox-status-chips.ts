/**
 * The inbox chip row's selection rules — pure, so the one thing this whole
 * change rests on is provable rather than buried in a route closure.
 *
 * The chip row and the Filters panel are TWO GRAINS OF ONE STATE: the panel
 * ticks leaves, a bucket chip ticks that bucket's leaves, and "All statuses" is
 * the select-all over the row. They used to be two separate ANDed filter fields
 * — `buckets` from the chips, `statuses` from the panel — which is why ticking
 * every row under the panel's "IN PROGRESS" heading left the "In progress" chip
 * dark, and why two lit chips could produce an empty list.
 *
 * Booking periods are members of the same row but have no leaves (a period is
 * computed from the booking span, not the order's status), so they are only ever
 * on or off. See `InboxFilterArgs.statuses` in convex/lib/orderInboxFilter.ts.
 */

import type { BookingPeriod } from "../../convex/lib/bookingPeriod";
import {
	BUCKET_LEAVES,
	INBOX_LEAF_KEYS,
	type InboxStatusLeaf,
	type OrderBucket,
} from "../../convex/lib/orderBuckets";
import { type BulkState, bulkStateOf } from "../components/ui/bulk-select-row";

/** Every member of the chip row: the select-all, the buckets, the periods. */
export type StatusChipKey = OrderBucket | "all" | BookingPeriod;

export function isBucketChip(key: StatusChipKey): key is OrderBucket {
	return key in BUCKET_LEAVES;
}

/**
 * Tri-state, because a bucket chip summarises several leaves: a chip reading OFF
 * while two of its three statuses are ticked would be telling the seller
 * something false (CLAUDE.md — a parent that summarises children is tri-state).
 *
 * "All statuses" is on when the axis is not narrowing, which is true both when
 * nothing is picked AND when every leaf is — the same reading a parent checkbox
 * gives over fully-ticked children. Without the second arm, ticking all four
 * groups leaves it dark above a list that is showing everything.
 */
export function statusChipState(
	key: StatusChipKey,
	selected: readonly string[],
	periods: readonly BookingPeriod[],
): BulkState {
	if (key === "all") {
		// The full-leaf check comes FIRST: with every leaf selected the axis
		// matches every order under the union — any period chips add nothing —
		// so it isn't narrowing and "All statuses" must read on. The panel's
		// Status select-all on a booking store produces exactly this state
		// (all leaves + all periods); checking periods first read it as dark
		// above a list showing everything (PR #243 review).
		if (selected.length === INBOX_LEAF_KEYS.length) return "all";
		if (periods.length > 0) return "none";
		return selected.length === 0 ? "all" : "none";
	}
	if (!isBucketChip(key)) return periods.includes(key) ? "all" : "none";
	const leaves = BUCKET_LEAVES[key];
	return bulkStateOf(
		leaves.length,
		leaves.filter((l) => selected.includes(l)).length,
	);
}

/** `FilterChip`'s tri-state prop for a chip. */
export function statusChipSelected(
	key: StatusChipKey,
	selected: readonly string[],
	periods: readonly BookingPeriod[],
): boolean | "mixed" {
	const state = statusChipState(key, selected, periods);
	return state === "all" ? true : state === "some" ? "mixed" : false;
}

/**
 * The leaf set after tapping a bucket chip. Partly-on FILLS (finishing the set
 * is what a half-lit group invites) and fully-on clears — identical to
 * `BulkSelectRow`, so the two places a seller can tick "In progress" behave the
 * same way.
 */
export function toggleBucketChip(
	bucket: OrderBucket,
	selected: readonly string[],
	periods: readonly BookingPeriod[],
): InboxStatusLeaf[] {
	const leaves = BUCKET_LEAVES[bucket];
	const without = selected.filter(
		(x) => !leaves.includes(x as InboxStatusLeaf),
	) as InboxStatusLeaf[];
	return statusChipState(bucket, selected, periods) === "all"
		? without
		: [...without, ...leaves];
}

/**
 * The one bucket whose leaves are selected EXACTLY — the state a seller reaches
 * by tapping a single chip. `null` for a partial group, a mix, or nothing, which
 * is what the empty-state copy branches on: "No new orders" is simply false for
 * a seller who picked three statuses across two buckets.
 */
export function wholeBucketSelected(
	selected: readonly string[],
	periods: readonly BookingPeriod[],
): OrderBucket | null {
	if (periods.length > 0) return null;
	for (const bucket of Object.keys(BUCKET_LEAVES) as OrderBucket[]) {
		const leaves = BUCKET_LEAVES[bucket];
		if (
			leaves.length === selected.length &&
			leaves.every((l) => selected.includes(l))
		) {
			return bucket;
		}
	}
	return null;
}
