// The ONE availability authority for the booking kind (86eyj70z1 decision 8's
// evaluation rule, minOrderRules one-module precedent): `bookings.requestBooking`
// (the authoritative gate), the public calendar query and — from S4 — the
// seller month view all read THIS module, so checkout and the calendars can
// never disagree about whether a night is free.
//
// Model: a stay occupies the NIGHTS [checkIn, checkOut) — checkOut is the
// morning the guest leaves, so it is exclusive: a 25→27 stay uses nights 25 +
// 26, and the 27th is open for someone else's check-in. All dates are
// MYT-midnight epoch-ms (fulfilmentDate's invariant; MY is UTC+8, no DST, so
// day arithmetic is plain 24 h steps).
//
// Capacity holders: every booking order that is not cancelled — including
// `booking_requested` (the soft hold, spec decision 3: a second buyer must not
// grab the same nights while the seller decides). Declined and expired
// requests become `cancelled`, which releases the hold by definition.
//
// Blocks (S4) join `isNightAvailable` here so blocked and full stay one
// question with one answer.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DAY_MS, isMytMidnight, todayMytMidnight } from "./fulfilmentDate";

/** How far ahead a check-in may be requested (~6 months — the design's month
 * nav cap; mirrors the 30-day fulfilment-date posture at booking scale). */
export const BOOKING_HORIZON_DAYS = 180;

/** Longest single stay. Also the capacity scan's look-back bound: a booking
 * whose check-in is more than this before a window can't overlap it. */
export const MAX_BOOKING_NIGHTS = 30;

/** How long a request soft-holds capacity before the cron releases it
 * (Airbnb norm; buyer copy promises "confirms within 24 hours"). */
export const BOOKING_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/** Widest availability window one query may ask for (a 2-month calendar
 * paint + slack) — bounds the public query's work per call. */
export const MAX_AVAILABILITY_WINDOW_DAYS = 92;

export function nightsBetween(checkIn: number, checkOut: number): number {
	return Math.round((checkOut - checkIn) / DAY_MS);
}

/** Every night [checkIn, checkOut) as MYT midnights. */
export function eachNight(checkIn: number, checkOut: number): number[] {
	const nights: number[] = [];
	for (let night = checkIn; night < checkOut; night += DAY_MS) {
		nights.push(night);
	}
	return nights;
}

/** Does a stay occupy any night inside [from, to)? Pure interval overlap. */
export function staysOverlap(
	checkIn: number,
	checkOut: number,
	from: number,
	to: number,
): boolean {
	return checkIn < to && checkOut > from;
}

/** A booking order still occupying its nights. `cancelled` is the ONLY
 * release — decline and expiry both land there. */
export function holdsCapacity(status: Doc<"orders">["status"]): boolean {
	return status !== "cancelled";
}

/**
 * Validate a requested range: MYT midnights, at least 1 night, at most
 * MAX_BOOKING_NIGHTS, check-in inside [today + notice, today + horizon].
 * Throws with buyer-facing copy — callers surface it verbatim.
 */
export function assertValidBookingRange(
	checkIn: number,
	checkOut: number,
	opts: { noticeDays: number; now?: number },
): void {
	if (!isMytMidnight(checkIn) || !isMytMidnight(checkOut)) {
		throw new Error("Booking dates must be calendar days");
	}
	const nights = nightsBetween(checkIn, checkOut);
	if (nights < 1) {
		throw new Error("Check-out must be after check-in");
	}
	if (nights > MAX_BOOKING_NIGHTS) {
		throw new Error(
			`Stays are limited to ${MAX_BOOKING_NIGHTS} nights — split a longer stay into two requests`,
		);
	}
	const today = todayMytMidnight(opts.now);
	const earliest = today + opts.noticeDays * DAY_MS;
	if (checkIn < earliest) {
		throw new Error(
			opts.noticeDays > 0
				? `This listing needs ${opts.noticeDays} day${opts.noticeDays === 1 ? "" : "s"}' notice — pick a later check-in`
				: "Check-in can't be in the past",
		);
	}
	if (checkIn > today + BOOKING_HORIZON_DAYS * DAY_MS) {
		throw new Error(
			"That's further ahead than this store takes bookings — pick an earlier check-in",
		);
	}
}

/**
 * Booked count per night of [from, to) for one listing. Indexed range read on
 * `by_booking_product`: check-ins from `from − MAX_BOOKING_NIGHTS` (anything
 * earlier can't reach the window) up to `to`, overlap + status filtered in
 * memory — bounded by the max stay length, never the table.
 */
export async function countBookedPerNight(
	ctx: QueryCtx | MutationCtx,
	productId: Id<"products">,
	from: number,
	to: number,
): Promise<Map<number, number>> {
	const counts = new Map<number, number>();
	const scanFrom = from - MAX_BOOKING_NIGHTS * DAY_MS;
	const holders = await ctx.db
		.query("orders")
		.withIndex("by_booking_product", (q) =>
			q
				.eq("bookingProductId", productId)
				.gte("bookingCheckIn", scanFrom)
				.lt("bookingCheckIn", to),
		)
		.collect();
	for (const order of holders) {
		if (!holdsCapacity(order.status)) continue;
		const checkIn = order.bookingCheckIn;
		const checkOut = order.bookingCheckOut;
		if (checkIn === undefined || checkOut === undefined) continue;
		if (!staysOverlap(checkIn, checkOut, from, to)) continue;
		for (
			let night = Math.max(checkIn, from);
			night < Math.min(checkOut, to);
			night += DAY_MS
		) {
			counts.set(night, (counts.get(night) ?? 0) + 1);
		}
	}
	return counts;
}

/**
 * The nights of [checkIn, checkOut) that are already at capacity for this
 * listing — empty array = the whole stay fits. The authoritative check
 * `requestBooking` runs inside its transaction (Convex serializes mutations,
 * so two buyers racing for the last spot can't both pass).
 */
export async function findFullNights(
	ctx: QueryCtx | MutationCtx,
	product: Pick<Doc<"products">, "_id" | "booking">,
	checkIn: number,
	checkOut: number,
): Promise<number[]> {
	const capacity = product.booking?.capacityPerNight ?? 1;
	const counts = await countBookedPerNight(ctx, product._id, checkIn, checkOut);
	return eachNight(checkIn, checkOut).filter(
		(night) => (counts.get(night) ?? 0) >= capacity,
	);
}
