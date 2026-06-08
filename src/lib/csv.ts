import Papa from "papaparse";
import {
	type GroupedImportResult,
	parseVariantImport,
	type RawImportRow,
	VARIANT_IMPORT_HEADER,
} from "./product-import";

/**
 * CSV bulk-import for products (variant-aware, one-row-per-variant). Pipeline:
 *   1. `parseProductsCsv` — text → raw rows → grouped products with auto-filled
 *      variants + grouping errors (shared logic in `src/lib/product-import.ts`)
 *   2. UI shows a per-product preview, blocks submit if any error
 *   3. Caller chunks `products` and calls `api.products.bulkUpsert` / preview
 */

export { VARIANT_IMPORT_HEADER as PRODUCT_CSV_HEADER } from "./product-import";

/**
 * Template: header + a single-variant example and a 2-axis multi-variant example
 * (Salmon · Weight × Cut) so sellers see both shapes.
 */
export function buildProductCsvTemplate(): string {
	return [
		VARIANT_IMPORT_HEADER,
		// product_handle,name,description,option1_name,option1_value,option2_name,option2_value,sku,price,stock,weight_grams
		"tent,Sample tent,A short description,,,,,TENT-1,299.00,10,1800",
		"salmon,Frozen salmon,Vacuum-packed,Weight,500g,Cut,Fillet,SAL-500-F,45.00,5,500",
		"salmon,Frozen salmon,Vacuum-packed,Weight,1kg,Cut,Fillet,SAL-1K-F,85.00,3,1000",
	].join("\n");
}

export function downloadProductCsvTemplate(): void {
	triggerCsvDownload(
		buildProductCsvTemplate(),
		"kedaipal-products-template.csv",
	);
}

/**
 * A fuller sample catalog so a retailer can download, tweak, and re-upload to
 * bootstrap their catalog. Mixes single-variant and multi-variant products.
 */
export function buildSampleProductsCsv(): string {
	return [
		VARIANT_IMPORT_HEADER,
		"tee,Cotton tee,Soft cotton,Size,S,,,TEE-S,39.00,20,200",
		"tee,Cotton tee,Soft cotton,Size,M,,,TEE-M,39.00,25,220",
		"tee,Cotton tee,Soft cotton,Size,L,,,TEE-L,39.00,15,240",
		"mug,Ceramic mug,350ml,,,,,MUG-1,19.90,40,400",
		"cake,Chocolate cake,Made to order,Size,0.5kg,,,CAKE-05,55.00,0,600",
		"cake,Chocolate cake,Made to order,Size,1kg,,,CAKE-1,95.00,0,1100",
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
 * Parse a CSV string into grouped products with their (auto-filled) variant
 * sets. Per-row validation + grouping errors are collected so the UI can render
 * them.
 */
export function parseProductsCsv(text: string): GroupedImportResult {
	const result = Papa.parse<RawImportRow>(text.trim(), {
		header: true,
		skipEmptyLines: "greedy",
		transformHeader: (h) => h.trim().toLowerCase(),
	});
	const headers = result.meta.fields ?? [];
	return parseVariantImport(result.data, Array.from(headers), 2);
}
