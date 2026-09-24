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
	partitionNights,
	resolveBookingRange,
	splitNightsByRate,
	staysOverlap,
	closureRule,
	countedDays,
	resolveOpenDaysTerm,
	usedDayRuns,
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

describe("partitionNights (S13 — which nights, not just how many)", () => {
	const myt = (y: number, m: number, d: number) =>
		Date.UTC(y, m - 1, d) - MYT_OFFSET_MS;
	const THU_10_SEP = myt(2026, 9, 10);
	const MON_14_SEP = myt(2026, 9, 14);
	const friSat = [5, 6];

	it("locates each rate's nights inside the span", () => {
		// Thu→Mon sleeps Thu 10, Fri 11, Sat 12, Sun 13.
		const { weekday, weekend } = partitionNights(
			THU_10_SEP,
			MON_14_SEP,
			friSat,
		);
		expect(weekday).toEqual([THU_10_SEP, myt(2026, 9, 13)]);
		expect(weekend).toEqual([myt(2026, 9, 11), myt(2026, 9, 12)]);
	});

	it("a weekday set is NOT contiguous — the reason lines name nights, not a range", () => {
		// Thu and Sun, with the weekend between them: no "X → Y" is true of
		// that line, which is why the sub-line lists nights instead.
		const { weekday } = partitionNights(THU_10_SEP, MON_14_SEP, friSat);
		expect(weekday).toHaveLength(2);
		expect(weekday[1] - weekday[0]).toBe(3 * DAY_MS);
	});

	it("no weekend days = every night is a weekday night", () => {
		for (const days of [undefined, []]) {
			const { weekday, weekend } = partitionNights(
				THU_10_SEP,
				MON_14_SEP,
				days,
			);
			expect(weekday).toHaveLength(4);
			expect(weekend).toHaveLength(0);
		}
	});

	it("is the one author behind splitNightsByRate's counts", () => {
		const booking = { weekendPrice: 12_000, weekendDays: friSat };
		const counts = splitNightsByRate(THU_10_SEP, MON_14_SEP, booking);
		const { weekday, weekend } = partitionNights(
			THU_10_SEP,
			MON_14_SEP,
			friSat,
		);
		expect(counts.weekdayNights).toBe(weekday.length);
		expect(counts.weekendNights).toBe(weekend.length);
	});
});

describe("closureRule (z8r3fdhpm7) — what a store closure does to a listing", () => {
	it("stays and night packages: the night is unavailable", () => {
		expect(closureRule(undefined)).toBe("unavailable");
		expect(closureRule({})).toBe("unavailable");
		expect(closureRule({ packageLength: 2, packageUnit: "night" })).toBe(
			"unavailable",
		);
		// A night package can't skip — the flag is meaningless there.
		expect(
			closureRule({ packageLength: 2, packageUnit: "night", skipsClosedDays: true }),
		).toBe("unavailable");
	});

	it("month and every-day packages absorb it; an open-days day package skips it", () => {
		expect(closureRule({ packageLength: 1, packageUnit: "month" })).toBe(
			"absorbed",
		);
		expect(closureRule({ packageLength: 5, packageUnit: "day" })).toBe(
			"absorbed",
		);
		expect(closureRule({ packageLength: 5 })).toBe("absorbed");
		expect(
			closureRule({ packageLength: 5, packageUnit: "day", skipsClosedDays: true }),
		).toBe("skipped");
		// A month never skips — it runs by the calendar.
		expect(
			closureRule({ packageLength: 1, packageUnit: "month", skipsClosedDays: true }),
		).toBe("absorbed");
	});
});

