import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import { parseProductsCsv } from "./csv";
import {
	buildExportFilename,
	type ExportableProduct,
	productsToCsvString,
	productsToXlsxBlob,
} from "./product-export";

const sampleProducts: ExportableProduct[] = [
	{
		handle: "prod_tent",
		name: "Tent — 4 person",
		description: "Lightweight 4-season tent, sleeps four",
		options: [],
		variants: [
			{
				optionValues: [],
				sku: "TENT-4P",
				price: 49900,
				onHand: 12,
				parcelWeightG: 1800,
				active: true,
			},
		],
	},
	{
		handle: "prod_tee",
		name: "Cotton Tee",
		description: undefined,
		options: [{ name: "Size", values: ["S", "M"] }],
		variants: [
			{
				optionValues: ["S"],
				sku: "TEE-S",
				price: 3900,
				onHand: 20,
				parcelWeightG: 200,
				active: true,
			},
			{
				optionValues: ["M"],
				sku: "TEE-M",
				price: 3900,
				onHand: 0,
				parcelWeightG: 200,
				active: true,
			},
			// Inactive (auto-filled) variant — should NOT be exported.
			{
				optionValues: ["L"],
				sku: undefined,
				price: 0,
				onHand: 0,
				parcelWeightG: 0,
				active: false,
			},
		],
	},
	{
		handle: "prod_stove",
		name: 'Stove "Pro" / 3000W',
		description: "Multi-fuel, with carry case,\nweatherproof",
		options: [],
		variants: [
			{
				optionValues: [],
				sku: "STOVE-1",
				price: 12000,
				onHand: 0,
				parcelWeightG: 500,
				active: true,
			},
		],
	},
];

describe("productsToCsvString", () => {
	test("round-trips through parseProductsCsv (one row per active variant)", () => {
		const csv = productsToCsvString(sampleProducts);
		const parsed = parseProductsCsv(csv);
		expect(parsed.errorRows).toEqual([]);
		// 1 (tent) + 2 (tee active) + 1 (stove) = 4 active variant rows.
		expect(parsed.summary.variantCount).toBe(4);
		expect(parsed.products).toHaveLength(3);
	});

	test("exports only active variants", () => {
		const csv = productsToCsvString(sampleProducts);
		expect(csv).toContain("TEE-S");
		expect(csv).toContain("TEE-M");
		// The inactive "L" variant has no SKU; only its absence matters — the Tee
		// should round-trip to exactly its 2 active variants.
		const tee = parseProductsCsv(csv).products.find(
			(p) => p.name === "Cotton Tee",
		);
		expect(tee?.variants).toHaveLength(2);
	});

	test("preserves SKU + price precision through the round-trip", () => {
		const parsed = parseProductsCsv(productsToCsvString(sampleProducts));
		const tent = parsed.products.find((p) => p.name === "Tent — 4 person");
		expect(tent?.variants[0].sku).toBe("TENT-4P");
		expect(tent?.variants[0].price).toBe(49900);
	});

	test("quotes descriptions with commas, quotes, and newlines", () => {
		const parsed = parseProductsCsv(productsToCsvString(sampleProducts));
		const stove = parsed.products.find((p) => p.name === 'Stove "Pro" / 3000W');
		expect(stove?.description).toContain("weatherproof");
	});

	test("zero stock round-trips as 0", () => {
		const parsed = parseProductsCsv(productsToCsvString(sampleProducts));
		const tee = parsed.products.find((p) => p.name === "Cotton Tee");
		expect(tee?.variants.find((v) => v.optionValues[0] === "M")?.onHand).toBe(
			0,
		);
	});
});

describe("productsToXlsxBlob", () => {
	test("round-trips through ExcelJS read", async () => {
		const blob = await productsToXlsxBlob(sampleProducts);
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(await blob.arrayBuffer());
		const ws = wb.getWorksheet("Products");
		expect(ws).toBeDefined();
		// Header + 4 active variant rows.
		expect(ws?.rowCount).toBe(5);
		// Columns: product_handle, name, ... (name is column 2).
		expect(ws?.getRow(2).getCell(2).value).toBe("Tent — 4 person");
	});
});

describe("buildExportFilename", () => {
	test("stamps with YYYY-MM-DD and extension", () => {
		const frozen = new Date("2026-04-20T10:30:00Z");
		expect(buildExportFilename("csv", "kedaipal-products", frozen)).toMatch(
			/kedaipal-products-2026-04-\d{2}\.csv/,
		);
		expect(buildExportFilename("xlsx", "kedaipal-products", frozen)).toMatch(
			/kedaipal-products-2026-04-\d{2}\.xlsx/,
		);
	});
});
