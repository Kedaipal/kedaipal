/**
 * Store opening hours (86eyp5rav) — the seller's weekly schedule, and the rule
 * that a buyer's fulfilment moment must fall inside it. Born from a real
 * order: a buyer picked a 3:00 AM delivery two days out, because nothing told
 * checkout when the store can actually operate.
 *
 * Shape: 7 entries indexed by weekday, 0 = Sunday .. 6 = Saturday — the same
 * `getUTCDay()` index `formatFulfilmentDate` reads off a MYT-shifted date, so
 * the two can never disagree about which day a fulfilment date lands on. Each
 * day is open `[open, close]` in minutes since MYT midnight (both boundaries
 * inclusive — delivering AT closing time is fine, the freeAbove posture), or
 * `closed: true`. `close` caps at 23:59 (1439), not 24:00: the native
 * `<input type="time">` cannot express "24:00", and fulfilment times are
 * already `< 1440` — so "open 24 hours" is spelled `{ open: 0, close: 1439 }`
 * and there is no midnight special case anywhere.
 *
 * `undefined` hours = open 24/7 — every pre-existing store, zero migration.
 * An explicitly-saved all-24h week normalizes back to `undefined` so "no
 * constraint" has exactly one spelling (the minOrderValue 0→unset posture).
 *
 * The hours constrain ONLY the fulfilment date/time a buyer may pick at
 * storefront checkout (and what the storefront header displays). Browsing and
 * placing orders stay 24/7, and counter checkout is exempt — the seller is
 * standing there (the min-notice posture). Deliberately NO hidden "first slot
 * one hour after open / last slot one hour before close" buffer: a hidden
 * offset makes the displayed hours lie ("you open at 9 — why can't I pick
 * 9?"), and prep headroom already has explicit levers (min notice, the
 * checkout lead floor, or simply tighter hours).
 *
 * PREP FLOOR: every selectable-time helper takes an optional trailing
 * `prepMinutes` and hands it to `minSelectableTimeMinutes` — the cart's
 * slowest item raising the checkout lead (z8r3fdff97). It is threaded rather
 * than applied by the caller so there is ONE answer to "the earliest moment a
 * buyer may pick"; defaults to 0, so a caller that doesn't care is unchanged.
 *
 * SPLIT DAYS (z8r3fdff8r): a day may carry a SECOND window — a cafe open
 * 7:30–10:00 for breakfast then 12:00–18:00, a kitchen that shuts between
 * lunch and dinner. Stored as an optional `open2`/`close2` pair beside the
 * first window: an optional widening, so every existing row stays byte-
 * identical and there is no migration. Nothing outside this file reads those
 * fields — every consumer goes through `dayWindows(day)`, which hands back
 * the day's windows as a list. That is the whole extensibility story: a third
 * window later is a schema widen plus one line in `dayWindows`, not a branch
 * in eight functions.
 *
 * CLOSED DATES (z8r3fdhpm7): the weekly schedule's exceptions — Hari Raya, a
 * balik-kampung week — live in `closedDates.ts` and are stored beside the
 * hours on the retailer. `isStoreClosedOn` is the one combined question ("is
 * the store shut all day on this date?"), and `openNowStatus` reads both, so
 * the header never says "Open now" on a closed date.
 *
 * v1 limits (each a follow-up if a real seller asks): at most two windows per
 * day, no overnight wrap (a mamak open 6 PM – 2 AM).
 *
 * No Convex imports — pure functions shared by the server gate
 * (orders.create, retailers.updateSettings) and the client (checkout date/
 * time UI, settings editor, storefront header), the fulfilmentDate.ts way.
 */

import { type ClosedDateRange, closureOn, upcomingClosures } from "./closedDates";
import {
	DAY_MS,
	MINUTES_PER_DAY,
	formatFulfilmentTime,
	hhmmFromMinutes,
	minSelectableTimeMinutes,
	mytMinutesOfDay,
	todayMytMidnight,
	weekdayIndexMyt,
	ymdFromEpoch,
} from "./fulfilmentDate";

