/**
 * Store closed dates (ClickUp `z8r3fdhpm7`) — the specific days a store is
 * shut on top of its weekly schedule: Hari Raya, balik kampung, a renovation.
 * Opening hours only know weekdays, and deferred these twice on purpose (v1 and
 * S13), so until now a cake seller going home for Raya had no way to stop
 * buyers picking Raya day except pausing the whole store.
 *
 * Shape: `retailers.closedDates`, a short list of `{ startDate, endDate,
 * label? }`. Both dates are MYT midnights and `endDate` is INCLUSIVE — a closed
 * day has no leaving morning, the `bookingBlocks.endDate` posture (contrast
 * `bookingCheckOut`, which is exclusive because a guest leaves that morning).
 * The label is PUBLIC: buyers read it at checkout and in the storefront header
 * ("closed Thu, 1 Oct 2026 (Hari Raya)"), and the settings field says so.
 *
 * The list is bounded (`MAX_CLOSED_RANGES`) and self-pruning: every write drops
 * the ranges that have already ended, so a store that closes for Raya every
 * year never accumulates history on its retailer document. Reads never filter
 * by the clock — `closureOn` is date-specific, so an ended range is inert.
 *
 * Overlapping ranges are legal and unioned at read, the block-days rule:
 * merging on write would make "remove this closure" ambiguous.
 *
 * Why the seller declares them rather than Kedaipal shipping a public-holiday
 * calendar: holidays differ by state, Raya depends on moon sighting, cuti
 * peristiwa arrives at short notice — and whether a business closes on a
 * holiday is its own call (a campsite's busiest nights ARE the holidays). A
 * wrong automatic skip would silently move the end of something a buyer paid
 * for. A "pre-fill my state's holidays" shortcut can sit on top of this later;
 * it must never become the logic.
 *
 * No Convex imports — pure functions shared by the server gates and the
 * client, the fulfilmentDate.ts way. The combined "is the store closed that
 * day?" question (weekly day off OR a closed date) lives in openingHours.ts as
 * `isStoreClosedOn`, since it needs the weekly schedule too.
 */

import {
	DAY_MS,
	formatFulfilmentDate,
	isMytMidnight,
	MYT_OFFSET_MS,
	todayMytMidnight,
} from "./fulfilmentDate";

export interface ClosedDateRange {
	/** First closed day, MYT midnight. */
	startDate: number;
	/** Last closed day, MYT midnight, INCLUSIVE (a single day: start === end). */
	endDate: number;
	/** Why — shown to buyers. Trimmed, ≤ MAX_CLOSED_LABEL_CHARS, unset when blank. */
	label?: string;
}

/** How many ranges one store may hold at once. Ended ranges are pruned on
 * every write, so this counts UPCOMING closures — fifty is years of Raya,
 * CNY and school-holiday breaks, and keeps the retailer document small. */
export const MAX_CLOSED_RANGES = 50;
/** Longest single range — a season-long renovation. Matches the booking
 * block's `MAX_BLOCK_DAYS`, the other "the store is shut for a stretch" row. */
export const MAX_CLOSED_RANGE_DAYS = 366;
/** Room for "Hari Raya Aidilfitri" or "Balik kampung — back 7 Apr". */
export const MAX_CLOSED_LABEL_CHARS = 60;

/** Days a range covers, inclusive of both ends. */
export function closedRangeDays(range: ClosedDateRange): number {
	return Math.round((range.endDate - range.startDate) / DAY_MS) + 1;
}

/** Trim + collapse whitespace; blank → undefined. Throws on an over-long one. */
export function sanitizeClosedLabel(
	label: string | undefined,
): string | undefined {
	const clean = label?.replace(/\s+/g, " ").trim();
	if (!clean) return undefined;
	if (clean.length > MAX_CLOSED_LABEL_CHARS) {
		throw new Error(
			`Keep the reason under ${MAX_CLOSED_LABEL_CHARS} characters`,
		);
	}
	return clean;
}

