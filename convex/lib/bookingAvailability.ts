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
	weekdayIndexMyt,
} from "./fulfilmentDate";
import { type ClosedDateRange, isClosedDate } from "./closedDates";
import {
	isMonthlyUnit,
	MAX_PACKAGE_DAYS,
	MAX_PACKAGE_MONTHS,
	type PackageUnit,
} from "./productKind";

/** How far ahead a check-in may be requested (~6 months — the design's month
 * nav cap; mirrors the 30-day fulfilment-date posture at booking scale). */
export const BOOKING_HORIZON_DAYS = 180;

/** Longest single FREE-RANGE stay a buyer may request (the campsite shape).
 * A fixed-length package is bounded by `MAX_PACKAGE_DAYS` instead. */
export const MAX_BOOKING_NIGHTS = 30;

/**
 * How many packages one booking may hold — "3 months up front", "two 2-day
 * deals back to back". A gym that can only sell one term at a time is a broken
 * gym product; separate bookings would mean separate payments and separate
 * renewal dates for what the member experiences as one membership.
 *
 * 12 matches `MAX_PACKAGE_MONTHS`, so a monthly listing reaches a full year.
 * `maxPackageQuantity()` narrows it further whenever the resulting TERM would
 * outrun `MAX_PACKAGE_DAYS` — that bound is load-bearing for the capacity
 * scans, not a preference.
 */
export const MAX_PACKAGE_QUANTITY = 12;

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

/**
 * How many days of [checkIn, checkOut) a booking actually USES — the span
 * minus the shut days an open-days package stepped over (z8r3fdhpm7,
 * `orders.bookingSkippedDays`). Every other booking has no skipped days, so
 * this is the plain span for them.
 *
 * The one count every "N days" on an order reads. Counting the span instead
 * told a buyer who bought 4 open days that their package was "7 days", and the
 * seller's approve card said "7 nights" beside a receipt that said 4.
 */
export function countedDays(
	checkIn: number,
	checkOut: number,
	skipped: readonly number[] | undefined,
): number {
	const inside = (skipped ?? []).filter(
		(day) => day >= checkIn && day < checkOut,
	).length;
	return nightsBetween(checkIn, checkOut) - inside;
}

/**
 * The unbroken runs of days a booking actually USES, as `[start,
 * endExclusive)` spans. One span for every booking except an open-days package
 * (z8r3fdhpm7), which is cut at each shut day it stepped over — Sat 3, then
 * Mon 5, then Thu 8–Fri 9.
 *
 * For the seller's Google Calendar feed: the in-app grid drops a member on the
 * days their package skips (`occupiesNight`), so the feed must not draw them
 * there either — one continuous event said "Aisyah — Kayak course" on the
 * Sunday the shop is shut.
 */
export function usedDayRuns(
	checkIn: number,
	checkOut: number,
	skipped: readonly number[] | undefined,
): Array<{ start: number; endExclusive: number }> {
	const shut = new Set(skipped ?? []);
	if (shut.size === 0) return [{ start: checkIn, endExclusive: checkOut }];
	const runs: Array<{ start: number; endExclusive: number }> = [];
	let runStart: number | null = null;
	for (let day = checkIn; day < checkOut; day += DAY_MS) {
		if (shut.has(day)) {
			if (runStart !== null) runs.push({ start: runStart, endExclusive: day });
			runStart = null;
		} else if (runStart === null) {
			runStart = day;
		}
	}
	if (runStart !== null) runs.push({ start: runStart, endExclusive: checkOut });
	return runs;
}

/** A package can't START on a day the store is shut — the one sentence, so
 * the resolver's refusal and the buyer calendar's reason can't drift. */
export const CLOSED_START_MESSAGE =
	"The store is closed on that day — start on a day it's open";

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

/**
 * Does this booking actually USE `night`? Inside [checkIn, checkOut) and not
 * one of the shut days an open-days package stepped over (z8r3fdhpm7,
 * `orders.bookingSkippedDays`) — a skipped Sunday is a day the member is never
 * there, so it holds no capacity and puts no name on the seller's grid. Every
 * other booking has no skipped days, so this is plain span overlap for them.
 */
