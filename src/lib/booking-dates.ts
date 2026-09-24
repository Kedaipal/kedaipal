// Pure logic behind the buyer's booking calendar (S2, design 86eym0pjg
// Variant A): MYT-day ⟷ JS-Date conversion for react-day-picker, and the
// two-tap range selection with Airbnb-style checkout-only handling. Kept out
// of the component so the tricky parts (exclusive check-out, the first full
// night being a valid LEAVING morning, conflict ceilings) are unit-tested
// rather than eyeballed.

import {
	countedDays,
	resolveOpenDaysTerm,
} from "../../convex/lib/bookingAvailability";
import {
	addMytCalendarMonths,
	DAY_MS,
	MYT_OFFSET_MS,
} from "../../convex/lib/fulfilmentDate";
import {
	isMonthlyUnit,
	MAX_PACKAGE_DAYS,
	type PackageUnit,
	weekendDaysLabel,
} from "../../convex/lib/productKind";

/** The MYT-midnight epoch for the calendar day a DayPicker `Date` names.
 * DayPicker deals in local-timezone dates; only the y/m/d matter. */
export function mytEpochFromCalendarDate(date: Date): number {
	return (
		Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
		MYT_OFFSET_MS
	);
}

/** The local-timezone `Date` that renders an MYT-midnight epoch's calendar
 * day in DayPicker (inverse of the above). */
export function calendarDateFromMytEpoch(epoch: number): Date {
	const shifted = new Date(epoch + MYT_OFFSET_MS);
	return new Date(
		shifted.getUTCFullYear(),
		shifted.getUTCMonth(),
		shifted.getUTCDate(),
	);
}

/** MYT midnight of the first day of the month containing `epoch`. */
export function mytMonthStart(epoch: number): number {
	const shifted = new Date(epoch + MYT_OFFSET_MS);
	return (
		Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - MYT_OFFSET_MS
	);
}

/** MYT midnight of the first day of the month `offset` months after. */
export function addMytMonths(monthStart: number, offset: number): number {
	const shifted = new Date(monthStart + MYT_OFFSET_MS);
	return (
		Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + offset, 1) -
		MYT_OFFSET_MS
	);
}

export type BookingSelection = {
	checkIn?: number;
	checkOut?: number;
};

export type SelectionContext = {
	/** Nights that cannot take another booking (full — or, from S4, blocked;
	 * never distinguished). MYT midnights. */
	unavailable: ReadonlySet<number>;
	/** Earliest selectable check-in (today + notice), MYT midnight. */
	earliestCheckIn: number;
	/** Latest selectable check-in (horizon), MYT midnight, inclusive. */
	latestCheckIn: number;
	maxNights: number;
	/** Fixed-length package (S7). Set = ONE tap picks the whole stay: the
	 * buyer chooses a start date and the end derives. Unset = the two-tap free
	 * range. Mirrors `products.booking.packageLength`. */
	packageLength?: number;
	/** How that length counts. A CALENDAR month's span depends on which month
	 * it starts in (28–31 days), so the nights a package occupies must be
	 * derived per candidate start rather than assumed fixed. */
	packageUnit?: PackageUnit;
	/** How many packages the buyer is taking ("3 months up front"). Defaults
	 * to 1. It belongs in the SELECTION context because it changes which start
	 * days are offerable at all — a longer term has more nights to clear. */
	packageQuantity?: number;
	/** Open-days package only (`closureRule` "skipped", z8r3fdhpm7): is the
	 * store shut all day? Set = the term counts OPEN days and steps over the
	 * rest (`resolveOpenDaysTerm`, the server's own resolver). Unset = every
	 * day in a row. */
	isClosed?: (day: number) => boolean;
	/** Every package listing: is the store shut all day? A package can't
	 * START on a day it says yes to — the same refusal `resolveBookingRange`
	 * makes — whether the term then counts every day or only open ones. */
	startClosed?: (day: number) => boolean;
};

/**
 * The term a package starting on `day` would run — the one place the client
 * derives it for a SELECTION (it knows about open-days packages; `packageEnd`
 * is the plain every-day arithmetic). `null` when the start can't carry the
 * term at all: an open-days package starting on a shut day, or one whose skips
 * would outrun the scan bound — both refused by the server with words.
 */
export function packageTerm(
	day: number,
	ctx: Pick<
		SelectionContext,
		"packageLength" | "packageUnit" | "packageQuantity" | "isClosed"
	>,
): { checkOut: number; skipped: number[] } | null {
	const length = ctx.packageLength;
	if (length === undefined || length <= 0) return null;
	if (ctx.isClosed) {
		try {
			return resolveOpenDaysTerm(
				day,
				length * Math.max(1, ctx.packageQuantity ?? 1),
				ctx.isClosed,
			);
		} catch {
			return null;
		}
	}
	return {
		checkOut: packageEnd(day, length, ctx.packageUnit, ctx.packageQuantity),
		skipped: [],
	};
}

