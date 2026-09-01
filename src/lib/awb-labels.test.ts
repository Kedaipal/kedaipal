import { describe, expect, test } from "vitest";
import { emptySkipCounts } from "../../convex/lib/pdf/awb";
import {
	AWB_SORT_OPTIONS,
	defaultCheckedQueueIds,
	describeAwbPaper,
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

describe("defaultCheckedQueueIds (the print-queue modal's default ticks)", () => {
	const row = (orderId: string, labelPrintedAt?: number) => ({
		orderId,
		labelPrintedAt,
	});

	test("never-printed rows start checked", () => {
		expect(defaultCheckedQueueIds([row("a"), row("b")])).toEqual(["a", "b"]);
	});

	test("previously-printed rows start UNCHECKED — the deliberate-reprint rule", () => {
		expect(
			defaultCheckedQueueIds([row("a", 1_000), row("b"), row("c", 2_000)]),
		).toEqual(["b"]);
	});

	test("a printed timestamp of 0 still counts as printed (only undefined is 'never')", () => {
		expect(defaultCheckedQueueIds([row("a", 0)])).toEqual([]);
	});

	test("an empty queue defaults to nothing", () => {
		expect(defaultCheckedQueueIds([])).toEqual([]);
	});

	test("keeps the queue's own order (oldest first)", () => {
		expect(defaultCheckedQueueIds([row("z"), row("m", 5), row("a")])).toEqual([
			"z",
			"a",
		]);
	});
});

describe("describeAwbPaper", () => {
	test("names both paper sizes the way the printer will behave", () => {
		expect(describeAwbPaper("a6")).toBe("one A6 label per page");
		expect(describeAwbPaper("a4-4up")).toBe("four labels per A4 sheet");
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
