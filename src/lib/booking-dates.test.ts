import { describe, expect, it } from "vitest";
import { DAY_MS, MYT_OFFSET_MS } from "../../convex/lib/fulfilmentDate";
import {
	calendarDateFromMytEpoch,
	canCheckIn,
	conflictCeiling,
	latestCheckOutFor,
	mytEpochFromCalendarDate,
	mytMonthStart,
	bookingPriceSuffix,
	bookingSpanNoun,
	describeBookingSpan,
	nextBookingSelection,
	packageCountLabel,
	packageEnd,
	packageNights,
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

describe("fixed-length packages (S7)", () => {
	const pkg = (partial: Partial<SelectionContext> = {}) =>
		ctx({ packageLength: 30, ...partial });

	it("one tap picks the whole span — there is no check-out to choose", () => {
		const sel = nextBookingSelection({}, day(3), pkg());
		expect(sel.checkIn).toBe(day(3));
		expect(sel.checkOut).toBe(day(33));
	});

	it("tapping again just moves the start", () => {
		const first = nextBookingSelection({}, day(3), pkg());
		const second = nextBookingSelection(first, day(10), pkg());
		expect(second.checkIn).toBe(day(10));
		expect(second.checkOut).toBe(day(40));
	});

	it("a start is offered only when EVERY night it would occupy is free", () => {
		// One busy night 10 days out closes every start that would span it —
		// a package can't be shortened around it.
		const c = pkg({ unavailable: new Set([day(10)]) });
		expect(canCheckIn(day(11), c)).toBe(true); // starts after the busy night
		expect(canCheckIn(day(10), c)).toBe(false); // starts ON it
		expect(canCheckIn(day(5), c)).toBe(false); // would span it
		expect(nextBookingSelection({}, day(5), c)).toEqual({});
	});

	it("still respects the notice window and horizon", () => {
		const c = pkg({ earliestCheckIn: day(2), latestCheckIn: day(20) });
		expect(canCheckIn(day(1), c)).toBe(false);
		expect(canCheckIn(day(21), c)).toBe(false);
		expect(canCheckIn(day(2), c)).toBe(true);
	});

	it("packageNights lists exactly the days occupied", () => {
		expect(packageNights(day(0), 3)).toEqual([day(0), day(1), day(2)]);
	});

	it("crossing a month boundary lands on the right calendar day", () => {
		// 1 Sep + 30 days = 1 Oct, so the last usable day is 30 Sep.
		const sel = nextBookingSelection({}, day(0), pkg());
		const last = calendarDateFromMytEpoch((sel.checkOut ?? 0) - DAY_MS);
		expect(last.getMonth()).toBe(8); // September
		expect(last.getDate()).toBe(30);
	});
});

describe("booking copy helpers (S7)", () => {
	it("names the span it prices, rather than saying 'per package'", () => {
		// A gym's RM100 is "/month" — "per package" made the buyer open the
		// listing to find out what span they were buying, and made the seller's
		// own price field read "per night" while they typed a monthly fee.
		expect(bookingPriceSuffix(1, "month")).toBe("/month");
		expect(bookingPriceSuffix(3, "month")).toBe("/3 months");
		expect(bookingPriceSuffix(30, "day")).toBe("/30 days");
		expect(bookingPriceSuffix(1, "day")).toBe("/day");
		// A free-range stay is still per-night, and stays the default when no
		// unit is supplied.
		expect(bookingPriceSuffix(undefined)).toBe("/night");
		expect(bookingPriceSuffix(0)).toBe("/night");
		expect(bookingPriceSuffix(0, "month")).toBe("/night");
	});

	it("offers the bare span noun for prose that brings its own preposition", () => {
		expect(bookingSpanNoun(1, "month")).toBe("month");
		expect(bookingSpanNoun(2, "month")).toBe("2 months");
		expect(bookingSpanNoun(30, "day")).toBe("30 days");
		expect(bookingSpanNoun(undefined)).toBe("night");
	});

	it("a package reads as a validity window ending on its LAST usable day", () => {
		const fmt = (e: number) => String(calendarDateFromMytEpoch(e).getDate());
		// 1 Sep + 30 days: valid through the 30th, never "– 1 Oct".
		expect(
			describeBookingSpan(day(0), day(30), { isPackage: true, format: fmt }),
		).toBe("Valid 1 – 30");
		// A stay's check-out morning IS the day they leave.
		expect(
			describeBookingSpan(day(0), day(2), { isPackage: false, format: fmt }),
		).toBe("1 → 3");
	});
});

describe("package count label (the 'How many 2 dayss?' bug)", () => {
	it("never double-pluralises: the noun carries LENGTH, the caller carries COUNT", () => {
		// The reported string came from "How many " + bookingSpanNoun() + "s":
		// bookingSpanNoun already pluralises on the package's length, and the
		// caller pluralised again on the buyer's count.
		expect(packageCountLabel(2, "day")).toBe("2-day packages");
		expect(packageCountLabel(2, "day")).not.toContain("dayss");
		expect(packageCountLabel(2, "night")).toBe("2-night packages");
		// A length of one is just its unit — "How many months?" beats "How many
		// 1-month packages?".
		expect(packageCountLabel(1, "month")).toBe("months");
		expect(packageCountLabel(1, "night")).toBe("nights");
		expect(packageCountLabel(3, "month")).toBe("3-month packages");
	});

	it("carries the seller's word through the price suffix and span noun", () => {
		// "night" and "day" are the same arithmetic; only the word differs.
		expect(bookingPriceSuffix(2, "night")).toBe("/2 nights");
		expect(bookingPriceSuffix(1, "night")).toBe("/night");
		expect(bookingSpanNoun(2, "night")).toBe("2 nights");
		expect(packageEnd(0, 2, "night")).toBe(packageEnd(0, 2, "day"));
		expect(packageEnd(0, 2, "night", 3)).toBe(packageEnd(0, 2, "day", 3));
	});
});
