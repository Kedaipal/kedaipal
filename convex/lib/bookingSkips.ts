// "Skip a day" on an open-days package (z8r3fdh3ay) — the ONE author of what a
// customer skip does to a plan, run by `bookings.skipPackageDay` /
// `unskipPackageDay` and by the seller's dialog preview, so the last day the
// seller is shown is the last day the server writes.
//
// The shape: a meal plan / class pass counted in OPEN days (`closureRule`
// "skipped", z8r3fdhpm7) is a number of days of service. When the customer
// misses one, the seller logs it and the plan owes that day back: the day
// joins `orders.bookingSkippedDays` (so capacity, the grid, the calendar feed
// and every "N days" count drop it with no extra code) AND
// `orders.bookingCustomerSkips` (the WHY — labelled, capped, undoable), and
// `bookingCheckOut` moves out by exactly one open day, stepping over the
// store's shut days on the way. Check-in, price and quantity never move: a
// skip is not a refund and never changes money.
//
// Pure — no ctx — so the client imports it for the preview.

import { MAX_PACKAGE_DAYS } from "./productKind";
import { DAY_MS, todayMytMidnight } from "./fulfilmentDate";

/** The order fields a skip question reads. A structural subset of
 * `Doc<"orders">`, so a whole order row satisfies it. */
export type SkipPlan = {
	status: string;
	bookingCheckIn?: number;
	bookingCheckOut?: number;
	bookingSkippedDays?: readonly number[];
	bookingCustomerSkips?: readonly number[];
};

/** What a plan looks like after a skip (or an undo) — exactly the fields the
 * mutation patches, plus the last day it now runs to. */
export type SkipResult = {
	checkOut: number;
	skippedDays: number[];
	customerSkips: number[];
	/** The plan's last usable day after the change (`checkOut − 1 day`). */
	lastDay: number;
};

/**
 * Can this order's plan be skipped AT ALL — is it an open-days package? The
 * frozen `bookingOpenDays` answers for every order placed since z8r3fdh3ay;
 * an older order falls back to whether its listing counts open days today.
 * Anything else (a stay, an every-day pass, a gym month) has no "Skip a day":
 * access time is not owed back when unused, which is the industry norm the
 * closed-dates work already follows.
 */
export function isSkippablePlan(
	order: { bookingPackaged?: boolean; bookingOpenDays?: boolean },
	listingCountsOpenDays: boolean,
): boolean {
	if (order.bookingPackaged !== true) return false;
	if (order.bookingOpenDays !== undefined) return order.bookingOpenDays;
	return listingCountsOpenDays;
}

/**
 * Why the plan as a whole can't take another skip right now, or null when it
 * can. Seller-facing — rendered beside the disabled "Skip a day" button, and
 * thrown verbatim by the mutation as the backstop.
 */
export function planSkipBlocker(
	plan: SkipPlan,
	opts: { maxSkips?: number; now?: number },
): string | null {
	const { bookingCheckIn: checkIn, bookingCheckOut: checkOut } = plan;
	if (checkIn === undefined || checkOut === undefined) {
		return "This order has no plan dates";
	}
	if (plan.status === "cancelled") return "This plan was cancelled";
	if (plan.status === "booking_requested") {
		return "Approve the booking first — a request can't be skipped yet";
	}
	if (plan.status === "delivered") {
		return "This plan is marked as ended — move it back to Active to skip a day";
	}
	if (todayMytMidnight(opts.now) >= checkOut) {
		return "This plan has ended — a skip has to be logged by its last day";
	}
	const used = (plan.bookingCustomerSkips ?? []).length;
	if (opts.maxSkips !== undefined && used >= opts.maxSkips) {
		return `All ${opts.maxSkips} skip${opts.maxSkips === 1 ? "" : "s"} on this plan are used — the listing allows up to ${opts.maxSkips}`;
	}
	return null;
}

/**
 * Why THIS day can't be skipped, or null when it can. Past days inside the
 * plan are fine — customers tell the seller late — but only a day the plan
 * actually counts: a day it already steps over never used a meal.
 */