/** The exclusive end of a package starting on `day` — the one place the
 * client derives it, matching the server's `resolveBookingRange`. */
export function packageEnd(
	day: number,
	length: number,
	unit: PackageUnit = "day",
	quantity = 1,
): number {
	// One step over the WHOLE term, never one package at a time — month
	// clamping compounds (31 Jan stepped 3× lands 28 Apr, one 3-month term
	// lands 30 Apr). Mirrors resolveBookingRange exactly.
	const total = length * Math.max(1, quantity);
	return isMonthlyUnit(unit)
		? addMytCalendarMonths(day, total)
		: day + total * DAY_MS;
}

/**
 * The start dates a BLOCK over [from, to] (both inclusive) takes off sale for
 * a package listing — every start whose term would USE a blocked day, clipped
 * to today. `null` for a free-range listing or when nothing sellable is hit.
 * Judged for ONE package, the shortest term a buyer can take (more packages
 * reach further back, so this is the floor, stated as such).
 *
 * It exists for the block sheet (z8r3fdhpm7): a block refuses a package that
 * covers ANY blocked day, so blocking one Raya day on a monthly membership
 * silently stops a month of sign-ups. The sheet states it and offers a
 * closed date instead, which a package takes in its stride.
 *
 * `schedule` makes the answer the one the buyer calendar gives: a shut day is
 * never a start (`startClosed`), and an open-days listing (`isClosed`) is
 * judged on the days it counts — its term steps over shut days, so a block
 * on one of those stops nothing, and a start further back can still reach a
 * blocked day that an every-day count would have missed.
 *
 * COST: up to ~400 candidate starts, each resolving a term of up to a year.
 * Fine once, when the seller confirms a block range — never call it per cell
 * or per render (the grid has its own occupancy data).
 */
export function packageStartsCoveringRange(
	listing: { packageLength?: number; packageUnit?: PackageUnit },
	from: number,
	to: number,
	today: number,
	schedule: {
		isClosed?: (day: number) => boolean;
		startClosed?: (day: number) => boolean;
	} = {},
): { first: number; last: number } | null {
	const length = listing.packageLength;
	if (length === undefined || length <= 0) return null;
	const ctx = {
		packageLength: length,
		packageUnit: listing.packageUnit,
		isClosed: schedule.isClosed,
	};
	let first: number | null = null;
	let last: number | null = null;
	// Walk BACK from the block's last day. A term's end only moves earlier as
	// its start does (skips included), so the first start whose term ends
	// before `from` ends the scan — bounded by the longest term there is.
	for (
		let start = to;
		start >= from - (MAX_PACKAGE_DAYS + 31) * DAY_MS && start >= today;
		start -= DAY_MS
	) {
		if (schedule.startClosed?.(start)) continue;
		const term = packageTerm(start, ctx);
		if (term === null) continue;
		if (term.checkOut <= from) break;
		const skipped = new Set(term.skipped);
		let usesBlockedDay = false;
		for (
			let day = Math.max(start, from);
			day <= to && day < term.checkOut;
			day += DAY_MS
		) {
			if (!skipped.has(day)) {
				usesBlockedDay = true;
				break;
			}
		}
		if (!usesBlockedDay) continue;
		first = start;
		last ??= start;
	}
	return first === null || last === null ? null : { first, last };
}

/** Can this day START a stay? Its own night must be free and inside the
 * bookable window. */
export function canCheckIn(day: number, ctx: SelectionContext): boolean {
	if (day < ctx.earliestCheckIn || day > ctx.latestCheckIn) return false;
	// A package is all-or-nothing: the buyer can't shorten it around a busy
	// night, so EVERY night it would occupy has to be free before the start
	// day is offered at all (the server re-checks the same span). An open-days
	// package is judged on the days it COUNTS — a skipped day is never used —
	// and can't start on a shut day at all.
	if (ctx.packageLength !== undefined && ctx.packageLength > 0) {
		// No package starts on a day the store is shut (owner call, 24 Sep).
		if (ctx.startClosed?.(day)) return false;
		const term = packageTerm(day, ctx);
		if (term === null) return false;
		const skipped = new Set(term.skipped);
		for (let night = day; night < term.checkOut; night += DAY_MS) {
			if (!skipped.has(night) && ctx.unavailable.has(night)) return false;
		}
		return true;
	}
	return !ctx.unavailable.has(day);
}

