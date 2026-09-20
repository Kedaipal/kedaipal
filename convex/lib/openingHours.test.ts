import { describe, expect, test } from "vitest";
import {
	assertWithinOpeningHours,
	type DayHours,
	dayGaps,
	dayHoursError,
	dayHoursIssue,
	dayWindows,
	defaultTimeWithinHours,
	formatDayWindow,
	gapForTime,
	hasSecondWindow,
	hoursForDate,
	isAllDay,
	isOpenOnDate,
	isTimeSelectable,
	MAX_CLOSE_MINUTES,
	nextSelectableTime,
	OPEN_ALL_DAY,
	type OpeningHours,
	openingHoursSpecification,
	openNowStatus,
	sanitizeOpeningHours,
	selectableTimeWindow,
	selectableTimeWindows,
} from "./openingHours";
import { MYT_OFFSET_MS, weekdayIndexMyt } from "./fulfilmentDate";

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
/** Huff & Puff's schedule (z8r3fdff8r): breakfast 7:30–10:00, then the cafe
 * window 12:00–18:00, shut in between. */
const SPLIT_DAY: DayHours = {
	open: 7 * 60 + 30,
	close: 10 * 60,
	open2: 12 * 60,
	close2: 18 * 60,
};

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


// ---------------------------------------------------------------------------
// Split days — two windows (z8r3fdff8r)
// ---------------------------------------------------------------------------

describe("dayWindows / dayGaps / hasSecondWindow", () => {
	test("an unsplit day is one window with no gap", () => {
		expect(dayWindows(NINE_TO_SIX)).toEqual([{ open: 540, close: 1080 }]);
		expect(dayGaps(NINE_TO_SIX)).toEqual([]);
		expect(hasSecondWindow(NINE_TO_SIX)).toBe(false);
	});

	test("a split day is two windows with the break between them", () => {
		expect(dayWindows(SPLIT_DAY)).toEqual([
			{ open: 450, close: 600 },
			{ open: 720, close: 1080 },
		]);
		expect(dayGaps(SPLIT_DAY)).toEqual([{ open: 600, close: 720 }]);
		expect(hasSecondWindow(SPLIT_DAY)).toBe(true);
	});

	test("a HALF pair is ignored rather than guessed at", () => {
		const half: DayHours = { open: 540, close: 600, open2: 720 };
		expect(dayWindows(half)).toEqual([{ open: 540, close: 600 }]);
		expect(hasSecondWindow(half)).toBe(false);
	});

	test("gapForTime names the break only for a moment inside it", () => {
		expect(gapForTime(SPLIT_DAY, 11 * 60)).toEqual({ open: 600, close: 720 });
		// Both window bounds are OPEN moments, so neither edge is "in the gap".
		expect(gapForTime(SPLIT_DAY, 600)).toBeNull();
		expect(gapForTime(SPLIT_DAY, 720)).toBeNull();
		// Before opening / after closing is not a gap — it's outside the day.
		expect(gapForTime(SPLIT_DAY, 7 * 60)).toBeNull();
		expect(gapForTime(SPLIT_DAY, 19 * 60)).toBeNull();
	});
});

describe("formatDayWindow with two windows", () => {
	test("prints both, comma-separated", () => {
		expect(formatDayWindow(SPLIT_DAY)).toBe(
			"7:30 AM – 10:00 AM, 12:00 PM – 6:00 PM",
		);
	});
});

describe("dayHoursError (the one shared rule-set)", () => {
	test("accepts an unsplit day and a well-formed split one", () => {
		expect(dayHoursError(NINE_TO_SIX)).toBeNull();
		expect(dayHoursError(SPLIT_DAY)).toBeNull();
		expect(dayHoursError(OPEN_ALL_DAY)).toBeNull();
	});

	test("the second window must start AFTER the first closes", () => {
		expect(
			dayHoursError({ open: 450, close: 600, open2: 600, close2: 1080 }),
		).toMatch(/must start after 10:00 AM/);
		expect(
			dayHoursError({ open: 450, close: 600, open2: 540, close2: 1080 }),
		).toMatch(/must start after 10:00 AM/);
	});

	test("the second window's own bounds are checked", () => {
		expect(
			dayHoursError({ open: 450, close: 600, open2: 720, close2: 720 }),
		).toMatch(/before its closing time/);
		// The 11:59 PM cap speaks only when it is the actual problem.
		expect(
			dayHoursError({ open: 450, close: 600, open2: 720, close2: 1440 }),
		).toBe("the second window can close at 11:59 PM at the latest");
	});

	test("an all-day first window refuses a second", () => {
		expect(
			dayHoursError({ open: 0, close: MAX_CLOSE_MINUTES, open2: 600, close2: 700 }),
		).toMatch(/already covers the whole day/);
	});
});

