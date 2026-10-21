import { describe, expect, test } from "vitest";
import {
	applyCustomerSkip,
	allSkipsUsed,
	closureSkippedDays,
	isSkippablePlan,
	latestCustomerSkip,
	planSkipBlocker,
	skipDayIssue,
	undoLatestSkip,
} from "./bookingSkips";
import { usedDayRuns } from "./bookingAvailability";
import { DAY_MS, todayMytMidnight } from "./fulfilmentDate";
import { MAX_PACKAGE_DAYS } from "./productKind";

// A fixed Monday, MYT midnight: Mon 5 Oct 2026 (16:00 UTC the day before).
const MON = Date.UTC(2026, 9, 4, 16);
const d = (offset: number) => MON + offset * DAY_MS;
/** Sue Chef's week: shut Saturday and Sunday. */
const weekends = (day: number) => {
	const wd = new Date(day + 8 * 3_600_000).getUTCDay();
	return wd === 0 || wd === 6;
};
const never = () => false;

/** A 5-meal-day plan, Mon 5 → Fri 9 Oct (check-out Sat 10). */
const plan = (extra: Record<string, unknown> = {}) => ({
	status: "confirmed",
	bookingCheckIn: d(0),
	bookingCheckOut: d(5),
	...extra,
});

describe("applyCustomerSkip", () => {
	test("skipping Wednesday moves the last day across the weekend to Monday", () => {
		const result = applyCustomerSkip(plan(), d(2), weekends);
		expect(result.lastDay).toBe(d(7));
		expect(result.checkOut).toBe(d(8));
		// Wed is the customer's; Sat + Sun are the shut days stepped over.
		expect(result.skippedDays).toEqual([d(2), d(5), d(6)]);
		expect(result.customerSkips).toEqual([d(2)]);
	});

	test("a closed date right after the weekend is stepped over too", () => {
		const raya = (day: number) => weekends(day) || day === d(7);
		const result = applyCustomerSkip(plan(), d(1), raya);
		expect(result.lastDay).toBe(d(8));
		expect(result.skippedDays).toEqual([d(1), d(5), d(6), d(7)]);
	});

	test("skipping the plan's last day moves it to the next open day", () => {
		const result = applyCustomerSkip(plan(), d(4), weekends);
		expect(result.lastDay).toBe(d(7));
		expect(result.skippedDays).toEqual([d(4), d(5), d(6)]);
	});

	test("a second skip extends again and keeps the log in the order it was taken", () => {
		const first = applyCustomerSkip(plan(), d(3), weekends);
		const second = applyCustomerSkip(
			plan({
				bookingCheckOut: first.checkOut,
				bookingSkippedDays: first.skippedDays,
				bookingCustomerSkips: first.customerSkips,
			}),
			d(1),
			weekends,
		);
		expect(second.customerSkips).toEqual([d(3), d(1)]);
		expect(second.lastDay).toBe(d(8));
	});

	test("refuses days it can't skip, with the reason", () => {
		const skipped = plan({
			bookingCheckOut: d(8),
			bookingSkippedDays: [d(2), d(5), d(6)],
			bookingCustomerSkips: [d(2)],
		});
		expect(() => applyCustomerSkip(skipped, d(-1), weekends)).toThrow(
			/Before the plan starts/,
		);
		expect(() => applyCustomerSkip(skipped, d(8), weekends)).toThrow(
			/After the plan's last day/,
		);
		expect(() => applyCustomerSkip(skipped, d(2), weekends)).toThrow(
			/Already skipped/,
		);
		expect(() => applyCustomerSkip(skipped, d(5), weekends)).toThrow(
			/store is closed that day/,
		);
	});

	test("refuses, never truncates, an extension past a year from the start", () => {
		const long = {
			status: "confirmed",
			bookingCheckIn: d(0),
			bookingCheckOut: d(MAX_PACKAGE_DAYS),
		};
		expect(() => applyCustomerSkip(long, d(10), never)).toThrow(
			/past a year/,
		);
		// One day short of the ceiling still extends.
		const fits = { ...long, bookingCheckOut: d(MAX_PACKAGE_DAYS - 1) };
		expect(applyCustomerSkip(fits, d(10), never).checkOut).toBe(
			d(MAX_PACKAGE_DAYS),
		);
	});
});

