import { describe, expect, test } from "vitest";
import {
	buildVariantGrid,
	dedupeProvidedVariants,
	groupVariantRows,
	inferAxes,
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

	test("blank weight stays undefined (preserve-on-update), not 0", () => {
		const blank = validateVariantRow(
			{ name: "X", price: "10", stock: "1" },
			2,
		) as VariantImportRow;
		expect(blank.parcelWeightG).toBeUndefined();

		const explicit = validateVariantRow(
			{ name: "X", price: "10", stock: "1", weight_grams: "0" },
			2,
		) as VariantImportRow;
		// An explicit "0" is a real value (sets weight to 0), distinct from blank.
		expect(explicit.parcelWeightG).toBe(0);
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

	test("case-only value differences collide → reported, never silently dropped", () => {
		// row A "Fillet" + row B "fillet" used to collapse the axis to one value
		// while row B's data was discarded (its raw-case key missed the canonical
		// combo). Now they canonicalize to the same variant → duplicate error.
		const res = groupVariantRows([
			row({
				rowNumber: 2,
				name: "Salmon",
				groupingKey: "salmon",
				optionNames: ["Cut"],
				optionValues: ["Fillet"],
				price: 8500,
				sku: "S-F",
			}),
			row({
				rowNumber: 3,
				name: "Salmon",
				groupingKey: "salmon",
				optionNames: ["Cut"],
				optionValues: ["fillet"],
				price: 9900,
				sku: "S-f",
			}),
		]);
		expect(res.products).toHaveLength(0);
		expect(res.errorRows).toHaveLength(1);
		expect(res.errorRows[0].rowNumber).toBe(3); // the second (colliding) row
		expect(res.errorRows[0].errors[0]).toMatch(/Duplicate variant/);
	});

	test("a provided variant's blank weight propagates as undefined", () => {
		const res = groupVariantRows([
			row({
				rowNumber: 2,
				name: "Tee",
				groupingKey: "tee",
				optionNames: ["Size"],
				optionValues: ["S"],
				sku: "TEE-S",
				parcelWeightG: undefined,
			}),
		]);
		const active = res.products[0].variants.find((v) => v.active);
		expect(active?.parcelWeightG).toBeUndefined();
	});
});

describe("groupVariantRows helpers (independently testable)", () => {
	test("inferAxes collects distinct values, first casing wins", () => {
		const out = inferAxes([
			row({ optionNames: ["Cut"], optionValues: ["Fillet"] }),
			row({ optionNames: ["Cut"], optionValues: ["fillet"] }),
			row({ optionNames: ["Cut"], optionValues: ["Whole"] }),
		]);
		expect("options" in out && out.options).toEqual([
			{ name: "Cut", values: ["Fillet", "Whole"] },
		]);
	});

	test("inferAxes errors on a no-option product spanning >1 row", () => {
		const out = inferAxes([row({}), row({ rowNumber: 3 })]);
		expect("error" in out && out.error.errors[0]).toMatch(/spans multiple rows/);
	});

	test("dedupeProvidedVariants keys by canonical casing", () => {
		const options = [{ name: "Cut", values: ["Fillet"] }];
		const ok = dedupeProvidedVariants(
			[row({ optionNames: ["Cut"], optionValues: ["fillet"] })],
			options,
		);
		// "fillet" canonicalizes to the "Fillet" axis value.
		expect("provided" in ok && ok.provided.has("Fillet")).toBe(true);
	});

	test("buildVariantGrid auto-fills omitted combinations", () => {
		const options = [{ name: "Size", values: ["S", "M"] }];
		const provided = new Map([
			["S", row({ optionNames: ["Size"], optionValues: ["S"], price: 100 })],
		]);
		const out = buildVariantGrid(options, provided, row({}));
		expect("variants" in out && out.variants).toHaveLength(2);
		expect("autoFilled" in out && out.autoFilled).toBe(1);
	});

	test("buildVariantGrid errors past the per-product cap", () => {
		// 8 × 8 = 64 > MAX_VARIANTS_PER_PRODUCT (50).
		const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
		const options = [
			{ name: "A", values: eight },
			{ name: "B", values: eight },
		];
		const out = buildVariantGrid(options, new Map(), row({ name: "Big" }));
		expect("error" in out && out.error.errors[0]).toMatch(/expands to 64/);
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
