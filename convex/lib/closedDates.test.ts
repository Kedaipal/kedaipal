import { describe, expect, test } from "vitest";
import {
	CLOSURE_HEADS_UP_DAYS,
	type ClosedDateRange,
	closedDateIssue,
	closureHeadsUp,
	formatClosedRangeShort,
	closedDateMessage,
	closedRangeDays,
	closureOn,
	describeClosure,
	formatClosedRange,
	isClosedDate,
	MAX_CLOSED_LABEL_CHARS,
	MAX_CLOSED_RANGE_DAYS,
	sameClosedRange,
	sanitizeClosedDateRange,
	sanitizeClosedLabel,
	upcomingClosures,
} from "./closedDates";
import { DAY_MS, MYT_OFFSET_MS } from "./fulfilmentDate";

// Fixed clock: Thu 24 Sep 2026, 10:00 MYT.
const NOW = Date.UTC(2026, 8, 24, 2, 0, 0);
const midnight = (y: number, m: number, d: number) =>
	Date.UTC(y, m - 1, d) - MYT_OFFSET_MS;
const TODAY = midnight(2026, 9, 24);
const THU_1_OCT = midnight(2026, 10, 1);
const SAT_3_OCT = midnight(2026, 10, 3);

const raya: ClosedDateRange = {
	startDate: THU_1_OCT,
	endDate: SAT_3_OCT,
	label: "Hari Raya",
};

