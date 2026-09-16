import { describe, expect, test } from "vitest";
import {
	DAY_MS,
	MYT_OFFSET_MS,
	mytMidnightFromYmd,
	todayMytMidnight,
} from "./fulfilmentDate";
import {
	daysUntilEvent,
	describeEvent,
	formatEventBadge,
	hiddenFromStorefront,
	isEventPassed,
	MAX_EVENT_SEATS,
	sanitizeEvent,
	seatsLeft,
} from "./productEvent";

/** 25 Sep 2026 was a Friday; the badge tests pin real weekday output. */
const SEP_25_2026 = mytMidnightFromYmd("2026-09-25");
/** An instant on 1 Sep 2026, MYT — "now" for the year-elision tests. */
const NOW_2026 = mytMidnightFromYmd("2026-09-01") + 10 * 60 * 60 * 1000;

describe("sanitizeEvent", () => {
	const today = todayMytMidnight();

	test("undefined stays undefined — no event is a valid answer", () => {
		expect(sanitizeEvent(undefined)).toBeUndefined();
	});

	test("accepts today, refuses yesterday", () => {
		expect(sanitizeEvent({ date: today })?.date).toBe(today);
		expect(() => sanitizeEvent({ date: today - DAY_MS })).toThrow(
			/can't be in the past/i,
		);
	});

	test("allowPastDate lets a finished event be re-saved", () => {
		// The morning-after case: fixing a seat cap on an event that already ran
		// must not be refused for the date it has always had.
		expect(
			sanitizeEvent({ date: today - 3 * DAY_MS }, { allowPastDate: true })?.date,
		).toBe(today - 3 * DAY_MS);
	});

	test("the date must be a calendar day, not an arbitrary instant", () => {
		expect(() => sanitizeEvent({ date: today + 3600_000 })).toThrow(
			/calendar day/i,
		);
	});

	test("a missing date is refused — an event IS its date", () => {
		expect(() => sanitizeEvent({ seats: 30 })).toThrow(/needs a date/i);
	});

	test("time is a time of day, and midnight is legal", () => {
		expect(sanitizeEvent({ date: today, timeMinutes: 0 })?.timeMinutes).toBe(0);
		expect(sanitizeEvent({ date: today, timeMinutes: 1439 })?.timeMinutes).toBe(
			1439,
		);
		expect(() => sanitizeEvent({ date: today, timeMinutes: 1440 })).toThrow(
			/time of day/i,
		);
		expect(() => sanitizeEvent({ date: today, timeMinutes: -1 })).toThrow(
			/time of day/i,
		);
	});

	test("0 seats normalizes to UNSET — 'no limit' has one spelling", () => {
		// The trap this guards: a stored 0 reads as "sold out" to seatsLeft, so
		// an uncapped event would render as fully booked from the first render.
		expect(sanitizeEvent({ date: today, seats: 0 })?.seats).toBeUndefined();
		expect(sanitizeEvent({ date: today })?.seats).toBeUndefined();
	});

	test("seats are bounded 1..MAX", () => {
		expect(sanitizeEvent({ date: today, seats: 1 })?.seats).toBe(1);
		expect(sanitizeEvent({ date: today, seats: MAX_EVENT_SEATS })?.seats).toBe(
			MAX_EVENT_SEATS,
		);
		expect(() =>
			sanitizeEvent({ date: today, seats: MAX_EVENT_SEATS + 1 }),
		).toThrow(/between 1 and/i);
		expect(() => sanitizeEvent({ date: today, seats: 2.5 })).toThrow(
			/whole number/i,
		);
	});
});

describe("isEventPassed / hiddenFromStorefront", () => {
	const today = todayMytMidnight();

	test("an event stays up for its WHOLE day and goes the next morning", () => {
		// The guest checking the venue at 7 AM for an 8 AM breakfast must still
		// find the listing.
		expect(isEventPassed({ date: today }, today + 23 * 60 * 60 * 1000)).toBe(
			false,
		);
		expect(isEventPassed({ date: today }, today + DAY_MS)).toBe(true);
	});

	test("a future event is never passed", () => {
		expect(isEventPassed({ date: today + 5 * DAY_MS })).toBe(false);
	});

	test("a product with no event is never hidden by this rule", () => {
		expect(hiddenFromStorefront({})).toBe(false);
		expect(hiddenFromStorefront({ event: { date: today } })).toBe(false);
		expect(hiddenFromStorefront({ event: { date: today - DAY_MS } })).toBe(true);
	});

	test("daysUntilEvent counts calendar days either side of today", () => {
		expect(daysUntilEvent({ date: today })).toBe(0);
		expect(daysUntilEvent({ date: today + 9 * DAY_MS })).toBe(9);
		expect(daysUntilEvent({ date: today - 3 * DAY_MS })).toBe(-3);
	});
});

describe("seatsLeft", () => {
	test("uncapped returns undefined, not a number", () => {
		expect(seatsLeft({}, 12)).toBeUndefined();
	});

	test("counts down and CLAMPS at zero", () => {
		expect(seatsLeft({ seats: 30 }, 18)).toBe(12);
		expect(seatsLeft({ seats: 30 }, 30)).toBe(0);
		// A cap lowered below what's taken must read 0, never "-3 seats left".
		expect(seatsLeft({ seats: 5 }, 8)).toBe(0);
	});
});

describe("formatEventBadge / describeEvent", () => {
	test("drops the year inside the current year, keeps it beyond", () => {
		expect(
			formatEventBadge({ date: SEP_25_2026, timeMinutes: 8 * 60 }, NOW_2026),
		).toBe("Fri 25 Sep · 8:00 AM");
		// An event 14 months out: "Fri 25 Sep" alone would be a lie of omission.
		expect(formatEventBadge({ date: SEP_25_2026 }, NOW_2026 - 400 * DAY_MS)).toBe(
			"Fri 25 Sep 2026",
		);
	});

	test("an all-day event shows no time", () => {
		expect(formatEventBadge({ date: SEP_25_2026 }, NOW_2026)).toBe("Fri 25 Sep");
	});

	test("describeEvent pluralises the seat count", () => {
		expect(
			describeEvent({ date: SEP_25_2026, seats: 1 }, NOW_2026),
		).toBe("Event · Fri 25 Sep · 1 seat");
		expect(
			describeEvent({ date: SEP_25_2026, seats: 30 }, NOW_2026),
		).toBe("Event · Fri 25 Sep · 30 seats");
		// Uncapped says nothing about seats rather than "0 seats".
		expect(describeEvent({ date: SEP_25_2026 }, NOW_2026)).toBe(
			"Event · Fri 25 Sep",
		);
	});

	test("the badge reads in MYT, not the runner's timezone", () => {
		// 25 Sep MYT midnight is 24 Sep 16:00 UTC — a UTC-based formatter would
		// print the day before for every Malaysian event.
		expect(new Date(SEP_25_2026 + MYT_OFFSET_MS).getUTCDate()).toBe(25);
		expect(formatEventBadge({ date: SEP_25_2026 }, NOW_2026)).toContain("25 Sep");
	});
});
