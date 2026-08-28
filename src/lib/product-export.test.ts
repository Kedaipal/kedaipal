import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import { parseProductsCsv } from "./csv";
import {
	buildExportFilename,
	EXPORT_ONLY_COLUMNS,
	type ExportableProduct,
	type ExportableVariant,
	isExportableVariant,
	PRODUCT_IMPORT_ROUNDTRIP_COLUMNS,
	productsToCsvString,
	productsToXlsxBlob,
	REPORT_COLUMNS,
} from "./product-export";
import { exportOnlyColumnsPresent } from "./product-import";

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

// ---------------------------------------------------------------------------
// 86eyrtz74 — the catalogue report columns. The first eleven columns stay the
// import template; everything after answers "what is actually in my store".
// ---------------------------------------------------------------------------

const reportProduct: ExportableProduct = {
	handle: "prod_kek",
	name: "Kek Lapis",
	description: "Sarawak layer cake",
	options: [{ name: "Size", values: ["1kg", "2kg"] }],
	currency: "MYR",
	categories: ["Kuih", "Bestseller"],
	active: true,
	hidden: false,
	url: "https://kedaipal.com/hermoolah/p/kek-lapis",
	minQuantity: 3,
	minNoticeDays: 2,
	imageCount: 4,
	variants: [
		{
			optionValues: ["1kg"],
			sku: "KEK-1",
			price: 8600,
			onHand: 10,
			parcelWeightG: 1200,
			active: true,
			reserved: 2,
			blockWhenOutOfStock: true,
			imageCount: 2,
		},
	],
};

/** Read one data row of an export as a {column: value} map (RFC-4180 aware —
 * the categories cell contains a comma). `i` is 1-based. */
function rowOf(csv: string, i = 1): Record<string, string> {
	const [header, ...rows] = csv.trim().split("\n");
	const cells = (line: string) => {
		const out: string[] = [];
		let cur = "";
		let quoted = false;
		for (let k = 0; k < line.length; k++) {
			const ch = line[k];
			if (quoted) {
				if (ch === '"') {
					if (line[k + 1] === '"') {
						cur += '"';
						k++;
					} else quoted = false;
				} else cur += ch;
			} else if (ch === '"') quoted = true;
			else if (ch === ",") {
				out.push(cur);
				cur = "";
			} else cur += ch;
		}
		out.push(cur);
		return out;
	};
	const keys = cells(header);
	const vals = cells(rows[i - 1] ?? "");
	return Object.fromEntries(keys.map((k, idx) => [k, vals[idx] ?? ""]));
}

describe("product export — round-trip contract", () => {
	test("the import columns still lead, in their original order", () => {
		const header = productsToCsvString([reportProduct]).split("\n")[0];
		expect(header.split(",").slice(0, 11)).toEqual([
			...PRODUCT_IMPORT_ROUNDTRIP_COLUMNS,
		]);
	});

	test("the report columns follow, in registry order", () => {
		const header = productsToCsvString([reportProduct]).split("\n")[0];
		expect(header.split(",").slice(11)).toEqual([...REPORT_COLUMNS]);
	});

	test("an exported sheet re-parses through the import parser", () => {
		// The extra columns must not break the round-trip the export exists for.
		const parsed = parseProductsCsv(productsToCsvString([reportProduct]));
		expect(parsed.errorRows).toEqual([]);
		expect(parsed.products.length).toBe(1);
	});

	test("the import names every report column as one it will ignore", () => {
		// Keeps the two lists honest without the import importing the export.
		const header = productsToCsvString([reportProduct]).split("\n")[0];
		expect(exportOnlyColumnsPresent(header.split(","))).toEqual([
			...EXPORT_ONLY_COLUMNS,
		]);
	});

	test("an older sheet without the report columns reports nothing ignored", () => {
		expect(
			exportOnlyColumnsPresent([...PRODUCT_IMPORT_ROUNDTRIP_COLUMNS]),
		).toEqual([]);
	});
});

describe("product export — the report columns", () => {
	test("categories export comma-separated", () => {
		expect(rowOf(productsToCsvString([reportProduct])).categories).toBe(
			"Kuih, Bestseller",
		);
	});

	test("order rules, stock policy and photos export", () => {
		const r = rowOf(productsToCsvString([reportProduct]));
		expect(r.currency).toBe("MYR");
		expect(r.min_order_qty).toBe("3");
		expect(r.min_notice_days).toBe("2");
		expect(r.stock_policy).toBe("tracked");
		expect(r.reserved).toBe("2");
		expect(r.photos).toBe("2"); // the variant's own photos win over the product's
		expect(r.product_url).toBe("https://kedaipal.com/hermoolah/p/kek-lapis");
	});

	test("a made-to-order variant says so — it explains why stock never moves", () => {
		const r = rowOf(
			productsToCsvString([
				{
					...reportProduct,
					variants: [
						{ ...reportProduct.variants[0], blockWhenOutOfStock: false },
					],
				},
			]),
		);
		expect(r.stock_policy).toBe("made-to-order");
	});

	test("storefront state distinguishes hidden, category-hidden and archived", () => {
		const state = (p: Partial<ExportableProduct>) =>
			rowOf(productsToCsvString([{ ...reportProduct, ...p }])).storefront;
		expect(state({})).toBe("visible");
		expect(state({ hidden: true })).toBe("hidden");
		expect(state({ hiddenByCategory: true })).toBe("hidden (category)");
		expect(state({ active: false })).toBe("archived");
		expect(
			rowOf(productsToCsvString([{ ...reportProduct, active: false }]))
				.product_status,
		).toBe("archived");
	});

	test("a custom line exports the seller's own label", () => {
		const r = rowOf(
			productsToCsvString([
				{
					...reportProduct,
					variants: [
						{
							...reportProduct.variants[0],
							isCustom: true,
							customLabel: "Bespoke design",
							requiresProof: true,
						},
					],
				},
			]),
		);
		expect(r.custom_line).toBe("Bespoke design");
		expect(r.needs_mockup).toBe("Yes");
	});

	test("flags read blank, never 'false'", () => {
		const r = rowOf(productsToCsvString([reportProduct]));
		expect(r.needs_mockup).toBe("");
		expect(r.custom_line).toBe("");
	});
});

