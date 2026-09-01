/**
 * Booking period (S8, `86eyqxb2q`) — the boundaries are the whole feature, so
 * they're pinned individually. Every case injects `now`, so none of this
 * depends on when the suite runs.
 */
import { describe, expect, it } from "vitest";
import {
	currentBookingLine,
	describeBookingPeriod,
	ENDING_SOON_DAYS,
	matchesAnyBookingPeriod,
	matchesBookingPeriod,
	type PeriodOrder,
} from "./bookingPeriod";
import { DAY_MS, todayMytMidnight } from "./fulfilmentDate";

const NOW = Date.UTC(2026, 8, 15, 6, 30); // mid-morning, mid-month
const today = todayMytMidnight(NOW);
const day = (n: number) => today + n * DAY_MS;

function order(
	checkIn: number | undefined,
	checkOut: number | undefined,
	status = "confirmed",
): PeriodOrder {
	return { bookingCheckIn: checkIn, bookingCheckOut: checkOut, status };
}

describe("matchesBookingPeriod — the boundaries", () => {
	it("a stay checking in TODAY is active", () => {
		expect(matchesBookingPeriod(order(day(0), day(3)), "active", NOW)).toBe(
			true,
		);
	});

	it("a stay checking out TODAY is NOT active — it is ended", () => {
		// The exclusive-checkOut rule the whole vertical runs on: they left this
		// morning, and tonight belongs to the next guest.
		const leaving = order(day(-3), day(0));
		expect(matchesBookingPeriod(leaving, "active", NOW)).toBe(false);
		expect(matchesBookingPeriod(leaving, "ended", NOW)).toBe(true);
	});

	it("a stay starting tomorrow is upcoming, not active", () => {
		const soon = order(day(1), day(4));
		expect(matchesBookingPeriod(soon, "upcoming", NOW)).toBe(true);
		expect(matchesBookingPeriod(soon, "active", NOW)).toBe(false);
	});

	it("the last night of a stay still counts as active", () => {
		expect(matchesBookingPeriod(order(day(-5), day(1)), "active", NOW)).toBe(
			true,
		);
	});
});

describe("matchesBookingPeriod — ending soon is a subset of active", () => {
	it("includes a stay ending exactly at the horizon, excludes one past it", () => {
		const atHorizon = order(day(-2), day(ENDING_SOON_DAYS));
		const pastHorizon = order(day(-2), day(ENDING_SOON_DAYS + 1));
		expect(matchesBookingPeriod(atHorizon, "ending_soon", NOW)).toBe(true);
		expect(matchesBookingPeriod(pastHorizon, "ending_soon", NOW)).toBe(false);
		// …and both are still active, which is what makes it a subset.
		expect(matchesBookingPeriod(atHorizon, "active", NOW)).toBe(true);
		expect(matchesBookingPeriod(pastHorizon, "active", NOW)).toBe(true);
	});

	it("an ALREADY-ended stay is never ending soon", () => {
		// Guarding the obvious trap: "ends within 7 days" is true of something
		// that ended 3 days ago if you forget to require active first.
		expect(
			matchesBookingPeriod(order(day(-10), day(-3)), "ending_soon", NOW),
		).toBe(false);
	});
});

describe("matchesBookingPeriod — what never matches", () => {
	it("an ordinary order with no span matches nothing", () => {
		// Without this, selecting Active on a mixed inbox would keep every
		// product order — the opposite of the question being asked.
		const plain = order(undefined, undefined);
		for (const period of ["upcoming", "active", "ending_soon", "ended"] as const) {
			expect(matchesBookingPeriod(plain, period, NOW)).toBe(false);
		}
	});

	it("a cancelled booking is not active however its dates read", () => {
		// Declined and expired requests both land in `cancelled`.
		const cancelled = order(day(-1), day(5), "cancelled");
		expect(matchesBookingPeriod(cancelled, "active", NOW)).toBe(false);
		expect(matchesBookingPeriod(cancelled, "ended", NOW)).toBe(false);
	});

	it("a half-recorded span matches nothing", () => {
		expect(matchesBookingPeriod(order(day(0), undefined), "active", NOW)).toBe(
			false,
		);
		expect(matchesBookingPeriod(order(undefined, day(5)), "active", NOW)).toBe(
			false,
		);
	});
});

