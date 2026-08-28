import { describe, expect, test } from "vitest";
import { MYT_OFFSET_MS } from "./fulfilmentDate";
import {
	assertWithinOpeningHours,
	type DayHours,
	defaultTimeWithinHours,
	formatDayWindow,
	hoursForDate,
	isAllDay,
	isOpenOnDate,
	MAX_CLOSE_MINUTES,
	OPEN_ALL_DAY,
	type OpeningHours,
	openingHoursSpecification,
	openNowStatus,
	sanitizeOpeningHours,
	selectableTimeWindow,
	weekdayIndexMyt,
} from "./openingHours";

// Fixed reference clock, matching fulfilmentDate.test.ts: 2026-06-26 (a
// FRIDAY) at 09:00 MYT = 01:00 UTC.
const NOW = Date.UTC(2026, 5, 26, 1, 0, 0);
const FRI_JUN_26 = Date.UTC(2026, 5, 26) - MYT_OFFSET_MS;
const SAT_JUN_27 = FRI_JUN_26 + 86_400_000;
const SUN_JUN_28 = SAT_JUN_27 + 86_400_000;

/** A week open 24h everywhere, with per-weekday overrides (0 = Sunday). */
function week(overrides: Partial<Record<number, DayHours>> = {}): OpeningHours {
	return Array.from({ length: 7 }, (_, i) => overrides[i] ?? { ...OPEN_ALL_DAY });
}

const NINE_TO_SIX: DayHours = { open: 9 * 60, close: 18 * 60 };

describe("weekdayIndexMyt", () => {
	test("reads the MYT calendar weekday off a midnight epoch", () => {
		expect(weekdayIndexMyt(FRI_JUN_26)).toBe(5);
		expect(weekdayIndexMyt(SAT_JUN_27)).toBe(6);
		expect(weekdayIndexMyt(SUN_JUN_28)).toBe(0);
	});
});

describe("sanitizeOpeningHours", () => {
	test("null (the explicit clear) comes back as undefined", () => {
		expect(sanitizeOpeningHours(null)).toBeUndefined();
	});

	test("an all-24h week normalizes to undefined — open 24/7 has one spelling", () => {
		expect(sanitizeOpeningHours(week())).toBeUndefined();
	});

	test("a real schedule survives; a false closed flag is dropped, true kept", () => {
		const out = sanitizeOpeningHours(
			week({
				1: { open: 540, close: 1080, closed: false },
				0: { open: 540, close: 1080, closed: true },
			}),
		);
		expect(out?.[1]).toEqual({ open: 540, close: 1080 });
		expect(out?.[0]).toEqual({ open: 540, close: 1080, closed: true });
	});

	test("rejects the wrong number of days", () => {
		expect(() =>
			sanitizeOpeningHours(week().slice(0, 6) as OpeningHours),
		).toThrow(/7 days/);
	});

	test("rejects open ≥ close, naming the weekday", () => {
		expect(() =>
			sanitizeOpeningHours(week({ 3: { open: 1080, close: 540 } })),
		).toThrow(/Wednesday/);
		expect(() =>
			sanitizeOpeningHours(week({ 3: { open: 540, close: 540 } })),
		).toThrow(/before/);
	});

	test("rejects non-integers and out-of-range minutes", () => {
		expect(() =>
			sanitizeOpeningHours(week({ 2: { open: 9.5, close: 1080 } })),
		).toThrow();
		expect(() =>
			sanitizeOpeningHours(week({ 2: { open: -5, close: 1080 } })),
		).toThrow();
		// 1440 ("24:00") is not expressible — 23:59 is the ceiling.
		expect(() =>
			sanitizeOpeningHours(week({ 2: { open: 0, close: 1440 } })),
		).toThrow();
	});

	test("rejects an all-closed week — a store must keep one pickable day", () => {
		const allClosed = Array.from({ length: 7 }, () => ({
			open: 540,
			close: 1080,
			closed: true as const,
		}));
		expect(() => sanitizeOpeningHours(allClosed)).toThrow(/at least one day/);
	});

	test("a closed day still validates its (kept) times", () => {
		expect(() =>
			sanitizeOpeningHours(week({ 4: { open: 1080, close: 540, closed: true } })),
		).toThrow(/Thursday/);
	});
});

