import { describe, expect, test } from "vitest";
import {
	cartesian,
	isValidCombination,
	MAX_VALUES_PER_AXIS,
	normalizeOptions,
	sameOptionValues,
	variantLabel,
} from "./lib/variant";

describe("variant helpers", () => {
	test("cartesian of zero axes yields one implicit default combo", () => {
		expect(cartesian([])).toEqual([[]]);
	});

	test("cartesian of one axis", () => {
		expect(cartesian([{ name: "Size", values: ["S", "M", "L"] }])).toEqual([
			["S"],
			["M"],
			["L"],
		]);
	});

	test("cartesian of two axes is row-major, axis-aligned", () => {
		expect(
			cartesian([
				{ name: "Weight", values: ["500g", "1kg"] },
				{ name: "Cut", values: ["Fillet", "Whole"] },
			]),
		).toEqual([
			["500g", "Fillet"],
			["500g", "Whole"],
			["1kg", "Fillet"],
			["1kg", "Whole"],
		]);
	});

	test("variantLabel joins values; empty for the default", () => {
		expect(variantLabel([])).toBe("");
		expect(variantLabel(["1kg", "Fillet"])).toBe("1kg / Fillet");
	});

	test("sameOptionValues compares positionally", () => {
		expect(sameOptionValues(["a", "b"], ["a", "b"])).toBe(true);
		expect(sameOptionValues(["a", "b"], ["b", "a"])).toBe(false);
		expect(sameOptionValues([], [])).toBe(true);
	});

	test("isValidCombination checks length + membership", () => {
		const options = [{ name: "Size", values: ["S", "M"] }];
		expect(isValidCombination(options, ["S"])).toBe(true);
		expect(isValidCombination(options, ["XL"])).toBe(false);
		expect(isValidCombination(options, ["S", "Red"])).toBe(false);
	});

	describe("normalizeOptions", () => {
		test("undefined/empty → []", () => {
			expect(normalizeOptions(undefined)).toEqual([]);
			expect(normalizeOptions([])).toEqual([]);
		});

		test("trims names + values and drops blank values", () => {
			expect(
				normalizeOptions([{ name: "  Size  ", values: [" S ", "M", "  "] }]),
			).toEqual([{ name: "Size", values: ["S", "M"] }]);
		});

		test("rejects > 2 axes", () => {
			expect(() =>
				normalizeOptions([
					{ name: "A", values: ["1"] },
					{ name: "B", values: ["1"] },
					{ name: "C", values: ["1"] },
				]),
			).toThrow(/At most 2 option axes/);
		});

		test("rejects duplicate axis names (case-insensitive)", () => {
			expect(() =>
				normalizeOptions([
					{ name: "Size", values: ["S"] },
					{ name: "size", values: ["M"] },
				]),
			).toThrow(/Duplicate option axis/);
		});

		test("rejects duplicate values within an axis", () => {
			expect(() =>
				normalizeOptions([{ name: "Size", values: ["S", "s"] }]),
			).toThrow(/Duplicate value/);
		});

		test("rejects an axis with no usable values", () => {
			expect(() =>
				normalizeOptions([{ name: "Size", values: ["  "] }]),
			).toThrow(/at least one value/);
		});

		test("rejects a grid exceeding the 100-variant cap", () => {
			// 11 × 10 = 110 > 100. Both axes stay inside MAX_VALUES_PER_AXIS (25),
			// so this is the VARIANT cap refusing, not the per-axis one.
			expect(() =>
				normalizeOptions([
					{ name: "A", values: Array.from({ length: 11 }, (_, i) => `a${i}`) },
					{ name: "B", values: Array.from({ length: 10 }, (_, i) => `b${i}`) },
				]),
			).toThrow(/That makes 110 variants — max 100 per product/);
		});

		test("accepts the 56-variant two-size event grid (z8r3fdjgvd)", () => {
			// "Adult 1 size" (S–4XL) × "Adult 2 size" (None + S–4XL) = 7 × 8 = 56.
			// Refused by the old cap of 50; the reason the cap moved.
			const sizes = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"];
			const normalized = normalizeOptions([
				{ name: "Adult 1 size", values: sizes },
				{ name: "Adult 2 size", values: ["None", ...sizes] },
			]);
			expect(cartesian(normalized)).toHaveLength(56);
		});

		test("the variant cap, not MAX_VALUES_PER_AXIS, refuses a full 25 × 25 grid", () => {
			// Both axes are exactly at MAX_VALUES_PER_AXIS, so the per-axis guard is
			// satisfied and 625 has to be caught by MAX_VARIANTS_PER_PRODUCT.
			const values = Array.from({ length: MAX_VALUES_PER_AXIS }, (_, i) => `v${i}`);
			expect(() =>
				normalizeOptions([
					{ name: "A", values },
					{ name: "B", values },
				]),
			).toThrow(/That makes 625 variants — max 100 per product/);
		});
	});
});