export interface DayHours {
	/** Minutes since MYT midnight the store opens (0..1438). */
	open: number;
	/** Minutes since MYT midnight the store closes (1..1439), > open. Inclusive:
	 * a fulfilment moment AT closing time is allowed. */
	close: number;
	/** Shut all day. `open`/`close` keep their last values so re-opening a day
	 * in settings restores them instead of resetting to a default. */
	closed?: boolean;
	/** Optional SECOND window's opening minute (z8r3fdff8r) — the lunch/dinner
	 * split. Strictly after `close`, so the two windows never touch and the
	 * shut stretch between them is a real gap buyers are kept out of. Set as a
	 * PAIR with `close2`; the sanitizer drops a half pair rather than guessing.
	 * Read it through `dayWindows`, never directly. */
	open2?: number;
	/** Optional second window's closing minute — `> open2`, `≤ 1439`. */
	close2?: number;
}

/** One open stretch within a day, in minutes since MYT midnight. Both bounds
 * inclusive (the freeAbove posture: delivering AT closing time is fine). */
export interface DayWindow {
	open: number;
	close: number;
}

/** 7 entries indexed by weekday, 0 = Sunday .. 6 = Saturday. */
export type OpeningHours = DayHours[];

export const DAYS_PER_WEEK = 7;
/** Latest expressible closing time — 23:59. See the header comment for why
 * this is 1439 and not 1440. */
export const MAX_CLOSE_MINUTES = MINUTES_PER_DAY - 1;
/** One day, fully open — the meaning of an unset schedule, day by day. */
export const OPEN_ALL_DAY: DayHours = { open: 0, close: MAX_CLOSE_MINUTES };

/** Full weekday names, index-aligned with the schedule (0 = Sunday). Used in
 * error copy ("closed on Sundays") and the settings/storefront day lists. */
export const WEEKDAY_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];
/** Short forms for tight rows ("Mon 9:00 AM – 6:00 PM"). */
export const WEEKDAY_NAMES_SHORT = [
	"Sun",
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat",
];


/**
 * The day's window for a fulfilment date, resolving the default: unset hours
 * → fully open; a closed day → null.
 */
export function hoursForDate(
	hours: OpeningHours | undefined,
	dateEpoch: number,
): DayHours | null {
	if (hours === undefined) return OPEN_ALL_DAY;
	const day = hours[weekdayIndexMyt(dateEpoch)];
	// A malformed row (wrong length) fails open rather than blocking checkout —
	// the sanitizer guarantees 7 entries, so this is a defensive default only.
	if (!day) return OPEN_ALL_DAY;
	return day.closed ? null : day;
}

/** Whether the store opens at all on the date's weekday. */
export function isOpenOnDate(
	hours: OpeningHours | undefined,
	dateEpoch: number,
): boolean {
	return hoursForDate(hours, dateEpoch) !== null;
}

/** The weekdays the store never opens (0 = Sunday), ascending. Empty for a
 * 24/7 store — the one fact about the weekly schedule an open-days package
 * needs, so it is what a buyer surface is sent (z8r3fdhpm7). */
export function closedWeekdays(hours: OpeningHours | undefined): number[] {
	if (!hours) return [];
	return hours.flatMap((day, i) => (day.closed ? [i] : []));
}

/**
 * "Is the store shut all day?" as a predicate, built from the two facts a
 * buyer surface is actually sent — the weekly days off and the closed dates.
 * The server builds it from the SAME two facts (`closedWeekdays` of its stored
 * hours), so an open-days package term resolves identically on both sides.
 */
export function storeClosedOn(
	weekdaysOff: readonly number[],
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
): (dateEpoch: number) => boolean {
	const off = new Set(weekdaysOff);
	return (dateEpoch) =>
		off.has(weekdayIndexMyt(dateEpoch)) ||
		closureOn(closedDates, dateEpoch) !== null;
}

/**
 * Is the store shut ALL DAY on this date — its weekly day off, or one of its
 * closed dates (z8r3fdhpm7)? The one combined question, so a surface that
 * cares about "can anything happen that day" never checks only half of it.
 */
export function isStoreClosedOn(
	hours: OpeningHours | undefined,
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
	dateEpoch: number,
): boolean {
	return (
		hoursForDate(hours, dateEpoch) === null ||
		closureOn(closedDates, dateEpoch) !== null
	);
}

/** Whether a day's window is the full 24 hours. The all-day spelling is
 * always a SINGLE window — the sanitizer refuses a second one beside it — so
 * this stays a one-window question. */
export function isAllDay(day: DayHours): boolean {
	return day.open === 0 && day.close === MAX_CLOSE_MINUTES;
}