describe("product export — which variants are included", () => {
	const variant = (over: Partial<ExportableVariant>): ExportableVariant => ({
		optionValues: ["1kg"],
		price: 0,
		onHand: 0,
		parcelWeightG: 0,
		active: false,
		...over,
	});

	test("auto-filled empty combinations stay out — they are noise, not catalogue", () => {
		// buildVariantGrid fills gaps as {no sku, price 0, stock 0, inactive}; a
		// 5x4 product would otherwise drag 14 blank rows into every export.
		expect(isExportableVariant(variant({}))).toBe(false);
	});

	test("a variant the seller named, priced or stocked IS exported when off", () => {
		// This is the gap: manually deactivated variants used to vanish entirely.
		expect(isExportableVariant(variant({ sku: "KEK-2" }))).toBe(true);
		expect(isExportableVariant(variant({ price: 100 }))).toBe(true);
		expect(isExportableVariant(variant({ onHand: 5 }))).toBe(true);
	});

	test("active variants are always exported", () => {
		expect(isExportableVariant(variant({ active: true }))).toBe(true);
	});

	test("an exported inactive variant is labelled inactive", () => {
		const csv = productsToCsvString([
			{
				...reportProduct,
				variants: [
					reportProduct.variants[0],
					variant({ sku: "KEK-2", price: 9900 }),
				],
			},
		]);
		expect(rowOf(csv, 1).variant_status).toBe("active");
		expect(rowOf(csv, 2).variant_status).toBe("inactive");
		expect(rowOf(csv, 2).sku).toBe("KEK-2");
	});
});

describe("round-trip preserves sellability (PR #230 review, MEDIUM)", () => {
	// The export started including variants the seller built and switched off.
	// The import's CREATE path defaults a provided row to active
	// (`insertVariants`: `active ?? true`), so without reading `variant_status`
	// back, exporting a catalogue and importing it into a second store — or
	// re-importing after deleting the product — resurrected those variants live
	// and purchasable at their old price.
	const withDeactivated: ExportableProduct = {
		...reportProduct,
		variants: [
			reportProduct.variants[0],
			{
				optionValues: ["2kg"],
				sku: "KEK-2",
				price: 16000,
				onHand: 4,
				parcelWeightG: 2200,
				active: false,
			},
		],
	};

	test("an exported inactive variant re-imports as INACTIVE", () => {
		const parsed = parseProductsCsv(
			productsToCsvString(withDeactivated ? [withDeactivated] : []),
		);
		expect(parsed.errorRows).toEqual([]);
		const variants = parsed.products[0].variants;
		const one = variants.find((v) => v.sku === "KEK-1");
		const two = variants.find((v) => v.sku === "KEK-2");
		expect(one?.active).toBe(true);
		expect(two?.active).toBe(false);
	});

	test("a sheet with no variant_status column still imports everything active", () => {
		// Every hand-made sheet and every pre-86eyrtz74 export must behave
		// exactly as before — absence of the column is not "inactive".
		const legacy = "name,price,stock\nKek Lapis,86.00,10\n";
		const parsed = parseProductsCsv(legacy);
		expect(parsed.errorRows).toEqual([]);
		expect(parsed.products[0].variants.every((v) => v.active)).toBe(true);
	});

	test("only the exact word 'inactive' switches a row off", () => {
		// A malformed cell must never silently hide a variant the seller sells.
		for (const cell of ["", "active", "ACTIVE", "disabled", "0", "nonsense"]) {
			const csv = `name,price,stock,variant_status\nKek,86.00,10,${cell}\n`;
			expect(parseProductsCsv(csv).products[0].variants[0].active).toBe(true);
		}
		const off = "name,price,stock,variant_status\nKek,86.00,10,  Inactive \n";
		expect(parseProductsCsv(off).products[0].variants[0].active).toBe(false);
	});

	test("variant_status is NOT advertised as an ignored column", () => {
		// It is the one report column the import reads, so the import screen must
		// not tell the seller it will be discarded.
		const header = productsToCsvString([reportProduct]).split("\n")[0];
		expect(header).toContain("variant_status");
		expect(exportOnlyColumnsPresent(header.split(","))).not.toContain(
			"variant_status",
		);
	});

	test("every other report column is still ignored, and still announced", () => {
		const header = productsToCsvString([reportProduct]).split("\n")[0];
		expect(exportOnlyColumnsPresent(header.split(","))).toEqual([
			...EXPORT_ONLY_COLUMNS,
		]);
		expect(EXPORT_ONLY_COLUMNS).not.toContain("variant_status");
		expect(REPORT_COLUMNS).toContain("variant_status");
	});
});
