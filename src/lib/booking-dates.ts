// Pure logic behind the buyer's booking calendar (S2, design 86eym0pjg
// Variant A): MYT-day ⟷ JS-Date conversion for react-day-picker, and the
// two-tap range selection with Airbnb-style checkout-only handling. Kept out
// of the component so the tricky parts (exclusive check-out, the first full
// night being a valid LEAVING morning, conflict ceilings) are unit-tested
// rather than eyeballed.

import {
	addMytCalendarMonths,
	DAY_MS,
	MYT_OFFSET_MS,
} from "../../convex/lib/fulfilmentDate";
import {
	isMonthlyUnit,
	type PackageUnit,
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
};

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

/** Every night a stay starting on `day` would occupy, for a fixed-length
 * package. Derived from the real end, so a month package covers exactly the
 * days that month has. */
export function packageNights(
	day: number,
	length: number,
	unit: PackageUnit = "day",
	quantity = 1,
): number[] {
	const nights: number[] = [];
	for (let n = day; n < packageEnd(day, length, unit, quantity); n += DAY_MS) {
		nights.push(n);
	}
	return nights;
}

/** Can this day START a stay? Its own night must be free and inside the
 * bookable window. */
export function canCheckIn(day: number, ctx: SelectionContext): boolean {
	if (day < ctx.earliestCheckIn || day > ctx.latestCheckIn) return false;
	// A package is all-or-nothing: the buyer can't shorten it around a busy
	// night, so EVERY night it would occupy has to be free before the start
	// day is offered at all (the server re-checks the same span).
	if (ctx.packageLength !== undefined && ctx.packageLength > 0) {
		return !packageNights(
			day,
			ctx.packageLength,
			ctx.packageUnit,
			ctx.packageQuantity,
		).some((night) => ctx.unavailable.has(night));
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
		return canCheckIn(day, ctx)
			? {
					checkIn: day,
					checkOut: packageEnd(
						day,
						ctx.packageLength,
						ctx.packageUnit,
						ctx.packageQuantity,
					),
				}
			: current;
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
 * The same span as a bare noun phrase ("month", "3 days") — for prose that
 * already supplies its own preposition ("one flat price per month").
 */
export function bookingSpanNoun(
	packageLength?: number,
	packageUnit: PackageUnit = "day",
): string {
	if (packageLength === undefined || packageLength <= 0) return "night";
	return packageLength === 1
		? packageUnit
		: `${packageLength} ${packageUnit}s`;
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
