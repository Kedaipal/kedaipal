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
/** Minimum days' notice when a retailer hasn't configured one. */
export const DEFAULT_MIN_NOTICE_DAYS = 1;

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