describe("sanitizeOpeningHours with split days", () => {
	test("keeps a valid second window and drops a half pair", () => {
		const out = sanitizeOpeningHours(
			week({ 1: SPLIT_DAY, 2: { open: 540, close: 1080, open2: 1200 } }),
		);
		expect(out?.[1]).toEqual(SPLIT_DAY);
		// Half pair dropped — one spelling for "no second window".
		expect(out?.[2]).toEqual({ open: 540, close: 1080 });
	});

	test("refuses an out-of-order second window, naming the day", () => {
		expect(() =>
			sanitizeOpeningHours(
				week({ 3: { open: 540, close: 600, open2: 550, close2: 1080 } }),
			),
		).toThrow(/Wednesday: the second window must start after 10:00 AM/);
	});

	test("refuses a second window beside an all-day first one", () => {
		expect(() =>
			sanitizeOpeningHours(
				week({ 4: { open: 0, close: MAX_CLOSE_MINUTES, open2: 600, close2: 700 } }),
			),
		).toThrow(/Thursday: the first window already covers the whole day/);
	});

	test("an all-24h week still normalises to unset", () => {
		expect(sanitizeOpeningHours(week())).toBeUndefined();
	});

	test("removing the second window is byte-identical to a plain day", () => {
		const out = sanitizeOpeningHours(week({ 1: { open: 540, close: 1080 } }));
		expect(out?.[1]).toEqual({ open: 540, close: 1080 });
		expect(Object.keys(out?.[1] ?? {})).toEqual(["open", "close"]);
	});

	test("a closed split day keeps both windows for when it re-opens", () => {
		const out = sanitizeOpeningHours(
			week({ 0: { ...SPLIT_DAY, closed: true }, 1: NINE_TO_SIX }),
		);
		expect(out?.[0]).toEqual({ ...SPLIT_DAY, closed: true });
	});
});

describe("assertWithinOpeningHours across a break", () => {
	const hours = week({ 5: SPLIT_DAY });

	test("both windows are accepted, edges included", () => {
		for (const minute of [450, 600, 720, 1080]) {
			expect(() =>
				assertWithinOpeningHours(hours, FRI_JUN_26, minute),
			).not.toThrow();
		}
	});

	test("a moment in the break is refused, and the break is NAMED", () => {
		expect(() => assertWithinOpeningHours(hours, FRI_JUN_26, 11 * 60)).toThrow(
			/closed 10:00 AM – 12:00 PM that day — pick a time in an open window/,
		);
	});

	test("outside the whole day still reports the hours", () => {
		expect(() => assertWithinOpeningHours(hours, FRI_JUN_26, 7 * 60)).toThrow(
			/open 7:30 AM – 10:00 AM, 12:00 PM – 6:00 PM/,
		);
		expect(() => assertWithinOpeningHours(hours, FRI_JUN_26, 19 * 60)).toThrow(
			/open 7:30 AM – 10:00 AM, 12:00 PM – 6:00 PM/,
		);
	});

	test("a date-only (pickup) check ignores the break entirely", () => {
		expect(() =>
			assertWithinOpeningHours(hours, FRI_JUN_26, undefined),
		).not.toThrow();
	});
});

