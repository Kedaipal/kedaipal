import ExcelJS from "exceljs";
import Papa from "papaparse";
import { VARIANT_IMPORT_COLUMNS } from "./product-import";

/**
 * Product bulk export — one row per (active) variant, in the exact column shape
 * the import parser expects (`VARIANT_IMPORT_COLUMNS`) so an export → edit →
 * re-import round-trip works without column mapping.
 *
 * - Prices are written as major-unit strings (e.g. "120.50").
 * - Only ACTIVE variants are exported. Combinations that were auto-filled
 *   inactive on import are omitted and re-auto-filled on the next import, so the
 *   common "edit my live prices/stock" round-trip is preserved. (Manually
 *   deactivated variants are not exported — a known v1 limitation.)
 * - `product_handle` is the product id, a stable grouping key that survives
 *   name edits.
 */

export const PRODUCT_EXPORT_COLUMNS = VARIANT_IMPORT_COLUMNS;

export interface ExportableVariant {
	optionValues: string[];
	sku?: string;
	price: number; // minor units
	onHand: number;
	parcelWeightG: number;
	active: boolean;
}

export interface ExportableProduct {
	handle: string; // stable grouping key (product id)
	name: string;
	description?: string;
	options: { name: string; values: string[] }[];
	variants: ExportableVariant[];
}

type ExportRow = Record<(typeof VARIANT_IMPORT_COLUMNS)[number], string>;

/** One export row per active variant of a product. */
function productToExportRows(p: ExportableProduct): ExportRow[] {
	return p.variants
		.filter((vr) => vr.active)
		.map((vr) => ({
			product_handle: p.handle,
			name: p.name,
			description: p.description ?? "",
			option1_name: p.options[0]?.name ?? "",
			option1_value: vr.optionValues[0] ?? "",
			option2_name: p.options[1]?.name ?? "",
			option2_value: vr.optionValues[1] ?? "",
			sku: vr.sku ?? "",
			price: (vr.price / 100).toFixed(2),
			stock: String(vr.onHand),
			weight_grams: String(vr.parcelWeightG),
		}));
}

export function productsToExportRows(
	products: ExportableProduct[],
): ExportRow[] {
	return products.flatMap(productToExportRows);
}

/** Render products as a CSV string (header always included). */
export function productsToCsvString(products: ExportableProduct[]): string {
	return Papa.unparse(
		{
			fields: Array.from(PRODUCT_EXPORT_COLUMNS),
			data: productsToExportRows(products),
		},
		{ newline: "\n" },
	);
}

/** Render products as an XLSX Blob (first sheet "Products"). */
export async function productsToXlsxBlob(
	products: ExportableProduct[],
): Promise<Blob> {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet("Products");
	ws.columns = PRODUCT_EXPORT_COLUMNS.map((col) => ({
		header: col,
		key: col,
		width: col === "description" ? 40 : col === "name" ? 28 : 14,
	}));
	ws.getRow(1).font = { bold: true };
	for (const row of productsToExportRows(products)) ws.addRow(row);
	const buffer = await wb.xlsx.writeBuffer();
	return new Blob([buffer], {
		type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	});
}

function triggerDownload(blob: Blob, filename: string): void {
	if (typeof window === "undefined") return;
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

function exportDateStamp(now = new Date()): string {
	return [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, "0"),
		String(now.getDate()).padStart(2, "0"),
	].join("-");
}

export function buildExportFilename(
	kind: "csv" | "xlsx",
	fileBase = "kedaipal-products",
	now = new Date(),
): string {
	return `${fileBase}-${exportDateStamp(now)}.${kind}`;
}

export function downloadProductsCsv(
	products: ExportableProduct[],
	fileBase?: string,
): void {
	const csv = productsToCsvString(products);
	triggerDownload(
		new Blob([csv], { type: "text/csv;charset=utf-8" }),
		buildExportFilename("csv", fileBase),
	);
}

export async function downloadProductsXlsx(
	products: ExportableProduct[],
	fileBase?: string,
): Promise<void> {
	const blob = await productsToXlsxBlob(products);
	triggerDownload(blob, buildExportFilename("xlsx", fileBase));
}
