/**
 * How the EasyParcel dispatch card chooses among 20-odd couriers
 * (z8r3fdcje2 /test-code F9, F11, F13). Pure, so the rules are tested apart
 * from the card that draws them.
 *
 * The /test-code run that prompted this: a delivery order to a Toa Payoh flat
 * pre-selected "Park N Parcel (From Point to Point)" — the cheapest, and one
 * that leaves the parcel at a locker for a buyer who asked for delivery. The
 * cheapest is what a seller accepts without reading, so the pre-selection
 * has to be the cheapest service that KEEPS the order's promise.
 */

import type { EasyparcelRate } from "../../convex/lib/easyparcel";
import { DAY_MS, todayMytMidnight } from "../../convex/lib/fulfilmentDate";

/** Can this service get the parcel there by the buyer's date, if the seller
 * books today? "late" = even its fastest day misses; "maybe_late" = its slow
 * end does. Undefined when either side is unknown — no date or no transit is
 * no claim. Transit is read as calendar days from today, which is generous
 * to the courier (collection may be tomorrow), so "maybe" stays a maybe. */
export function rateDateFit(
	rate: Pick<EasyparcelRate, "transit">,
	fulfilmentDate: number | undefined,
	now: number = Date.now(),
): "late" | "maybe_late" | undefined {
	if (fulfilmentDate === undefined || !rate.transit) return undefined;
	const daysLeft = Math.round(
		(fulfilmentDate - todayMytMidnight(now)) / DAY_MS,
	);
	if (rate.transit.minDays > daysLeft) return "late";
	if (rate.transit.maxDays > daysLeft) return "maybe_late";
	return undefined;
}

/** A rate that keeps the order's promise: reaches the buyer's door, takes a
 * single parcel, and can make the buyer's date. */
function keepsPromise(
	rate: EasyparcelRate,
	fulfilmentDate: number | undefined,
	now: number,
): boolean {
	return (
		rate.deliversTo !== "point" &&
		rate.minParcels === undefined &&
		rateDateFit(rate, fulfilmentDate, now) === undefined
	);
}

/**
 * The pre-selected rate: the cheapest that keeps every promise, else the
 * cheapest that at least reaches the door with one parcel, else the
 * cheapest. Rates arrive price-sorted.
 */
export function defaultRateId(
	rates: EasyparcelRate[],
	fulfilmentDate: number | undefined,
	now: number = Date.now(),
): string | null {
	return (
		rates.find((r) => keepsPromise(r, fulfilmentDate, now))?.serviceId ??
		rates.find((r) => r.deliversTo !== "point" && r.minParcels === undefined)
			?.serviceId ??
		rates[0]?.serviceId ??
		null
	);
}

export type RateFilter = "door" | "point";

/** The two receiving modes present in this quote, with counts — the filter
 * renders only when a quote holds both (otherwise there is nothing to pick). */
export function rateFilterCounts(rates: EasyparcelRate[]): {
	door: number;
	point: number;
} {
	return {
		door: rates.filter((r) => r.deliversTo !== "point").length,
		point: rates.filter((r) => r.deliversTo === "point").length,
	};
}

export function filterRates(
	rates: EasyparcelRate[],
	filter: RateFilter,
): EasyparcelRate[] {
	return rates.filter((r) =>
		filter === "point" ? r.deliversTo === "point" : r.deliversTo !== "point",
	);
}

/** How many rows show before "Show all" — the cheap end of a 27-row quote is
 * where the decision is; the rest is one tap away. */
export const RATES_SHOWN_FIRST = 6;