describe("resolveOpenDaysTerm (z8r3fdhpm7)", () => {
	// Wed 30 Sep 2026 start; closed Thu 1 Oct (a date) and Sundays (weekly).
	const WED_30_SEP = Date.UTC(2026, 8, 30) - MYT_OFFSET_MS;
	const d = (n: number) => WED_30_SEP + n * DAY_MS;
	const closed = (day: number) =>
		day === d(1) || new Date(day + MYT_OFFSET_MS).getUTCDay() === 0;

	it("counts five OPEN days and names the two it stepped over (the ticket's done criterion)", () => {
		expect(resolveOpenDaysTerm(d(0), 5, closed)).toEqual({
			// Wed 30, Fri 2, Sat 3, Mon 5, Tue 6 → leaves Wed 7 (exclusive).
			checkOut: d(7),
			skipped: [d(1), d(4)],
		});
	});

	it("a store with nothing closed runs the plain every-day term", () => {
		expect(resolveOpenDaysTerm(d(0), 5, () => false)).toEqual({
			checkOut: d(5),
			skipped: [],
		});
	});

	it("can't start on a shut day — day one must be a day the service happens", () => {
		expect(() => resolveOpenDaysTerm(d(1), 5, closed)).toThrow(
			/closed on that day/,
		);
	});

	it("refuses (never truncates) a term the skips stretch past the scan bound", () => {
		// Open one day a week: 60 open days need ~420 calendar days.
		const oncePerWeek = (day: number) =>
			new Date(day + MYT_OFFSET_MS).getUTCDay() !== 3;
		expect(() => resolveOpenDaysTerm(d(0), 60, oncePerWeek)).toThrow(
			/longer than a year/,
		);
	});

	it("resolveBookingRange routes an open-days package through it — and demands the schedule", () => {
		const booking = {
			packageLength: 5,
			packageUnit: "day" as const,
			skipsClosedDays: true,
		};
		expect(resolveBookingRange(booking, d(0), undefined, 1, closed)).toEqual({
			checkIn: d(0),
			checkOut: d(7),
			skipped: [d(1), d(4)],
		});
		// Two packages = ten open days, counted in ONE step.
		expect(
			resolveBookingRange(booking, d(0), undefined, 2, closed).skipped,
		).toEqual([d(1), d(4), d(11)]);
		expect(() => resolveBookingRange(booking, d(0))).toThrow(
			/needs the store's schedule/,
		);
		// An every-day package runs straight through the shut days in its term.
		expect(
			resolveBookingRange(
				{ packageLength: 5, packageUnit: "day" },
				d(0),
				undefined,
				1,
				closed,
			),
		).toEqual({ checkIn: d(0), checkOut: d(5), skipped: [] });
	});

	it("NO package starts on a shut day — every-day and month ones too (owner call, 24 Sep)", () => {
		// Thu 1 Oct is closed: a term starting there sold days nobody could use.
		for (const booking of [
			{ packageLength: 5, packageUnit: "day" as const },
			{ packageLength: 1, packageUnit: "month" as const },
		]) {
			expect(() =>
				resolveBookingRange(booking, d(1), undefined, 1, closed),
			).toThrow(/closed on that day — start on a day it's open/);
		}
		// A stay never reads the weekly day off or a start rule — its closed
		// nights are refused by `findFullNights` instead.
		expect(resolveBookingRange({}, d(1), d(2), 1, closed)).toEqual({
			checkIn: d(1),
			checkOut: d(2),
			skipped: [],
		});
	});
});

describe("countedDays — the one count every \"N days\" on an order reads", () => {
	it("the span minus the days an open-days package skipped, and only those inside it", () => {
		expect(countedDays(day(0), day(7), [day(1), day(4)])).toBe(5);
		expect(countedDays(day(0), day(7), [day(-1), day(7)])).toBe(7);
		expect(countedDays(day(0), day(2), undefined)).toBe(2);
	});
});

describe("usedDayRuns — the days a booking is actually there, as unbroken runs", () => {
	it("an open-days package is cut at each day it skips", () => {
		// Sat 3 (day 0) → Fri 9 (day 6), skipping Sun 4, Tue 6, Wed 7.
		expect(usedDayRuns(day(0), day(7), [day(1), day(3), day(4)])).toEqual([
			{ start: day(0), endExclusive: day(1) },
			{ start: day(2), endExclusive: day(3) },
			{ start: day(5), endExclusive: day(7) },
		]);
	});

	it("everything else is one run — the span itself", () => {
		expect(usedDayRuns(day(0), day(3), undefined)).toEqual([
			{ start: day(0), endExclusive: day(3) },
		]);
		expect(usedDayRuns(day(0), day(3), [])).toEqual([
			{ start: day(0), endExclusive: day(3) },
		]);
	});
});
