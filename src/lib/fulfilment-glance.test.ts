import { describe, expect, it } from "vitest";
import {
	MAX_CLOSE_MINUTES,
	type OpeningHours,
} from "../../convex/lib/openingHours";
import { hoursSummary, noticeSummary } from "./fulfilment-glance";

const nineToSix = { open: 9 * 60, close: 18 * 60 };
const closed = { ...nineToSix, closed: true as const };
const week = (days: Array<typeof nineToSix | typeof closed>): OpeningHours =>
	days as OpeningHours;

describe("hoursSummary", () => {
	it("reads no schedule as open around the clock", () => {
		expect(hoursSummary(undefined)).toEqual({
			glance: "Open 24/7",
			row: "Every day · Open 24 hours",
		});
	});

	it("collapses a run of days into a range, Monday first", () => {
		// index 0 = Sunday; Monday is the one day off.
		const h = week([
			nineToSix,
			closed,
			nineToSix,
			nineToSix,
			nineToSix,
			nineToSix,
			nineToSix,
		]);
		expect(hoursSummary(h)).toEqual({
			glance: "Open 6 days",
			row: "Tue–Sun · 9:00 AM – 6:00 PM",
		});
	});

	it("lists scattered days and admits when the hours differ", () => {
		const h = week([
			closed,
			{ open: 8 * 60, close: 12 * 60 },
			closed,
			nineToSix,
			closed,
			closed,
			closed,
		]);
		expect(hoursSummary(h)).toEqual({
			glance: "Open 2 days",
			row: "Mon, Wed · hours vary",
		});
	});

	it("says every day when nothing is closed", () => {
		const allDay = { open: 0, close: MAX_CLOSE_MINUTES };
		const h = week(Array.from({ length: 7 }, () => allDay));
		expect(hoursSummary(h).glance).toBe("Open every day");
		expect(hoursSummary(h).row).toBe("Every day · Open 24 hours");
	});
});

describe("noticeSummary", () => {
	it("names same-day and pluralises days", () => {
		expect(noticeSummary(0)).toBe("Same-day");
		expect(noticeSummary(1)).toBe("1 day");
		expect(noticeSummary(3)).toBe("3 days");
	});
});
