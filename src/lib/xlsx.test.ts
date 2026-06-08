import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import { parseProductsXlsx } from "./xlsx";

async function buildWorkbook(
	headers: string[],
	rows: (string | number | boolean | undefined)[][],
): Promise<ArrayBuffer> {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet("Products");
	ws.addRow(headers);
	for (const row of rows) ws.addRow(row);
	// ExcelJS typing: Promise<ArrayBuffer> at runtime (browser and jsdom).
	return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("parseProductsXlsx", () => {
	test("parses rows into single-variant products with sku", async () => {
		const buf = await buildWorkbook(
			["sku", "name", "description", "price", "stock"],
			[
				["TENT-4P", "Tent", "4-season", "499.00", "12"],
				["", "Headlamp", "", "89.5", "30"],
			],
		);
		const result = await parseProductsXlsx(buf);
		expect(result.errorRows).toEqual([]);
		expect(result.products).toHaveLength(2);
		const tent = result.products.find((p) => p.name === "Tent");
		expect(tent?.variants[0].sku).toBe("TENT-4P");
		expect(tent?.variants[0].price).toBe(49900);
		expect(
			result.products.find((p) => p.name === "Headlamp")?.variants[0].sku,
		).toBeUndefined();
	});

	test("coerces numeric price cells to sen", async () => {
		const buf = await buildWorkbook(
			["name", "price", "stock"],
			[["Tent", 499.5, 12]],
		);
		const result = await parseProductsXlsx(buf);
		expect(result.errorRows).toEqual([]);
		expect(result.products[0].variants[0].price).toBe(49950);
	});

	test("flags missing required columns", async () => {
		const buf = await buildWorkbook(["name", "price"], [["Tent", "499"]]);
		const result = await parseProductsXlsx(buf);
		expect(result.products).toEqual([]);
		expect(result.errorRows[0].errors[0]).toMatch(/stock/);
	});

	test("normalizes mixed-case headers", async () => {
		const buf = await buildWorkbook(
			["SKU", "Name", "Description", "Price", "Stock"],
			[["TENT-4P", "Tent", "4-season", "499", "12"]],
		);
		const result = await parseProductsXlsx(buf);
		expect(result.errorRows).toEqual([]);
		expect(result.products[0].variants[0].sku).toBe("TENT-4P");
	});

	test("parses a multi-variant sheet into one grouped product", async () => {
		const buf = await buildWorkbook(
			["name", "option1_name", "option1_value", "sku", "price", "stock"],
			[
				["Tee", "Size", "S", "TEE-S", "39", "10"],
				["Tee", "Size", "M", "TEE-M", "39", "12"],
			],
		);
		const result = await parseProductsXlsx(buf);
		expect(result.errorRows).toEqual([]);
		expect(result.products).toHaveLength(1);
		expect(result.products[0].variants).toHaveLength(2);
	});

	test("skips blank rows between data", async () => {
		const buf = await buildWorkbook(
			["name", "price", "stock"],
			[
				["Tent", "499", "12"],
				[undefined, undefined, undefined],
				["Headlamp", "89", "30"],
			],
		);
		const result = await parseProductsXlsx(buf);
		expect(result.errorRows).toEqual([]);
		expect(result.products).toHaveLength(2);
	});
});
