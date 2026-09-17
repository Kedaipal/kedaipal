/**
 * The prep floor (ClickUp `z8r3fdff97`) — the earliest moment an order whose
 * cart carries a prep window can be handed over, and the words for refusing
 * anything sooner.
 *
 * ONE author for the rule AND its copy, because three places enforce it:
 * `orders.create`, the claim-link commit, and the storefront checkout's inline
 * check. If the server said "earliest pickup is 7:00 PM" while the checkout
 * offered 6:45, the buyer would be told two different things by the same app.
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
import { type OpeningHours, selectableTimeWindows } from "./openingHours";

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
 * Deliberately silent on everything that is not prep's fault — a closed day, a
 * time in a lunch break, a time after closing — so the opening-hours rules speak
 * for those in their own words. The two are complementary, not stacked: this
 * one only fires when prep is the reason a slot disappeared.
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
		// The day still had slots WITHOUT prep, so prep is what used them up.
		// Both empty means the store is closed or finished anyway — the
		// opening-hours rules own that message.
		return withoutPrep.length > 0 ? { kind: "too_late_today" } : null;
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
