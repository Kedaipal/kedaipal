/**
 * Pure helpers for the checkout fulfilment date — the buyer's answer to
 * "When do you need this? (delivery or pickup date)". Kills the "bila nak?"
 * follow-up the seller would otherwise send in WhatsApp.
 *
 * All Kedaipal retailers operate in Malaysia (UTC+8, no DST), so a calendar day
 * is anchored to a fixed +08:00 offset: `fulfilmentDate` is stored as the
 * epoch-ms of that day's MIDNIGHT in Malaysia time (MYT). This is drift-free
 * without a tz database and round-trips cleanly between the native
 * `<input type="date">` "YYYY-MM-DD" value and storage.
 *
 * No Convex imports — pure functions unit-tested in isolation and imported by
 * both the backend (validation, WhatsApp/email copy) and the frontend
 * (storefront + counter checkout + dashboard display), the same way
 * `paymentMethod.ts` is shared.
 */

/** Malaysia is UTC+8 year-round (no daylight saving). */
export const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Hard ceiling on how far ahead a buyer can schedule (v1, hardcoded). */
export const MAX_NOTICE_DAYS = 30;
/**
 * Minimum days' notice when a retailer hasn't configured one. Defaults to 0
 * (same-day allowed) — most F&B sellers also take walk-in / same-day orders, and
 * a seller who needs lead time sets it explicitly in Settings → Fulfilment.
 */
export const DEFAULT_MIN_NOTICE_DAYS = 0;

/**
 * Epoch-ms of MYT midnight for a "YYYY-MM-DD" string. Returns NaN when the
 * string is malformed or names a non-existent day (e.g. "2026-02-31"), so
 * callers can reject in one check.
 */
export function mytMidnightFromYmd(ymd: string): number {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
	if (!m) return Number.NaN;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	const utc = Date.UTC(y, mo - 1, d);
	// Reject calendar overflow: Date.UTC rolls "2026-02-31" into March, so
	// round-trip and require the components to survive unchanged.
	const back = new Date(utc);
	if (
		back.getUTCFullYear() !== y ||
		back.getUTCMonth() !== mo - 1 ||
		back.getUTCDate() !== d
	) {
		return Number.NaN;
	}
	return utc - MYT_OFFSET_MS;
}

/** "YYYY-MM-DD" (MYT calendar day) for an epoch-ms value — drives input value. */
export function ymdFromEpoch(epoch: number): string {
	const d = new Date(epoch + MYT_OFFSET_MS);
	const y = d.getUTCFullYear();
	const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
	const da = String(d.getUTCDate()).padStart(2, "0");
	return `${y}-${mo}-${da}`;
}

/** MYT midnight (epoch-ms) for the calendar day containing `now`. */
export function todayMytMidnight(now: number = Date.now()): number {
	return Math.floor((now + MYT_OFFSET_MS) / DAY_MS) * DAY_MS - MYT_OFFSET_MS;
}

/** True iff `epoch` lands exactly on a MYT midnight (a whole calendar day). */
export function isMytMidnight(epoch: number): boolean {
	return Number.isInteger(epoch) && (epoch + MYT_OFFSET_MS) % DAY_MS === 0;
}

/**
 * Normalise a retailer's configured minimum-notice setting into a usable
 * integer in [0, MAX_NOTICE_DAYS]. Undefined → the default. 0 is allowed so
 * ready-stock sellers (frozen meals, kuih) can offer same-day fulfilment.
 */
export function clampMinNoticeDays(days: number | undefined): number {
	if (days === undefined || !Number.isFinite(days)) {
		return DEFAULT_MIN_NOTICE_DAYS;
	}
	const i = Math.trunc(days);
	if (i < 0) return 0;
	if (i > MAX_NOTICE_DAYS) return MAX_NOTICE_DAYS;
	return i;
}

/**
 * Selectable MYT-midnight bounds for a retailer's notice setting. `min` =
 * today + notice days; `max` = today + 30 days. Both are MYT midnights, so they
 * feed straight into the `<input type="date" min max>` via `ymdFromEpoch`.
 */
export function fulfilmentDateBounds(
	minNoticeDays: number | undefined,
	now: number = Date.now(),
): { min: number; max: number } {
	const today = todayMytMidnight(now);
	const min = today + clampMinNoticeDays(minNoticeDays) * DAY_MS;
	const max = today + MAX_NOTICE_DAYS * DAY_MS;
	return { min, max };
}

/**
 * Validate a stored/submitted fulfilment date. Throws a plain Error (callers in
 * Convex wrap it in ConvexError, matching assertValidAddress). Returns the
 * value unchanged on success so it reads as a parse step.
 */
