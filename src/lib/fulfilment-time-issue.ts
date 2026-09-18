/**
 * The checkout's delivery-time rules, shared by storefront checkout and claim
 * checkout. Both pages used to carry the same submit-time `if` ladder,
 * copy-pasted, and the inline notice only knew about one of its four cases.
 *
 * Three pieces, all pure:
 *
 * 1. `fulfilmentTimeIssue`: WHAT is wrong with a chosen time, as data.
 * 2. `timeIssueCopy` / `timeMovedCopy`: the sentence, as parts. A time or a
 *    range is kept as a value rather than a string, so the page can render it
 *    as one unbreakable unit. On a narrow phone, "4:30 PM –⏎5:30 PM" reads as
 *    two unrelated times. `copyText` flattens the same parts for the submit
 *    banner, so the inline notice and the submit refusal are one sentence and
 *    can't drift.
 * 3. `planTimeRepair`: the ticking repair, made ownership-aware. A time the
 *    SYSTEM prefilled goes stale as the clock moves, and is moved FORWARD with
 *    an announcement. A time the BUYER typed is never rewritten: the inline
 *    notice explains, and submit refuses. Before this, a buyer who typed 6:00
 *    PM into a lunch break watched it silently become 5:20 PM, earlier than
 *    they asked for, with nothing on screen saying why.
 */

import {
	formatFulfilmentTime,
	hhmmFromMinutes,
	minSelectableTimeMinutes,
	timeMinutesFromHhmm,
} from "../../convex/lib/fulfilmentDate";
import {
	type DayWindow,
	dayWindows,
	defaultTimeWithinHours,
	gapForTime,
	hoursForDate,
	isAllDay,
	isTimeSelectable,
	nextSelectableTime,
	type OpeningHours,
	selectableTimeWindows,
} from "../../convex/lib/openingHours";

export type TimeIssue =
	/** Nothing left to pick that day (today after closing, or minutes before
	 * midnight). `storeClosed` separates "the store has shut" from "the
	 * checkout lead ran out", because they call for different words. */
	| { kind: "no_slot"; storeClosed: boolean }
	/** The day has slots, but the field is empty (a cleared input). */
	| { kind: "missing" }
	/** Before the earliest pickable moment (opening time, or the lead floor). */
	| { kind: "too_early"; earliest: number }
	/** After the day's last closing time. */
	| { kind: "too_late"; latest: number }
	/** Inside the day's bounds but in a split day's break. */
	| { kind: "in_break"; gap: DayWindow };

interface TimeContext {
	hours: OpeningHours | undefined;
	dayEpoch: number;
	now?: number;
	/** The cart's prep floor (z8r3fdff97). Optional, and 0 changes nothing. */
	prepMinutes?: number;
}

/**
 * What's wrong with the chosen time on that day, or null when it's pickable.
 * Precedence: no slot at all, then no time entered, then too early, too late,
 * and the break. The day comes first: when today has closed, "pick a delivery
 * time" would send the buyer to the wrong field. On a today whose first window
 * the floor has already swallowed, a time in the old break reads "the earliest
 * we can deliver is 7:00 PM", which is the truer instruction.
 */
export function fulfilmentTimeIssue(
	args: TimeContext & { timeMinutes: number | undefined },
): TimeIssue | null {
	const { hours, dayEpoch, timeMinutes, now = Date.now(), prepMinutes = 0 } =
		args;
	const windows = selectableTimeWindows(hours, dayEpoch, now, prepMinutes);
	if (windows.length === 0) {
		const day = hoursForDate(hours, dayEpoch);
		return { kind: "no_slot", storeClosed: day !== null && !isAllDay(day) };
	}
	if (timeMinutes === undefined || Number.isNaN(timeMinutes)) {
		return { kind: "missing" };
	}
	if (isTimeSelectable(hours, dayEpoch, timeMinutes, now, prepMinutes)) {
		return null;
	}
	const earliest = windows[0].open;
	const latest = windows[windows.length - 1].close;
	if (timeMinutes < earliest) return { kind: "too_early", earliest };
	if (timeMinutes > latest) return { kind: "too_late", latest };
	const day = hoursForDate(hours, dayEpoch);
	const gap = day ? gapForTime(day, timeMinutes) : null;
	if (gap) return { kind: "in_break", gap };
	// Inside the bounds, in no window and in no break: only a hand-edited
	// schedule gets here. Point at the next slot rather than guess a sentence.
	return {
		kind: "too_early",
		earliest:
			nextSelectableTime(hours, dayEpoch, timeMinutes, now, prepMinutes) ??
			earliest,
	};
}

/** A sentence in parts. A `time` or `range` is one unbreakable unit on screen. */
export type CopyPart = string | { time: number } | { range: DayWindow };

export function formatRange(range: DayWindow): string {
	return `${formatFulfilmentTime(range.open)} – ${formatFulfilmentTime(range.close)}`;
}

/** Flatten parts into plain text (the submit banner, tests). */
export function copyText(parts: CopyPart[]): string {
	return parts
		.map((part) =>
			typeof part === "string"
				? part
				: "time" in part
					? formatFulfilmentTime(part.time)
					: formatRange(part.range),
		)
		.join("");
}

export function timeIssueCopy(
	issue: TimeIssue,
	ctx: { storeName: string; verb: "deliver" | "collect" },
): CopyPart[] {
	switch (issue.kind) {
		case "no_slot":
			return issue.storeClosed
				? [`${ctx.storeName} has closed for today — pick another day.`]
				: [`There's no time left to ${ctx.verb} today — pick tomorrow.`];
		case "missing":
			return [
				ctx.verb === "collect" ? "Pick a collection time." : "Pick a delivery time.",
			];
		case "too_early":
			return [
				`The earliest we can ${ctx.verb} is `,
				{ time: issue.earliest },
				" — pick that or later.",
			];
		case "too_late":
			return [
				`${ctx.storeName} closes at `,
				{ time: issue.latest },
				" that day — pick an earlier time.",
			];
		case "in_break":
			return [
				`${ctx.storeName} is closed `,
				{ range: issue.gap },
				" — pick a time in an open window.",
			];
	}
}