describe("matchesAnyBookingPeriod", () => {
	it("ORs the selection, and an empty selection filters nothing", () => {
		const upcoming = order(day(2), day(5));
		expect(matchesAnyBookingPeriod(upcoming, [], NOW)).toBe(true);
		expect(matchesAnyBookingPeriod(upcoming, ["active"], NOW)).toBe(false);
		expect(
			matchesAnyBookingPeriod(upcoming, ["active", "upcoming"], NOW),
		).toBe(true);
	});
});

describe("describeBookingPeriod — the reception-desk line", () => {
	it("counts days left, and a PACKAGE's last day is the night before check-out", () => {
		// A stay's check-out morning is a day the guest is still there; a
		// package's is the morning after its last valid day. Same epoch, one
		// day's difference in what it means.
		const stay = { ...order(day(-2), day(3)), bookingPackaged: false };
		const pkg = { ...order(day(-2), day(3)), bookingPackaged: true };
		expect(describeBookingPeriod(stay, NOW)).toBe("Active · 3 days left");
		expect(describeBookingPeriod(pkg, NOW)).toBe("Active · 2 days left");
	});

	it("reads naturally at the edges", () => {
		expect(
			describeBookingPeriod({ ...order(day(-2), day(1)), bookingPackaged: true }, NOW),
		).toBe("Active · ends today");
		expect(
			describeBookingPeriod({ ...order(day(-2), day(2)), bookingPackaged: true }, NOW),
		).toBe("Active · ends tomorrow");
		expect(describeBookingPeriod(order(day(1), day(4)), NOW)).toBe(
			"Starts tomorrow",
		);
		expect(describeBookingPeriod(order(day(4), day(9)), NOW)).toBe(
			"Starts in 4 days",
		);
		expect(describeBookingPeriod(order(day(-9), day(0)), NOW)).toBe(
			"Ended today",
		);
		expect(describeBookingPeriod(order(day(-9), day(-1)), NOW)).toBe(
			"Ended yesterday",
		);
		expect(describeBookingPeriod(order(day(-9), day(-4)), NOW)).toBe(
			"Ended 4 days ago",
		);
	});

	it("says nothing at all for a non-booking or a cancelled one", () => {
		expect(describeBookingPeriod(order(undefined, undefined), NOW)).toBeNull();
		expect(
			describeBookingPeriod(order(day(-1), day(5), "cancelled"), NOW),
		).toBeNull();
	});
});

describe("currentBookingLine — which booking the customer card shows", () => {
	const packaged = (from: number, to: number, status = "confirmed") => ({
		bookingCheckIn: day(from),
		bookingCheckOut: day(to),
		bookingPackaged: true,
		status,
	});

	it("prefers an ACTIVE booking, and among several the one ending soonest", () => {
		expect(
			currentBookingLine(
				[packaged(-20, 40), packaged(-2, 4), packaged(10, 20)],
				NOW,
			),
		).toBe("Active · 3 days left");
	});

	it("falls back to the SOONEST upcoming when nothing is running", () => {
		expect(currentBookingLine([packaged(9, 20), packaged(4, 8)], NOW)).toBe(
			"Starts in 4 days",
		);
	});

	it("falls back to the most recently ENDED — the renewal conversation", () => {
		expect(currentBookingLine([packaged(-40, -30), packaged(-9, -2)], NOW)).toBe(
			"Ended 2 days ago",
		);
	});

	it("says nothing for a customer with no bookings, or only cancelled ones", () => {
		expect(currentBookingLine([], NOW)).toBeNull();
		expect(
			currentBookingLine([{ status: "confirmed" } as never], NOW),
		).toBeNull();
		expect(currentBookingLine([packaged(-1, 5, "cancelled")], NOW)).toBeNull();
	});
});
