import { describe, expect, test } from "vitest";
import { MIN_SCHEDULE_LEAD_MS, resolveScheduleAt } from "./lalamove";
import {
	addMytCalendarMonths,
	DAY_MS,
	assertValidFulfilmentTime,
	EARLIEST_FULFILMENT_LEAD_MINUTES,
	composeFulfilmentMoment,
	defaultFulfilmentTimeMinutes,
	formatFulfilmentDateTime,
	formatFulfilmentTime,
	hasSelectableTimeToday,
	hhmmFromMinutes,
	minSelectableTimeMinutes,
	timeMinutesFromHhmm,
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

describe("fulfilment time (86eyg0n8e follow-up)", () => {
	// 4 Aug 2026 14:12 MYT — an ordinary afternoon instant.
	const AUG4 = Date.UTC(2026, 7, 3, 16, 0, 0); // MYT midnight 4 Aug
	const NOW_1412 = AUG4 + (14 * 60 + 12) * 60_000;

	test("assertValidFulfilmentTime: range-only, integers only", () => {
		expect(assertValidFulfilmentTime(0)).toBe(0);
		expect(assertValidFulfilmentTime(1439)).toBe(1439);
		for (const bad of [-1, 1440, 90.5, Number.NaN]) {
			expect(() => assertValidFulfilmentTime(bad)).toThrow(/time of day/);
		}
	});

	test("composeFulfilmentMoment: midnight + minutes = the exact instant", () => {
		expect(composeFulfilmentMoment(AUG4, 14 * 60 + 30)).toBe(
			AUG4 + (14 * 60 + 30) * 60_000,
		);
	});

	test("default: today is AS SOON AS POSSIBLE — the floor itself", () => {
		// 14:12 + 15 lead = 14:27 → rounds to 14:30. Not an arbitrary hour out:
		// ordering at 8:09 and being offered 9:30 read as a made-up wait.
		expect(defaultFulfilmentTimeMinutes(AUG4, NOW_1412)).toBe(14 * 60 + 30);
		expect(defaultFulfilmentTimeMinutes(AUG4, NOW_1412)).toBe(
			minSelectableTimeMinutes(AUG4, NOW_1412),
		);
		// Late evening still lands on a real slot inside the day.
		expect(
			defaultFulfilmentTimeMinutes(AUG4, AUG4 + (23 * 60 + 20) * 60_000),
		).toBe(23 * 60 + 35);
	});

	test("the ASAP default is never more than the lead + a rounding step out", () => {
		// "As soon as possible" has to MEAN that: at any minute of the day the
		// prefill sits within the lead time plus the 5-minute rounding, never
		// an invented wait.
		for (let minute = 0; minute < 1440; minute += 1) {
			const now = AUG4 + minute * 60_000;
			if (!hasSelectableTimeToday(now)) continue;
			const out = defaultFulfilmentTimeMinutes(AUG4, now) - minute;
			expect(out).toBeGreaterThanOrEqual(EARLIEST_FULFILMENT_LEAD_MINUTES);
			expect(out).toBeLessThanOrEqual(EARLIEST_FULFILMENT_LEAD_MINUTES + 5);
		}
	});

	test("by the time a vendor dispatches, an ASAP order books a rider NOW", () => {
		// The seller books minutes-to-hours after checkout, so the buyer's
		// "as soon as possible" moment is past by then and resolveScheduleAt
		// turns it into an immediate dispatch rather than a scheduled pickup.
		const orderedAt = NOW_1412;
		const moment = composeFulfilmentMoment(
			AUG4,
			defaultFulfilmentTimeMinutes(AUG4, orderedAt),
		);
		expect(resolveScheduleAt(moment, orderedAt + 20 * 60_000)).toBeUndefined();
	});

	test("default: a future day is 10:00 AM, never a 'now'-derived clock time", () => {
		expect(defaultFulfilmentTimeMinutes(AUG4 + 86_400_000, NOW_1412)).toBe(
			600,
		);
	});

	test("floor: today is the lead time out, rounded to 5; other days are free", () => {
		// 14:12 + 15 = 14:27 → rounds to 14:30.
		expect(minSelectableTimeMinutes(AUG4, NOW_1412)).toBe(14 * 60 + 30);
		expect(minSelectableTimeMinutes(AUG4 + 86_400_000, NOW_1412)).toBe(0);
	});

	test("THE INVARIANT: the prefilled default is never below the floor", () => {
		// The bug Zaki hit: default and floor were computed independently, so a
		// value that was fine at mount could sit under the floor and the
		// browser blocked submit with its own message. Sweep the whole day.
		for (let minute = 0; minute < 1440; minute += 1) {
			const now = AUG4 + minute * 60_000;
			for (const day of [AUG4, AUG4 + 86_400_000]) {
				// Skip the last minutes of the day, where no valid slot exists at
				// all — hasSelectableTimeToday is false and the form pushes the
				// buyer to tomorrow instead.
				if (!hasSelectableTimeToday(now) && day === AUG4) continue;
				const def = defaultFulfilmentTimeMinutes(day, now);
				expect(def).toBeGreaterThanOrEqual(minSelectableTimeMinutes(day, now));
				expect(def).toBeLessThan(1440);
			}
		}
	});

	test("the floor and the dispatch threshold are ONE number, not two", () => {
		// If these drift, a buyer can pick a time we then refuse to schedule.
		expect(MIN_SCHEDULE_LEAD_MS).toBe(
			EARLIEST_FULFILMENT_LEAD_MINUTES * 60_000,
		);
	});

	test("the last minutes of the day have no bookable slot left", () => {
		expect(hasSelectableTimeToday(NOW_1412)).toBe(true);
		expect(hasSelectableTimeToday(AUG4 + (23 * 60 + 50) * 60_000)).toBe(false);
	});

	test("HH:MM round-trips; garbage becomes NaN", () => {
		expect(timeMinutesFromHhmm("15:30")).toBe(930);
		expect(hhmmFromMinutes(930)).toBe("15:30");
		expect(hhmmFromMinutes(5)).toBe("00:05");
		for (const bad of ["24:00", "12:60", "9:30", "abc", ""]) {
			expect(Number.isNaN(timeMinutesFromHhmm(bad))).toBe(true);
		}
	});

	test("labels: 12-hour, and one spelling for date · time", () => {
		expect(formatFulfilmentTime(0)).toBe("12:00 AM");
		expect(formatFulfilmentTime(930)).toBe("3:30 PM");
		expect(formatFulfilmentTime(12 * 60)).toBe("12:00 PM");
		expect(formatFulfilmentDateTime(AUG4, 930)).toBe(
			"Tue, 4 Aug 2026 · 3:30 PM",
		);
		// No time → exactly the old date label, so legacy surfaces can't shift.
		expect(formatFulfilmentDateTime(AUG4, undefined)).toBe(
			formatFulfilmentDate(AUG4),
		);
	});
});

describe("addMytCalendarMonths (S7 — what 'monthly' actually means)", () => {
	const myt = (y: number, m: number, d: number) =>
		Date.UTC(y, m - 1, d) - MYT_OFFSET_MS;
	const readBack = (epoch: number) => {
		const d = new Date(epoch + MYT_OFFSET_MS);
		return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
	};

	test("same day, next month — join the 12th, renew the 12th", () => {
		expect(readBack(addMytCalendarMonths(myt(2026, 1, 12), 1))).toEqual([
			2026, 2, 12,
		]);
	});

	test("clamps into a SHORT month instead of spilling over", () => {
		// 31 Jan + 1 month is the 28th, not 3 March.
		expect(readBack(addMytCalendarMonths(myt(2026, 1, 31), 1))).toEqual([
			2026, 2, 28,
		]);
		// A leap year gets its extra day.
		expect(readBack(addMytCalendarMonths(myt(2028, 1, 31), 1))).toEqual([
			2028, 2, 29,
		]);
		// 31 Mar + 1 month = 30 Apr.
		expect(readBack(addMytCalendarMonths(myt(2026, 3, 31), 1))).toEqual([
			2026, 4, 30,
		]);
	});

	test("rolls the year over", () => {
		expect(readBack(addMytCalendarMonths(myt(2026, 12, 5), 1))).toEqual([
			2027, 1, 5,
		]);
		expect(readBack(addMytCalendarMonths(myt(2026, 6, 15), 12))).toEqual([
			2027, 6, 15,
		]);
	});

	test("lands on MYT midnight, so day arithmetic stays exact", () => {
		const end = addMytCalendarMonths(myt(2026, 1, 12), 1);
		expect(isMytMidnight(end)).toBe(true);
	});

	test("this is what a rolling 30 days could NOT do", () => {
		// The whole reason for the change: 30 days from 1 Feb overshoots into
		// March, so a member's renewal date walks through the year.
		const rolling = myt(2026, 2, 1) + 30 * DAY_MS;
		expect(readBack(rolling)).toEqual([2026, 3, 3]);
		expect(readBack(addMytCalendarMonths(myt(2026, 2, 1), 1))).toEqual([
			2026, 3, 1,
		]);
	});
});