/**
 * A day's open stretches, earliest first — THE accessor. Every consumer
 * (gate, checkout, header, JSON-LD, settings summary) iterates this instead of
 * reading `open2`/`close2`, so adding a third window later touches this
 * function and the sanitizer, and nothing else.
 *
 * A half pair (one of `open2`/`close2` set, from hand-edited data) is ignored
 * rather than guessed at — the sanitizer already drops it on the way in.
 */
export function dayWindows(day: DayHours): DayWindow[] {
	const windows: DayWindow[] = [{ open: day.open, close: day.close }];
	if (day.open2 !== undefined && day.close2 !== undefined) {
		windows.push({ open: day.open2, close: day.close2 });
	}
	return windows;
}

/** Whether the day is split (a lunch/dinner break sits inside it). */
export function hasSecondWindow(day: DayHours): boolean {
	return day.open2 !== undefined && day.close2 !== undefined;
}

/**
 * The SHUT stretches between a day's windows — what the buyer must be kept
 * out of, in the words they're told ("closed 10:00 AM – 12:00 PM"). Bounds are
 * the neighbouring windows' own close/open: both are open moments, so the gap
 * is read as exclusive, which is exactly how a human reads "closed 10–12".
 */
export function dayGaps(day: DayHours): DayWindow[] {
	const windows = dayWindows(day);
	return windows
		.slice(0, -1)
		.map((window, i) => ({ open: window.close, close: windows[i + 1].open }));
}

/** Whether a moment falls inside one of the day's open windows. */
export function isWithinDay(day: DayHours, timeMinutes: number): boolean {
	return dayWindows(day).some(
		(window) => timeMinutes >= window.open && timeMinutes <= window.close,
	);
}

/** The gap a moment falls into, or null when it doesn't sit between two
 * windows (before opening, after closing, or inside an open stretch). */
export function gapForTime(
	day: DayHours,
	timeMinutes: number,
): DayWindow | null {
	return (
		dayGaps(day).find(
			(gap) => timeMinutes > gap.open && timeMinutes < gap.close,
		) ?? null
	);
}

/** "9:00 AM – 6:00 PM", "7:30 AM – 10:00 AM, 12:00 PM – 6:00 PM" for a split
 * day, or "Open 24 hours" for a full one. */
export function formatDayWindow(day: DayHours): string {
	if (isAllDay(day)) return "Open 24 hours";
	return dayWindows(day)
		.map(
			(window) =>
				`${formatFulfilmentTime(window.open)} – ${formatFulfilmentTime(window.close)}`,
		)
		.join(", ");
}

/** What is wrong with a day's windows, and WHICH window it is about. The
 * window lets the settings editor mark only the offending pickers and put the
 * sentence under them. Painting all four red when only the second window's
 * start is wrong points the seller at controls that are fine. */
export interface DayHoursIssue {
	/** Seller-facing sentence, lower-case start so callers can prefix the
	 * weekday ("Monday: …") or capitalise it when standing alone. */
	message: string;
	window: "first" | "second";
}

/**
 * THE rule-set for one day's windows. Shared by the settings editor (inline,
 * per keystroke) and `sanitizeOpeningHours` (at save), so the client can never
 * disagree with the server about what is allowed or say it in different words.
 *
 * Each rule gets its own sentence rather than one catch-all. "Opening time must
 * be before closing time (closing at latest 11:59 PM)" made every seller read a
 * cap the picker cannot even exceed, so the cap now speaks only when it is the
 * actual problem (an API caller sending 24:00).
 */
export function dayHoursIssue(day: DayHours): DayHoursIssue | null {
	// On a split day "opening time" is ambiguous — the second window's rules
	// name their window, so the first window's must too. An unsplit day keeps
	// the wording it always had.
	const split = hasSecondWindow(day);
	if (
		!Number.isInteger(day.open) ||
		!Number.isInteger(day.close) ||
		day.open < 0 ||
		day.open >= day.close
	) {
		return {
			message: split
				? "the first window's opening time must be before its closing time"
				: "opening time must be before closing time",
			window: "first",
		};
	}
	if (day.close > MAX_CLOSE_MINUTES) {
		return {
			message: split
				? "the first window can close at 11:59 PM at the latest"
				: "closing time can be 11:59 PM at the latest",
			window: "first",
		};
	}
	if (!split) return null;
	// Non-null within this branch — restated for the type system.
	const open2 = day.open2 as number;
	const close2 = day.close2 as number;
	if (isAllDay(day)) {
		// About the SECOND window: its existence is the conflict, and removing
		// it is the fix the sentence asks for.
		return {
			message:
				"the first window already covers the whole day — remove the second window",
			window: "second",
		};
	}
	if (!Number.isInteger(open2) || !Number.isInteger(close2) || open2 >= close2) {
		return {
			message:
				"the second window's opening time must be before its closing time",
			window: "second",
		};
	}
	if (close2 > MAX_CLOSE_MINUTES) {
		return {
			message: "the second window can close at 11:59 PM at the latest",
			window: "second",
		};
	}
	if (open2 <= day.close) {
		return {
			message: `the second window must start after ${formatFulfilmentTime(day.close)}`,
			window: "second",
		};
	}
	return null;
}