describe("selectableTimeWindows / isTimeSelectable", () => {
	test("a future split day offers both windows, unfloored", () => {
		expect(selectableTimeWindows(week({ 6: SPLIT_DAY }), SAT_JUN_27, NOW)).toEqual(
			[
				{ open: 450, close: 600 },
				{ open: 720, close: 1080 },
			],
		);
	});

	test("today's floor trims the first window and can drop it entirely", () => {
		// NOW is 09:00 → floor 09:15 → the breakfast window shrinks.
		expect(selectableTimeWindows(week({ 5: SPLIT_DAY }), FRI_JUN_26, NOW)).toEqual(
			[
				{ open: 555, close: 600 },
				{ open: 720, close: 1080 },
			],
		);
		// At 10:30 the breakfast window is gone; only the cafe window is left.
		const later = Date.UTC(2026, 5, 26, 2, 30, 0);
		expect(
			selectableTimeWindows(week({ 5: SPLIT_DAY }), FRI_JUN_26, later),
		).toEqual([{ open: 720, close: 1080 }]);
	});

	test("the HULL is what a single-range time input can express", () => {
		expect(selectableTimeWindow(week({ 6: SPLIT_DAY }), SAT_JUN_27, NOW)).toEqual({
			min: 450,
			max: 1080,
		});
	});

	test("isTimeSelectable fences the break the hull cannot", () => {
		const hours = week({ 6: SPLIT_DAY });
		expect(isTimeSelectable(hours, SAT_JUN_27, 9 * 60, NOW)).toBe(true);
		expect(isTimeSelectable(hours, SAT_JUN_27, 11 * 60, NOW)).toBe(false);
		expect(isTimeSelectable(hours, SAT_JUN_27, 13 * 60, NOW)).toBe(true);
		// Before the day opens / after it closes.
		expect(isTimeSelectable(hours, SAT_JUN_27, 7 * 60, NOW)).toBe(false);
		expect(isTimeSelectable(hours, SAT_JUN_27, 19 * 60, NOW)).toBe(false);
	});
});

describe("defaultTimeWithinHours across a break", () => {
	test("a future day's 10:00 default lands ON the breakfast close", () => {
		expect(
			defaultTimeWithinHours(week({ 6: SPLIT_DAY }), SAT_JUN_27, NOW),
		).toBe(10 * 60);
	});

	test("a 10:00 default past the first window jumps to the second", () => {
		const earlyClose: DayHours = { ...SPLIT_DAY, close: 9 * 60 };
		expect(
			defaultTimeWithinHours(week({ 6: earlyClose }), SAT_JUN_27, NOW),
		).toBe(12 * 60);
	});

	test("today, once the first window has passed, prefills the second", () => {
		const later = Date.UTC(2026, 5, 26, 2, 30, 0); // 10:30 MYT
		expect(
			defaultTimeWithinHours(week({ 5: SPLIT_DAY }), FRI_JUN_26, later),
		).toBe(12 * 60);
	});

	test("never prefills INTO the break", () => {
		const hours = week({ 5: SPLIT_DAY, 6: SPLIT_DAY });
		for (const [epoch, now] of [
			[FRI_JUN_26, NOW],
			[SAT_JUN_27, NOW],
			[FRI_JUN_26, Date.UTC(2026, 5, 26, 2, 30, 0)],
		] as const) {
			const next = defaultTimeWithinHours(hours, epoch, now);
			expect(next).not.toBeNull();
			expect(isTimeSelectable(hours, epoch, next as number, now)).toBe(true);
		}
	});
});

describe("openNowStatus across a break", () => {
	test("inside the first window, 'until' is THAT window's close", () => {
		// NOW = Friday 09:00, inside 7:30–10:00.
		const status = openNowStatus(week({ 5: SPLIT_DAY }), NOW);
		expect(status.open).toBe(true);
		if (status.open) expect(status.until).toBe(10 * 60);
	});

	test("inside the break, the store reopens LATER TODAY", () => {
		const elevenAm = Date.UTC(2026, 5, 26, 3, 0, 0);
		const status = openNowStatus(week({ 5: SPLIT_DAY }), elevenAm);
		expect(status).toEqual({
			open: false,
			nextOpen: { daysAhead: 0, openMinutes: 12 * 60 },
		});
	});

	test("inside the second window, 'until' is the day's last close", () => {
		const onePm = Date.UTC(2026, 5, 26, 5, 0, 0);
		const status = openNowStatus(week({ 5: SPLIT_DAY }), onePm);
		expect(status.open).toBe(true);
		if (status.open) expect(status.until).toBe(18 * 60);
	});

	test("after the last window, the next opening is tomorrow", () => {
		const sevenPm = Date.UTC(2026, 5, 26, 11, 0, 0);
		const status = openNowStatus(
			week({ 5: SPLIT_DAY, 6: NINE_TO_SIX }),
			sevenPm,
		);
		expect(status).toEqual({
			open: false,
			nextOpen: { daysAhead: 1, openMinutes: 9 * 60 },
		});
	});
});

