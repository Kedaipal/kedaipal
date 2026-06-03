import { describe, expect, test } from "vitest";
import {
	groupVariantRows,
	parseVariantImport,
	type RawImportRow,
	type VariantImportRow,
	validateVariantRow,
} from "./product-import";

function row(over: Partial<VariantImportRow>): VariantImportRow {
	return {
		rowNumber: 1,
		groupingKey: (over.name ?? "p").toLowerCase(),
		name: "P",
		description: undefined,
		optionNames: [],
		optionValues: [],
		sku: undefined,
		price: 1000,
		onHand: 1,
		parcelWeightG: 0,
		...over,
	};
}

describe("validateVariantRow", () => {
	test("parses options + weight, converts price to sen", () => {
		const raw: RawImportRow = {
			name: "Salmon",
			option1_name: "Weight",
			option1_value: "1kg",
			option2_name: "Cut",
			option2_value: "Fillet",
			sku: "S-1",
			price: "85.50",
			stock: "4",
			weight_grams: "1000",
		};
		const r = validateVariantRow(raw, 2);
		expect("errors" in r).toBe(false);
		const v = r as VariantImportRow;
		expect(v.optionNames).toEqual(["Weight", "Cut"]);
		expect(v.optionValues).toEqual(["1kg", "Fillet"]);
		expect(v.price).toBe(8550);
		expect(v.parcelWeightG).toBe(1000);
		expect(v.groupingKey).toBe("salmon");
	});

	test("product_handle overrides the grouping key", () => {
		const r = validateVariantRow(
			{
				product_handle: "SALMON-2024",
				name: "Salmon",
				price: "10",
				stock: "1",
			},
			2,
		) as VariantImportRow;
		expect(r.groupingKey).toBe("salmon-2024");
	});

	test("rejects an option name without a value", () => {
		const r = validateVariantRow(
			{ name: "X", option1_name: "Size", price: "10", stock: "1" },
			2,
		);
		expect("errors" in r && r.errors[0]).toMatch(/option1 needs both/);
	});

	test("rejects fractional sen (3+ decimals) and bad stock", () => {
		const r = validateVariantRow(
			{ name: "X", price: "9.999", stock: "1.5" },
			2,
		);
		expect("errors" in r).toBe(true);
	});
});