export function occupiesNight(
	order: Pick<
		Doc<"orders">,
		"bookingCheckIn" | "bookingCheckOut" | "bookingSkippedDays"
	>,
	night: number,
): boolean {
	const checkIn = order.bookingCheckIn;
	const checkOut = order.bookingCheckOut;
	if (checkIn === undefined || checkOut === undefined) return false;
	if (night < checkIn || night >= checkOut) return false;
	return !(order.bookingSkippedDays ?? []).includes(night);
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
	for (const order of await bookingsOverlapping(ctx, productId, from, to)) {
		const checkIn = order.bookingCheckIn as number;
		const checkOut = order.bookingCheckOut as number;
		for (
			let night = Math.max(checkIn, from);
			night < Math.min(checkOut, to);
			night += DAY_MS
		) {
			if (!occupiesNight(order, night)) continue;
			counts.set(night, (counts.get(night) ?? 0) + 1);
		}
	}
	return counts;
}

/**
 * Every capacity-holding booking on `productId` that overlaps [from, to).
 *
 * THE one bounded scan. It exists because the look-back bound has now been got
 * wrong twice in two separate copies of this query — S7 found it in the
 * capacity count, and the seller day-sheet was still on a flat 30 days months
 * later, so a 3-month member showed in the grid's pill and vanished when the
 * seller tapped the day. Every caller reads through here, so there is one
 * `MAX_BOOKING_SPAN_DAYS` to get right.
 *
 * Returns whole orders: callers that need only counts discard the rest, and
 * the ones that need names (the seller's calendar) don't pay for a second scan.
 * `bookingCheckIn`/`bookingCheckOut` are guaranteed defined on every row
 * returned.
 */
