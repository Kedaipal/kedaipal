import { describe, expect, it } from "vitest";
import { overCapMessage } from "../../../convex/lib/variant";
import { buildSubmitVariants, collectOptionIssues } from "./product-form";
import type { VariantIssue, VariantRow } from "./variant-editor";

/** A fully-valid single variant; spread over to vary one field per case. */
function row(overrides: Partial<VariantRow> = {}): VariantRow {
	return {
		optionValues: [],
		sku: "",
		price: "10.00",
		stock: "5",
		active: true,
		blockWhenOutOfStock: true,
		requiresProof: false,
		parcelWeightG: "",
		imageStorageIds: [],
		...overrides,
	};
}

function issuesOf(
	result: ReturnType<typeof buildSubmitVariants>,
): VariantIssue[] {
	return "issues" in result ? result.issues : [];
}

describe("buildSubmitVariants — stock validation", () => {
	it("accepts a made-to-order variant with blank stock (falls back to 0)", () => {
		const result = buildSubmitVariants(
			[row({ blockWhenOutOfStock: false, stock: "" })],
			null,
		);
		expect("variants" in result).toBe(true);
		if ("variants" in result) {
			expect(result.variants[0].onHand).toBe(0);
			expect(result.variants[0].blockWhenOutOfStock).toBe(false);
		}
	});

	it("accepts a made-to-order variant with an explicit 0 stock", () => {
		const result = buildSubmitVariants(
			[row({ blockWhenOutOfStock: false, stock: "0" })],
			null,
		);
		expect("variants" in result).toBe(true);
		if ("variants" in result) expect(result.variants[0].onHand).toBe(0);
	});

	it("still requires a whole-number stock when tracking stock — addressed to the row's stock field", () => {
		const result = buildSubmitVariants(
			[row({ blockWhenOutOfStock: true, stock: "" })],
			null,
		);
		expect(issuesOf(result)).toEqual([
			expect.objectContaining({ where: "row", index: 0, field: "stock" }),
		]);
	});

	it("accepts 0 stock when tracking stock (0 is a valid whole number)", () => {
		const result = buildSubmitVariants(
			[row({ blockWhenOutOfStock: true, stock: "0" })],
			null,
		);
		expect("variants" in result).toBe(true);
		if ("variants" in result) expect(result.variants[0].onHand).toBe(0);
	});

	it("does not block on blank stock for an inactive (deactivated) variant", () => {
		const result = buildSubmitVariants(
			[row({ active: false, stock: "" })],
			null,
		);
		expect("variants" in result).toBe(true);
		if ("variants" in result) expect(result.variants[0].onHand).toBe(0);
	});

	it("still rejects a missing price on an active variant — addressed to the row's price field", () => {
		const result = buildSubmitVariants([row({ price: "" })], null);
		expect(issuesOf(result)).toEqual([
			expect.objectContaining({ where: "row", index: 0, field: "price" }),
		]);
	});
});

describe("buildSubmitVariants — collects ALL issues, addressed per row/field", () => {
	it("reports every invalid cell in one pass (not just the first)", () => {
		const result = buildSubmitVariants(
			[
				row({ optionValues: ["Small"], price: "", stock: "" }),
				row({ optionValues: ["Large"], price: "abc", stock: "3" }),
			],
			null,
		);
		const issues = issuesOf(result);
		expect(issues).toHaveLength(3);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ where: "row", index: 0, field: "price" }),
				expect.objectContaining({ where: "row", index: 0, field: "stock" }),
				expect.objectContaining({ where: "row", index: 1, field: "price" }),
			]),
		);
	});

	it("a made-to-order row only flags price, never stock", () => {
		const result = buildSubmitVariants(
			[row({ blockWhenOutOfStock: false, price: "", stock: "" })],
			null,
		);
		expect(issuesOf(result)).toEqual([
			expect.objectContaining({ where: "row", index: 0, field: "price" }),
		]);
	});

	it("an invalid custom-line price is addressed to the custom price field", () => {
		const result = buildSubmitVariants([row()], {
			label: "Bespoke",
			price: "not-a-price",
			prompt: "",
			imageStorageIds: [],
		});
		expect(issuesOf(result)).toEqual([
			expect.objectContaining({ where: "custom", index: 0, field: "price" }),
		]);
	});
});

