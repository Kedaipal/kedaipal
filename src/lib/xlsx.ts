import ExcelJS from "exceljs";
import {
	type GroupedImportResult,
	parseVariantImport,
	type RawImportRow,
} from "./product-import";

/**
 * XLSX bulk-import parser. Reads the first worksheet, converts rows to the
 * same `RawImportRow` shape the CSV parser produces, then delegates to the
 * shared validator so CSV and XLSX enforce identical rules.
 *
 * Supported source: XLSX files written by Excel, Numbers, Google Sheets, or
 * by this app's own `product-export.ts`. Numeric cells (Excel's default for
 * prices) are coerced to strings before validation so the round-trip works
 * even if the user didn't export via our tooling.
 */

/**
 * Coerce any ExcelJS cell value into the plain string the shared validator
 * expects. Handles numbers (2 decimals for prices), rich text, formulas, and
 * dates defensively — none of which our schema actually uses, but retailers
 * paste from everywhere.
 */
function cellValueToString(
	value: ExcelJS.CellValue | undefined,
): string | undefined {
	if (value === null || value === undefined) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	if (value instanceof Date) return value.toISOString();
	// Rich text: { richText: [{ text: "..." }, ...] }
	if (typeof value === "object" && "richText" in value) {
		return value.richText.map((t) => t.text).join("");
	}
	// Formula cells: { formula: "...", result: ... }
	if (typeof value === "object" && "result" in value) {
		return cellValueToString(value.result as ExcelJS.CellValue);
	}
	// Hyperlink: { text, hyperlink }
	if (typeof value === "object" && "text" in value) {
		return String(value.text);
	}
	if (typeof value === "object" && "error" in value) return undefined;
	return String(value);
}

/**
 * Parse an XLSX `ArrayBuffer` into the shared `ParsedProductImport` shape.
 * Reads the first worksheet; the header row is the first non-empty row of
 * cells. Data rows are every subsequent row.
 */
export async function parseProductsXlsx(
	buffer: ArrayBuffer,
): Promise<GroupedImportResult> {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(buffer);
	const ws = wb.worksheets[0];
	if (!ws) {
		return {
			products: [],
			errorRows: [
				{ rowNumber: 0, raw: {}, errors: ["Workbook has no worksheets"] },
			],
			summary: { productCount: 0, variantCount: 0, autoFilledCount: 0 },
		};
	}

	// Header is row 1. Lowercase + trim so we match the CSV parser's header
	// handling.
	const headerRow = ws.getRow(1);
	const headers: string[] = [];
	headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
		const header = cellValueToString(cell.value)?.trim().toLowerCase() ?? "";
		headers[colNumber - 1] = header;
	});

	const rows: RawImportRow[] = [];
	// rowCount includes the header; iterate from row 2 onwards.
	for (let r = 2; r <= ws.rowCount; r++) {
		const row = ws.getRow(r);
		const raw: RawImportRow = {};
		let hasAny = false;
		row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
			const header = headers[colNumber - 1];
			if (!header) return;
			const value = cellValueToString(cell.value);
			if (value !== undefined && value.length > 0) hasAny = true;
			raw[header] = value;
		});
		if (hasAny) rows.push(raw);
	}

	// Same offset as CSV — header is row 1, data starts row 2 — so validation
	// row numbers match what the user sees in Excel.
	return parseVariantImport(
		rows,
		headers.filter((h) => h.length > 0),
		2,
	);
}
