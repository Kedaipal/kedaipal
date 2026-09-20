/**
 * The prep floor (ClickUp `z8r3fdff97`) — the earliest moment an order whose
 * cart carries a prep window can be handed over, and the words for refusing
 * anything sooner.
 *
 * ONE author for the rule AND its copy, because three places enforce it:
 * `orders.create`, the claim-link commit, and the storefront checkout's inline
 * check. If the server said "earliest pickup is 7:00 PM" while the checkout
 * offered 6:45, the buyer would be told two different things by the same app.
 * The RULE never diverges; the words may, in one deliberate spot — on a day
 * the store genuinely finished, the checkout's ladder says "closed for today"
 * before prep speaks, while this module's server error still names the prep
 * (reachable only from a stale tab or a direct call, since the checkout
 * blocks submit first).
 *
 * Hours-aware on purpose. The first version floored against the whole day
 * ("now + prep") and named an earliest time the store could not honour: with
 * an 18:00 close, ordering at 16:30 with a 2-hour prep said "earliest pickup
 * is 6:30 PM" — after closing — instead of "too late for today". It now reads
 * T1's `selectableTimeWindows`, so a split day's break and the closing time
 * are respected and the named time is always one a buyer can actually pick.
 *
 * No Convex imports: pure, shared by the server and the client.
 */
import {
	clampPrepMinutes,
	formatFulfilmentTime,
	formatPrepDuration,
} from "./fulfilmentDate";
import {
	isOpenOnDate,
	OPEN_ALL_DAY,
	type OpeningHours,
	selectableTimeWindows,
} from "./openingHours";

/** What the buyer is waiting for, in the words the refusal uses. */
export type PrepFloorKind = "pickup" | "delivery";

/** The cart's slowest prep window and the product that sets it. */
export type CartPrep = { minutes: number; productName: string };

export const NO_CART_PREP: CartPrep = { minutes: 0, productName: "" };

/**
 * The slowest line decides the whole order, the way the strictest line decides
 * its notice. The FIRST line wins a tie, so the named product is stable as the
 * buyer adds items rather than flipping to whichever was added last.
 */
export function slowestPrep(
	lines: readonly { name: string; prepMinutes?: number }[],
): CartPrep {
	let slowest = NO_CART_PREP;
	for (const line of lines) {
		const minutes = clampPrepMinutes(line.prepMinutes);
		if (minutes > slowest.minutes) {
			slowest = { minutes, productName: line.name };
		}
	}
	return slowest;
}

/**
 * The opening hours a prep window is judged against. A TIMED fulfilment is
 * handed over inside the store's hours, so prep counts only the slots they
 * leave. A DATE-ONLY one isn't — a drop-off meet-up's hour is its point's own
 * schedule, and a legacy date-only order means "any time that day" — so prep
 * is judged against the WHOLE of every day the store opens. Closed weekdays
 * stay closed: those still refuse every method, in the opening-hours words.
 *
 * Judged against the store's hours instead, a date-only order after closing
 * saw no slots with prep AND none without, so prep looked blameless and a
 * 24-hour prep could be booked for a meet-up that same evening.
 */
export function prepFloorHours(
	hours: OpeningHours | undefined,
	timed: boolean,
): OpeningHours | undefined {
	if (timed || hours === undefined) return hours;
	return hours.map((day) => (day.closed ? day : OPEN_ALL_DAY));
}

/**
 * Why prep refuses a moment, as data — so a page can render the refusal with
 * its time kept whole (the checkout's `CopyText`), and the server can join the
 * same parts into its error. One author, two renderings, one sentence.
 */
export type PrepFloorProblem =
	/** Prep used up today's remaining slots — the store still had some
	 * without it. */
	| { kind: "too_late_today" }
	/** Today still has slots, but this moment is before the first one prep
	 * allows. `earliest` is that slot, never a time inside a break. */
	| { kind: "too_early"; earliest: number };

/**
 * What prep refuses about this fulfilment moment, or `null`.
 *
 * Deliberately silent on what the opening-hours rules ALWAYS refuse in their
 * own words — a closed weekday, a time in a lunch break, a named time outside
 * the windows. The two are complementary, not stacked: prep speaks only where
 * it has something true to say.
 *
 * But an OPEN day with no prep-able slot left refuses HERE, even when prep
 * isn't the only thing that emptied it (the store finished for the day, or the
 * flat checkout lead crossed midnight). The first cut deferred that case to
 * the opening-hours rules too — which no-op with hours unset and hold a named
 * time only to its window, never to the clock — so from 23:41 MYT, when the
 * 15-minute lead alone empties an all-day store, a same-day order with a
 * 4-hour prep sailed through `orders.create` (the 2026.09.6 release gap). An
 * order whose prep can't finish today is impossible whoever emptied the day,
 * and "too late for today, pick a later day" is the right instruction either
 * way.
 *
 * A future day's windows are identical with and without prep (prep is absorbed
 * overnight — `minSelectableTimeMinutes` floors only today), so a future day is
 * always `null` without needing a date branch here.
 *
 * `timeMinutes` is optional: a date-only order can still be too late for today.
 */
