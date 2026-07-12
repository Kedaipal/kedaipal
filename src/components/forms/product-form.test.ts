import { describe, expect, it } from "vitest";
import { buildSubmitVariants } from "./product-form";
import type { VariantRow } from "./variant-editor";

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

	it("still requires a whole-number stock when tracking stock", () => {
		const result = buildSubmitVariants(
			[row({ blockWhenOutOfStock: true, stock: "" })],
			null,
		);
		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error).toMatch(/whole-number stock/i);
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

	it("still rejects a missing price on an active variant", () => {
		const result = buildSubmitVariants([row({ price: "" })], null);
		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error).toMatch(/valid price/i);
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