/**
 * With a check-in chosen, the latest possible check-out morning: the earlier
 * of (first unavailable night at-or-after check-in — leaving THAT morning is
 * fine, the night itself isn't slept) and the max-stay ceiling. Scanning is
 * bounded by maxNights, so no horizon-length loops.
 */
export function latestCheckOutFor(
	checkIn: number,
	ctx: SelectionContext,
): number {
	const ceiling = checkIn + ctx.maxNights * DAY_MS;
	for (let night = checkIn; night < ceiling; night += DAY_MS) {
		if (ctx.unavailable.has(night)) return night;
	}
	return ceiling;
}

/**
 * The two-tap reducer. Tap semantics (locked Variant A):
 *  - nothing selected (or a full range): a valid check-in day starts fresh;
 *  - check-in selected: a later day within the reachable window completes the
 *    range; the check-in day itself (or any earlier day) RESTARTS from that
 *    day when it can check in — one tap always does something sensible.
 * Returns the same selection when the tap is invalid (the calendar disables
 * those days, so this is belt-and-braces).
 */
export function nextBookingSelection(
	current: BookingSelection,
	day: number,
	ctx: SelectionContext,
): BookingSelection {
	// A fixed-length package is a ONE-tap pick: the start is the only choice,
	// the end derives (S7). Never a partial selection to complete.
	if (ctx.packageLength !== undefined && ctx.packageLength > 0) {
		const term = canCheckIn(day, ctx) ? packageTerm(day, ctx) : null;
		return term ? { checkIn: day, checkOut: term.checkOut } : current;
	}
	const pickingCheckOut =
		current.checkIn !== undefined && current.checkOut === undefined;
	if (
		pickingCheckOut &&
		current.checkIn !== undefined &&
		day > current.checkIn
	) {
		if (day <= latestCheckOutFor(current.checkIn, ctx)) {
			return { checkIn: current.checkIn, checkOut: day };
		}
		return current;
	}
	if (canCheckIn(day, ctx)) {
		return { checkIn: day };
	}
	return current;
}

/** The conflict explainer for a check-in whose forward run is capped by a
 * full night (design's partial-range state). Null when nothing to explain —
 * the full maxNights window is open. */
export function conflictCeiling(
	checkIn: number,
	ctx: SelectionContext,
): { latestCheckOut: number; maxStayNights: number } | null {
	const latest = latestCheckOutFor(checkIn, ctx);
	if (latest >= checkIn + ctx.maxNights * DAY_MS) return null;
	return {
		latestCheckOut: latest,
		maxStayNights: Math.round((latest - checkIn) / DAY_MS),
	};
}

/**
 * What follows a booking listing's price: a fixed-length package is a flat
 * price for the whole span (S7), a free-range stay is per-night. ONE author so
 * the storefront card, the product page and the seller's own price field can't
 * disagree.
 *
 * The span is NAMED rather than called "per package" — a gym's RM100 is "/mo"
 * and a 3D2N deal is "/3 days". "Per package" made the buyer open the listing
 * to find out what they were buying, and made the seller's field read "Price
 * per night" while they typed a monthly membership fee.
 */
export function bookingPriceSuffix(
	packageLength?: number,
	packageUnit: PackageUnit = "day",
): string {
	if (packageLength === undefined || packageLength <= 0) return "/night";
	return packageLength === 1
		? `/${packageUnit}`
		: `/${packageLength} ${packageUnit}s`;
}

/**
 * What follows the WEEKEND rate on a storefront price line — "/night Fri &
 * Sat" — so the card, the product page, the detail sheet and the calendar
 * legend all spell the second rate the same way (S13). Returns null when the
 * listing has no weekend rate, so callers render nothing rather than an
 * empty suffix.
 */
export function weekendRateSuffix(
	booking:
		| { packageLength?: number; weekendPrice?: number; weekendDays?: number[] }
		| undefined,
): string | null {
	if (!booking || booking.weekendPrice === undefined) return null;
	if ((booking.packageLength ?? 0) > 0) return null;
	const days = booking.weekendDays ?? [];
	if (days.length === 0) return null;
	return `/night ${weekendDaysLabel(days)}`;
}

/**
 * The same span as a bare noun phrase ("month", "3 days") — for prose that
 * already supplies its own preposition ("one flat price per month").
 */
export function bookingSpanNoun(
	packageLength?: number,
	packageUnit: PackageUnit = "day",
): string {
	if (packageLength === undefined || packageLength <= 0) return "night";
	return packageLength === 1 ? packageUnit : `${packageLength} ${packageUnit}s`;
}

