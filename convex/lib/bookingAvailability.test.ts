import { describe, expect, it, test } from "vitest";
import {
	assertValidBookingRange,
	BOOKING_HORIZON_DAYS,
	eachNight,
	holdsCapacity,
	MAX_BOOKING_NIGHTS,
	MAX_BOOKING_SPAN_DAYS,
	MAX_PACKAGE_QUANTITY,
	maxPackageQuantity,
	nightsBetween,
	normalizePackageQuantity,
	resolveBookingRange,
	splitNightsByRate,
	staysOverlap,
} from "./bookingAvailability";
import {
	addMytCalendarMonths,
	DAY_MS,
	MYT_OFFSET_MS,
	todayMytMidnight,
	weekdayIndexMyt,
} from "./fulfilmentDate";

const NOW = Date.UTC(2026, 7, 17, 4, 0, 0); // 17 Aug 2026 12:00 MYT
const today = todayMytMidnight(NOW);
const day = (offset: number) => today + offset * DAY_MS;

describe("night math", () => {
	it("counts nights with an exclusive check-out", () => {
		// 25 → 27 occupies two nights (25, 26); the 27th is the leaving morning.
		expect(nightsBetween(day(8), day(10))).toBe(2);
		expect(eachNight(day(8), day(10))).toEqual([day(8), day(9)]);
	});

	it("back-to-back stays never overlap — checkout day is the next check-in", () => {
		expect(staysOverlap(day(1), day(3), day(3), day(5))).toBe(false);
		expect(staysOverlap(day(1), day(4), day(3), day(5))).toBe(true);
		expect(staysOverlap(day(3), day(5), day(1), day(3))).toBe(false);
	});
});

