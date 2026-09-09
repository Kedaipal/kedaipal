/**
 * Weekend / weekday rate helpers (S13, `z8r3fddkp8`) — the sanitizer sweep
 * and the label author/reader pair that the order lines depend on.
 */
import { describe, expect, it } from "vitest";
import {
	bookingNightKind,
	DEFAULT_WEEKEND_DAYS,
	MAX_WEEKEND_PRICE,
	sanitizeWeekendRate,
	WEEKDAY_NIGHTS_LABEL,
	weekendDaysLabel,
	weekendNightsLabel,
} from "./productKind";

describe("sanitizeWeekendRate", () => {
	it("no price means no rate — days alone are dropped, one spelling", () => {
		expect(sanitizeWeekendRate(undefined, undefined)).toEqual({});
		expect(sanitizeWeekendRate(0, [5, 6])).toEqual({});
		expect(sanitizeWeekendRate(undefined, [0])).toEqual({});
	});

	it("a price with no days defaults to Fri + Sat nights", () => {
		expect(sanitizeWeekendRate(12_000, undefined)).toEqual({
			weekendPrice: 12_000,
			weekendDays: [...DEFAULT_WEEKEND_DAYS],
		});
		expect(DEFAULT_WEEKEND_DAYS).toEqual([5, 6]);
	});

	it("dedupes and sorts the picked nights so equal picks store equally", () => {
		expect(sanitizeWeekendRate(12_000, [6, 5, 6, 0])).toEqual({
			weekendPrice: 12_000,
			weekendDays: [0, 5, 6],
		});
	});

	it("refuses a bad price", () => {
		for (const bad of [-1, 1.5, MAX_WEEKEND_PRICE + 1]) {
			expect(() => sanitizeWeekendRate(bad, undefined)).toThrow(
				/Weekend rate must be/,
			);
		}
		expect(sanitizeWeekendRate(MAX_WEEKEND_PRICE, undefined).weekendPrice).toBe(
			MAX_WEEKEND_PRICE,
		);
	});

	it("refuses a price with no nights, and a rate on every night", () => {
		expect(() => sanitizeWeekendRate(12_000, [])).toThrow(
			/at least one night/,
		);
		expect(() => sanitizeWeekendRate(12_000, [0, 1, 2, 3, 4, 5, 6])).toThrow(
			/every night/,
		);
	});

	it("refuses a night that isn't a weekday index", () => {
		for (const bad of [[7], [-1], [1.5]]) {
			expect(() => sanitizeWeekendRate(12_000, bad)).toThrow(
				/days of the week/,
			);
		}
	});

	it("refuses the pair on a fixed-length package — surfaced, not ignored", () => {
		expect(() =>
			sanitizeWeekendRate(12_000, [5, 6], { packageLength: 30 }),
		).toThrow(/package has one flat price/);
		// A package with NO rate is fine — nothing to refuse.
		expect(sanitizeWeekendRate(undefined, undefined, { packageLength: 30 })).toEqual(
			{},
		);
		// packageLength 0 / unset is the free range.
		expect(
			sanitizeWeekendRate(12_000, [5, 6], { packageLength: 0 }).weekendPrice,
		).toBe(12_000);
	});
});

describe("weekendDaysLabel", () => {
	it("reads in Mon→Sun order with an ampersand before the last", () => {
		expect(weekendDaysLabel([5, 6])).toBe("Fri & Sat");
		expect(weekendDaysLabel([6, 5])).toBe("Fri & Sat");
		expect(weekendDaysLabel([0, 5, 6])).toBe("Fri, Sat & Sun");
		expect(weekendDaysLabel([0])).toBe("Sun");
		// Sunday sorts LAST, never first — the storage order is 0-first.
		expect(weekendDaysLabel([0, 6])).toBe("Sat & Sun");
		expect(weekendDaysLabel([])).toBe("");
	});
});

describe("order-line labels round-trip through bookingNightKind", () => {
	it("the writer and the reader agree", () => {
		expect(bookingNightKind(WEEKDAY_NIGHTS_LABEL)).toBe("weekday");
		expect(bookingNightKind(weekendNightsLabel([5, 6]))).toBe("weekend");
		expect(bookingNightKind(weekendNightsLabel([0]))).toBe("weekend");
		expect(weekendNightsLabel([5, 6])).toBe("Weekend nights (Fri & Sat)");
	});

	it("a pre-S13 or ordinary variant label is neither", () => {
		expect(bookingNightKind(undefined)).toBeUndefined();
		expect(bookingNightKind("Riverside")).toBeUndefined();
		expect(bookingNightKind("Weekend nights")).toBeUndefined();
	});
});