/**
 * The span WITH its count, always — "1 month", "3 days", "2 nights" — for
 * prose that states the length outright ("the booking runs 3 days from
 * there"). It sits beside bookingSpanNoun, which drops the "1" because it
 * reads as a price suffix ("per month").
 *
 * Both product forms hand-rolled this and both got it wrong: the edit form
 * printed "runs 1 days" and said "days" even on a NIGHT package; the wizard
 * printed "1 month(s)" and "1 days". Same class as "How many 2 dayss?" below —
 * a span formatted anywhere but here drifts.
 */
export function bookingSpanCounted(
	packageLength: number,
	packageUnit: PackageUnit = "day",
): string {
	return `${packageLength} ${packageUnit}${packageLength === 1 ? "" : "s"}`;
}

/**
 * What the stepper asks. Two shapes, because one doesn't read in both cases:
 * a length of ONE is just its unit ("How many months?"), anything longer is a
 * hyphenated adjective on "packages" ("How many 2-night packages?").
 *
 * The naive version — "How many " + bookingSpanNoun() + "s" — produced the
 * reported **"How many 2 dayss?"**: `bookingSpanNoun` already pluralises on
 * the package's LENGTH, and the caller was pluralising again on the buyer's
 * COUNT. Two different axes; only one of them belongs in the noun.
 */
export function packageCountLabel(
	packageLength: number,
	packageUnit: PackageUnit = "day",
): string {
	return packageLength === 1
		? `${packageUnit}s`
		: `${packageLength}-${packageUnit} packages`;
}

/** How many nights a split line names in full before it starts counting the
 * rest. Three fits a sub-line on a phone; a 30-night stay's weekday line would
 * otherwise print twenty-odd dates. */
const MAX_NAMED_NIGHTS = 3;

/**
 * The nights one rate charged for, named (S13) — "Thu 17 Sep",
 * "Fri 18 Sep, Sat 19 Sep", "Thu 17 Sep, Fri 18 Sep +3 more nights".
 *
 * Individual nights, never a range. A weekend rate's nights are frequently
 * NOT contiguous — a Thu→Mon stay charges the weekday rate for the Thursday
 * AND the Sunday — so there is no "17 → 20 Sep" that is true of that line.
 * Naming each night is the only form that stays honest on every stay, and it
 * sidesteps the other trap: a "–" between two nights reads like the
 * check-in → check-out arrow used everywhere else, which would make two
 * nights look like one.
 *
 * `format` is injected so this stays pure and the caller picks the style.
 */
export function describeNights(
	nights: readonly number[],
	format: (epoch: number) => string,
	/** What the overflow counts — nights for a stay's rate lines, days for an
	 * open-days package's skipped days (z8r3fdhpm7). */
	noun: "night" | "day" = "night",
): string {
	if (nights.length === 0) return "";
	if (nights.length <= MAX_NAMED_NIGHTS) return nights.map(format).join(", ");
	const shown = nights
		.slice(0, MAX_NAMED_NIGHTS - 1)
		.map(format)
		.join(", ");
	const rest = nights.length - (MAX_NAMED_NIGHTS - 1);
	return `${shown} +${rest} more ${noun}${rest === 1 ? "" : "s"}`;
}

/**
 * One night, compact — "Thu 17 Sep". The year is deliberately dropped: these
 * sit under a card that already states the stay's full dates, and three
 * "Thu, 17 Sep 2026"s in one sub-line is unreadable. No comma either, because
 * commas separate the nights from each other.
 */
