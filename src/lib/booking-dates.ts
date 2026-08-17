// Pure logic behind the buyer's booking calendar (S2, design 86eym0pjg
// Variant A): MYT-day ⟷ JS-Date conversion for react-day-picker, and the
// two-tap range selection with Airbnb-style checkout-only handling. Kept out
// of the component so the tricky parts (exclusive check-out, the first full
// night being a valid LEAVING morning, conflict ceilings) are unit-tested
// rather than eyeballed.

import { DAY_MS, MYT_OFFSET_MS } from "../../convex/lib/fulfilmentDate";

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
		Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) -
		MYT_OFFSET_MS
	);
}

/** MYT midnight of the first day of the month `offset` months after. */
export function addMytMonths(monthStart: number, offset: number): number {
	const shifted = new Date(monthStart + MYT_OFFSET_MS);
	return (
		Date.UTC(
			shifted.getUTCFullYear(),
			shifted.getUTCMonth() + offset,
			1,
		) - MYT_OFFSET_MS
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
};

/** Can this day START a stay? Its own night must be free and inside the
 * bookable window. */
export function canCheckIn(day: number, ctx: SelectionContext): boolean {
	return (
		day >= ctx.earliestCheckIn &&
		day <= ctx.latestCheckIn &&
		!ctx.unavailable.has(day)
	);
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
	const pickingCheckOut =
		current.checkIn !== undefined && current.checkOut === undefined;
	if (pickingCheckOut && current.checkIn !== undefined && day > current.checkIn) {
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
