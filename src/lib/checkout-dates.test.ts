import { describe, expect, it } from "vitest";
import { addDaysYmd, quickPickDays, ymdChipLabel } from "./checkout-dates";

describe("addDaysYmd", () => {
	it("adds days in pure calendar space", () => {
		expect(addDaysYmd("2026-07-29", 1)).toBe("2026-07-30");
		expect(addDaysYmd("2026-07-31", 1)).toBe("2026-08-01");
		expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDaysYmd("2026-07-29", 0)).toBe("2026-07-29");
	});

	it("crosses months backwards too", () => {
		expect(addDaysYmd("2026-08-01", -1)).toBe("2026-07-31");
	});
});

describe("ymdChipLabel", () => {
	it("renders weekday + day + month", () => {
		// 2026-07-29 is a Wednesday.
		expect(ymdChipLabel("2026-07-29")).toBe("Wed, 29 Jul");
	});
});

describe("quickPickDays", () => {
	it("labels the notice-free case Today / Tomorrow / weekday", () => {
		const days = quickPickDays("2026-07-29", "2026-08-28", "2026-07-29");
		expect(days).toHaveLength(3);
		expect(days[0]).toEqual({ ymd: "2026-07-29", label: "Today" });
		expect(days[1]).toEqual({ ymd: "2026-07-30", label: "Tomorrow" });
		expect(days[2].ymd).toBe("2026-07-31");
		expect(days[2].label).toBe(ymdChipLabel("2026-07-31"));
	});

	it("never says Today when a notice window pushes the floor past it", () => {
		// 2-day notice: min = today + 2 → first chip is a plain weekday label.
		const days = quickPickDays("2026-07-31", "2026-08-28", "2026-07-29");
		expect(days[0].ymd).toBe("2026-07-31");
		expect(days[0].label).toBe(ymdChipLabel("2026-07-31"));
	});

	it("says Tomorrow when the floor is exactly today + 1", () => {
		const days = quickPickDays("2026-07-30", "2026-08-28", "2026-07-29");
		expect(days[0]).toEqual({ ymd: "2026-07-30", label: "Tomorrow" });
	});

	it("stops at the max bound", () => {
		const days = quickPickDays("2026-08-27", "2026-08-28", "2026-07-29");
		expect(days.map((d) => d.ymd)).toEqual(["2026-08-27", "2026-08-28"]);
	});

	it("returns nothing for an empty or inverted window", () => {
		expect(quickPickDays("", "", "2026-07-29")).toEqual([]);
		expect(quickPickDays("2026-08-02", "2026-08-01", "2026-07-29")).toEqual([]);
	});
});

describe("quickPickDays — isSelectable filter (store opening hours, 86eyp5rav)", () => {
	it("skips filtered-out days and scans forward so three REAL choices show", () => {
		const days = quickPickDays(
			"2026-07-01",
			"2026-07-31",
			"2026-07-01",
			3,
			(ymd) => ymd !== "2026-07-02", // store closed on the 2nd
		);
		expect(days.map((d) => d.ymd)).toEqual([
			"2026-07-01",
			"2026-07-03",
			"2026-07-04",
		]);
		expect(days[0].label).toBe("Today");
	});

	it("returns fewer chips when the window can't fill the count", () => {
		const days = quickPickDays(
			"2026-07-01",
			"2026-07-03",
			"2026-07-01",
			3,
			(ymd) => ymd === "2026-07-02", // only one open day in the window
		);
		expect(days.map((d) => d.ymd)).toEqual(["2026-07-02"]);
	});

	it("today skipped by the filter never labels another day 'Today'", () => {
		const days = quickPickDays(
			"2026-07-01",
			"2026-07-31",
			"2026-07-01",
			2,
			(ymd) => ymd !== "2026-07-01",
		);
		expect(days[0]).toEqual({ ymd: "2026-07-02", label: "Tomorrow" });
	});
});