describe("sanitizeClosedDateRange", () => {
	test("keeps a valid range and its cleaned label", () => {
		expect(
			sanitizeClosedDateRange(
				{ startDate: THU_1_OCT, endDate: SAT_3_OCT, label: "  Hari   Raya " },
				NOW,
			),
		).toEqual(raya);
	});

	test("a blank label is dropped, not stored empty", () => {
		expect(
			sanitizeClosedDateRange(
				{ startDate: THU_1_OCT, endDate: THU_1_OCT, label: "   " },
				NOW,
			),
		).toEqual({ startDate: THU_1_OCT, endDate: THU_1_OCT });
	});

	test("today is allowed — 'we're shut today' is the most urgent closure", () => {
		expect(
			sanitizeClosedDateRange({ startDate: TODAY, endDate: TODAY }, NOW),
		).toEqual({ startDate: TODAY, endDate: TODAY });
	});

	test("refuses misaligned, reversed, past and over-long ranges", () => {
		expect(() =>
			sanitizeClosedDateRange(
				{ startDate: THU_1_OCT + 60_000, endDate: SAT_3_OCT },
				NOW,
			),
		).toThrow(/calendar days/);
		expect(() =>
			sanitizeClosedDateRange({ startDate: SAT_3_OCT, endDate: THU_1_OCT }, NOW),
		).toThrow(/can't be before the first/);
		expect(() =>
			sanitizeClosedDateRange(
				{ startDate: TODAY - DAY_MS, endDate: THU_1_OCT },
				NOW,
			),
		).toThrow(/already passed/);
		expect(() =>
			sanitizeClosedDateRange(
				{
					startDate: THU_1_OCT,
					endDate: THU_1_OCT + MAX_CLOSED_RANGE_DAYS * DAY_MS,
				},
				NOW,
			),
		).toThrow(/at most 366 days/);
		// Exactly 366 days is the ceiling, and it's allowed.
		expect(
			closedRangeDays(
				sanitizeClosedDateRange(
					{
						startDate: THU_1_OCT,
						endDate: THU_1_OCT + (MAX_CLOSED_RANGE_DAYS - 1) * DAY_MS,
					},
					NOW,
				),
			),
		).toBe(MAX_CLOSED_RANGE_DAYS);
	});

	test("refuses a label past the cap", () => {
		expect(() => sanitizeClosedLabel("x".repeat(MAX_CLOSED_LABEL_CHARS + 1))).toThrow(
			/under 60/,
		);
		expect(sanitizeClosedLabel("x".repeat(MAX_CLOSED_LABEL_CHARS))).toHaveLength(
			MAX_CLOSED_LABEL_CHARS,
		);
	});
});

describe("closureOn", () => {
	test("end date is INCLUSIVE, the day after is open", () => {
		expect(closureOn([raya], THU_1_OCT)).toBe(raya);
		expect(closureOn([raya], SAT_3_OCT)).toBe(raya);
		expect(closureOn([raya], SAT_3_OCT + DAY_MS)).toBeNull();
		expect(closureOn([raya], THU_1_OCT - DAY_MS)).toBeNull();
		expect(isClosedDate(undefined, THU_1_OCT)).toBe(false);
	});

	test("with overlaps the LABELLED range wins, so the buyer reads why", () => {
		const bare: ClosedDateRange = {
			startDate: THU_1_OCT - DAY_MS,
			endDate: SAT_3_OCT,
		};
		expect(closureOn([bare, raya], THU_1_OCT)).toBe(raya);
		expect(closureOn([raya, bare], THU_1_OCT)).toBe(raya);
		// Only the bare one covers the day before.
		expect(closureOn([bare, raya], THU_1_OCT - DAY_MS)).toBe(bare);
	});
});

describe("upcomingClosures", () => {
	test("drops ranges that already ended and sorts earliest first", () => {
		const ended: ClosedDateRange = {
			startDate: TODAY - 5 * DAY_MS,
			endDate: TODAY - DAY_MS,
		};
		const endsToday: ClosedDateRange = {
			startDate: TODAY - 2 * DAY_MS,
			endDate: TODAY,
		};
		const later: ClosedDateRange = {
			startDate: SAT_3_OCT + 10 * DAY_MS,
			endDate: SAT_3_OCT + 10 * DAY_MS,
		};
		expect(upcomingClosures([later, ended, raya, endsToday], NOW)).toEqual([
			endsToday,
			raya,
			later,
		]);
		expect(upcomingClosures(undefined, NOW)).toEqual([]);
	});
});

describe("copy", () => {
	test("one day, a range in one year, and a range across years", () => {
		expect(formatClosedRange({ startDate: THU_1_OCT, endDate: THU_1_OCT })).toBe(
			"Thu, 1 Oct 2026",
		);
		expect(formatClosedRange(raya)).toBe("Thu, 1 Oct – Sat, 3 Oct 2026");
		expect(
			formatClosedRange({
				startDate: midnight(2026, 12, 31),
				endDate: midnight(2027, 1, 2),
			}),
		).toBe("Thu, 31 Dec 2026 – Sat, 2 Jan 2027");
	});

	test("the refusal names the whole range and the reason", () => {
		expect(describeClosure(raya)).toBe("Thu, 1 Oct – Sat, 3 Oct 2026 (Hari Raya)");
		expect(closedDateMessage(raya)).toBe(
			"The store is closed Thu, 1 Oct – Sat, 3 Oct 2026 (Hari Raya) — pick another day",
		);
		expect(closedDateMessage(raya, "Kek Mak Jah")).toMatch(/^Kek Mak Jah is closed/);
		expect(
			closedDateMessage({ startDate: THU_1_OCT, endDate: THU_1_OCT }),
		).toBe("The store is closed Thu, 1 Oct 2026 — pick another day");
	});

	test("the server gate answers only for a covered date", () => {
		expect(closedDateIssue([raya], THU_1_OCT)).toMatch(/closed Thu, 1 Oct/);
		expect(closedDateIssue([raya], SAT_3_OCT + DAY_MS)).toBeNull();
		expect(closedDateIssue(undefined, THU_1_OCT)).toBeNull();
	});

	test("range identity ignores the label", () => {
		expect(
			sameClosedRange(raya, { startDate: THU_1_OCT, endDate: SAT_3_OCT }),
		).toBe(true);
		expect(
			sameClosedRange(raya, { startDate: THU_1_OCT, endDate: THU_1_OCT }),
		).toBe(false);
	});
});

describe("header heads-up", () => {
	test("compact spellings: one day, same month, across months", () => {
		expect(formatClosedRangeShort({ startDate: THU_1_OCT, endDate: THU_1_OCT })).toBe(
			"Thu 1 Oct",
		);
		expect(formatClosedRangeShort(raya)).toBe("1–3 Oct");
		expect(
			formatClosedRangeShort({ startDate: midnight(2026, 9, 30), endDate: SAT_3_OCT }),
		).toBe("30 Sep – 3 Oct");
	});

	test("warns about the soonest closure starting within two weeks, never one already running", () => {
		const running: ClosedDateRange = { startDate: TODAY, endDate: TODAY };
		const far: ClosedDateRange = {
			startDate: TODAY + (CLOSURE_HEADS_UP_DAYS + 1) * DAY_MS,
			endDate: TODAY + (CLOSURE_HEADS_UP_DAYS + 1) * DAY_MS,
		};
		expect(closureHeadsUp([far, raya, running], NOW)).toBe(raya);
		expect(closureHeadsUp([far, running], NOW)).toBeNull();
		expect(closureHeadsUp(undefined, NOW)).toBeNull();
	});
});