describe("openingHoursSpecification with split days", () => {
	test("emits one row PER WINDOW — schema.org's own lunch-break shape", () => {
		const rows = openingHoursSpecification(
			Array.from({ length: 7 }, (_, i) =>
				i === 1 ? SPLIT_DAY : { ...OPEN_ALL_DAY, closed: true },
			),
		);
		expect(rows).toEqual([
			{
				"@type": "OpeningHoursSpecification",
				dayOfWeek: "Monday",
				opens: "07:30",
				closes: "10:00",
			},
			{
				"@type": "OpeningHoursSpecification",
				dayOfWeek: "Monday",
				opens: "12:00",
				closes: "18:00",
			},
		]);
	});
});

describe("single-window behaviour is untouched", () => {
	test("hoursForDate / isAllDay / the hull all read as before", () => {
		const hours = week({ 5: NINE_TO_SIX, 6: NINE_TO_SIX });
		expect(hoursForDate(hours, FRI_JUN_26)).toEqual(NINE_TO_SIX);
		expect(isOpenOnDate(hours, FRI_JUN_26)).toBe(true);
		expect(isAllDay(OPEN_ALL_DAY)).toBe(true);
		expect(dayGaps(NINE_TO_SIX)).toEqual([]);
		expect(selectableTimeWindow(hours, SAT_JUN_27, NOW)).toEqual({
			min: 540,
			max: 1080,
		});
	});
});


// ---------------------------------------------------------------------------
// Prep floor — the T2 seam (z8r3fdff97)
// ---------------------------------------------------------------------------

describe("prepMinutes raises the selectable floor", () => {
	test("omitting it is byte-identical to before — every existing caller", () => {
		const hours = week({ 5: NINE_TO_SIX, 6: NINE_TO_SIX });
		expect(selectableTimeWindows(hours, FRI_JUN_26, NOW)).toEqual(
			selectableTimeWindows(hours, FRI_JUN_26, NOW, 0),
		);
		expect(defaultTimeWithinHours(hours, SAT_JUN_27, NOW)).toBe(
			defaultTimeWithinHours(hours, SAT_JUN_27, NOW, 0),
		);
	});

	test("today: the floor is now + the LONGER of the flat lead and prep", () => {
		const hours = week({ 5: NINE_TO_SIX });
		// NOW = 09:00. Flat lead 15 → 09:15. A 90-minute prep → 10:30.
		expect(selectableTimeWindows(hours, FRI_JUN_26, NOW, 90)).toEqual([
			{ open: 10 * 60 + 30, close: 18 * 60 },
		]);
		// A prep SHORTER than the flat lead never shortens it.
		expect(selectableTimeWindows(hours, FRI_JUN_26, NOW, 5)).toEqual([
			{ open: 9 * 60 + 15, close: 18 * 60 },
		]);
		// Neither does a nonsense one.
		expect(selectableTimeWindows(hours, FRI_JUN_26, NOW, -60)).toEqual([
			{ open: 9 * 60 + 15, close: 18 * 60 },
		]);
		expect(
			selectableTimeWindows(hours, FRI_JUN_26, NOW, Number.NaN),
		).toEqual([{ open: 9 * 60 + 15, close: 18 * 60 }]);
	});

	test("a future day is untouched — prep is absorbed overnight", () => {
		const hours = week({ 6: NINE_TO_SIX });
		expect(selectableTimeWindows(hours, SAT_JUN_27, NOW, 600)).toEqual([
			{ open: 9 * 60, close: 18 * 60 },
		]);
		expect(defaultTimeWithinHours(hours, SAT_JUN_27, NOW, 600)).toBe(10 * 60);
	});

	test("prep can swallow a SPLIT day's first window whole", () => {
		const hours = week({ 5: SPLIT_DAY });
		// NOW = 09:00 + 150 min prep = 11:30, past the 10:00 breakfast close.
		expect(selectableTimeWindows(hours, FRI_JUN_26, NOW, 150)).toEqual([
			{ open: 12 * 60, close: 18 * 60 },
		]);
		// The prefill follows it into window 2 rather than into the break.
		expect(defaultTimeWithinHours(hours, FRI_JUN_26, NOW, 150)).toBe(12 * 60);
		expect(isTimeSelectable(hours, FRI_JUN_26, 9 * 60 + 30, NOW, 150)).toBe(
			false,
		);
		expect(isTimeSelectable(hours, FRI_JUN_26, 13 * 60, NOW, 150)).toBe(true);
	});

	test("prep past the last close leaves the day unpickable", () => {
		const hours = week({ 5: SPLIT_DAY });
		expect(selectableTimeWindows(hours, FRI_JUN_26, NOW, 12 * 60)).toEqual([]);
		expect(selectableTimeWindow(hours, FRI_JUN_26, NOW, 12 * 60)).toBeNull();
		expect(defaultTimeWithinHours(hours, FRI_JUN_26, NOW, 12 * 60)).toBeNull();
	});

	test("the hull still bounds a prep-trimmed split day", () => {
		const hours = week({ 5: SPLIT_DAY });
		expect(selectableTimeWindow(hours, FRI_JUN_26, NOW, 30)).toEqual({
			min: 9 * 60 + 30,
			max: 18 * 60,
		});
	});
});