export function formatNight(epoch: number): string {
	const d = new Date(epoch + MYT_OFFSET_MS);
	return `${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = [
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
 * How a placed booking's span reads on an order. A fixed-length package is a
 * validity WINDOW — its last usable day is the night before the exclusive
 * check-out, so "Valid 1 Sep – 30 Sep" (not "– 1 Oct", which would promise a
 * day the buyer doesn't have). A free-range stay keeps check-in → check-out,
 * where the check-out morning IS the day they leave.
 *
 * `format` is injected so this stays pure and the caller supplies its own
 * locale-aware date formatter.
 */
export function describeBookingSpan(
	checkIn: number,
	checkOut: number,
	opts: { isPackage: boolean; format: (epoch: number) => string },
): string {
	return opts.isPackage
		? `Valid ${opts.format(checkIn)} – ${opts.format(checkOut - DAY_MS)}`
		: `${opts.format(checkIn)} → ${opts.format(checkOut)}`;
}

/**
 * "Skips Thu 1 Oct, Sun 4 Oct" — the shut days an open-days package stepped
 * over (z8r3fdhpm7, frozen `orders.bookingSkippedDays`), or "" when none. The
 * one spelling on every order surface, so the receipt, the seller's page and
 * the buyer's page name them alike.
 */
export function describeSkippedDays(
	skipped: readonly number[] | undefined,
): string {
	if (!skipped || skipped.length === 0) return "";
	return `skips ${describeNights(skipped, formatNight, "day")}`;
}

/**
 * How long a placed booking is, counted the way it was sold — "4 open days"
 * for an open-days package (z8r3fdhpm7), "30 days" for any other package,
 * "2 nights" for a stay. `null` without dates.
 *
 * The one author of that count: the track page, the seller's approve card and
 * the order summary each did the span arithmetic themselves, so an open-days
 * package read "4 open days" on the receipt and "7 days" / "7 nights" on the
 * next two screens.
 */
export function bookingLengthLabel(
	order: {
		bookingCheckIn?: number;
		bookingCheckOut?: number;
		bookingPackaged?: boolean;
		bookingSkippedDays?: readonly number[];
	},
	locale: "en" | "ms" = "en",
): string | null {
	const { bookingCheckIn: checkIn, bookingCheckOut: checkOut } = order;
	if (checkIn === undefined || checkOut === undefined) return null;
	const n = countedDays(checkIn, checkOut, order.bookingSkippedDays);
	const plural = n === 1 ? "" : "s";
	if (order.bookingPackaged !== true) {
		return locale === "ms" ? `${n} malam` : `${n} night${plural}`;
	}
	if ((order.bookingSkippedDays ?? []).length > 0) {
		return locale === "ms" ? `${n} hari buka` : `${n} open day${plural}`;
	}
	return locale === "ms" ? `${n} hari` : `${n} day${plural}`;
}

/**
 * Where ONE day sits in a booking, for the seller's day sheet — "arrives
 * today", "night 3 of 7", "leaves tomorrow" for a stay; "starts today",
 * "day 2 of 4", "last day" for a package. A bare range makes the seller do
 * the arithmetic; for an open-days package they couldn't (z8r3fdhpm7): the
 * old span count said "night 3 of 7" on day 2 of a 4-open-day course.
 */
export function bookingDayPosition(
	row: {
		checkIn: number;
		checkOut: number;
		packaged: boolean;
		skippedDays?: readonly number[];
	},
	date: number,
): string {
	if (!row.packaged) {
		if (row.checkIn === date) return "arrives today";
		if (date + DAY_MS >= row.checkOut) return "leaves tomorrow";
		const total = Math.round((row.checkOut - row.checkIn) / DAY_MS);
		const nth = Math.round((date - row.checkIn) / DAY_MS) + 1;
		return `night ${nth} of ${total}`;
	}
	const shut = new Set(row.skippedDays ?? []);
	const days: number[] = [];
	for (let day = row.checkIn; day < row.checkOut; day += DAY_MS) {
		if (!shut.has(day)) days.push(day);
	}
	const index = days.indexOf(date);
	if (index === -1) return "a day it skips";
	if (days.length === 1) return "its only day";
	if (index === 0) return "starts today";
	if (index === days.length - 1) return "last day";
	return `day ${index + 1} of ${days.length}`;
}

/**
 * The seller order page's one-line booking summary. A fixed-length package
 * reads as a validity window in DAYS — OPEN days when it skipped any — and a
 * free-range stay as check-in → check-out in NIGHTS.
 *
 * Moved here from the route (z8r3fdhpm7) because the inline copy read
 * `bookingPackageDays`, the field S7 renamed to `bookingPackaged`: nothing
 * complained (it was typed optional), so every package order's summary said
 * "30 nights · 1 Sep → 1 Oct". Pure and tested now.
 */
export function bookingFulfilmentLine(
	order: {
		bookingCheckIn?: number;
		bookingCheckOut?: number;
		bookingPackaged?: boolean;
		bookingSkippedDays?: readonly number[];
	},
	format: (epoch: number) => string,
): string {
	const { bookingCheckIn: checkIn, bookingCheckOut: checkOut } = order;
	const count = bookingLengthLabel(order);
	if (checkIn === undefined || checkOut === undefined || count === null) {
		return "Booking";
	}
	const isPackage = order.bookingPackaged === true;
	const parts = [
		"Booking",
		count,
		describeBookingSpan(checkIn, checkOut, { isPackage, format }),
	];
	const skips = describeSkippedDays(order.bookingSkippedDays);
	if (skips) parts.push(skips);
	return parts.join(" · ");
}
