// Where a booking sits in TIME, relative to today (booking S8, `86eyqxb2q`).
//
// FS Fitness's ask is "sit at the gym and see who has paid" — but the inbox
// already answers "who has paid". What it could not answer is "who is CURRENT":
// a member whose month started three weeks ago is buried in a
// fulfilment-date-sorted list, because their fulfilment date is their start
// date and that is ancient history by week three.
//
// **This is a filter chip, not an inbox bucket** — the ticket asked for a
// bucket, and it can't be one. Buckets (`new | in_progress | completed |
// cancelled`) are a PARTITION: every order is in exactly one, which is what
// makes the counts sum to the total and "select all" unambiguous. "Active" is
// a different axis — an active booking is simultaneously `in_progress` — so
// adding it to that list would make buckets overlap and quietly break both
// properties. As a chip it composes with the buckets instead, and with the
// payment filter that answers the other half of the same question.
//
// Pure: `now` is injected (the `matchesFulfilmentWindow` posture), so the
// boundaries are testable without freezing clocks.

import { DAY_MS, todayMytMidnight } from "./fulfilmentDate";

/**
 * The periods a seller can filter by.
 *
 * `ending_soon` is deliberately a SUBSET of `active`, not a sibling of it.
 * Multi-select filters here OR within themselves, so picking both is simply
 * `active` — harmless, and the alternative (a separate boolean refinement
 * control) would be a second widget expressing one idea. Categories already
 * overlap this way; only `statuses` happens to be exclusive.
 */
export type BookingPeriod = "upcoming" | "active" | "ending_soon" | "ended";

/**
 * The periods the inbox offers, in the order they're shown.
 *
 * "Active" leads because it is the question FS Fitness actually asked ("who is
 * current"); "Ending this week" sits next to it as its urgent subset, and
 * "Upcoming" last because it is the only one about work that hasn't started.
 * `ended` is deliberately NOT offered as a chip — history is what Insights and
 * the customer record are for, and a fourth chip earning its place would need
 * someone to ask for it.
 */
export const BOOKING_PERIOD_CHIPS = [
	"active",
	"ending_soon",
	"upcoming",
] as const satisfies readonly BookingPeriod[];

/** Every valid period, for narrowing untrusted input (a hand-edited URL). */
export const BOOKING_PERIODS: readonly BookingPeriod[] = [
	"upcoming",
	"active",
	"ending_soon",
	"ended",
];

/** What each chip says. "This week" matches the fulfilment chip's wording for
 * the same 7-day span, so the two don't teach different vocabularies. */
export const BOOKING_PERIOD_LABELS: Record<BookingPeriod, string> = {
	active: "Active now",
	ending_soon: "Ending this week",
	upcoming: "Upcoming",
	ended: "Ended",
};

/** How far ahead "ending soon" reaches. Seven days = the reception-desk
 * horizon and the same span the fulfilment "this week" chip uses, so the two
 * mean the same thing by "this week". */
export const ENDING_SOON_DAYS = 7;

/** The order fields a period question reads. A structural subset of
 * `Doc<"orders">`, so a whole order row satisfies it. */
export type PeriodOrder = {
	bookingCheckIn?: number;
	bookingCheckOut?: number;
	status: string;
};

/**
 * Whole MYT days from today to `epoch`. Negative = in the past.
 */
export function daysFromToday(epoch: number, now: number = Date.now()): number {
	return Math.round((epoch - todayMytMidnight(now)) / DAY_MS);
}

/**
 * Does this order occupy, precede or follow `period`?
 *
 * Two exclusions are baked in rather than left to compose:
 *
 *  - **Not a booking → never matches.** An ordinary order has no span, so it
 *    can't be "active". Without this, selecting Active on a mixed inbox would
 *    silently keep every product order, which is the opposite of the question.
 *  - **Cancelled → never matches.** A cancelled stay is not on site, whatever
 *    its dates say, and declined/expired requests both land in `cancelled`.
 *    The seller reaches those through the Cancelled bucket.
 *
 * Boundaries follow the exclusive-`checkOut` rule the whole vertical uses: a
 * stay checking in TODAY is active, and one checking out TODAY is not — they
 * left this morning, and tonight's night belongs to the next guest.
 */