export function skipDayIssue(plan: SkipPlan, day: number): string | null {
	const { bookingCheckIn: checkIn, bookingCheckOut: checkOut } = plan;
	if (checkIn === undefined || checkOut === undefined) {
		return "This order has no plan dates";
	}
	if (day < checkIn) return "Before the plan starts";
	if (day >= checkOut) return "After the plan's last day";
	if ((plan.bookingCustomerSkips ?? []).includes(day)) return "Already skipped";
	if ((plan.bookingSkippedDays ?? []).includes(day)) {
		return "The store is closed that day — it never used a day";
	}
	return null;
}

/**
 * Skip `day`: it stops counting, and the plan runs one open day longer — the
 * first day on or after the old check-out that `isClosed` says the store is
 * open, with any shut days stepped over on the way frozen as skipped too (so
 * the counts keep matching the span). `isClosed` is the store's schedule NOW:
 * the replacement day is being promised today.
 *
 * Throws seller-facing copy when the day can't be skipped, or when the
 * extension would stretch the plan past `MAX_PACKAGE_DAYS` from its start —
 * that bound keeps the capacity scans' look-back honest (`bookingsOverlapping`),
 * so it is refused, never truncated.
 */
export function applyCustomerSkip(
	plan: SkipPlan,
	day: number,
	isClosed: (day: number) => boolean,
): SkipResult {
	const issue = skipDayIssue(plan, day);
	if (issue !== null) throw new Error(issue);
	// skipDayIssue has proven both dates exist.
	const checkIn = plan.bookingCheckIn as number;
	const ceiling = checkIn + MAX_PACKAGE_DAYS * DAY_MS;
	const skipped = new Set(plan.bookingSkippedDays ?? []);
	skipped.add(day);
	let next = plan.bookingCheckOut as number;
	while (isClosed(next)) {
		if (next >= ceiling) break;
		skipped.add(next);
		next += DAY_MS;
	}
	if (next >= ceiling) {
		throw new Error(
			"Skipping that day would run the plan past a year from its start — it can't be extended any further",
		);
	}
	return {
		checkOut: next + DAY_MS,
		skippedDays: [...skipped].sort((a, b) => a - b),
		customerSkips: [...(plan.bookingCustomerSkips ?? []), day],
		lastDay: next,
	};
}

/** The skip "Undo" reverses — the most recently LOGGED one. Older skips are
 * final, so the seller's history can't be rewritten out of order. */
export function latestCustomerSkip(plan: SkipPlan): number | undefined {
	return (plan.bookingCustomerSkips ?? []).at(-1);
}

/**
 * Undo the latest skip: its day counts again, and the plan gives back the one
 * open day the skip added — the last counted day is dropped, along with any
 * shut days that were only inside the term because of the extension. Works
 * from the plan as it is now, so it stays right if the store's schedule
 * changed in between.
 */
export function undoLatestSkip(plan: SkipPlan): SkipResult {
	const day = latestCustomerSkip(plan);
	const { bookingCheckIn: checkIn, bookingCheckOut: checkOut } = plan;
	if (day === undefined || checkIn === undefined || checkOut === undefined) {
		throw new Error("There's no skip to undo");
	}
	const skipped = new Set(plan.bookingSkippedDays ?? []);
	skipped.delete(day);
	// The plan's last counted day is the day before check-out (every resolver
	// ends the term on a counted day). Drop it; the new end is the counted day
	// before it — there is always one, because `day` itself counts again.
	let previous = checkOut - 2 * DAY_MS;
	while (previous > checkIn && skipped.has(previous)) previous -= DAY_MS;
	const newCheckOut = previous + DAY_MS;
	return {
		checkOut: newCheckOut,
		skippedDays: [...skipped].filter((d) => d < newCheckOut).sort((a, b) => a - b),
		customerSkips: (plan.bookingCustomerSkips ?? []).slice(0, -1),
		lastDay: previous,
	};
}

/**
 * The shut days a plan stepped over, WITHOUT the customer's own skips — what
 * "skips Sun 4 Oct" (the store was closed) means. The customer's skips read
 * separately, because "you skipped this" and "we were shut" are different
 * facts to both sides.
 */
export function closureSkippedDays(plan: {
	bookingSkippedDays?: readonly number[];
	bookingCustomerSkips?: readonly number[];
}): number[] {
	const customer = new Set(plan.bookingCustomerSkips ?? []);
	return (plan.bookingSkippedDays ?? []).filter((d) => !customer.has(d));
}
