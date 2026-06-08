import { describe, expect, test } from "vitest";
import { buildProductCsvTemplate, parseProductsCsv } from "./csv";

describe("parseProductsCsv", () => {
	test("groups legacy rows into single-variant products, price → sen", () => {
		const csv = [
			"name,description,price,stock",
			"Tent,4-season,499.00,12",
			"Headlamp,,89.5,30",
		].join("\n");

		const result = parseProductsCsv(csv);
		expect(result.errorRows).toEqual([]);
		expect(result.products).toHaveLength(2);
		const tent = result.products.find((p) => p.name === "Tent");
		expect(tent?.options).toEqual([]);
		expect(tent?.variants).toHaveLength(1);
		expect(tent?.variants[0].price).toBe(49900);
		expect(tent?.variants[0].onHand).toBe(12);
		const hl = result.products.find((p) => p.name === "Headlamp");
		expect(hl?.variants[0].price).toBe(8950);
	});

	test("groups one-row-per-variant into a product with inferred options", () => {
		const csv = [
			"name,option1_name,option1_value,option2_name,option2_value,sku,price,stock",
			"Salmon,Weight,500g,Cut,Fillet,S-5F,45,3",
			"Salmon,Weight,1kg,Cut,Fillet,S-1F,85,2",
		].join("\n");

		const result = parseProductsCsv(csv);
		expect(result.errorRows).toEqual([]);
		expect(result.products).toHaveLength(1);
		const salmon = result.products[0];
		expect(salmon.options).toEqual([
			{ name: "Weight", values: ["500g", "1kg"] },
			{ name: "Cut", values: ["Fillet"] },
		]);
		expect(salmon.variants).toHaveLength(2); // 2×1 cartesian, both provided
		expect(result.summary).toMatchObject({ productCount: 1, variantCount: 2 });
	});

	test("auto-fills missing cartesian combinations as inactive", () => {
		const csv = [
			"name,option1_name,option1_value,option2_name,option2_value,price,stock",
			"Salmon,Weight,500g,Cut,Fillet,45,3",
			"Salmon,Weight,1kg,Cut,Whole,78,1",
		].join("\n");

		const result = parseProductsCsv(csv);
		const salmon = result.products[0];
		expect(salmon.variants).toHaveLength(4); // 2×2 cartesian
		expect(salmon.autoFilledCount).toBe(2);
		expect(salmon.variants.filter((v) => !v.active)).toHaveLength(2);
	});

	test("rounds price beyond 2 decimal places", () => {
		const result = parseProductsCsv(
			["name,price,stock", "X,12.999,1"].join("\n"),
		);
		expect(result.products[0].variants[0].price).toBe(1300);
	});

	test("flags missing required columns at the file level", () => {
		const result = parseProductsCsv(["name,price", "Tent,499"].join("\n"));
		expect(result.products).toEqual([]);
		expect(result.errorRows[0].rowNumber).toBe(0);
		expect(result.errorRows[0].errors[0]).toMatch(/stock/);
	});

	test("collects per-row errors with spreadsheet row numbers", () => {
		const csv = [
			"name,description,price,stock",
			",,499,12",
			"Tent,,abc,12",
			"Tent2,,499,-1",
		].join("\n");

		const result = parseProductsCsv(csv);
		expect(result.products).toEqual([]);
		expect(result.errorRows).toHaveLength(3);
		expect(result.errorRows[0]).toMatchObject({ rowNumber: 2 });
		expect(result.errorRows[0].errors[0]).toMatch(/name/);
		expect(result.errorRows[1].errors[0]).toMatch(/price/);
		expect(result.errorRows[2].errors[0]).toMatch(/stock/);
	});

	test("ignores empty trailing lines", () => {
		const result = parseProductsCsv(
			"name,description,price,stock\nTent,,499,12\n\n\n",
		);
		expect(result.errorRows).toEqual([]);
		expect(result.products).toHaveLength(1);
	});

	test("template parses cleanly through the same pipeline", () => {
		const result = parseProductsCsv(buildProductCsvTemplate());
		expect(result.errorRows).toEqual([]);
		expect(result.products.length).toBeGreaterThan(0);
	});

	test("rejects an oversized sku", () => {
		const longSku = "X".repeat(61);
		const result = parseProductsCsv(
			["name,sku,price,stock", `Tent,${longSku},499,12`].join("\n"),
		);
		expect(result.products).toEqual([]);
		expect(result.errorRows[0].errors[0]).toMatch(/sku/);
	});
});