describe("undoLatestSkip", () => {
	test("restores the plan exactly as it was before the skip", () => {
		const before = plan();
		const skipped = applyCustomerSkip(before, d(2), weekends);
		const undone = undoLatestSkip(
			plan({
				bookingCheckOut: skipped.checkOut,
				bookingSkippedDays: skipped.skippedDays,
				bookingCustomerSkips: skipped.customerSkips,
			}),
		);
		expect(undone.checkOut).toBe(d(5));
		expect(undone.lastDay).toBe(d(4));
		expect(undone.skippedDays).toEqual([]);
		expect(undone.customerSkips).toEqual([]);
	});

	test("keeps the shut days the plan was SOLD with", () => {
		// Sold Thu → Wed over a weekend (frozen Sat + Sun), then Mon skipped.
		const sold = {
			status: "confirmed",
			bookingCheckIn: d(3),
			bookingCheckOut: d(10),
			bookingSkippedDays: [d(5), d(6)],
		};
		const skipped = applyCustomerSkip(sold, d(7), weekends);
		expect(skipped.lastDay).toBe(d(10));
		const undone = undoLatestSkip({
			...sold,
			bookingCheckOut: skipped.checkOut,
			bookingSkippedDays: skipped.skippedDays,
			bookingCustomerSkips: skipped.customerSkips,
		});
		expect(undone.checkOut).toBe(d(10));
		expect(undone.skippedDays).toEqual([d(5), d(6)]);
	});

	test("only ever reverses the latest skip, and a plan without one refuses", () => {
		const twice = plan({
			bookingCheckOut: d(9),
			bookingSkippedDays: [d(1), d(3), d(5), d(6)],
			bookingCustomerSkips: [d(3), d(1)],
		});
		expect(latestCustomerSkip(twice)).toBe(d(1));
		const undone = undoLatestSkip(twice);
		expect(undone.customerSkips).toEqual([d(3)]);
		expect(undone.skippedDays).toEqual([d(3), d(5), d(6)]);
		expect(undone.checkOut).toBe(d(8));
		expect(() => undoLatestSkip(plan())).toThrow(/no skip to undo/);
	});
});

describe("planSkipBlocker", () => {
	const now = MON + 10 * 3_600_000; // Mon 5 Oct, 6 pm MYT
	test("an active plan inside its term can be skipped", () => {
		expect(planSkipBlocker(plan(), { now })).toBeNull();
	});
	test("names every state that can't take a skip", () => {
		expect(planSkipBlocker(plan({ status: "cancelled" }), { now })).toMatch(
			/cancelled/,
		);
		expect(
			planSkipBlocker(plan({ status: "booking_requested" }), { now }),
		).toMatch(/Approve the booking first/);
		expect(planSkipBlocker(plan({ status: "delivered" }), { now })).toMatch(
			/marked as ended/,
		);
		// Check-out morning: the plan is over.
		expect(planSkipBlocker(plan(), { now: d(5) + 3_600_000 })).toMatch(
			/has ended/,
		);
		// The last day itself is still skippable.
		expect(planSkipBlocker(plan(), { now: d(4) + 3_600_000 })).toBeNull();
		expect(todayMytMidnight(d(4) + 3_600_000)).toBe(d(4));
	});
	test("the listing's cap counts the customer's skips only", () => {
		const one = plan({
			bookingSkippedDays: [d(1), d(5), d(6)],
			bookingCustomerSkips: [d(1)],
		});
		expect(planSkipBlocker(one, { now, maxSkips: 2 })).toBeNull();
		expect(planSkipBlocker(one, { now, maxSkips: 1 })).toBe(
			"The one skip on this plan is used — the listing allows 1",
		);
	});
});

describe("helpers", () => {
	test("skipDayIssue allows past days inside the plan", () => {
		expect(skipDayIssue(plan(), d(0))).toBeNull();
	});
	test("closureSkippedDays drops the customer's own skips", () => {
		expect(
			closureSkippedDays({
				bookingSkippedDays: [d(2), d(5), d(6)],
				bookingCustomerSkips: [d(2)],
			}),
		).toEqual([d(5), d(6)]);
	});
	test("isSkippablePlan trusts the frozen flag over the listing", () => {
		expect(isSkippablePlan({ bookingPackaged: true }, true)).toBe(true);
		expect(isSkippablePlan({ bookingPackaged: true }, false)).toBe(false);
		expect(
			isSkippablePlan({ bookingPackaged: true, bookingOpenDays: true }, false),
		).toBe(true);
		expect(isSkippablePlan({ bookingPackaged: undefined }, true)).toBe(false);
	});
});

describe("the calendar feed follows a skip", () => {
	test("the feed's runs drop the skipped day and run to the new check-out", () => {
		const skipped = applyCustomerSkip(plan(), d(2), weekends);
		// The ICS feed reads these runs straight off the order (calendarFeed).
		expect(usedDayRuns(d(0), skipped.checkOut, skipped.skippedDays)).toEqual([
			{ start: d(0), endExclusive: d(2) },
			{ start: d(3), endExclusive: d(5) },
			{ start: d(7), endExclusive: d(8) },
		]);
	});
});

describe("allSkipsUsed", () => {
	test("reads like a person at 1, 2 and many", () => {
		expect(allSkipsUsed(1)).toBe("The one skip on this plan is used");
		expect(allSkipsUsed(2)).toBe("Both skips on this plan are used");
		expect(allSkipsUsed(5)).toBe("All 5 skips on this plan are used");
	});
});
