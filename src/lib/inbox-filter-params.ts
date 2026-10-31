/**
 * The inbox's filter vocabulary, in ONE place (PR #358 review).
 *
 * The route used to carry two hand-written lists of the same idea: a 14-clause
 * boolean deciding whether "Clear filters" should appear, and a separate object
 * literal deciding what it cleared. They drifted the moment a new param
 * arrived — Home's due span (`ffrom`/`fto`) was added to the first and not the
 * second, so a seller who tapped a Plan ahead tile onto an empty day got
 * "No orders match your filters → Clear filters", tapped it, and the list
 * stayed empty with nothing left on screen to blame.
 *
 * Deriving both from these arrays makes that drift a type error instead of a
 * dead end: a new filter param is added once, and the thing that COUNTS it and
 * the thing that CLEARS it cannot disagree.
 */

/**
 * Params that mean "the seller is filtering" — i.e. that make the list a subset
 * and so make "Clear filters" a true offer.
 *
 * The STATUS AXIS (`st`, `period`) is deliberately absent: it is the chip row's
 * own state, which has its own visible control above the list, and a chip tap
 * must not flip the empty state to "No orders match your filters" (PR #243
 * review). It is cleared anyway — see `INBOX_CLEARED_PARAMS`.
 */
export const INBOX_FILTER_PARAMS = [
	"pay",
	"method",
	"munspec",
	"from",
	"to",
	"mockup",
	"fwin",
	"ffrom",
	"fto",
	"sources",
	"ful",
	"cat",
	"catunspec",
	"listing",
	"asrc",
] as const;

/**
 * What "Clear all" / "Clear filters" resets: every filter above PLUS both
 * halves of the status axis. Broader on purpose — this is the "start over"
 * button, and in table view the axis is set from the Status column's own funnel,
 * so leaving it would strand the seller on the very filter the empty row is
 * telling them about. It once cleared `st` but not `period` — half the chip row
 * (PR #243 review), the same drift in the other direction.
 */
export const INBOX_CLEARED_PARAMS = [
	...INBOX_FILTER_PARAMS,
	"st",
	"period",
] as const;

export type InboxFilterParam = (typeof INBOX_CLEARED_PARAMS)[number];

/** True when any filter above is set. Arrays count only when non-empty, and an
 * explicit `false` is not a filter — the same rule the server's
 * `narrowsTheInbox` applies, for the same reason. */
export function anyInboxFilterActive(
	search: Partial<Record<InboxFilterParam, unknown>>,
): boolean {
	return INBOX_FILTER_PARAMS.some((key) => {
		const value = search[key];
		if (Array.isArray(value)) return value.length > 0;
		return value != null && value !== false;
	});
}

/** Every clearable param set to `undefined`, ready to spread over the current
 * search. Keys must be PRESENT and undefined: a missing key leaves the old
 * value in the URL. */
export function clearedInboxFilters(): Record<InboxFilterParam, undefined> {
	return Object.fromEntries(
		INBOX_CLEARED_PARAMS.map((key) => [key, undefined]),
	) as Record<InboxFilterParam, undefined>;
}