describe("buildSubmitVariants — custom line", () => {
	it("appends the custom line as a made-to-order, mockup-gated entry", () => {
		const result = buildSubmitVariants([row()], {
			label: "Bespoke cake",
			price: "",
			prompt: "Tell us your theme",
			imageStorageIds: [],
		});
		expect("variants" in result).toBe(true);
		if ("variants" in result) {
			const custom = result.variants.at(-1);
			expect(custom?.isCustom).toBe(true);
			expect(custom?.price).toBe(0); // blank price = price on quote
			expect(custom?.blockWhenOutOfStock).toBe(false);
			expect(custom?.requiresProof).toBe(true);
			expect(custom?.onHand).toBe(0);
		}
	});
});

describe("collectOptionIssues", () => {
	it("flags an unnamed axis and an axis with no values, per axis", () => {
		expect(
			collectOptionIssues([
				{ name: "", values: ["Small"] },
				{ name: "Flavour", values: [] },
			]),
		).toEqual([
			expect.objectContaining({ where: "option", index: 0, field: "name" }),
			expect.objectContaining({ where: "option", index: 1, field: "values" }),
		]);
	});

	it("an empty axis reports both problems; valid axes report none", () => {
		expect(collectOptionIssues([{ name: "", values: [] }])).toHaveLength(2);
		expect(collectOptionIssues([{ name: "Size", values: ["S", "M"] }])).toEqual(
			[],
		);
	});

	// z8r3fdjgvd — the cap is broken by adding a VALUE, so it is reported on the
	// axis and (being an option issue) ahead of every row issue, which is what
	// the focus-first-error helper lands on.
	it("reports an over-cap grid FIRST, as an axis problem", () => {
		const issues = collectOptionIssues([
			{
				name: "Adult 1 size",
				values: Array.from({ length: 11 }, (_, i) => `a${i}`),
			},
			{
				name: "Adult 2 size",
				values: Array.from({ length: 10 }, (_, i) => `b${i}`),
			},
		]);
		expect(issues[0]).toEqual(
			expect.objectContaining({ where: "option", index: 0, field: "values" }),
		);
		// The consequence, not just the fact.
		// The shared sentence — states the EXCESS and asks for values, which is
		// the only mapping that is true at every shape.
		expect(issues[0].message).toBe(overCapMessage(110));
		expect(issues[0].message).toMatch(/110 choices — 10 over the limit of 100/);
	});

	it("the 56-choice grid the cap was raised for reports nothing", () => {
		const sizes = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"];
		expect(
			collectOptionIssues([
				{ name: "Adult 1 size", values: sizes },
				{ name: "Adult 2 size", values: ["None", ...sizes] },
			]),
		).toEqual([]);
	});
});

describe("buildSubmitVariants — sale prices (z8r3fdcw72)", () => {
	it("converts a valid sale price to minor units and leaves blanks off promo", () => {
		const result = buildSubmitVariants(
			[row({ price: "45.00", promoPrice: "31.50" }), row({ price: "45.00" })],
			null,
		);
		expect("variants" in result).toBe(true);
		if ("variants" in result) {
			expect(result.variants[0].promoPrice).toBe(3150);
			// Blank = this line simply isn't on promotion, which is the default.
			expect(result.variants[1].promoPrice).toBeUndefined();
		}
	});

	it("refuses a sale price that doesn't undercut its OWN line", () => {
		const atList = buildSubmitVariants(
			[row({ price: "45.00", promoPrice: "45.00" })],
			null,
		);
		expect("issues" in atList).toBe(true);
		if ("issues" in atList) {
			expect(atList.issues).toEqual([
				{
					where: "row",
					index: 0,
					field: "promoPrice",
					message: "A sale price has to be below this line's normal price.",
				},
			]);
		}
		const above = buildSubmitVariants(
			[row({ price: "45.00", promoPrice: "50.00" })],
			null,
		);
		expect("issues" in above).toBe(true);
		if ("issues" in above) expect(above.issues[0].field).toBe("promoPrice");
	});

	it("names a sale price that isn't a number at all", () => {
		const result = buildSubmitVariants(
			[row({ price: "45.00", promoPrice: "half price" })],
			null,
		);
		expect("issues" in result).toBe(true);
		if ("issues" in result) {
			expect(result.issues[0]).toMatchObject({ field: "promoPrice" });
			expect(result.issues[0].message).toMatch(/numbers only/);
		}
	});

	it("an inactive row's sale price is not policed — it sells nothing", () => {
		const result = buildSubmitVariants(
			[row({ active: false, price: "45.00", promoPrice: "99.00" })],
			null,
		);
		expect("variants" in result).toBe(true);
	});
});