describe("hoursForDate / isOpenOnDate", () => {
	test("unset hours mean fully open, every day", () => {
		expect(hoursForDate(undefined, FRI_JUN_26)).toEqual(OPEN_ALL_DAY);
		expect(isOpenOnDate(undefined, SUN_JUN_28)).toBe(true);
	});

	test("a closed weekday resolves to null; an open one to its window", () => {
		const hours = week({ 5: { ...NINE_TO_SIX, closed: true }, 6: NINE_TO_SIX });
		expect(hoursForDate(hours, FRI_JUN_26)).toBeNull();
		expect(isOpenOnDate(hours, FRI_JUN_26)).toBe(false);
		expect(hoursForDate(hours, SAT_JUN_27)).toEqual(NINE_TO_SIX);
	});
});

describe("assertWithinOpeningHours", () => {
	test("unset hours never throw", () => {
		expect(() =>
			assertWithinOpeningHours(undefined, FRI_JUN_26, 3 * 60),
		).not.toThrow();
	});

	test("a closed day throws, naming the weekday — with or without a time", () => {
		const hours = week({ 5: { ...NINE_TO_SIX, closed: true } });
		expect(() =>
			assertWithinOpeningHours(hours, FRI_JUN_26, undefined),
		).toThrow(/closed on Fridays/);
		expect(() => assertWithinOpeningHours(hours, FRI_JUN_26, 600)).toThrow(
			/closed on Fridays/,
		);
	});

	test("the window is INCLUSIVE at both ends; outside throws with the hours", () => {
		const hours = week({ 5: NINE_TO_SIX });
		expect(() =>
			assertWithinOpeningHours(hours, FRI_JUN_26, 9 * 60),
		).not.toThrow();
		expect(() =>
			assertWithinOpeningHours(hours, FRI_JUN_26, 18 * 60),
		).not.toThrow();
		expect(() =>
			assertWithinOpeningHours(hours, FRI_JUN_26, 9 * 60 - 1),
		).toThrow(/9:00 AM – 6:00 PM/);
		expect(() =>
			assertWithinOpeningHours(hours, FRI_JUN_26, 18 * 60 + 1),
		).toThrow(/pick a time inside/);
	});

	test("a date-only check on an open day passes (pickup orders)", () => {
		const hours = week({ 5: NINE_TO_SIX });
		expect(() =>
			assertWithinOpeningHours(hours, FRI_JUN_26, undefined),
		).not.toThrow();
	});
});

describe("selectableTimeWindow", () => {
	test("today: the lead floor raises the opening (09:00 now → 09:15 floor)", () => {
		const hours = week({ 5: NINE_TO_SIX });
		// mytMinutesOfDay(NOW) = 540; +15 lead, ceil to 5 → 555.
		expect(selectableTimeWindow(hours, FRI_JUN_26, NOW)).toEqual({
			min: 555,
			max: 18 * 60,
		});
	});

	test("a future day is free from the opening time", () => {
		const hours = week({ 6: NINE_TO_SIX });
		expect(selectableTimeWindow(hours, SAT_JUN_27, NOW)).toEqual({
			min: 9 * 60,
			max: 18 * 60,
		});
	});

	test("null when the day is closed, or today's window has already passed", () => {
		const closedFri = week({ 5: { ...NINE_TO_SIX, closed: true } });
		expect(selectableTimeWindow(closedFri, FRI_JUN_26, NOW)).toBeNull();
		// Store closed at 08:20 — it's 09:00, floor 555 > close 500.
		const earlyFri = week({ 5: { open: 300, close: 500 } });
		expect(selectableTimeWindow(earlyFri, FRI_JUN_26, NOW)).toBeNull();
	});

	test("unset hours degrade to exactly the pre-hours floor behaviour", () => {
		expect(selectableTimeWindow(undefined, FRI_JUN_26, NOW)).toEqual({
			min: 555,
			max: MAX_CLOSE_MINUTES,
		});
	});
});