export function prepFloorProblem(args: {
	hours: OpeningHours | undefined;
	dateEpoch: number;
	timeMinutes: number | undefined;
	now: number;
	prep: CartPrep;
}): PrepFloorProblem | null {
	const { hours, dateEpoch, timeMinutes, now, prep } = args;
	if (prep.minutes <= 0) return null;

	const withPrep = selectableTimeWindows(hours, dateEpoch, now, prep.minutes);
	const withoutPrep = selectableTimeWindows(hours, dateEpoch, now, 0);

	if (withPrep.length === 0) {
		// A weekday the store never opens stays the opening-hours rules'
		// refusal ("closed on Fridays"). Every OTHER empty day refuses here —
		// see the header: deferring "finished anyway" to rules that no-op with
		// hours unset is how the 23:41 gap opened.
		return isOpenOnDate(hours, dateEpoch) ? { kind: "too_late_today" } : null;
	}
	if (timeMinutes === undefined) return null;

	// The first slot a buyer can really pick. Never a time inside a break: on a
	// split day where prep swallows the breakfast window, this is the lunch
	// window's open time, not "now + prep".
	const earliest = withPrep[0].open;
	const earliestWithoutPrep = withoutPrep[0]?.open ?? earliest;
	// Only prep's fault if prep actually moved the earliest slot.
	if (earliest > earliestWithoutPrep && timeMinutes < earliest) {
		return { kind: "too_early", earliest };
	}
	return null;
}

/** "“Ice Cream Puff” needs 2 hours to prepare" — the one spelling of why prep
 * refuses or moves a time, shared by the refusal and the checkout's move note. */
export function prepNeedsText(prep: CartPrep): string {
	return `“${prep.productName}” needs ${formatPrepDuration(prep.minutes)} to prepare`;
}

/** The refusal as parts: text, and a time kept as a value. No closing period —
 * the server error has none, and a page adds its own. */
export function prepFloorCopy(
	problem: PrepFloorProblem,
	prep: CartPrep,
	kind: PrepFloorKind,
): Array<string | { time: number }> {
	const needs = prepNeedsText(prep);
	return problem.kind === "too_late_today"
		? [`${needs} — too late for today, pick a later day`]
		: [`${needs} — earliest ${kind} is `, { time: problem.earliest }];
}

/**
 * The server's refusal: `prepFloorProblem` in words, or `null`. What
 * `orders.create` and `orderClaims.commit` throw — the checkout renders the
 * same parts, so the two can never tell a buyer different things.
 */
export function prepFloorIssue(args: {
	hours: OpeningHours | undefined;
	dateEpoch: number;
	timeMinutes: number | undefined;
	now: number;
	prep: CartPrep;
	kind: PrepFloorKind;
}): string | null {
	const problem = prepFloorProblem(args);
	if (problem === null) return null;
	return prepFloorCopy(problem, args.prep, args.kind)
		.map((part) =>
			typeof part === "string" ? part : formatFulfilmentTime(part.time),
		)
		.join("");
}

/**
 * The WHOLE prep rule for a placed order — what `orders.create` and
 * `orderClaims.commit` call (ClickUp `z8r3fdg9aa`): `prepFloorIssue` against
 * the deadline this handover races (`prepFloorHours`, `timed` = the checkout's
 * `asksForTime`) — closing time when the store's hours bound it, else
 * midnight. A counter can't hand anything over at 7 PM if it shut at 6; a
 * drop-off meet-up keeps its point's own hour and races only the day.
 *
 * This used to be TWO passes: after closing, the hours-bound pass found no
 * slot with prep and none without, `prepFloorProblem` deferred, and a second
 * midnight-widened pass was needed so a 24-hour prep couldn't book tonight.
 * `prepFloorProblem` no longer defers on an open day with nothing left, so
 * the first pass refuses everything the second did (widening only ever
 * enlarges the windows) and the day's deadline needs no pass of its own.
 */
export function orderPrepFloorIssue(args: {
	hours: OpeningHours | undefined;
	dateEpoch: number;
	timeMinutes: number | undefined;
	now: number;
	prep: CartPrep;
	kind: PrepFloorKind;
	/** `asksForTime` — whether the store's hours bound this handover. */
	timed: boolean;
}): string | null {
	return prepFloorIssue({
		...args,
		hours: prepFloorHours(args.hours, args.timed),
	});
}
