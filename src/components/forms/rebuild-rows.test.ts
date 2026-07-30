import { describe, expect, it } from "vitest";
import { emptyRow, rebuildRows, type VariantRow } from "./variant-editor";

function single(partial: Partial<VariantRow> = {}): VariantRow {
	return { ...emptyRow([]), ...partial };
}

describe("rebuildRows", () => {
	it("keeps the seller's rows while an axis is still incomplete", () => {
		// The segmented "Buyer picks a choice" control seeds an EMPTY axis, and
		// cartesian() over zero values is []. Wiping rows there would discard the
		// price/flags the seller already typed (PR #108 review, finding 1).
		const rows = [single({ price: "12", blockWhenOutOfStock: false })];
		expect(rebuildRows([{ name: "", values: [] }], rows)).toBe(rows);
		expect(rebuildRows([{ name: "Size", values: [] }], rows)).toBe(rows);
		// Also holds for the second axis: adding it before typing values must not
		// destroy the priced first-axis grid.
		const grid = [
			single({ optionValues: ["S"], price: "12" }),
			single({ optionValues: ["M"], price: "18" }),
		];
		expect(
			rebuildRows(
				[
					{ name: "Size", values: ["S", "M"] },
					{ name: "Flavour", values: [] },
				],
				grid,
			),
		).toBe(grid);
	});

	it("carries the single row's price + fulfilment into every generated row", () => {
		const rows = [
			single({ price: "12", stock: "5", blockWhenOutOfStock: false }),
		];
		const next = rebuildRows([{ name: "Size", values: ["S", "M", "L"] }], rows);
		expect(next).toHaveLength(3);
		expect(next.map((r) => r.price)).toEqual(["12", "12", "12"]);
		expect(next.map((r) => r.blockWhenOutOfStock)).toEqual([
			false,
			false,
			false,
		]);
		// SKU stays per-row blank — those must be unique per variant.
		expect(next.map((r) => r.sku)).toEqual(["", "", ""]);
	});

	it("survives the two-step switch (empty axis, then a preset) with values intact", () => {
		// Exactly the seller path: type RM12 + Made to order → "Buyer picks a
		// choice" (empty axis) → tap the "Size" preset.
		const start = [single({ price: "12", blockWhenOutOfStock: false })];
		const afterSwitch = rebuildRows([{ name: "", values: [] }], start);
		const afterPreset = rebuildRows(
			[{ name: "Size", values: ["Small", "Medium", "Large"] }],
			afterSwitch,
		);
		expect(afterPreset.map((r) => r.price)).toEqual(["12", "12", "12"]);
		expect(afterPreset.map((r) => r.blockWhenOutOfStock)).toEqual([
			false,
			false,
			false,
		]);
	});

	it("preserves typed values for surviving combinations when values change", () => {
		const rows = [
			single({ optionValues: ["S"], price: "12", sku: "BRN-S" }),
			single({ optionValues: ["M"], price: "18" }),
		];
		const next = rebuildRows([{ name: "Size", values: ["S", "L"] }], rows);
		expect(next).toHaveLength(2);
		expect(next[0]).toMatchObject({ price: "12", sku: "BRN-S" });
		// New combination inherits the first row's flags, not emptyRow defaults.
		expect(next[1].price).toBe("");
		expect(next[1].blockWhenOutOfStock).toBe(rows[0].blockWhenOutOfStock);
	});

	it("collapsing to zero axes returns the single implicit row", () => {
		const rows = [
			single({ optionValues: ["S"], price: "12" }),
			single({ optionValues: ["M"], price: "18" }),
		];
		const next = rebuildRows([], rows);
		expect(next).toHaveLength(1);
		expect(next[0].optionValues).toEqual([]);
	});
});
