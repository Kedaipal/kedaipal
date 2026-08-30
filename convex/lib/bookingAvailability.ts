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
import {
	addMytCalendarMonths,
	DAY_MS,
	isMytMidnight,
	todayMytMidnight,
} from "./fulfilmentDate";
import { MAX_PACKAGE_DAYS } from "./productKind";

/** How far ahead a check-in may be requested (~6 months — the design's month
 * nav cap; mirrors the 30-day fulfilment-date posture at booking scale). */
export const BOOKING_HORIZON_DAYS = 180;

/** Longest single FREE-RANGE stay a buyer may request (the campsite shape).
 * A fixed-length package is bounded by `MAX_PACKAGE_DAYS` instead. */
export const MAX_BOOKING_NIGHTS = 30;

/**
 * The capacity scan's look-back bound: a booking whose check-in is more than
 * this before a window cannot overlap it.
 *
 * This is the MAX over every shape a stay can take — a free range
 * (`MAX_BOOKING_NIGHTS`) or a fixed-length package (`MAX_PACKAGE_DAYS`, S7).
 * It must never be narrower than the longest span that could exist, or the
 * indexed scan silently misses an overlapping booking and the night reads as
 * free. Deliberately NOT per-product: a listing's `packageLength` can be edited
 * (or cleared) after long bookings were already placed against it, so only a
 * global ceiling is safe.
 */
export const MAX_BOOKING_SPAN_DAYS = Math.max(
	MAX_BOOKING_NIGHTS,
	MAX_PACKAGE_DAYS,
);

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
	opts: { noticeDays: number; now?: number; maxNights?: number },
): void {
	if (!isMytMidnight(checkIn) || !isMytMidnight(checkOut)) {
		throw new Error("Booking dates must be calendar days");
	}
	const nights = nightsBetween(checkIn, checkOut);
	if (nights < 1) {
		throw new Error("Check-out must be after check-in");
	}
	// A fixed-length package passes its own length as the ceiling (S7): its
	// span is the seller's choice, already capped at MAX_PACKAGE_DAYS when they
	// set it, and the buyer never picks it. Free ranges keep the 30-night cap.
	const maxNights = opts.maxNights ?? MAX_BOOKING_NIGHTS;
	if (nights > maxNights) {
		throw new Error(
			`Stays are limited to ${maxNights} nights — split a longer stay into two requests`,
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
	const scanFrom = from - MAX_BOOKING_SPAN_DAYS * DAY_MS;
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

/** Longest single block (a season-long renovation) — also the block scan's
 * look-back bound, the MAX_BOOKING_NIGHTS role for the blocks table. */
export const MAX_BLOCK_DAYS = 366;

/**
 * The retailer's blocks that could touch [from, to) — store-level and
 * per-listing rows together (the caller filters by product). Indexed range
 * read on `by_retailer_start`, bounded by the max block length.
 */
export async function loadBlocksForWindow(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
	from: number,
	to: number,
): Promise<Doc<"bookingBlocks">[]> {
	const scanFrom = from - MAX_BLOCK_DAYS * DAY_MS;
	const rows = await ctx.db
		.query("bookingBlocks")
		.withIndex("by_retailer_start", (q) =>
			q
				.eq("retailerId", retailerId)
				.gte("startDate", scanFrom)
				.lt("startDate", to),
		)
		.collect();
	// endDate is INCLUSIVE (schema comment) — a block reaches the window when
	// its last covered night is at or past `from`.
	return rows.filter((block) => block.endDate >= from);
}

/** Is this night blocked for this listing? Store-level blocks cover every
 * listing; per-listing blocks only their own. endDate inclusive. */
export function isNightBlocked(
	blocks: ReadonlyArray<
		Pick<Doc<"bookingBlocks">, "productId" | "startDate" | "endDate">
	>,
	night: number,
	productId: Id<"products">,
): boolean {
	return blocks.some(
		(block) =>
			(block.productId === undefined || block.productId === productId) &&
			night >= block.startDate &&
			night <= block.endDate,
	);
}

/**
 * The nights of [checkIn, checkOut) this listing can NOT take another booking
 * on — at capacity OR seller-blocked, evaluated in ONE place (86eyj70z1
 * decision 8) so `requestBooking`, the buyer calendar and the seller calendar
 * can never disagree, and so buyers can never tell blocked from full. Empty
 * array = the whole stay fits. The authoritative check `requestBooking` runs
 * inside its transaction (Convex serializes mutations, so two buyers racing
 * for the last spot — or racing a seller's block — can't slip through).
 */
export async function findFullNights(
	ctx: QueryCtx | MutationCtx,
	product: Pick<Doc<"products">, "_id" | "retailerId" | "booking">,
	checkIn: number,
	checkOut: number,
): Promise<number[]> {
	// UNDEFINED capacity = unlimited (S7) — a gym has no daily member cap, so
	// only the seller's own blocks can close a night. Never `?? 1` here: that
	// would read "unlimited" as "one spot" and refuse the second member.
	const capacity = product.booking?.capacityPerNight;
	const blocks = await loadBlocksForWindow(
		ctx,
		product.retailerId,
		checkIn,
		checkOut,
	);
	// The count is the expensive half — skip it entirely when nothing it could
	// return would close a night.
	const counts =
		capacity === undefined
			? null
			: await countBookedPerNight(ctx, product._id, checkIn, checkOut);
	return eachNight(checkIn, checkOut).filter(
		(night) =>
			(capacity !== undefined &&
				counts !== null &&
				(counts.get(night) ?? 0) >= capacity) ||
			isNightBlocked(blocks, night, product._id),
	);
}

/**
 * The nights a stay occupies, given the listing's shape: a fixed-length
 * package derives its end from the start (S7), a free-range stay keeps the
 * check-out the buyer picked. ONE author, so the buyer's calendar, the
 * checkout preview and the authoritative mutation can't disagree by a day.
 */
export function resolveBookingRange(
	booking:
		| { packageLength?: number; packageUnit?: "day" | "month" }
		| undefined,
	checkIn: number,
	checkOut?: number,
): { checkIn: number; checkOut: number } {
	const length = booking?.packageLength;
	if (length !== undefined && length > 0) {
		// A MONTH package lands on the same day of the next month (clamped for
		// short months) rather than after a fixed day count — see
		// addMytCalendarMonths for why that is what "monthly" means.
		return {
			checkIn,
			checkOut:
				booking?.packageUnit === "month"
					? addMytCalendarMonths(checkIn, length)
					: checkIn + length * DAY_MS,
		};
	}
	if (checkOut === undefined) {
		throw new Error("Pick your check-out date");
	}
	return { checkIn, checkOut };
}