describe("defaultTimeWithinHours", () => {
	test("future day: 10:00 AM when inside the window, clamped when not", () => {
		expect(defaultTimeWithinHours(week({ 6: NINE_TO_SIX }), SAT_JUN_27, NOW)).toBe(
			10 * 60,
		);
		// Dinner stall opening 5 PM — clamp up to opening.
		expect(
			defaultTimeWithinHours(
				week({ 6: { open: 17 * 60, close: 23 * 60 } }),
				SAT_JUN_27,
				NOW,
			),
		).toBe(17 * 60);
		// Breakfast stall closing 9 AM — clamp down to closing.
		expect(
			defaultTimeWithinHours(
				week({ 6: { open: 5 * 60, close: 9 * 60 } }),
				SAT_JUN_27,
				NOW,
			),
		).toBe(9 * 60);
	});

	test("today starts at the window's floor; a dead day returns null", () => {
		expect(defaultTimeWithinHours(week({ 5: NINE_TO_SIX }), FRI_JUN_26, NOW)).toBe(
			555,
		);
		expect(
			defaultTimeWithinHours(
				week({ 5: { ...NINE_TO_SIX, closed: true } }),
				FRI_JUN_26,
				NOW,
			),
		).toBeNull();
	});
});

describe("openNowStatus", () => {
	test("open exactly at opening time (boundary inclusive)", () => {
		const status = openNowStatus(week({ 5: NINE_TO_SIX }), NOW); // 09:00 now
		expect(status.open).toBe(true);
		if (status.open) expect(status.day).toEqual(NINE_TO_SIX);
	});

	test("before today's opening → opens later today", () => {
		const status = openNowStatus(week({ 5: { open: 600, close: 1080 } }), NOW);
		expect(status).toEqual({
			open: false,
			nextOpen: { daysAhead: 0, openMinutes: 600 },
		});
	});

	test("after today's close → scans forward past closed days", () => {
		const status = openNowStatus(
			week({
				5: { open: 300, close: 500 }, // closed by 09:00
				6: { ...NINE_TO_SIX, closed: true }, // Saturday shut
				0: { open: 8 * 60, close: 17 * 60 }, // Sunday reopens
			}),
			NOW,
		);
		expect(status).toEqual({
			open: false,
			nextOpen: { daysAhead: 2, openMinutes: 8 * 60 },
		});
	});

	test("a (sanitizer-forbidden) all-closed week reports no next opening", () => {
		const allClosed = week();
		for (const day of allClosed) day.closed = true;
		expect(openNowStatus(allClosed, NOW)).toEqual({
			open: false,
			nextOpen: null,
		});
	});
});

describe("formatDayWindow / isAllDay", () => {
	test("a full day reads as 'Open 24 hours', anything else as a range", () => {
		expect(isAllDay(OPEN_ALL_DAY)).toBe(true);
		expect(formatDayWindow(OPEN_ALL_DAY)).toBe("Open 24 hours");
		expect(formatDayWindow(NINE_TO_SIX)).toBe("9:00 AM – 6:00 PM");
	});
});

describe("openingHoursSpecification (Store JSON-LD)", () => {
	test("emits open days only, in schema.org's 24h HH:MM format", () => {
		const rows = openingHoursSpecification(
			week({
				0: { ...NINE_TO_SIX, closed: true },
				1: { open: 9 * 60 + 30, close: 21 * 60 },
			}),
		);
		expect(rows).toHaveLength(6);
		expect(rows.find((r) => r.dayOfWeek === "Sunday")).toBeUndefined();
		expect(rows.find((r) => r.dayOfWeek === "Monday")).toEqual({
			"@type": "OpeningHoursSpecification",
			dayOfWeek: "Monday",
			opens: "09:30",
			closes: "21:00",
		});
	});
});