describe("groupVariantRows — auto-fill", () => {
	test("auto-fills missing cartesian combinations as inactive 0/0", () => {
		// Provide 2 of the 4 Weight×Cut combinations.
		const rows: VariantImportRow[] = [
			row({
				rowNumber: 2,
				name: "Salmon",
				groupingKey: "salmon",
				optionNames: ["Weight", "Cut"],
				optionValues: ["1kg", "Fillet"],
				price: 8500,
				onHand: 3,
				sku: "S-1KG-F",
			}),
			row({
				rowNumber: 3,
				name: "Salmon",
				groupingKey: "salmon",
				optionNames: ["Weight", "Cut"],
				optionValues: ["500g", "Whole"],
				price: 4000,
				onHand: 5,
				sku: "S-500-W",
			}),
		];
		const res = groupVariantRows(rows);
		expect(res.errorRows).toHaveLength(0);
		expect(res.products).toHaveLength(1);
		const p = res.products[0];
		// Inferred axes from provided values.
		expect(p.options).toEqual([
			{ name: "Weight", values: ["1kg", "500g"] },
			{ name: "Cut", values: ["Fillet", "Whole"] },
		]);
		// Full cartesian = 4 variants; 2 provided, 2 auto-filled.
		expect(p.variants).toHaveLength(4);
		expect(p.autoFilledCount).toBe(2);
		const provided = p.variants.filter((v) => v.active);
		const filled = p.variants.filter((v) => !v.active);
		expect(provided).toHaveLength(2);
		expect(filled).toHaveLength(2);
		for (const f of filled) {
			expect(f.price).toBe(0);
			expect(f.onHand).toBe(0);
			expect(f.sku).toBeUndefined();
		}
		expect(res.summary).toEqual({
			productCount: 1,
			variantCount: 4,
			autoFilledCount: 2,
		});
	});

	test("single-variant product → one implicit default variant", () => {
		const res = groupVariantRows([
			row({
				rowNumber: 2,
				name: "Tee",
				groupingKey: "tee",
				price: 5000,
				onHand: 9,
				sku: "TEE",
			}),
		]);
		expect(res.products[0].variants).toHaveLength(1);
		expect(res.products[0].variants[0].optionValues).toEqual([]);
		expect(res.products[0].variants[0].active).toBe(true);
		expect(res.products[0].autoFilledCount).toBe(0);
	});

	test("rejects mismatched axes within one product", () => {
		const res = groupVariantRows([
			row({
				rowNumber: 2,
				name: "X",
				groupingKey: "x",
				optionNames: ["Size", "Color"],
				optionValues: ["S", "Red"],
			}),
			row({
				rowNumber: 3,
				name: "X",
				groupingKey: "x",
				optionNames: ["Size"],
				optionValues: ["M"],
			}),
		]);
		expect(res.products).toHaveLength(0);
		expect(res.errorRows[0].errors[0]).toMatch(/don't match/);
	});

	test("rejects duplicate combination within one product", () => {
		const res = groupVariantRows([
			row({
				rowNumber: 2,
				name: "X",
				groupingKey: "x",
				optionNames: ["Size"],
				optionValues: ["S"],
			}),
			row({
				rowNumber: 3,
				name: "X",
				groupingKey: "x",
				optionNames: ["Size"],
				optionValues: ["S"],
			}),
		]);
		expect(res.errorRows[0].errors[0]).toMatch(/Duplicate variant/);
	});

	test("flags a no-option product that spans multiple rows", () => {
		const res = groupVariantRows([
			row({ rowNumber: 2, name: "X", groupingKey: "x" }),
			row({ rowNumber: 3, name: "X", groupingKey: "x" }),
		]);
		expect(res.errorRows[0].errors[0]).toMatch(/spans multiple rows/);
	});

	test("last-writer-wins on product name with a drift warning", () => {
		const res = groupVariantRows([
			row({
				rowNumber: 2,
				name: "Salmon",
				groupingKey: "h",
				optionNames: ["Size"],
				optionValues: ["S"],
			}),
			row({
				rowNumber: 3,
				name: "Salmon Deluxe",
				groupingKey: "h",
				optionNames: ["Size"],
				optionValues: ["M"],
			}),
		]);
		expect(res.products[0].name).toBe("Salmon Deluxe");
		expect(res.products[0].warnings[0]).toMatch(/Multiple names/);
	});
});

describe("parseVariantImport — end to end", () => {
	test("missing required column short-circuits", () => {
		const res = parseVariantImport([{ name: "X" }], ["name"]);
		expect(res.errorRows[0].errors[0]).toMatch(/Missing required column/);
	});

	test("legacy 4-column sheet imports as single-variant products", () => {
		const res = parseVariantImport(
			[
				{ name: "Tent", price: "120", stock: "5" },
				{ name: "Lamp", price: "30", stock: "9", sku: "LMP" },
			],
			["name", "price", "stock", "sku"],
		);
		expect(res.errorRows).toHaveLength(0);
		expect(res.summary).toEqual({
			productCount: 2,
			variantCount: 2,
			autoFilledCount: 0,
		});
		expect(res.products.every((p) => p.options.length === 0)).toBe(true);
	});

	test("flags intra-file duplicate SKUs", () => {
		const res = parseVariantImport(
			[
				{ name: "A", price: "1", stock: "1", sku: "DUP" },
				{ name: "B", price: "2", stock: "2", sku: "DUP" },
			],
			["name", "price", "stock", "sku"],
		);
		expect(
			res.errorRows.some((e) => /Duplicate sku "DUP"/.test(e.errors[0])),
		).toBe(true);
	});
});