describe("assertValidBookingRange", () => {
	it("accepts a plain future stay", () => {
		expect(() =>
			assertValidBookingRange(day(3), day(5), { noticeDays: 0, now: NOW }),
		).not.toThrow();
	});

	it("rejects non-midnight, inverted and zero-night ranges", () => {
		expect(() =>
			assertValidBookingRange(day(3) + 1, day(5), { noticeDays: 0, now: NOW }),
		).toThrow(/calendar days/);
		expect(() =>
			assertValidBookingRange(day(5), day(5), { noticeDays: 0, now: NOW }),
		).toThrow(/after check-in/);
		expect(() =>
			assertValidBookingRange(day(5), day(3), { noticeDays: 0, now: NOW }),
		).toThrow(/after check-in/);
	});

	it("caps the stay length", () => {
		expect(() =>
			assertValidBookingRange(day(1), day(1 + MAX_BOOKING_NIGHTS), {
				noticeDays: 0,
				now: NOW,
			}),
		).not.toThrow();
		expect(() =>
			assertValidBookingRange(day(1), day(2 + MAX_BOOKING_NIGHTS), {
				noticeDays: 0,
				now: NOW,
			}),
		).toThrow(/limited to/);
	});

	it("floors check-in at today + notice and caps at the horizon", () => {
		expect(() =>
			assertValidBookingRange(day(-1), day(1), { noticeDays: 0, now: NOW }),
		).toThrow(/in the past/);
		expect(() =>
			assertValidBookingRange(day(1), day(2), { noticeDays: 2, now: NOW }),
		).toThrow(/2 days' notice/);
		expect(() =>
			assertValidBookingRange(day(2), day(3), { noticeDays: 2, now: NOW }),
		).not.toThrow();
		expect(() =>
			assertValidBookingRange(
				day(BOOKING_HORIZON_DAYS + 1),
				day(BOOKING_HORIZON_DAYS + 2),
				{ noticeDays: 0, now: NOW },
			),
		).toThrow(/further ahead/);
	});
});

describe("holdsCapacity", () => {
	it("every non-cancelled booking order holds its nights", () => {
		expect(holdsCapacity("booking_requested")).toBe(true);
		expect(holdsCapacity("confirmed")).toBe(true);
		expect(holdsCapacity("delivered")).toBe(true);
		expect(holdsCapacity("cancelled")).toBe(false);
	});
});

describe("multi-package terms (buying N packages in one booking)", () => {
	const monthly = { packageLength: 1, packageUnit: "month" as const };
	const twoDay = { packageLength: 2, packageUnit: "day" as const };

	test("the whole term is one step, never one package at a time", () => {
		// 31 Jan is the case that separates them. Stepping +1 month three times
		// clamps at each hop (28 Feb → 28 Mar → 28 Apr); one 3-month term clamps
		// once and lands 30 Apr. A member who paid for three months up front
		// bought ONE term, so the single step is the honest reading — and it
		// can't quietly lose a day per package.
		const jan31 = Date.UTC(2027, 0, 31) - MYT_OFFSET_MS;
		const oneStep = resolveBookingRange(monthly, jan31, undefined, 3);
		expect(oneStep.checkOut).toBe(addMytCalendarMonths(jan31, 3));

		let chained = jan31;
		for (let i = 0; i < 3; i++) chained = addMytCalendarMonths(chained, 1);
		expect(oneStep.checkOut).not.toBe(chained);
	});

	test("a day package multiplies cleanly", () => {
		const start = Date.UTC(2026, 8, 1) - MYT_OFFSET_MS;
		expect(resolveBookingRange(twoDay, start, undefined, 3).checkOut).toBe(
			start + 6 * DAY_MS,
		);
		// Absent or 1 keeps the single-package behaviour untouched.
		expect(resolveBookingRange(twoDay, start).checkOut).toBe(
			start + 2 * DAY_MS,
		);
	});

	test("the ceiling protects the scan bound, not just taste", () => {
		// MAX_BOOKING_SPAN_DAYS is derived from MAX_PACKAGE_DAYS, and every scan
		// that has to see a booking whose check-in is far behind the night being
		// read is bounded by it. Let a buyer stack packages past that and those
		// scans silently stop finding them.
		expect(maxPackageQuantity(monthly)).toBeLessThanOrEqual(
			MAX_PACKAGE_QUANTITY,
		);
		// The invariant is the REAL calendar span, not a 31-day approximation of
		// it — that approximation is what wrongly capped a monthly listing at 11
		// and stopped a member buying a full year. Twelve calendar months are at
		// most 366 days (leap), which is exactly the bound, so check the actual
		// worst case: every start date across a leap year.
		const maxMonths = maxPackageQuantity(monthly);
		expect(maxMonths).toBe(12);
		let worstSpanDays = 0;
		for (let d = 0; d < 366; d++) {
			const start = Date.UTC(2027, 0, 1) - MYT_OFFSET_MS + d * DAY_MS;
			const end = addMytCalendarMonths(start, maxMonths);
			worstSpanDays = Math.max(worstSpanDays, Math.round((end - start) / DAY_MS));
		}
		expect(worstSpanDays).toBeLessThanOrEqual(MAX_BOOKING_SPAN_DAYS);

		// A 6-month package can be taken twice — that is a full year, and a year
		// is the documented ceiling.
		expect(maxPackageQuantity({ packageLength: 6, packageUnit: "month" })).toBe(
			2,
		);
		// A 2-day deal is capped by the plain quantity ceiling, not the span.
		expect(maxPackageQuantity(twoDay)).toBe(MAX_PACKAGE_QUANTITY);
		// A free-range listing has no packages at all.
		expect(maxPackageQuantity(undefined)).toBe(1);
	});

	test("a tampered quantity is clamped, never trusted", () => {
		expect(normalizePackageQuantity(999, monthly)).toBe(
			maxPackageQuantity(monthly),
		);
		expect(normalizePackageQuantity(0, monthly)).toBe(1);
		expect(normalizePackageQuantity(-3, monthly)).toBe(1);
		expect(normalizePackageQuantity(2.5, monthly)).toBe(1);
	});
});

describe("splitNightsByRate (S13 weekend rate)", () => {
	// Absolute MYT midnights, each asserted against its weekday so the fixture
	// can't silently rot if someone edits a date.
	const myt = (y: number, m: number, d: number) =>
		Date.UTC(y, m - 1, d) - MYT_OFFSET_MS;
	const THU_10_SEP = myt(2026, 9, 10);
	const MON_14_SEP = myt(2026, 9, 14);
	const SUN_13_SEP = myt(2026, 9, 13);
	const THU_31_DEC = myt(2026, 12, 31);
	const SAT_2_JAN = myt(2027, 1, 2);
	const friSat = { weekendPrice: 12_000, weekendDays: [5, 6] };

	it("fixture sanity", () => {
		expect(weekdayIndexMyt(THU_10_SEP)).toBe(4);
		expect(weekdayIndexMyt(SUN_13_SEP)).toBe(0);
		expect(weekdayIndexMyt(MON_14_SEP)).toBe(1);
		expect(weekdayIndexMyt(THU_31_DEC)).toBe(4);
		expect(weekdayIndexMyt(SAT_2_JAN)).toBe(6);
	});

	it("a Thu→Mon stay is 2 weekday + 2 weekend nights on Fri + Sat", () => {
		// Nights slept: Thu, Fri, Sat, Sun. The Monday morning is check-out.
		expect(splitNightsByRate(THU_10_SEP, MON_14_SEP, friSat)).toEqual({
			weekdayNights: 2,
			weekendNights: 2,
		});
	});

	it("the NIGHT's weekday counts, never the check-out morning", () => {
		// Sunday night → Monday morning: one night, and it is a SUNDAY night.
		expect(
			splitNightsByRate(SUN_13_SEP, MON_14_SEP, {
				weekendPrice: 12_000,
				weekendDays: [0],
			}),
		).toEqual({ weekdayNights: 0, weekendNights: 1 });
		// The same night under Fri + Sat is a weekday night — Monday is not
		// slept, so it can't be counted either way.
		expect(splitNightsByRate(SUN_13_SEP, MON_14_SEP, friSat)).toEqual({
			weekdayNights: 1,
			weekendNights: 0,
		});
	});

	it("splits across a year boundary (31 Dec → 2 Jan)", () => {
		// Thu 31 Dec (weekday) + Fri 1 Jan (weekend).
		expect(splitNightsByRate(THU_31_DEC, SAT_2_JAN, friSat)).toEqual({
			weekdayNights: 1,
			weekendNights: 1,
		});
	});

	it("splits across a month boundary and sums to the night count", () => {
		const from = myt(2026, 10, 29); // Thu 29 Oct
		const to = myt(2026, 11, 3); // Tue 3 Nov — 5 nights: Thu Fri Sat Sun Mon
		expect(weekdayIndexMyt(from)).toBe(4);
		const split = splitNightsByRate(from, to, friSat);
		expect(split).toEqual({ weekdayNights: 3, weekendNights: 2 });
		expect(split.weekdayNights + split.weekendNights).toBe(
			nightsBetween(from, to),
		);
	});

	it("all one kind reports the other as zero", () => {
		const mon = myt(2026, 9, 7);
		expect(splitNightsByRate(mon, THU_10_SEP, friSat)).toEqual({
			weekdayNights: 3,
			weekendNights: 0,
		});
		const fri = myt(2026, 9, 11);
		expect(splitNightsByRate(fri, SUN_13_SEP, friSat)).toEqual({
			weekdayNights: 0,
			weekendNights: 2,
		});
	});

	it("no rate, empty days, or a package → every night is a weekday night", () => {
		expect(splitNightsByRate(THU_10_SEP, MON_14_SEP, undefined)).toEqual({
			weekdayNights: 4,
			weekendNights: 0,
		});
		expect(
			splitNightsByRate(THU_10_SEP, MON_14_SEP, { weekendPrice: 12_000 }),
		).toEqual({ weekdayNights: 4, weekendNights: 0 });
		expect(
			splitNightsByRate(THU_10_SEP, MON_14_SEP, {
				...friSat,
				packageLength: 4,
			}),
		).toEqual({ weekdayNights: 4, weekendNights: 0 });
	});
});
