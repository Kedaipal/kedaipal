import { describe, expect, test } from "vitest";
import { emptySkipCounts } from "../../convex/lib/pdf/awb";
import {
	AWB_SORT_OPTIONS,
	describeAwbSkips,
	totalSkipped,
} from "./awb-labels";

describe("describeAwbSkips", () => {
	test("nothing skipped says nothing", () => {
		expect(describeAwbSkips(emptySkipCounts())).toBeNull();
	});

	test("names the CAUSE, never a bare count", () => {
		expect(describeAwbSkips({ ...emptySkipCounts(), no_address: 2 })).toBe(
			"Skipped 2 for pickup (no delivery address).",
		);
	});

	test("lists every reason present, in a stable order", () => {
		expect(
			describeAwbSkips({ cancelled: 1, no_address: 3, not_found: 2 }),
		).toBe(
			"Skipped 3 for pickup (no delivery address), 1 cancelled, 2 no longer in your orders.",
		);
	});

	test("totalSkipped sums every reason", () => {
		expect(totalSkipped({ cancelled: 1, no_address: 3, not_found: 2 })).toBe(6);
		expect(totalSkipped(emptySkipCounts())).toBe(0);
	});
});

describe("AWB_SORT_OPTIONS", () => {
	test("delivery date leads — it matches the inbox's own default order", () => {
		expect(AWB_SORT_OPTIONS[0].value).toBe("fulfilment");
	});

	test("offers all four sorts, each with a hint", () => {
		expect(AWB_SORT_OPTIONS.map((o) => o.value)).toEqual([
			"fulfilment",
			"status",
			"courier",
			"area",
		]);
		for (const option of AWB_SORT_OPTIONS) {
			expect(option.hint.length).toBeGreaterThan(0);
		}
	});
});