/**
 * Validate a range a seller is ADDING. Throws a plain Error with seller-facing
 * copy (callers in Convex wrap it in ConvexError). A range may start today —
 * "we're shut today" is the most urgent closure there is — but not before.
 */
export function sanitizeClosedDateRange(
	input: ClosedDateRange,
	now: number = Date.now(),
): ClosedDateRange {
	if (!isMytMidnight(input.startDate) || !isMytMidnight(input.endDate)) {
		throw new Error("Closed dates must be calendar days");
	}
	if (input.endDate < input.startDate) {
		throw new Error("The last closed day can't be before the first");
	}
	if (input.startDate < todayMytMidnight(now)) {
		throw new Error("That date has already passed — pick today or later");
	}
	const range = {
		startDate: input.startDate,
		endDate: input.endDate,
	};
	if (closedRangeDays(range) > MAX_CLOSED_RANGE_DAYS) {
		throw new Error(
			`Close at most ${MAX_CLOSED_RANGE_DAYS} days at a time — add a second range for a longer break`,
		);
	}
	const label = sanitizeClosedLabel(input.label);
	return label ? { ...range, label } : range;
}

/** Earliest first, then the shorter range — a stable reading order. */
function byStart(a: ClosedDateRange, b: ClosedDateRange): number {
	return a.startDate - b.startDate || a.endDate - b.endDate;
}

/**
 * The closures that have not ended yet, earliest first. What every list a
 * human reads shows (settings, the storefront's schedule dialog) and what a
 * write keeps.
 */
export function upcomingClosures(
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
	now: number = Date.now(),
): ClosedDateRange[] {
	if (!closedDates) return [];
	const today = todayMytMidnight(now);
	return closedDates.filter((range) => range.endDate >= today).sort(byStart);
}

/**
 * The closure covering `date`, or null. With overlapping ranges the LABELLED
 * one wins, so a buyer reads the reason rather than a bare date — then the
 * earliest start, so the answer is stable.
 */
export function closureOn(
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
	date: number,
): ClosedDateRange | null {
	if (!closedDates || closedDates.length === 0) return null;
	let best: ClosedDateRange | null = null;
	for (const range of closedDates) {
		if (date < range.startDate || date > range.endDate) continue;
		if (
			best === null ||
			(range.label !== undefined && best.label === undefined) ||
			(Boolean(range.label) === Boolean(best.label) &&
				byStart(range, best) < 0)
		) {
			best = range;
		}
	}
	return best;
}

/** Is `date` inside any closed range? */
export function isClosedDate(
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
	date: number,
): boolean {
	return closureOn(closedDates, date) !== null;
}

/** Same two ranges? Identity for remove — a range has no id of its own. */
export function sameClosedRange(
	a: Pick<ClosedDateRange, "startDate" | "endDate">,
	b: Pick<ClosedDateRange, "startDate" | "endDate">,
): boolean {
	return a.startDate === b.startDate && a.endDate === b.endDate;
}

/**
 * "Thu, 1 Oct 2026", or "Thu, 1 Oct – Sat, 3 Oct 2026" for a range (the year
 * once when both ends share it). The one spelling every surface uses — the
 * checkout refusal, the header, the settings list.
 */
export function formatClosedRange(
	range: Pick<ClosedDateRange, "startDate" | "endDate">,
): string {
	if (range.startDate === range.endDate) {
		return formatFulfilmentDate(range.startDate);
	}
	const sameYear =
		new Date(range.startDate + MYT_OFFSET_MS).getUTCFullYear() ===
		new Date(range.endDate + MYT_OFFSET_MS).getUTCFullYear();
	return `${formatFulfilmentDate(range.startDate, { year: !sameYear })} – ${formatFulfilmentDate(range.endDate)}`;
}

/**
 * The compact form for a one-line heads-up where the full spelling wraps on a
 * phone: "Thu 1 Oct", "1–3 Oct", "30 Sep – 2 Oct". No year — it only ever
 * describes a closure starting within days (`closureHeadsUp`).
 */
