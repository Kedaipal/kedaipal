/**
 * The "when" step's order rules for both buyer checkouts — the storefront cart
 * and the claim link — as pure functions (ClickUp `z8r3fdff97`).
 *
 * Built ON the time rules in `fulfilment-time-issue.ts` (T1, z8r3fdff8r),
 * never beside them: this module adds only what a CART brings — which
 * fulfilment asks for a time at all, the product rules read live, and the
 * prep window — and hands every clock question, prep included, to
 * `fulfilmentTimeIssue`. One precedence rule, one set of words, for both
 * checkouts and for the inline notice and the submit refusal alike. The
 * ticking repair stays T1's `planTimeRepair`.
 *
 * Copy comes back as `CopyPart[]`, so every place it lands renders its times
 * whole through `CopyText` — the inline notice under the field and the refusal
 * beside the CTA alike (T1's refusal state takes parts).
 * The server stays the judge (`orders.create`, `orderClaims.commit`).
 */

import {
	formatPrepDuration,
	todayMytMidnight,
} from "../../convex/lib/fulfilmentDate";
import {
	asksForTime,
	type FulfilmentKind,
	fulfilmentKind,
} from "../../convex/lib/fulfilmentShape";
import {
	type OpeningHours,
	selectableTimeWindows,
} from "../../convex/lib/openingHours";
import {
	type CartPrep,
	NO_CART_PREP,
	prepFloorHours,
} from "../../convex/lib/prepFloor";
import {
	type CopyPart,
	fulfilmentTimeIssue,
	type TimeIssue,
	type TimeVerb,
	timeIssueCopy,
} from "./fulfilment-time-issue";

/**
 * The fulfilment's shape moved to `convex/lib/fulfilmentShape.ts` (z8r3fdg9aa)
 * so `orders.create` and `orderClaims.commit` ask the same question this
 * module does. Re-exported here, because a checkout still reads its whole
 * "when" vocabulary from one import.
 */
export { asksForTime, fulfilmentKind };
export type { FulfilmentKind };

/** The verb T1's time copy speaks for a kind. */
export const TIME_VERB: Record<FulfilmentKind, TimeVerb> = {
	delivery: "deliver",
	collection: "collect",
	pickup: "pick up",
};

/** A line's order rules — the fields a product sets on how it can be ordered. */
type OrderRuleFields = {
	name?: string;
	prepMinutes?: number;
	pickupNote?: string;
	minNoticeDays?: number;
};

export type LineRules = {
	name: string;
	prepMinutes: number;
	pickupNote: string | undefined;
	minNoticeDays: number;
};

/**
 * A cart line's order rules as they stand NOW. The live product wins —
 * `orders.create` judges against it, so a seller who raised the prep time
 * after the buyer added the item, or a cart saved before prep existed, is
 * judged here exactly as the server will. The line's own snapshot is the
 * fallback only while the catalogue loads or once the product has left the
 * public list (the server is still the judge then).
 */
export function resolveLineRules(
	line: OrderRuleFields & { name: string },
	live: OrderRuleFields | undefined,
): LineRules {
	const source = live ?? line;
	return {
		name: live?.name ?? line.name,
		prepMinutes: source.prepMinutes ?? 0,
		pickupNote: source.pickupNote,
		minNoticeDays: source.minNoticeDays ?? 0,
	};
}

/**
 * The prep that floors this fulfilment. A collection trip is exempt, the
 * `orders.create` rule: the rider collects from the buyer FIRST and the work
 * happens after, so a prep window has nothing to delay.
 */
export function prepForFulfilment(
	cartPrep: CartPrep,
	kind: FulfilmentKind,
): CartPrep {
	return kind === "collection" ? NO_CART_PREP : cartPrep;
}

type DayArgs = {
	hours: OpeningHours | undefined;
	dateEpoch: number;
	now: number;
	prep: CartPrep;
	/** `asksForTime` — a timed day needs a pickable slot left; a date-only
	 * day just has to be open and not already out of prep time (judged to the
	 * end of the day, not to closing — `prepFloorHours`). */
	timed: boolean;
	kind: FulfilmentKind;
	storeName: string;
};

