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

/** A bucket chip over its own leaves. Split out so `toggleBucketChip` can ask
 * for it without being handed the row context only "All statuses" needs. */
function bucketChipState(
	bucket: OrderBucket,
	selected: readonly string[],
): BulkState {
	const leaves = BUCKET_LEAVES[bucket];
	return bulkStateOf(
		leaves.length,
		leaves.filter((l) => selected.includes(l)).length,
	);
}

/**
 * Tri-state, because a bucket chip summarises several leaves: a chip reading OFF
 * while two of its three statuses are ticked would be telling the seller
 * something false (CLAUDE.md — a parent that summarises children is tri-state).
 *
 * **"All statuses" is the select-all over THE ROW**, so it is on in exactly two
 * states: nothing picked, or every chip in the row picked. It is deliberately
 * NOT "the axis isn't narrowing" — that reading lit it with all eight leaves on
 * while two booking chips sat visibly dark beside it (owner report, 2 Sep),
 * which is the same "a chip claiming everything next to an unlit one" problem
 * the earlier rounds existed to remove. Semantically the two agree wherever it
 * matters: a booking period adds nothing once every leaf is on, so the only
 * states they disagree about are ones where the seller can SEE unlit chips.
 *
 * This still satisfies the case that produced the narrower rule (PR #243
 * review): the panel's Status select-all sets every leaf AND every period, so
 * the row is fully picked and "All statuses" lights.
 *
 * Binary, not tri-state, unlike its neighbours: "All statuses" means the ABSENCE
 * of a selection, so a dash on it while one chip is lit would read as "partly
 * everything", which is not a state.
 */
export function statusChipState(
	key: StatusChipKey,
	selected: readonly string[],
	periods: readonly BookingPeriod[],
	/** The period chips this row is OFFERING — empty for a store with no
	 * booking listings, where the row is buckets only. Without it "every chip
	 * picked" can't be told apart from "some chips picked". */
	availablePeriods: readonly BookingPeriod[],
): BulkState {
	if (key === "all") {
		const nothingPicked = selected.length === 0 && periods.length === 0;
		const everyChipPicked =
			selected.length === INBOX_LEAF_KEYS.length &&
			periods.length === availablePeriods.length;
		return nothingPicked || everyChipPicked ? "all" : "none";
	}
	if (!isBucketChip(key)) return periods.includes(key) ? "all" : "none";
	return bucketChipState(key, selected);
}

/** `FilterChip`'s tri-state prop for a chip. */
export function statusChipSelected(
	key: StatusChipKey,
	selected: readonly string[],
	periods: readonly BookingPeriod[],
	availablePeriods: readonly BookingPeriod[],
): boolean | "mixed" {
	const state = statusChipState(key, selected, periods, availablePeriods);
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
): InboxStatusLeaf[] {
	const leaves = BUCKET_LEAVES[bucket];
	const without = selected.filter(
		(x) => !leaves.includes(x as InboxStatusLeaf),
	) as InboxStatusLeaf[];
	return bucketChipState(bucket, selected) === "all"
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