/** The sentence alone, for callers that only need to know *whether* the day is
 * valid and what to say (`sanitizeOpeningHours`). */
export function dayHoursError(day: DayHours): string | null {
	return dayHoursIssue(day)?.message ?? null;
}

/**
 * Validate + normalize a submitted schedule. `null` (the explicit clear) and
 * an all-24h week both come back as `undefined` — open-24/7 has one spelling.
 * Throws a plain Error on bad input (callers in Convex wrap in ConvexError,
 * the assertValidFulfilmentDate posture).
 */
export function sanitizeOpeningHours(
	input: OpeningHours | null,
): OpeningHours | undefined {
	if (input === null) return undefined;
	if (!Array.isArray(input) || input.length !== DAYS_PER_WEEK) {
		throw new Error("Opening hours must cover all 7 days of the week");
	}
	const days: OpeningHours = input.map((raw, i) => {
		// A half pair is DROPPED, not guessed at: one spelling for "no second
		// window", so a client that clears only one picker can't persist a
		// window nothing can read.
		const day: DayHours =
			raw.open2 !== undefined && raw.close2 !== undefined
				? raw
				: { open: raw.open, close: raw.close, closed: raw.closed };
		const error = dayHoursError(day);
		if (error) throw new Error(`${WEEKDAY_NAMES[i]}: ${error}`);
		// One spelling per day: drop a false/undefined `closed` flag entirely,
		// and never persist an absent second window as explicit undefined.
		return {
			open: day.open,
			close: day.close,
			...(day.closed ? { closed: true as const } : {}),
			...(hasSecondWindow(day) ? { open2: day.open2, close2: day.close2 } : {}),
		};
	});
	if (days.every((day) => day.closed)) {
		// The working-method-invariant posture: a store closed every day of the
		// week could never take a storefront order at all.
		throw new Error(
			"Keep at least one day open — buyers need a day they can pick at checkout",
		);
	}
	if (days.every((day) => !day.closed && isAllDay(day))) return undefined;
	return days;
}

/**
 * The authoritative gate: does the fulfilment moment fall inside the hours?
 * Rejects a closed day for every method; checks the time windows only when a
 * time exists — a delivery, or (z8r3fdff97) a self-collect order at the
 * seller's own pickup point. A drop-off meet-up stays date-only: its own
 * schedule note carries the detail. A moment that lands in a SPLIT day's
 * break is named as such ("closed 10:00 AM – 12:00 PM"), because "open
 * 7:30 AM – 10:00 AM, 12:00 PM – 6:00 PM" alone makes the buyer work out why
 * 11:00 was refused. Throws plain Errors, caller wraps. Mirrored client-side
 * pre-submit so the buyer sees the same words inline.
 */
export function assertWithinOpeningHours(
	hours: OpeningHours | undefined,
	dateEpoch: number,
	timeMinutes: number | undefined,
): void {
	const day = hoursForDate(hours, dateEpoch);
	if (day === null) {
		throw new Error(
			`The store is closed on ${WEEKDAY_NAMES[weekdayIndexMyt(dateEpoch)]}s — pick another day`,
		);
	}
	if (timeMinutes === undefined || isAllDay(day)) return;
	if (isWithinDay(day, timeMinutes)) return;
	const gap = gapForTime(day, timeMinutes);
	if (gap) {
		throw new Error(
			`The store is closed ${formatFulfilmentTime(gap.open)} – ${formatFulfilmentTime(gap.close)} that day — pick a time in an open window`,
		);
	}
	throw new Error(
		`The store is open ${formatDayWindow(day)} that day — pick a time inside those hours`,
	);
}

