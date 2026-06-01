import Papa from "papaparse";
import {
	type ParsedProductImport,
	PRODUCT_IMPORT_HEADER,
	type RawImportRow,
	validateProductRows,
} from "./product-import";

/**
 * CSV bulk-import for products. The pipeline is:
 *   1. `parseProductsCsv` — parse text → typed rows + per-row validation errors
 *      (shared row validator lives in `src/lib/product-import.ts`)
 *   2. UI shows preview, blocks submit if any row is invalid
 *   3. Caller chunks `validRows` and calls `api.products.bulkUpsert` /
 *      `bulkCreate`
 */

export type {
	ParsedProductImport as ParsedProductsCsv,
	ProductImportRow as ProductCsvRow,
	ProductImportRowError as ProductCsvRowError,
} from "./product-import";
// Re-exports so existing imports keep working.
export {
	PRODUCT_IMPORT_COLUMNS as PRODUCT_CSV_COLUMNS,
	PRODUCT_IMPORT_HEADER as PRODUCT_CSV_HEADER,
} from "./product-import";

/**
 * Build a downloadable template with the header row + two example rows so
 * users can see exactly how to fill it in.
 */
export function buildProductCsvTemplate(): string {
	return [
		PRODUCT_IMPORT_HEADER,
		"ITEM-001,Sample product one,A short description of this product,29.90,20",
		"ITEM-002,Sample product two,Another short product description,49.00,15",
	].join("\n");
}

/**
 * Trigger a browser download of the template CSV. No-op on the server.
 */
export function downloadProductCsvTemplate(): void {
	triggerCsvDownload(
		buildProductCsvTemplate(),
		"kedaipal-products-template.csv",
	);
}

/**
 * A fuller sample catalog (header + several example rows) so a retailer can
 * download it, tweak the names, descriptions and prices in their spreadsheet,
 * and re-upload to bootstrap their catalog. Intentionally vertical-agnostic —
 * generic placeholder products that fit any store.
 */
export function buildSampleProductsCsv(): string {
	return [
		PRODUCT_IMPORT_HEADER,
		'ITEM-001,Sample product one,"A short description of this product",29.90,20',
		'ITEM-002,Sample product two,"Another short product description",49.00,15',
		'ITEM-003,Sample product three,"Describe what makes this item special",99.00,10',
		'ITEM-004,Sample product four,"Key details shoppers want to know",15.50,40',
		'ITEM-005,Sample product five,"Optional notes about the product",250.00,8',
	].join("\n");
}

export function downloadSampleProductsCsv(): void {
	triggerCsvDownload(buildSampleProductsCsv(), "kedaipal-products-sample.csv");
}

function triggerCsvDownload(content: string, filename: string): void {
	if (typeof window === "undefined") return;
	const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * Parse a CSV string into typed rows. Validates each row independently and
 * collects errors so the UI can render a row-by-row status table.
 */
export function parseProductsCsv(text: string): ParsedProductImport {
	const result = Papa.parse<RawImportRow>(text.trim(), {
		header: true,
		skipEmptyLines: "greedy",
		transformHeader: (h) => h.trim().toLowerCase(),
	});
	const headers = result.meta.fields ?? [];
	return validateProductRows(result.data, Array.from(headers), 2);
}
