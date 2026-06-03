import { describe, expect, test } from "vitest";
import {
	availableValuesPerAxis,
	cartesian,
	isSellable,
	resolveVariant,
	sameOptionValues,
	variantLabel,
} from "./variant";

const SALMON_OPTIONS = [
	{ name: "Weight", values: ["500g", "1kg"] },
	{ name: "Cut", values: ["Fillet", "Whole"] },
];

// Sellable everywhere except 1kg/Whole which is out of stock.
const SALMON_VARIANTS = [
	{ optionValues: ["500g", "Fillet"], onHand: 5, active: true },
	{ optionValues: ["500g", "Whole"], onHand: 2, active: true },
	{ optionValues: ["1kg", "Fillet"], onHand: 3, active: true },
	{ optionValues: ["1kg", "Whole"], onHand: 0, active: true },
];

describe("storefront variant helpers", () => {
	test("cartesian + variantLabel basics", () => {
		expect(cartesian([])).toEqual([[]]);
		expect(variantLabel([])).toBe("");
		expect(variantLabel(["1kg", "Fillet"])).toBe("1kg / Fillet");
	});

	test("sameOptionValues handles null slots in a partial selection", () => {
		expect(sameOptionValues(["1kg", "Fillet"], ["1kg", "Fillet"])).toBe(true);
		expect(sameOptionValues(["1kg", "Fillet"], ["1kg", null])).toBe(false);
	});

	describe("isSellable", () => {
		test("made-to-order is always sellable", () => {
			expect(isSellable({ optionValues: [], onHand: 0 }, false)).toBe(true);
		});
		test("hard-block requires stock", () => {
			expect(isSellable({ optionValues: [], onHand: 0 }, true)).toBe(false);
			expect(isSellable({ optionValues: [], onHand: 1 }, true)).toBe(true);
		});
		test("inactive variants are never sellable", () => {
			expect(
				isSellable({ optionValues: [], onHand: 9, active: false }, false),
			).toBe(false);
		});
	});

	describe("availableValuesPerAxis (hard-block)", () => {
		test("with no selection, every value with a sellable variant is open", () => {
			const [weight, cut] = availableValuesPerAxis(
				SALMON_OPTIONS,
				SALMON_VARIANTS,
				[null, null],
				true,
			);
			// Both weights still have at least one sellable cut.
			expect([...weight].sort()).toEqual(["1kg", "500g"]);
			expect([...cut].sort()).toEqual(["Fillet", "Whole"]);
		});

		test("selecting 1kg greys out Whole (its only 1kg combo is sold out)", () => {
			const [, cut] = availableValuesPerAxis(
				SALMON_OPTIONS,
				SALMON_VARIANTS,
				["1kg", null],
				true,
			);
			expect([...cut]).toEqual(["Fillet"]);
		});

		test("made-to-order keeps the sold-out combo available", () => {
			const [, cut] = availableValuesPerAxis(
				SALMON_OPTIONS,
				SALMON_VARIANTS,
				["1kg", null],
				false,
			);
			expect([...cut].sort()).toEqual(["Fillet", "Whole"]);
		});
	});

	describe("resolveVariant", () => {
		test("returns null for an incomplete selection", () => {
			expect(resolveVariant(SALMON_VARIANTS, ["1kg", null])).toBeNull();
		});
		test("resolves a complete selection to its exact variant", () => {
			const v = resolveVariant(SALMON_VARIANTS, ["1kg", "Fillet"]);
			expect(v?.optionValues).toEqual(["1kg", "Fillet"]);
		});
		test("single-variant product resolves on empty selection", () => {
			const variants = [{ optionValues: [], onHand: 5, active: true }];
			expect(resolveVariant(variants, [])?.onHand).toBe(5);
		});
	});
});