/**
 * WHY `from` could not stay — the true reason, because a move happens for
 * different causes and one sentence can't cover them. "7:30 PM is no longer
 * available" is right when the clock passed it and FALSE when the buyer
 * switched to a Friday that simply closes at 6:00 PM.
 */
export type TimeMoveReason =
	/** `from` sat in a split day's break (a seller edit, or a new day). */
	| { kind: "break"; gap: DayWindow }
	/** Today, `from` is below the earliest pickable moment — the clock (or the
	 * cart's prep window) overtook it. */
	| { kind: "passed" }
	/** `from` is before the day's first opening. (The repair lands ON that
	 * opening, so naming the opening time again would say one number twice.) */
	| { kind: "before_open" }
	/** `from` is after the day's last closing. */
	| { kind: "after_close" };

/** What a repair did, for the announcement under the time field. */
export interface TimeMove {
	from: number;
	to: number;
	reason: TimeMoveReason;
}

/**
 * Classify why `from` isn't pickable on `dayEpoch`. Precedence: a break names
 * itself; then the floor, which is today's earliest moment INCLUDING prep (a
 * time overtaken by the prep window has passed, it isn't "before opening");
 * then the day's own bounds.
 */
function moveReason(
	hours: OpeningHours | undefined,
	dayEpoch: number,
	from: number,
	now: number,
	prepMinutes: number,
): TimeMoveReason {
	const day = hoursForDate(hours, dayEpoch);
	const gap = day ? gapForTime(day, from) : null;
	if (gap) return { kind: "break", gap };
	if (from < minSelectableTimeMinutes(dayEpoch, now, prepMinutes)) {
		return { kind: "passed" };
	}
	if (day) {
		const windows = dayWindows(day);
		if (from < windows[0].open) return { kind: "before_open" };
		if (from > windows[windows.length - 1].close) {
			return { kind: "after_close" };
		}
	}
	return { kind: "passed" };
}

export function timeMovedCopy(
	moved: TimeMove,
	ctx: { storeName: string },
): CopyPart[] {
	const lead: CopyPart[] = ["We moved your time to ", { time: moved.to }];
	switch (moved.reason.kind) {
		case "break":
			return [
				...lead,
				` — ${ctx.storeName} is closed `,
				{ range: moved.reason.gap },
				".",
			];
		case "before_open":
			return [
				...lead,
				" — ",
				{ time: moved.from },
				` is before ${ctx.storeName} opens that day.`,
			];
		case "after_close":
			return [
				...lead,
				" — ",
				{ time: moved.from },
				` is after ${ctx.storeName} closes that day.`,
			];
		case "passed":
			return [...lead, " — ", { time: moved.from }, " is no longer available."];
	}
}

/**
 * The inputs a date/time refusal judged, as one comparable value. A submit
 * refusal about the day or the time stands only while these are unchanged:
 * the moment the buyer changes the method, the pickup point, the date or the
 * time, "that time won't work" is about a choice no longer on screen, and it
 * used to sit there contradicting a fixed field until the next press.
 */
export function fulfilmentInputsKey(values: {
	deliveryMethod: string;
	fulfilmentDate: string;
	fulfilmentTime: string;
	pickupLocationId: string;
}): string {
	return [
		values.deliveryMethod,
		values.pickupLocationId,
		values.fulfilmentDate,
		values.fulfilmentTime,
	].join("|");
}

export interface TimeRepair {
	/** What the field should now hold ("" clears an impossible prefill). */
	nextHhmm: string;
	/** Set when a real time moved to another real time, which is worth saying. */
	moved: TimeMove | null;
}

/**
 * One tick of the checkout's time repair. `systemHhmm` is the value the system
 * last wrote. When the field no longer holds it, the buyer has taken over and
 * nothing is rewritten. Returns null when there's nothing to do.
 *
 * - A pickable system time is left alone.
 * - A stale system time moves to the next slot AT OR AFTER it (forward), and
 *   falls back to the day's default only when nothing later is left.
 * - A day with no slot at all clears a system time rather than leaving a
 *   promise the day can't keep next to the "closed for today" notice. Once the
 *   buyer picks another day, the empty system value refills itself.
 */
export function planTimeRepair(
	args: TimeContext & { currentHhmm: string; systemHhmm: string },
): TimeRepair | null {
	const {
		hours,
		dayEpoch,
		currentHhmm,
		systemHhmm,
		now = Date.now(),
		prepMinutes = 0,
	} = args;
	if (currentHhmm !== systemHhmm) return null;
	const current = timeMinutesFromHhmm(currentHhmm);
	const hasTime = !Number.isNaN(current);
	if (selectableTimeWindows(hours, dayEpoch, now, prepMinutes).length === 0) {
		return hasTime ? { nextHhmm: "", moved: null } : null;
	}
	if (hasTime && isTimeSelectable(hours, dayEpoch, current, now, prepMinutes)) {
		return null;
	}
	const next =
		(hasTime
			? nextSelectableTime(hours, dayEpoch, current, now, prepMinutes)
			: null) ?? defaultTimeWithinHours(hours, dayEpoch, now, prepMinutes);
	if (next === null) return null;
	return {
		nextHhmm: hhmmFromMinutes(next),
		moved: hasTime
			? {
					from: current,
					to: next,
					reason: moveReason(hours, dayEpoch, current, now, prepMinutes),
				}
			: null,
	};
}
