import { describe, expect, test } from "vitest";
import {
	availableValuesPerAxis,
	cartesian,
	getCustomLine,
	isSellable,
	resolveVariant,
	sameOptionValues,
	variantLabel,
} from "./variant";

const SALMON_OPTIONS = [
	{ name: "Weight", values: ["500g", "1kg"] },
	{ name: "Cut", values: ["Fillet", "Whole"] },
];

// Sellable everywhere except 1kg/Whole which is out of stock. Hard-block flag is
// resolved per-variant (the server folds in the product default before sending).
const SALMON_VARIANTS = [
	{
		optionValues: ["500g", "Fillet"],
		onHand: 5,
		active: true,
		blockWhenOutOfStock: true,
	},
	{
		optionValues: ["500g", "Whole"],
		onHand: 2,
		active: true,
		blockWhenOutOfStock: true,
	},
	{
		optionValues: ["1kg", "Fillet"],
		onHand: 3,
		active: true,
		blockWhenOutOfStock: true,
	},
	{
		optionValues: ["1kg", "Whole"],
		onHand: 0,
		active: true,
		blockWhenOutOfStock: true,
	},
];

// Same combos, but every variant is made-to-order (never blocks).
const SALMON_MTO = SALMON_VARIANTS.map((v) => ({
	...v,
	blockWhenOutOfStock: false,
}));

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
			expect(
				isSellable({ optionValues: [], onHand: 0, blockWhenOutOfStock: false }),
			).toBe(true);
		});
		test("hard-block requires stock", () => {
			expect(
				isSellable({ optionValues: [], onHand: 0, blockWhenOutOfStock: true }),
			).toBe(false);
			expect(
				isSellable({ optionValues: [], onHand: 1, blockWhenOutOfStock: true }),
			).toBe(true);
		});
		test("inactive variants are never sellable", () => {
			expect(
				isSellable({
					optionValues: [],
					onHand: 9,
					active: false,
					blockWhenOutOfStock: false,
				}),
			).toBe(false);
		});
	});

	describe("availableValuesPerAxis (hard-block)", () => {
		test("with no selection, every value with a sellable variant is open", () => {
			const [weight, cut] = availableValuesPerAxis(
				SALMON_OPTIONS,
				SALMON_VARIANTS,
				[null, null],
			);
			// Both weights still have at least one sellable cut.
			expect([...weight].sort()).toEqual(["1kg", "500g"]);
			expect([...cut].sort()).toEqual(["Fillet", "Whole"]);
		});

		test("selecting 1kg greys out Whole (its only 1kg combo is sold out)", () => {
			const [, cut] = availableValuesPerAxis(SALMON_OPTIONS, SALMON_VARIANTS, [
				"1kg",
				null,
			]);
			expect([...cut]).toEqual(["Fillet"]);
		});

		test("made-to-order keeps the sold-out combo available", () => {
			const [, cut] = availableValuesPerAxis(SALMON_OPTIONS, SALMON_MTO, [
				"1kg",
				null,
			]);
			expect([...cut].sort()).toEqual(["Fillet", "Whole"]);
		});

		test("mixed product — only the hard-block sold-out combo greys out", () => {
			// 1kg/Whole hard-blocks (sold out → greyed); the rest are made-to-order.
			const mixed = SALMON_VARIANTS.map((v) => ({
				...v,
				blockWhenOutOfStock:
					v.optionValues[0] === "1kg" && v.optionValues[1] === "Whole",
			}));
			const [, cut] = availableValuesPerAxis(SALMON_OPTIONS, mixed, [
				"1kg",
				null,
			]);
			expect([...cut]).toEqual(["Fillet"]);
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
		test("custom line never shadows the default on empty selection", () => {
			// A no-axes product with a custom line has TWO []-keyed variants; the
			// real default (onHand 5) must win, not the custom row.
			const variants = [
				{ optionValues: [], onHand: 5, active: true },
				{ optionValues: [], onHand: 0, active: true, isCustom: true },
			];
			expect(resolveVariant(variants, [])?.onHand).toBe(5);
		});
	});

	describe("custom line", () => {
		const variants = [
			{
				optionValues: ["S"],
				onHand: 3,
				active: true,
				blockWhenOutOfStock: true,
			},
			{ optionValues: [], onHand: 0, active: true, isCustom: true },
		];
		test("getCustomLine returns the flagged row, or null when absent", () => {
			expect(getCustomLine(variants)?.isCustom).toBe(true);
			expect(getCustomLine([variants[0]])).toBeNull();
		});
		test("is excluded from axis availability (not pill-addressable)", () => {
			// Only the real "S" variant should make "S" available — the custom row's
			// empty optionValues must not register against the Size axis.
			const [size] = availableValuesPerAxis(
				[{ name: "Size", values: ["S"] }],
				variants,
				[null],
			);
			expect([...size]).toEqual(["S"]);
		});
	});
});