export async function bookingsOverlapping(
	ctx: QueryCtx | MutationCtx,
	productId: Id<"products">,
	from: number,
	to: number,
): Promise<Doc<"orders">[]> {
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
	return holders.filter((order) => {
		if (!holdsCapacity(order.status)) return false;
		const checkIn = order.bookingCheckIn;
		const checkOut = order.bookingCheckOut;
		if (checkIn === undefined || checkOut === undefined) return false;
		return staysOverlap(checkIn, checkOut, from, to);
	});
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
 * What a store CLOSED DATE does to this listing (z8r3fdhpm7) — the one author
 * of the per-shape rule, read by the availability authority below, the buyer
 * calendar and the seller calendar alike. A closure is NOT a block: a block
 * says "this can't be booked", a closure says "the store isn't operating that
 * day", and those mean different things depending on what is being sold.
 *
 *  - `"unavailable"` — the listing sells NIGHTS (a free-range stay, or a
 *    night-counted package like a 3D2N): a guest sleeps there, so if the whole
 *    place is shut nobody can stay. A closed date joins the unavailable nights,
 *    exactly like a store-wide block.
 *  - `"absorbed"` — a month package, or a day package counted every day in a
 *    row: ACCESS time. A gym closed on Raya doesn't extend anyone's month —
 *    closures are priced in, the industry norm. A closure inside the term
 *    never refuses the package; the buyer is told which days are closed. Only
 *    the START must be a day the store is open (owner call, 24 Sep): a term
 *    starting on a shut day — or made of nothing but shut days — sold the
 *    buyer days they could never use.
 *  - `"skipped"` — a day package the seller counts in OPEN days
 *    (`skipsClosedDays`): DAYS OF SERVICE — a 5-day course, a kids' camp, a
 *    class pass. A day the store is shut delivers nothing, so it isn't
 *    counted: the term runs past it (`resolveOpenDaysTerm`), and the weekly
 *    day off is skipped too, because it is just as undelivered.
 *
 * Stays never read the weekly day off (a campsite hosts overnight while
 * reception is shut). Both package rules do, for the start day; only the
 * open-days rule also steps over it inside the term.
 */
export type ClosureRule = "unavailable" | "absorbed" | "skipped";

export function closureRule(
	booking:
		| {
				packageLength?: number;
				packageUnit?: PackageUnit;
				skipsClosedDays?: boolean;
		  }
		| undefined,
): ClosureRule {
	const isPackage = (booking?.packageLength ?? 0) > 0;
	if (!isPackage) return "unavailable";
	if (booking?.packageUnit === "night") return "unavailable";
	if (booking?.skipsClosedDays === true && !isMonthlyUnit(booking.packageUnit)) {
		return "skipped";
	}
	return "absorbed";
}

/**
 * The term of an OPEN-DAYS package (`closureRule` "skipped", z8r3fdhpm7):
 * `openDays` days the store is open, counted from `checkIn`, stepping over
 * every day `isClosed` says is shut — a weekly day off or a closed date. ONE
 * author, run by the buyer calendar, the checkout preview and
 * `requestBooking`, so the promised last day and the charged one can't differ.
 *
 * `checkOut` is exclusive (the day after the last counted day), like every
 * booking; `skipped` is the shut days INSIDE the term, which the order freezes
 * so the receipt keeps naming them after the store edits its hours.
 *
 * Throws with buyer-facing copy when the start itself is shut (day 1 must be a
 * day the service happens) or when the skips would stretch the term past
 * `MAX_PACKAGE_DAYS` — that bound keeps the capacity scans' look-back honest
 * (the bug class `bookingsOverlapping` exists for), so it is refused, never
 * truncated.
 */
export function resolveOpenDaysTerm(
	checkIn: number,
	openDays: number,
	isClosed: (day: number) => boolean,
): { checkOut: number; skipped: number[] } {
	if (isClosed(checkIn)) throw new Error(CLOSED_START_MESSAGE);
	const skipped: number[] = [];
	const ceiling = checkIn + MAX_PACKAGE_DAYS * DAY_MS;
	let counted = 0;
	let day = checkIn;
	while (counted < openDays) {
		if (day >= ceiling) {
			throw new Error(
				"With the store's closed days skipped, that package would run longer than a year — take fewer",
			);
		}
		if (isClosed(day)) skipped.push(day);
		else counted += 1;
		day += DAY_MS;
	}
	return { checkOut: day, skipped };
}

/**
 * The nights of [checkIn, checkOut) this listing can NOT take another booking
 * on — at capacity OR seller-blocked OR, for a night-selling listing, a store
 * closed date (`closureRule`, z8r3fdhpm7) — evaluated in ONE place (86eyj70z1
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
	// Closed dates (z8r3fdhpm7) close a NIGHT only where the listing sells
	// nights — read here, inside the one authority, so the buyer calendar, the
	// seller calendar and `requestBooking` can't disagree about a closure.
	const closedDates: ReadonlyArray<ClosedDateRange> | undefined =
		closureRule(product.booking) === "unavailable"
			? (await ctx.db.get(product.retailerId))?.closedDates
			: undefined;
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
			isNightBlocked(blocks, night, product._id) ||
			isClosedDate(closedDates, night),
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
		| {
				packageLength?: number;
				packageUnit?: PackageUnit;
				skipsClosedDays?: boolean;
		  }
		| undefined,
	checkIn: number,
	checkOut?: number,
	packageQuantity = 1,
	/** The store's "shut all day?" answer — REQUIRED for an open-days package
	 * (`closureRule` "skipped"); for an every-day or month package it refuses
	 * a START on a shut day. Ignored for a stay. */
	isClosed?: (day: number) => boolean,
): { checkIn: number; checkOut: number; skipped: number[] } {
	const length = booking?.packageLength;
	if (length !== undefined && length > 0) {
		const quantity = normalizePackageQuantity(packageQuantity, booking);
		const rule = closureRule(booking);
		// Day one has to be a day the store is open, whichever way the term
		// counts — the open-days resolver below says the same thing itself.
		if (rule === "absorbed" && isClosed?.(checkIn)) {
			throw new Error(CLOSED_START_MESSAGE);
		}
		if (rule === "skipped") {
			if (!isClosed) {
				// A programming error, not a buyer one: resolving an open-days term
				// without the schedule would silently count shut days.
				throw new Error("An open-days package needs the store's schedule");
			}
			const term = resolveOpenDaysTerm(checkIn, length * quantity, isClosed);
			return { checkIn, checkOut: term.checkOut, skipped: term.skipped };
		}
		// The whole term is computed IN ONE STEP — `length * quantity` — never by
		// adding one package at a time. Calendar-month clamping is lossy and
		// compounds: 31 Jan stepped three times is 28 Feb → 28 Mar → 28 Apr,
		// while a single 3-month term from 31 Jan is 30 Apr. A member buying
		// three months up front bought one term, not three chained ones, so the
		// single step is the honest reading (and it can't drift a day per
		// package).
		return {
			checkIn,
			checkOut:
				isMonthlyUnit(booking?.packageUnit)
					? addMytCalendarMonths(checkIn, length * quantity)
					: checkIn + length * quantity * DAY_MS,
			skipped: [],
		};
	}
	if (checkOut === undefined) {
		throw new Error("Pick your check-out date");
	}
	return { checkIn, checkOut, skipped: [] };
}

/** The rate-relevant slice of a listing's booking config. */
export type BookingRateConfig = {
	packageLength?: number;
	weekendPrice?: number;
	weekendDays?: readonly number[];
};