export function assertValidFulfilmentDate(
	epoch: number,
	minNoticeDays: number | undefined,
	now: number = Date.now(),
): number {
	if (!isMytMidnight(epoch)) {
		throw new Error("Fulfilment date must be a whole calendar day");
	}
	const { min, max } = fulfilmentDateBounds(minNoticeDays, now);
	if (epoch < min) {
		throw new Error("Fulfilment date is too soon — pick a later day");
	}
	if (epoch > max) {
		throw new Error("Fulfilment date can be at most 30 days from today");
	}
	return epoch;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/**
 * Human label for a fulfilment date, e.g. "Sat, 28 Jun 2026". Pass
 * `{ weekday: false }` for "28 Jun 2026". Rendered in the WhatsApp message, the
 * email, the dashboard, and the tracking page.
 */
export function formatFulfilmentDate(
	epoch: number,
	opts: { weekday?: boolean } = {},
): string {
	const d = new Date(epoch + MYT_OFFSET_MS);
	const day = d.getUTCDate();
	const mon = MONTHS[d.getUTCMonth()];
	const year = d.getUTCFullYear();
	if (opts.weekday === false) return `${day} ${mon} ${year}`;
	return `${WEEKDAYS[d.getUTCDay()]}, ${day} ${mon} ${year}`;
}

/**
 * Short relative label for the dashboard ("Today", "Tomorrow", "Overdue") or
 * null when the date is far enough out that the absolute date carries it. Lets
 * order cards lead with urgency.
 */
export function relativeFulfilmentLabel(
	epoch: number,
	now: number = Date.now(),
): "Overdue" | "Today" | "Tomorrow" | null {
	const diff = Math.round((epoch - todayMytMidnight(now)) / DAY_MS);
	if (diff < 0) return "Overdue";
	if (diff === 0) return "Today";
	if (diff === 1) return "Tomorrow";
	return null;
}

/** The inbox date-chip windows. */
export type FulfilmentWindow = "today" | "tomorrow" | "this_week";

/**
 * Whether a fulfilment date falls inside an inbox chip's window. "this_week"
 * is inclusive of today/tomorrow and spans the next 7 days, so the chip behaves
 * like a buyer would expect ("everything due soon"), not a Mon–Sun calendar
 * week. Dateless orders never match (caller passes undefined → false upstream).
 */
export function matchesFulfilmentWindow(
	epoch: number,
	window: FulfilmentWindow,
	now: number = Date.now(),
): boolean {
	const diff = Math.round((epoch - todayMytMidnight(now)) / DAY_MS);
	switch (window) {
		case "today":
			return diff === 0;
		case "tomorrow":
			return diff === 1;
		case "this_week":
			return diff >= 0 && diff <= 7;
	}
}

// ---------------------------------------------------------------------------
// Fulfilment TIME (86eyg0n8e follow-up) — the buyer's answer to "what time?".
//
// Stored SEPARATELY from `fulfilmentDate` as minutes since MYT midnight
// (`orders.fulfilmentTimeMinutes`, 0..1439). The date field keeps its
// whole-day invariant — `assertValidFulfilmentDate` rejects non-midnights,
// and the inbox sort, due-today counts, urgency badges and window chips all
// compare midnights — so a time-of-day must never be folded into it. Minutes
// compose with the day (`composeFulfilmentMoment`) and cannot drift from it.
// Legacy orders, counter orders and self-collect orders simply have no time.
// ---------------------------------------------------------------------------

export const MINUTES_PER_DAY = 24 * 60;
const MINUTE_MS = 60 * 1000;

/**
 * How far ahead the earliest selectable time sits (minutes).
 *
 * MEASURED against the Lalamove MY sandbox (4 Aug 2026, devProbeScheduleAt):
 * their ONLY rule is "not in the past, not more than 30 days ahead" —
 * `scheduleAt` at +1 min quotes fine, +0 min and anything earlier is refused
 * with `ERR_INVALID_FIELD` ("Date cannot be a past date or more than 30 days
 * in advance"), and overnight slots (02:00, 03:00) quote normally, so there
 * are no operating hours to model.
 *
 * So this 15 is OURS, not theirs: enough of a buffer that a submit can't race
 * the clock into their past-date refusal, and enough that "arrive at X" is
 * physically plausible for a rider. It is deliberately SMALL — the earlier
 * 30-minute floor drifted past the prefilled time while a buyer filled the
 * form, and the browser then blocked submit with its own native message.
 * Shared with the dispatch decision (MIN_SCHEDULE_LEAD_MS) so the time a
 * buyer may pick and the time we will schedule can never disagree.
 */
export const EARLIEST_FULFILMENT_LEAD_MINUTES = 15;

/** Minutes since MYT midnight for an arbitrary instant. */
export function mytMinutesOfDay(now: number = Date.now()): number {
	return Math.floor(((now + MYT_OFFSET_MS) % DAY_MS) / MINUTE_MS);
}

/** Validate a stored/submitted time-of-day. Range-only on purpose: whether
 * the moment is still ahead is judged where it matters (checkout submit
 * client-side; dispatch books "now" for past moments) — a strict server
 * "must be in the future" here would let clock skew or a long-idle form
 * reject a legitimate checkout. */
export function assertValidFulfilmentTime(minutes: number): number {
	if (
		!Number.isInteger(minutes) ||
		minutes < 0 ||
		minutes >= MINUTES_PER_DAY
	) {
		throw new Error("Fulfilment time must be a time of day");
	}
	return minutes;
}

/** The exact instant the buyer asked for: the day's MYT midnight + minutes. */
export function composeFulfilmentMoment(
	dateEpoch: number,
	timeMinutes: number,
): number {
	return dateEpoch + timeMinutes * MINUTE_MS;
}

/**
 * Prefill for the checkout time input. Today → the next 30-minute mark at
 * least an hour out (2:12 PM → 3:30 PM) so a rider slot is realistic;
 * clamped to 23:30 late at night. A future day → 10:00 AM (a "now"-derived
 * clock time would be meaningless there — ordering at 11 PM must not
 * default tomorrow to 11 PM).
 */
export function defaultFulfilmentTimeMinutes(
	dateEpoch: number,
	now: number = Date.now(),
): number {
	if (dateEpoch !== todayMytMidnight(now)) return 10 * 60;
	// An hour out, rounded to a neat half-hour — but NEVER below the floor,
	// which is what makes the prefilled value always submittable. The hour
	// (rather than the floor itself) is deliberate breathing room: a value
	// sitting exactly on the floor would go stale within minutes of the buyer
	// starting to type.
	const floor = minSelectableTimeMinutes(dateEpoch, now);
	// The day has run out of bookable slots (see hasSelectableTimeToday) —
	// nothing valid exists to return, so hand back the last time of day and
	// let the caller push the buyer to tomorrow.
	if (floor >= MINUTES_PER_DAY) return MINUTES_PER_DAY - 5;
	const target = Math.max(mytMinutesOfDay(now) + 60, floor);
	// Clamped to 23:55 rather than spilling into tomorrow, and floored so a
	// late-evening order can still pick the last valid slot instead of being
	// handed an already-impossible 23:30.
	return Math.max(
		floor,
		Math.min(Math.ceil(target / 30) * 30, MINUTES_PER_DAY - 5),
	);
}

/**
 * Earliest selectable time for a chosen day: 30 minutes from now (rounded up
 * to 5) when the day is today, else free. Drives the `<input type="time">`
 * floor + the submit check; near midnight the floor can exceed the day —
 * `hasSelectableTimeToday` tells the form to push the buyer to tomorrow.
 */
export function minSelectableTimeMinutes(
	dateEpoch: number,
	now: number = Date.now(),
): number {
	if (dateEpoch !== todayMytMidnight(now)) return 0;
	return (
		Math.ceil(
			(mytMinutesOfDay(now) + EARLIEST_FULFILMENT_LEAD_MINUTES) / 5,
		) * 5
	);
}

/** False only in the last half-hour before midnight, when "today" has no
 * bookable slot left. */
export function hasSelectableTimeToday(now: number = Date.now()): boolean {
	return minSelectableTimeMinutes(todayMytMidnight(now), now) < MINUTES_PER_DAY;
}

/** "HH:MM" (the native time-input value) → minutes since midnight, or NaN. */
export function timeMinutesFromHhmm(hhmm: string): number {
	const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
	if (!m) return Number.NaN;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return Number.NaN;
	return h * 60 + min;
}

/** Minutes since midnight → "HH:MM" for the native time input. */
export function hhmmFromMinutes(minutes: number): string {
	const h = String(Math.floor(minutes / 60)).padStart(2, "0");
	const m = String(minutes % 60).padStart(2, "0");
	return `${h}:${m}`;
}

/** Human label, 12-hour MY convention: 930 → "3:30 PM", 0 → "12:00 AM". */
export function formatFulfilmentTime(minutes: number): string {
	const h24 = Math.floor(minutes / 60);
	const m = minutes % 60;
	const suffix = h24 < 12 ? "AM" : "PM";
	const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
	return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Date + optional time on one line: "Tue, 4 Aug 2026 · 3:30 PM". The single
 * formatter every surface uses (WhatsApp, email, tracking, order page), so a
 * time can never appear in two spellings.
 */
export function formatFulfilmentDateTime(
	epoch: number,
	timeMinutes: number | undefined,
	opts: { weekday?: boolean } = {},
): string {
	const date = formatFulfilmentDate(epoch, opts);
	if (timeMinutes === undefined) return date;
	return `${date} · ${formatFulfilmentTime(timeMinutes)}`;
}