/**
 * The day-level issue for a schedule, or `null` when the day can be offered.
 * A timed day needs a slot left (T1's `no_slot`, prep included). A date-only
 * day doesn't: only a closed weekday, or a today the cart's prep outlasts,
 * rules it out — a date-only pickup after hours was always allowed. Its prep
 * runs to midnight, the rule `orders.create` judges it by (`prepFloorHours`).
 */
function dayIssue(args: Omit<DayArgs, "kind" | "storeName">): TimeIssue | null {
	const issue = fulfilmentTimeIssue({
		hours: prepFloorHours(args.hours, args.timed),
		dayEpoch: args.dateEpoch,
		timeMinutes: undefined,
		now: args.now,
		prepMinutes: args.prep.minutes,
		prepItemName: args.prep.productName,
	});
	if (issue?.kind !== "no_slot") return null;
	if (!args.timed && issue.reason !== "closed_day" && !issue.prep) return null;
	return issue;
}

/** Whether the day can be offered at all (chips, the default date). */
export function isFulfilmentDaySelectable(
	args: Omit<DayArgs, "kind" | "storeName">,
): boolean {
	return dayIssue(args) === null;
}

/**
 * Why the chosen DAY won't work, or `null` — the notice under the date and the
 * first submit check, one sentence: a closed weekday, today's hours over, no
 * time left today, or the cart's prep having used today up (named as prep).
 */
export function fulfilmentDayCopy(args: DayArgs): CopyPart[] | null {
	const issue = dayIssue(args);
	return issue
		? timeIssueCopy(issue, {
				storeName: args.storeName,
				verb: TIME_VERB[args.kind],
			})
		: null;
}

/**
 * Why the chosen TIME won't work, or `null` — T1's ladder with the cart's prep
 * in it, so the day comes first and a prep refusal names the item.
 * `timeMinutes` undefined is an empty field.
 */
export function fulfilmentTimeCopy(
	args: Omit<DayArgs, "timed"> & { timeMinutes: number | undefined },
): CopyPart[] | null {
	const issue = fulfilmentTimeIssue({
		hours: args.hours,
		dayEpoch: args.dateEpoch,
		timeMinutes: args.timeMinutes,
		now: args.now,
		prepMinutes: args.prep.minutes,
		prepItemName: args.prep.productName,
	});
	return issue
		? timeIssueCopy(issue, {
				storeName: args.storeName,
				verb: TIME_VERB[args.kind],
			})
		: null;
}

/**
 * The one-line explanation of the cart's prep window, shown at the "when"
 * step — about TODAY, because that is the only day prep can change (it is
 * absorbed overnight). `null` whenever it changes nothing the buyer can see:
 * no prep, a notice of a day or more (today is out regardless), today already
 * over for other reasons (the hours say so), or a prep that doesn't move
 * today's earliest slot. A date-only fulfilment reads its prep to the end of
 * the day (`prepFloorHours`), the way the server judges it.
 */
export function prepHint(args: {
	hours: OpeningHours | undefined;
	now: number;
	prep: CartPrep;
	kind: FulfilmentKind;
	/** The effective notice in days (store and cart). */
	noticeDays: number;
	timed: boolean;
}): CopyPart[] | null {
	const { hours, now, prep, kind, noticeDays, timed } = args;
	if (prep.minutes <= 0 || noticeDays >= 1) return null;
	const today = todayMytMidnight(now);
	const judged = prepFloorHours(hours, timed);
	const withoutPrep = selectableTimeWindows(judged, today, now, 0);
	if (withoutPrep.length === 0) return null;
	const withPrep = selectableTimeWindows(judged, today, now, prep.minutes);
	const takes = `“${prep.productName}” takes about ${formatPrepDuration(prep.minutes)} to prepare`;
	if (withPrep.length === 0) return [`${takes}, so it can't be ready today.`];
	if (withPrep[0].open <= withoutPrep[0].open) return null;
	const earliest = { time: withPrep[0].open };
	return timed
		? [`${takes}, so the earliest ${kind} today is `, earliest, "."]
		: [`${takes}, so it's ready from `, earliest, " today."];
}