/**
 * How many of a stay's nights charge the weekend rate (S13, `z8r3fddkp8`).
 * ONE author — imported by the buyer's checkout receipt AND by
 * `requestBooking`'s line construction, so the preview and the charge can
 * never disagree by a night.
 *
 * A night is the calendar day it STARTS on: a 12→14 Sep stay sleeps the 12th
 * and 13th, so those two weekdays are read and the check-out morning (the
 * 14th) never counts — leaving on a Sunday morning is not a Saturday-night
 * charge. Month and year boundaries are plain 24 h steps (MYT has no DST).
 *
 * A listing with no weekend rate, or a fixed-length package (flat price by
 * definition — the validators refuse the pairing, this is belt-and-braces),
 * reports every night as weekday so callers need no special case.
 */
export function splitNightsByRate(
	checkIn: number,
	checkOut: number,
	booking: BookingRateConfig | undefined,
): { weekdayNights: number; weekendNights: number } {
	const isPackage = (booking?.packageLength ?? 0) > 0;
	const { weekday, weekend } = partitionNights(
		checkIn,
		checkOut,
		isPackage || booking?.weekendPrice === undefined
			? undefined
			: booking?.weekendDays,
	);
	return { weekdayNights: weekday.length, weekendNights: weekend.length };
}

/**
 * The same split, as the NIGHTS themselves rather than their counts — the one
 * author both readings come from, so a line's count and the dates printed
 * beside it can never disagree.
 *
 * The counts answer "why is my bill RM 110?"; the nights answer the question
 * that follows it, "which night was the expensive one?". An order can only ask
 * the second because it freezes `bookingWeekendDays`: two lines reading
 * "1 weekday night" and "1 weekend night" locate nothing inside a span on
 * their own.
 *
 * `weekendDays` absent or empty = every night is a weekday night, which is
 * exactly how a listing with no weekend rate (and every pre-S13 booking) reads.
 */
export function partitionNights(
	checkIn: number,
	checkOut: number,
	weekendDays: readonly number[] | undefined,
): { weekday: number[]; weekend: number[] } {
	const nights = eachNight(checkIn, checkOut);
	if (weekendDays === undefined || weekendDays.length === 0) {
		return { weekday: nights, weekend: [] };
	}
	const isWeekend = new Set(weekendDays);
	const weekday: number[] = [];
	const weekend: number[] = [];
	for (const night of nights) {
		(isWeekend.has(weekdayIndexMyt(night)) ? weekend : weekday).push(night);
	}
	return { weekday, weekend };
}

/**
 * How many packages one booking may hold, for THIS listing.
 *
 * Two ceilings, and the tighter one wins. `MAX_PACKAGE_QUANTITY` is the plain
 * cap; the second is structural — the whole term has to stay inside
 * `MAX_PACKAGE_DAYS`, because that is what bounds `MAX_BOOKING_SPAN_DAYS` and
 * therefore every scan that has to see a booking whose check-in is far behind
 * the night being read. Let a buyer stack five annual packages and those scans
 * silently stop finding them — the exact bug class S7 and the `dayBookings`
 * fix both closed.
 */
export function maxPackageQuantity(
	booking:
		| { packageLength?: number; packageUnit?: PackageUnit }
		| undefined,
): number {
	const length = booking?.packageLength;
	if (length === undefined || length <= 0) return 1;
	// Months are capped in MONTHS, not by a 31-day worst case.
	//
	// The 31-day approximation was over-conservative in a way that broke the
	// stated promise: 12 × 31 = 372 > MAX_PACKAGE_DAYS, so a 1-month listing
	// capped at ELEVEN and a member couldn't buy a full year in one booking —
	// contradicting the comment on MAX_PACKAGE_QUANTITY right above. Twelve
	// CALENDAR months span at most 366 days (a leap year), which is exactly
	// MAX_PACKAGE_DAYS, so bounding months by MAX_PACKAGE_MONTHS keeps the
	// span invariant intact and lets the annual membership through.
	const bySpan = isMonthlyUnit(booking?.packageUnit)
		? Math.floor(MAX_PACKAGE_MONTHS / length)
		: Math.floor(MAX_PACKAGE_DAYS / length);
	return Math.max(1, Math.min(MAX_PACKAGE_QUANTITY, bySpan));
}

/** Clamp an as-supplied quantity into what this listing actually allows. */
export function normalizePackageQuantity(
	quantity: number,
	booking:
		| { packageLength?: number; packageUnit?: PackageUnit }
		| undefined,
): number {
	if (!Number.isInteger(quantity) || quantity < 1) return 1;
	return Math.min(quantity, maxPackageQuantity(booking));
}
