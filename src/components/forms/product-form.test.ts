import { describe, expect, it } from "vitest";
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
});