// ---------------------------------------------------------------------------
// Which window is wrong, and precise sentences (z8r3fdff8r test round)
// ---------------------------------------------------------------------------

describe("dayHoursIssue names the window at fault", () => {
	test("a bad first window points at the first window", () => {
		expect(dayHoursIssue({ open: 600, close: 540 })).toEqual({
			message: "opening time must be before closing time",
			window: "first",
		});
		expect(dayHoursIssue({ open: 540, close: 1440 })).toEqual({
			message: "closing time can be 11:59 PM at the latest",
			window: "first",
		});
	});

	test("the plain single-window message lost the 11:59 PM noise", () => {
		// The picker can't go past 11:59 PM, so every seller was reading a cap
		// that could never apply to them.
		expect(dayHoursError({ open: 600, close: 540 })).toBe(
			"opening time must be before closing time",
		);
	});

	test("on a SPLIT day the first window's sentences name their window too", () => {
		// "Opening time must be before closing time" under two rows of pickers
		// leaves the seller guessing which opening time; the second window's
		// sentences already say "the second window's".
		expect(
			dayHoursIssue({ open: 600, close: 540, open2: 720, close2: 1080 }),
		).toEqual({
			message: "the first window's opening time must be before its closing time",
			window: "first",
		});
		expect(
			dayHoursIssue({ open: 540, close: 1440, open2: 720, close2: 1080 }),
		).toEqual({
			message: "the first window can close at 11:59 PM at the latest",
			window: "first",
		});
	});

	test("every second-window problem points at the second window", () => {
		for (const day of [
			{ open: 450, close: 600, open2: 540, close2: 1080 }, // starts too early
			{ open: 450, close: 600, open2: 720, close2: 720 }, // open ≥ close
			{ open: 450, close: 600, open2: 720, close2: 1440 }, // past 11:59 PM
			{ open: 0, close: MAX_CLOSE_MINUTES, open2: 600, close2: 700 }, // all-day clash
		]) {
			expect(dayHoursIssue(day)?.window).toBe("second");
		}
	});

	test("a valid day has no issue, and dayHoursError agrees", () => {
		expect(dayHoursIssue(SPLIT_DAY)).toBeNull();
		expect(dayHoursError(SPLIT_DAY)).toBeNull();
	});
});

describe("nextSelectableTime — a repair only ever moves forward", () => {
	const hours = week({ 6: SPLIT_DAY });

	test("inside a window: that moment itself", () => {
		expect(nextSelectableTime(hours, SAT_JUN_27, 13 * 60, NOW)).toBe(13 * 60);
	});

	test("in the break: the next window's opening, never the earlier one", () => {
		expect(nextSelectableTime(hours, SAT_JUN_27, 11 * 60, NOW)).toBe(12 * 60);
	});

	test("before the day opens: the first opening", () => {
		expect(nextSelectableTime(hours, SAT_JUN_27, 6 * 60, NOW)).toBe(450);
	});

	test("after the last close: nothing later is left", () => {
		expect(nextSelectableTime(hours, SAT_JUN_27, 19 * 60, NOW)).toBeNull();
	});

	test("today, the lead floor counts as the day's opening", () => {
		// NOW = Fri 09:00 → floor 09:15, inside the breakfast window.
		expect(
			nextSelectableTime(week({ 5: SPLIT_DAY }), FRI_JUN_26, 9 * 60, NOW),
		).toBe(9 * 60 + 15);
	});
});