export function formatClosedRangeShort(
	range: Pick<ClosedDateRange, "startDate" | "endDate">,
): string {
	const start = new Date(range.startDate + MYT_OFFSET_MS);
	const end = new Date(range.endDate + MYT_OFFSET_MS);
	const month = (d: Date) => SHORT_MONTHS[d.getUTCMonth()];
	if (range.startDate === range.endDate) {
		return `${SHORT_WEEKDAYS[start.getUTCDay()]} ${start.getUTCDate()} ${month(start)}`;
	}
	if (start.getUTCMonth() === end.getUTCMonth()) {
		return `${start.getUTCDate()}–${end.getUTCDate()} ${month(end)}`;
	}
	return `${start.getUTCDate()} ${month(start)} – ${end.getUTCDate()} ${month(end)}`;
}

const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = [
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

/** How far ahead the storefront header warns about a closure. Two weeks is
 * the pre-order horizon a buyer is plausibly choosing a date inside. */
export const CLOSURE_HEADS_UP_DAYS = 14;

/**
 * The closure a buyer should hear about in the storefront header BEFORE it
 * starts: the soonest one beginning after today and within
 * `CLOSURE_HEADS_UP_DAYS`. A closure covering today is the open-now line's
 * to say (`openNowStatus`), so it is not repeated here.
 */
export function closureHeadsUp(
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
	now: number = Date.now(),
): ClosedDateRange | null {
	const today = todayMytMidnight(now);
	const horizon = today + CLOSURE_HEADS_UP_DAYS * DAY_MS;
	return (
		upcomingClosures(closedDates, now).find(
			(range) => range.startDate > today && range.startDate <= horizon,
		) ?? null
	);
}

/**
 * The closures that overlap [from, toExclusive), each CLIPPED to it — "which
 * closed days fall inside this package term / this month on screen". Earliest
 * first; the label rides along so the reason can be named.
 */
export function closuresWithin(
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
	from: number,
	toExclusive: number,
): ClosedDateRange[] {
	if (!closedDates) return [];
	const last = toExclusive - DAY_MS;
	return closedDates
		.filter((range) => range.startDate <= last && range.endDate >= from)
		.map((range) => ({
			...range,
			startDate: Math.max(range.startDate, from),
			endDate: Math.min(range.endDate, last),
		}))
		.sort(byStart);
}

/** Every closed day in [from, toExclusive), as MYT midnights, ascending. */
export function closedDaysBetween(
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
	from: number,
	toExclusive: number,
): number[] {
	const days: number[] = [];
	if (!closedDates || closedDates.length === 0) return days;
	for (let day = from; day < toExclusive; day += DAY_MS) {
		if (closureOn(closedDates, day)) days.push(day);
	}
	return days;
}

/** "Thu, 1 Oct 2026 (Hari Raya)" — the range and, when given, why. */
export function describeClosure(range: ClosedDateRange): string {
	const when = formatClosedRange(range);
	return range.label ? `${when} (${range.label})` : when;
}

/**
 * The refusal when a buyer's fulfilment date falls on a closed date — ONE
 * sentence for the server gate (`orders.create`, `orderClaims.commit`) and the
 * checkout's inline notice, so a stale tab and a live one read alike. Names
 * the whole range, because "closed on the 1st" leaves the buyer guessing
 * whether the 2nd works. No closing period: the server error has none, and a
 * page adds its own.
 */
export function closedDateMessage(
	range: ClosedDateRange,
	storeName = "The store",
): string {
	return `${storeName} is closed ${describeClosure(range)} — pick another day`;
}

/**
 * The server-side gate: the refusal for a fulfilment date that falls on a
 * closed date, or null. Judged BEFORE prep and hours, because a closed date is
 * the truest reason — "the cake needs 2 hours" on a day the shop is shut
 * would send the buyer to the wrong fix.
 */
export function closedDateIssue(
	closedDates: ReadonlyArray<ClosedDateRange> | undefined,
	date: number,
): string | null {
	const closure = closureOn(closedDates, date);
	return closure ? closedDateMessage(closure) : null;
}
