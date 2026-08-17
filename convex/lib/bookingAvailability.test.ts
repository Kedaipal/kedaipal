import { describe, expect, it } from "vitest";
import {
	assertValidBookingRange,
	BOOKING_HORIZON_DAYS,
	eachNight,
	holdsCapacity,
	MAX_BOOKING_NIGHTS,
	nightsBetween,
	staysOverlap,
} from "./bookingAvailability";
import { DAY_MS, todayMytMidnight } from "./fulfilmentDate";

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