export function matchesBookingPeriod(
	order: PeriodOrder,
	period: BookingPeriod,
	now: number = Date.now(),
): boolean {
	const { bookingCheckIn: checkIn, bookingCheckOut: checkOut } = order;
	if (checkIn === undefined || checkOut === undefined) return false;
	if (order.status === "cancelled") return false;
	const today = todayMytMidnight(now);
	const isActive = checkIn <= today && today < checkOut;
	switch (period) {
		case "upcoming":
			return checkIn > today;
		case "active":
			return isActive;
		case "ending_soon":
			return isActive && daysFromToday(checkOut, now) <= ENDING_SOON_DAYS;
		case "ended":
			return checkOut <= today;
	}
}

/** True when the order matches ANY of the requested periods (the multi-select
 * OR). An empty list filters nothing, matching every other filter here. */
export function matchesAnyBookingPeriod(
	order: PeriodOrder,
	periods: readonly BookingPeriod[],
	now: number = Date.now(),
): boolean {
	if (periods.length === 0) return true;
	return periods.some((p) => matchesBookingPeriod(order, p, now));
}

/**
 * The reception-desk line for a customer's booking — "Active · 6 days left",
 * "Starts in 3 days", "Ended 2 days ago". Null when the order carries no span
 * or was cancelled, so the caller renders nothing rather than a stale claim.
 *
 * Counts in DAYS REMAINING rather than naming the end date, because the
 * question at a counter is "how long have they got", and a date makes the
 * reader do the arithmetic. `packaged` decides which day is the last one the
 * guest actually has: a package's exclusive check-out is the morning AFTER its
 * last valid day, while a stay's check-out is the day the guest leaves — so
 * the same epoch means "gone" on one and "still here" on the other.
 */
export function describeBookingPeriod(
	order: PeriodOrder & { bookingPackaged?: boolean },
	now: number = Date.now(),
): string | null {
	const { bookingCheckIn: checkIn, bookingCheckOut: checkOut } = order;
	if (checkIn === undefined || checkOut === undefined) return null;
	if (order.status === "cancelled") return null;
	const today = todayMytMidnight(now);
	if (checkIn > today) {
		const days = daysFromToday(checkIn, now);
		return days === 1 ? "Starts tomorrow" : `Starts in ${days} days`;
	}
	if (checkOut <= today) {
		const days = -daysFromToday(checkOut, now);
		if (days === 0) return "Ended today";
		return days === 1 ? "Ended yesterday" : `Ended ${days} days ago`;
	}
	// Active. A package's last usable day is the night before check-out; a
	// stay's check-out morning is a day the guest is still there.
	const lastDay = order.bookingPackaged === true ? checkOut - DAY_MS : checkOut;
	const left = daysFromToday(lastDay, now);
	if (left <= 0) return "Active · ends today";
	return left === 1 ? "Active · ends tomorrow" : `Active · ${left} days left`;
}

/**
 * The one booking line to show on a customer's card — the reception-desk
 * glance: "who is this, and are they current?"
 *
 * A customer can hold several bookings, so the pick has an order of interest:
 * an ACTIVE one first (they're here now), then the soonest UPCOMING (they're
 * expected), then the most recently ENDED (they were here, and that's the
 * renewal conversation). Anything else — no bookings, only cancelled ones —
 * returns null so the card renders nothing rather than a hedge.
 */
export function currentBookingLine(
	orders: ReadonlyArray<
		PeriodOrder & { bookingPackaged?: boolean }
	>,
	now: number = Date.now(),
): string | null {
	const withSpan = orders.filter(
		(o) =>
			o.bookingCheckIn !== undefined &&
			o.bookingCheckOut !== undefined &&
			o.status !== "cancelled",
	);
	if (withSpan.length === 0) return null;
	const active = withSpan.filter((o) => matchesBookingPeriod(o, "active", now));
	if (active.length > 0) {
		// Several at once (a member with two packages) — the one ending soonest
		// is the one with a decision attached to it.
		const soonest = active.reduce((a, b) =>
			(a.bookingCheckOut ?? 0) <= (b.bookingCheckOut ?? 0) ? a : b,
		);
		return describeBookingPeriod(soonest, now);
	}
	const upcoming = withSpan.filter((o) =>
		matchesBookingPeriod(o, "upcoming", now),
	);
	if (upcoming.length > 0) {
		const next = upcoming.reduce((a, b) =>
			(a.bookingCheckIn ?? 0) <= (b.bookingCheckIn ?? 0) ? a : b,
		);
		return describeBookingPeriod(next, now);
	}
	const latest = withSpan.reduce((a, b) =>
		(a.bookingCheckOut ?? 0) >= (b.bookingCheckOut ?? 0) ? a : b,
	);
	return describeBookingPeriod(latest, now);
}
