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
	staysOverlap,
} from "./bookingAvailability";
import {
	addMytCalendarMonths,
	DAY_MS,
	MYT_OFFSET_MS,
	todayMytMidnight,
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
