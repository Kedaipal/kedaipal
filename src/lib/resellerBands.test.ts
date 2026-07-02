import { describe, expect, test } from "vitest";
import { RESELLER_BANDS, SCALE_FROM_PRICE } from "./resellerBands";

// The Scale tier is banded on active resellers (ClickUp 86ey4gaju). These bands
// are the single source of truth shared by /pricing and the landing teaser, so
// this guards the ticketed table against drift.
describe("reseller bands", () => {
	test("mirrors the ticketed band table (299 / 499 / 799 / custom)", () => {
		expect(RESELLER_BANDS).toEqual([
			{ labelKey: "upTo10", price: "RM299" },
			{ labelKey: "11to30", price: "RM499" },
			{ labelKey: "31to75", price: "RM799" },
			{ labelKey: "75plus", price: null },
		]);
	});

	test("only the top (75+) band is a custom quote", () => {
		const customs = RESELLER_BANDS.filter((b) => b.price === null);
		expect(customs).toHaveLength(1);
		expect(customs[0].labelKey).toBe("75plus");
	});

	test("named prices ascend", () => {
		const nums = RESELLER_BANDS.map((b) => b.price)
			.filter((p): p is string => p !== null)
			.map((p) => Number(p.replace("RM", "")));
		const sorted = [...nums].sort((a, b) => a - b);
		expect(nums).toEqual(sorted);
	});

	test("the 'from' anchor equals the lowest band price", () => {
		expect(`RM${SCALE_FROM_PRICE}`).toBe(RESELLER_BANDS[0].price);
	});
});
