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
 * v1 limits (each a follow-up if a real seller asks): one range per day, no
 * overnight wrap (a mamak open 6 PM – 2 AM), no holiday/exception dates.
 *
 * No Convex imports — pure functions shared by the server gate
 * (orders.create, retailers.updateSettings) and the client (checkout date/
 * time UI, settings editor, storefront header), the fulfilmentDate.ts way.
 */

import {
	MINUTES_PER_DAY,
	MYT_OFFSET_MS,
	formatFulfilmentTime,
	hhmmFromMinutes,
	minSelectableTimeMinutes,
	mytMinutesOfDay,
	todayMytMidnight,
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

/** Weekday index (0 = Sunday) of a MYT-anchored epoch — the same shift +
 * `getUTCDay()` read `formatFulfilmentDate` uses. */
export function weekdayIndexMyt(epoch: number): number {
	return new Date(epoch + MYT_OFFSET_MS).getUTCDay();
}

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

/** Whether a day's window is the full 24 hours. */
export function isAllDay(day: DayHours): boolean {
	return day.open === 0 && day.close === MAX_CLOSE_MINUTES;
}

/** "9:00 AM – 6:00 PM", or "Open 24 hours" for a full day. */
export function formatDayWindow(day: DayHours): string {
	if (isAllDay(day)) return "Open 24 hours";
	return `${formatFulfilmentTime(day.open)} – ${formatFulfilmentTime(day.close)}`;
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
	const days: OpeningHours = input.map((day, i) => {
		if (
			!Number.isInteger(day.open) ||
			!Number.isInteger(day.close) ||
			day.open < 0 ||
			day.close > MAX_CLOSE_MINUTES ||
			day.open >= day.close
		) {
			throw new Error(
				`${WEEKDAY_NAMES[i]}: opening time must be before closing time (closing at latest 11:59 PM)`,
			);
		}
		// One spelling per day: drop a false/undefined `closed` flag entirely.
		return day.closed
			? { open: day.open, close: day.close, closed: true }
			: { open: day.open, close: day.close };
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
 * Rejects a closed day for every method; checks the time window only when a
 * time exists (delivery — pickup orders are date-only, their point's own
 * schedule note carries the detail). Throws plain Errors, caller wraps.
 * Mirrored client-side pre-submit so the buyer sees the same words inline.
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
	if (timeMinutes < day.open || timeMinutes > day.close) {
		throw new Error(
			`The store is open ${formatDayWindow(day)} that day — pick a time inside those hours`,
		);
	}
}

/**
 * The window a buyer may actually PICK for a delivery time on a chosen day:
 * the day's opening window floored by the checkout lead
 * (minSelectableTimeMinutes — "not in the next 15 minutes" when the day is
 * today). `null` = no pickable slot: the day is closed, or it's today and the
 * store has already closed (or midnight is too near). With hours unset this
 * degrades to exactly the pre-hours behaviour: floor..23:59, null only in the
 * last minutes before midnight.
 */
export function selectableTimeWindow(
	hours: OpeningHours | undefined,
	dateEpoch: number,
	now: number = Date.now(),
): { min: number; max: number } | null {
	const day = hoursForDate(hours, dateEpoch);
	if (day === null) return null;
	const min = Math.max(day.open, minSelectableTimeMinutes(dateEpoch, now));
	if (min > day.close) return null;
	return { min, max: day.close };
}

/**
 * Prefill for the time input, hours-aware: the plain default (today → the
 * floor / future day → 10:00 AM) clamped into the day's pickable window — a
 * dinner stall opening 5 PM prefills a future day at 5:00 PM, a breakfast
 * stall closing 9 AM prefills 9:00 AM. Null when the day has no pickable slot
 * at all (caller moves the buyer to another day).
 */
export function defaultTimeWithinHours(
	hours: OpeningHours | undefined,
	dateEpoch: number,
	now: number = Date.now(),
): number | null {
	const window = selectableTimeWindow(hours, dateEpoch, now);
	if (window === null) return null;
	const plain =
		dateEpoch === todayMytMidnight(now) ? window.min : 10 * 60;
	return Math.min(Math.max(plain, window.min), window.max);
}

/**
 * Live status for the storefront header line. `open` carries today's closing
 * time; `closed` carries the next opening (0 = later today, 1 = tomorrow, …)
 * — `nextOpen` is null only for a schedule with no open day, which the
 * sanitizer forbids (defensive for hand-edited data).
 */
export type OpenNowStatus =
	| { open: true; day: DayHours }
	| {
			open: false;
			nextOpen: { daysAhead: number; openMinutes: number } | null;
	  };

/**
 * schema.org `openingHoursSpecification` rows for the storefront's Store
 * JSON-LD — open days only, 24h "HH:MM" strings (the schema.org format).
 * Local-SEO icing on the same single source of truth.
 */
export function openingHoursSpecification(
	hours: OpeningHours,
): Array<Record<string, string>> {
	return hours.flatMap((day, i) =>
		day.closed
			? []
			: [
					{
						"@type": "OpeningHoursSpecification",
						dayOfWeek: WEEKDAY_NAMES[i],
						opens: hhmmFromMinutes(day.open),
						closes: hhmmFromMinutes(day.close),
					},
				],
	);
}

export function openNowStatus(
	hours: OpeningHours,
	now: number = Date.now(),
): OpenNowStatus {
	const today = todayMytMidnight(now);
	const nowMinutes = mytMinutesOfDay(now);
	const todayHours = hoursForDate(hours, today);
	if (
		todayHours !== null &&
		nowMinutes >= todayHours.open &&
		nowMinutes <= todayHours.close
	) {
		return { open: true, day: todayHours };
	}
	// Still before today's opening? That's the soonest reopening.
	if (todayHours !== null && nowMinutes < todayHours.open) {
		return {
			open: false,
			nextOpen: { daysAhead: 0, openMinutes: todayHours.open },
		};
	}
	const DAY_MS = MINUTES_PER_DAY * 60 * 1000;
	for (let ahead = 1; ahead <= DAYS_PER_WEEK; ahead++) {
		const day = hoursForDate(hours, today + ahead * DAY_MS);
		if (day !== null) {
			return { open: false, nextOpen: { daysAhead: ahead, openMinutes: day.open } };
		}
	}
	return { open: false, nextOpen: null };
}
