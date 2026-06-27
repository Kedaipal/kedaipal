import { describe, expect, test } from "vitest";
import {
	assertValidFulfilmentDate,
	clampMinNoticeDays,
	formatFulfilmentDate,
	fulfilmentDateBounds,
	isMytMidnight,
	matchesFulfilmentWindow,
	MYT_OFFSET_MS,
	mytMidnightFromYmd,
	relativeFulfilmentLabel,
	todayMytMidnight,
	ymdFromEpoch,
} from "./fulfilmentDate";

const DAY = 24 * 60 * 60 * 1000;

// A reference "now": 2026-06-26 09:00 MYT == 2026-06-26 01:00 UTC.
const NOW = Date.UTC(2026, 5, 26, 1, 0, 0);
// MYT midnight for 2026-06-26.
const JUN_26 = Date.UTC(2026, 5, 26) - MYT_OFFSET_MS;

describe("ymd <-> MYT midnight round-trip", () => {
	test("parses a valid day to MYT midnight", () => {
		expect(mytMidnightFromYmd("2026-06-26")).toBe(JUN_26);
		expect(isMytMidnight(JUN_26)).toBe(true);
	});

	test("round-trips through ymdFromEpoch", () => {
		expect(ymdFromEpoch(JUN_26)).toBe("2026-06-26");
		expect(ymdFromEpoch(mytMidnightFromYmd("2026-12-31"))).toBe("2026-12-31");
	});

	test("rejects malformed and overflow dates", () => {
		expect(Number.isNaN(mytMidnightFromYmd(""))).toBe(true);
		expect(Number.isNaN(mytMidnightFromYmd("2026-6-1"))).toBe(true);
		expect(Number.isNaN(mytMidnightFromYmd("2026-13-01"))).toBe(true);
		expect(Number.isNaN(mytMidnightFromYmd("2026-02-31"))).toBe(true);
	});

	test("a non-midnight epoch is not a MYT midnight", () => {
		expect(isMytMidnight(JUN_26 + 1)).toBe(false);
		expect(isMytMidnight(JUN_26 + DAY / 2)).toBe(false);
	});
});

describe("todayMytMidnight", () => {
	test("floors a mid-morning MYT instant to that day's midnight", () => {
		expect(todayMytMidnight(NOW)).toBe(JUN_26);
	});

	test("a few minutes after MYT midnight still lands on the same day", () => {
		const justAfter = Date.UTC(2026, 5, 25, 16, 5); // 2026-06-26 00:05 MYT
		expect(todayMytMidnight(justAfter)).toBe(JUN_26);
	});

	test("just before MYT midnight is the previous day", () => {
		const justBefore = Date.UTC(2026, 5, 25, 15, 55); // 2026-06-25 23:55 MYT
		expect(todayMytMidnight(justBefore)).toBe(JUN_26 - DAY);
	});
});

describe("clampMinNoticeDays", () => {
	test("undefined → default 0 (same-day allowed)", () => {
		expect(clampMinNoticeDays(undefined)).toBe(0);
	});
	test("allows 0 (same-day sellers)", () => {
		expect(clampMinNoticeDays(0)).toBe(0);
	});
	test("clamps negatives to 0 and caps at 30", () => {
		expect(clampMinNoticeDays(-5)).toBe(0);
		expect(clampMinNoticeDays(99)).toBe(30);
	});
	test("truncates fractional input", () => {
		expect(clampMinNoticeDays(2.9)).toBe(2);
	});
});

describe("fulfilmentDateBounds", () => {
	test("min = today + notice, max = today + 30", () => {
		const { min, max } = fulfilmentDateBounds(2, NOW);
		expect(min).toBe(JUN_26 + 2 * DAY);
		expect(max).toBe(JUN_26 + 30 * DAY);
	});
	test("notice 0 allows today", () => {
		expect(fulfilmentDateBounds(0, NOW).min).toBe(JUN_26);
	});
});

describe("assertValidFulfilmentDate", () => {
	test("accepts a day inside the window", () => {
		const d = JUN_26 + 3 * DAY;
		expect(assertValidFulfilmentDate(d, 1, NOW)).toBe(d);
	});
	test("rejects a non-midnight value", () => {
		expect(() => assertValidFulfilmentDate(JUN_26 + 1, 1, NOW)).toThrow(
			/whole calendar day/,
		);
	});
	test("rejects a date before the minimum notice", () => {
		// notice 2 → earliest is JUN_28; JUN_27 is too soon.
		expect(() =>
			assertValidFulfilmentDate(JUN_26 + 1 * DAY, 2, NOW),
		).toThrow(/too soon/);
	});
	test("rejects today when notice >= 1", () => {
		expect(() => assertValidFulfilmentDate(JUN_26, 1, NOW)).toThrow(/too soon/);
	});
	test("accepts today when notice is 0", () => {
		expect(assertValidFulfilmentDate(JUN_26, 0, NOW)).toBe(JUN_26);
	});
	test("rejects beyond 30 days", () => {
		expect(() =>
			assertValidFulfilmentDate(JUN_26 + 31 * DAY, 1, NOW),
		).toThrow(/30 days/);
	});
	test("accepts exactly 30 days out", () => {
		const d = JUN_26 + 30 * DAY;
		expect(assertValidFulfilmentDate(d, 1, NOW)).toBe(d);
	});
});

describe("formatFulfilmentDate", () => {
	test("default includes weekday", () => {
		expect(formatFulfilmentDate(JUN_26)).toBe("Fri, 26 Jun 2026");
	});
	test("weekday: false drops the weekday", () => {
		expect(formatFulfilmentDate(JUN_26, { weekday: false })).toBe(
			"26 Jun 2026",
		);
	});
});

describe("relativeFulfilmentLabel", () => {
	test("today / tomorrow / overdue / null", () => {
		expect(relativeFulfilmentLabel(JUN_26, NOW)).toBe("Today");
		expect(relativeFulfilmentLabel(JUN_26 + DAY, NOW)).toBe("Tomorrow");
		expect(relativeFulfilmentLabel(JUN_26 - DAY, NOW)).toBe("Overdue");
		expect(relativeFulfilmentLabel(JUN_26 + 3 * DAY, NOW)).toBeNull();
	});
});

describe("matchesFulfilmentWindow", () => {
	test("today", () => {
		expect(matchesFulfilmentWindow(JUN_26, "today", NOW)).toBe(true);
		expect(matchesFulfilmentWindow(JUN_26 + DAY, "today", NOW)).toBe(false);
	});
	test("tomorrow", () => {
		expect(matchesFulfilmentWindow(JUN_26 + DAY, "tomorrow", NOW)).toBe(true);
		expect(matchesFulfilmentWindow(JUN_26, "tomorrow", NOW)).toBe(false);
	});
	test("this_week spans today..+7, inclusive", () => {
		expect(matchesFulfilmentWindow(JUN_26, "this_week", NOW)).toBe(true);
		expect(matchesFulfilmentWindow(JUN_26 + 7 * DAY, "this_week", NOW)).toBe(
			true,
		);
		expect(matchesFulfilmentWindow(JUN_26 + 8 * DAY, "this_week", NOW)).toBe(
			false,
		);
		// Overdue dates don't fall in "this week".
		expect(matchesFulfilmentWindow(JUN_26 - DAY, "this_week", NOW)).toBe(false);
	});
});