/**
 * Every stretch a buyer may actually PICK for a delivery time on a chosen
 * day: the day's open windows floored by the checkout lead
 * (minSelectableTimeMinutes — "not in the next 15 minutes" when the day is
 * today), with any window the floor has already swallowed dropped. Empty =
 * no pickable slot: the day is closed, or it's today and the store has
 * finished for the day (or midnight is too near).
 */
export function selectableTimeWindows(
	hours: OpeningHours | undefined,
	dateEpoch: number,
	now: number = Date.now(),
	prepMinutes = 0,
): DayWindow[] {
	const day = hoursForDate(hours, dateEpoch);
	if (day === null) return [];
	const floor = minSelectableTimeMinutes(dateEpoch, now, prepMinutes);
	return dayWindows(day)
		.map((window) => ({
			open: Math.max(window.open, floor),
			close: window.close,
		}))
		.filter((window) => window.open <= window.close);
}

/**
 * The OUTER BOUNDS of the pickable stretches — what a native
 * `<input type="time">` can express, since its min/max is one range. On a
 * split day the break falls inside these bounds: the input stops the buyer
 * wandering outside the day, and the gap check (`isTimeSelectable`) stops
 * them landing in the break. `null` = nothing pickable that day. With hours
 * unset this degrades to exactly the pre-hours behaviour: floor..23:59, null
 * only in the last minutes before midnight.
 */
export function selectableTimeWindow(
	hours: OpeningHours | undefined,
	dateEpoch: number,
	now: number = Date.now(),
	prepMinutes = 0,
): { min: number; max: number } | null {
	const windows = selectableTimeWindows(hours, dateEpoch, now, prepMinutes);
	if (windows.length === 0) return null;
	return { min: windows[0].open, max: windows[windows.length - 1].close };
}

/** Whether a specific moment is pickable on that day — inside an open window
 * AND past the checkout lead floor. The gap-aware replacement for a
 * `min <= t <= max` test against the hull. */
export function isTimeSelectable(
	hours: OpeningHours | undefined,
	dateEpoch: number,
	timeMinutes: number,
	now: number = Date.now(),
	prepMinutes = 0,
): boolean {
	return selectableTimeWindows(hours, dateEpoch, now, prepMinutes).some(
		(window) => timeMinutes >= window.open && timeMinutes <= window.close,
	);
}

/**
 * The first pickable moment AT OR AFTER `fromMinutes`, or null when nothing on
 * that day is left after it. Used to repair a prefilled time that has gone
 * stale, because a repair must move the buyer's slot FORWARD. Jumping a stale
 * 7:30 PM back to 5:15 PM, just because 5:15 is the day's first slot, books a
 * rider earlier than anyone asked for.
 */
export function nextSelectableTime(
	hours: OpeningHours | undefined,
	dateEpoch: number,
	fromMinutes: number,
	now: number = Date.now(),
	prepMinutes = 0,
): number | null {
	for (const window of selectableTimeWindows(hours, dateEpoch, now, prepMinutes)) {
		const candidate = Math.max(window.open, fromMinutes);
		if (candidate <= window.close) return candidate;
	}
	return null;
}

/**
 * Prefill for the time input, hours-aware: the plain default (today → the
 * floor / future day → 10:00 AM) moved into the FIRST pickable window that can
 * still host it — a dinner stall opening 5 PM prefills a future day at
 * 5:00 PM, a breakfast stall closing 9 AM prefills 9:00 AM, and a cafe split
 * 7:30–10:00 / 12:00–18:00 prefills 12:00 PM once 10:00 has passed rather than
 * dropping the buyer in the break. Null when the day has no pickable slot at
 * all (caller moves the buyer to another day).
 */
export function defaultTimeWithinHours(
	hours: OpeningHours | undefined,
	dateEpoch: number,
	now: number = Date.now(),
	prepMinutes = 0,
): number | null {
	const windows = selectableTimeWindows(hours, dateEpoch, now, prepMinutes);
	if (windows.length === 0) return null;
	const plain = dateEpoch === todayMytMidnight(now) ? windows[0].open : 10 * 60;
	for (const window of windows) {
		if (plain <= window.close) return Math.max(plain, window.open);
	}
	// Past every window's close — the last pickable moment of the day.
	return windows[windows.length - 1].close;
}

