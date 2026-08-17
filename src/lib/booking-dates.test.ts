import { describe, expect, it } from "vitest";
import { DAY_MS, MYT_OFFSET_MS } from "../../convex/lib/fulfilmentDate";
import {
	calendarDateFromMytEpoch,
	canCheckIn,
	conflictCeiling,
	latestCheckOutFor,
	mytEpochFromCalendarDate,
	mytMonthStart,
	nextBookingSelection,
	type SelectionContext,
} from "./booking-dates";

const D0 = Date.UTC(2026, 8, 1) - MYT_OFFSET_MS; // 1 Sep 2026, MYT midnight
const day = (offset: number) => D0 + offset * DAY_MS;

function ctx(partial: Partial<SelectionContext> = {}): SelectionContext {
	return {
		unavailable: new Set<number>(),
		earliestCheckIn: day(0),
		latestCheckIn: day(180),
		maxNights: 30,
		...partial,
	};
}

describe("MYT ⟷ calendar date conversion", () => {
	it("round-trips regardless of the runner's timezone", () => {
		const date = calendarDateFromMytEpoch(day(24));
		expect(date.getDate()).toBe(25); // 25 Sep 2026
		expect(mytEpochFromCalendarDate(date)).toBe(day(24));
	});

	it("month starts align to MYT months", () => {
		expect(mytMonthStart(day(24))).toBe(day(0));
	});
});

describe("two-tap selection", () => {
	it("first tap sets check-in, second later tap completes the range", () => {
		const c = ctx();
		let sel = nextBookingSelection({}, day(24), c);
		expect(sel).toEqual({ checkIn: day(24) });
		sel = nextBookingSelection(sel, day(26), c);
		expect(sel).toEqual({ checkIn: day(24), checkOut: day(26) });
		// A third tap starts a fresh stay.
		sel = nextBookingSelection(sel, day(10), c);
		expect(sel).toEqual({ checkIn: day(10) });
	});

	it("an earlier tap during check-out picking restarts from that day", () => {
		const c = ctx();
		const sel = nextBookingSelection(
			{ checkIn: day(24) },
			day(20),
			c,
		);
		expect(sel).toEqual({ checkIn: day(20) });
	});

	it("never starts a stay on an unavailable night", () => {
		const c = ctx({ unavailable: new Set([day(24)]) });
		expect(canCheckIn(day(24), c)).toBe(false);
		expect(nextBookingSelection({}, day(24), c)).toEqual({});
	});
});

describe("checkout-only handling (the design's partial-range state)", () => {
	// Nights 11 + 12 (12/13 Sep) full; check-in Fri 11 Sep = day(10).
	const c = ctx({ unavailable: new Set([day(11), day(12)]) });

	it("the first full night is the LATEST check-out — leaving that morning is fine", () => {
		expect(latestCheckOutFor(day(10), c)).toBe(day(11));
	});

	it("completing the range at the ceiling works; past it is refused", () => {
		const sel = { checkIn: day(10) };
		expect(nextBookingSelection(sel, day(11), c)).toEqual({
			checkIn: day(10),
			checkOut: day(11),
		});
		expect(nextBookingSelection(sel, day(13), c)).toEqual(sel);
	});

	it("explains the ceiling, and stays quiet when the window is open", () => {
		expect(conflictCeiling(day(10), c)).toEqual({
			latestCheckOut: day(11),
			maxStayNights: 1,
		});
		expect(conflictCeiling(day(20), c)).toBeNull();
	});

	it("max-nights caps the run even with no full night in the way", () => {
		const short = ctx({ maxNights: 3 });
		expect(latestCheckOutFor(day(10), short)).toBe(day(13));
		expect(conflictCeiling(day(10), short)).toBeNull();
	});
});