/**
 * Live status for the storefront header line. `open` carries the close of the
 * window the store is in RIGHT NOW (not the day's last close — a split day is
 * about to shut for lunch, and "closes 6:00 PM" would be a lie); `closed`
 * carries the next opening, which on a split day may be later TODAY
 * (daysAhead 0). `nextOpen` is null only for a schedule with no open day,
 * which the sanitizer forbids (defensive for hand-edited data).
 *
 * `closure` (z8r3fdhpm7) is set when TODAY is one of the store's closed dates
 * — the header then says why ("Closed today · Hari Raya") instead of implying
 * the weekly schedule shut it, and `nextOpen` skips every closed date too, so
 * "opens tomorrow" is never said about the second day of a three-day closure.
 * `allDay` marks a next opening on a 24-hour day, where "opens 12:00 AM"
 * would be true but useless — the header says "reopens" instead.
 */
export type OpenNowStatus =
	| { open: true; day: DayHours; until: number }
	| {
			open: false;
			closure?: ClosedDateRange;
			nextOpen: {
				daysAhead: number;
				openMinutes: number;
				allDay: boolean;
			} | null;
	  };

/**
 * schema.org `openingHoursSpecification` rows for the storefront's Store
 * JSON-LD — open days only, one row per WINDOW (schema.org's own way to
 * express a lunch break), 24h "HH:MM" strings. Local-SEO icing on the same
 * single source of truth.
 */
export function openingHoursSpecification(
	hours: OpeningHours,
): Array<Record<string, string>> {
	return hours.flatMap((day, i) =>
		day.closed
			? []
			: dayWindows(day).map((window) => ({
					"@type": "OpeningHoursSpecification",
					dayOfWeek: WEEKDAY_NAMES[i],
					opens: hhmmFromMinutes(window.open),
					closes: hhmmFromMinutes(window.close),
				})),
	);
}

/**
 * schema.org `specialOpeningHoursSpecification` rows for the store's upcoming
 * closed dates (z8r3fdhpm7) — schema.org spells "closed all day" as a row
 * whose `opens` and `closes` are both 00:00, bounded by `validFrom` /
 * `validThrough` (ISO dates, inclusive). Google reads these as holiday hours.
 */
export function closedDatesSpecification(
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
	now: number = Date.now(),
): Array<Record<string, string>> {
	return upcomingClosures(closedDates, now).map((range) => ({
		"@type": "OpeningHoursSpecification",
		opens: "00:00",
		closes: "00:00",
		validFrom: ymdFromEpoch(range.startDate),
		validThrough: ymdFromEpoch(range.endDate),
	}));
}

/**
 * How far `openNowStatus` looks for the next opening. A week covers every
 * weekly schedule (the sanitizer forbids an all-closed one); the closed-date
 * ceiling on top covers the longest single closure plus a week after it.
 */
const NEXT_OPEN_HORIZON_DAYS = 366 + DAYS_PER_WEEK;

export function openNowStatus(
	hours: OpeningHours | undefined,
	now: number = Date.now(),
	closedDates?: ReadonlyArray<ClosedDateRange>,
): OpenNowStatus {
	const today = todayMytMidnight(now);
	const nowMinutes = mytMinutesOfDay(now);
	const closure = closureOn(closedDates, today) ?? undefined;
	const todayHours = closure ? null : hoursForDate(hours, today);
	if (todayHours !== null) {
		const current = dayWindows(todayHours).find(
			(window) => nowMinutes >= window.open && nowMinutes <= window.close,
		);
		if (current) {
			return { open: true, day: todayHours, until: current.close };
		}
		// Still before one of today's openings? The soonest is the next one —
		// on a split day that's the post-lunch reopening, hours away, not
		// tomorrow.
		const next = dayWindows(todayHours).find(
			(window) => nowMinutes < window.open,
		);
		if (next) {
			return {
				open: false,
				nextOpen: { daysAhead: 0, openMinutes: next.open, allDay: false },
			};
		}
	}
	for (let ahead = 1; ahead <= NEXT_OPEN_HORIZON_DAYS; ahead++) {
		const date = today + ahead * DAY_MS;
		if (closureOn(closedDates, date)) continue;
		const day = hoursForDate(hours, date);
		if (day !== null) {
			return {
				open: false,
				...(closure ? { closure } : {}),
				nextOpen: {
					daysAhead: ahead,
					openMinutes: day.open,
					allDay: isAllDay(day),
				},
			};
		}
	}
	return { open: false, ...(closure ? { closure } : {}), nextOpen: null };
}
