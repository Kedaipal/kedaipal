/**
 * Shared row validation for product bulk-import flows (CSV, XLSX,
 * paste-from-spreadsheet). The parsers normalize their input into
 * `RawImportRow` (string-keyed, string-valued) and hand it to
 * `validateProductRows` so every entry-point enforces the same rules.
 *
 * Prices are entered in MAJOR units (e.g. "120.50") and converted to integer
 * MINOR units (sen) before being sent to Convex — same convention as the
 * single-product form. See `src/lib/format.ts` for the inverse.
 */

import { cartesian, variantLabel } from "./variant";

export const PRODUCT_IMPORT_REQUIRED_COLUMNS = [
	"name",
	"price",
	"stock",
] as const;

export const PRODUCT_IMPORT_OPTIONAL_COLUMNS = ["sku", "description"] as const;

export const PRODUCT_IMPORT_COLUMNS = [
	"sku",
	"name",
	"description",
	"price",
	"stock",
] as const;

export type ProductImportColumn = (typeof PRODUCT_IMPORT_COLUMNS)[number];

export const PRODUCT_IMPORT_HEADER = PRODUCT_IMPORT_COLUMNS.join(",");

export const PRODUCT_SKU_MAX_LENGTH = 60;
export const PRODUCT_NAME_MAX_LENGTH = 120;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 1000;

export interface RawImportRow {
	[header: string]: string | undefined;
}

export interface ProductImportRow {
	rowNumber: number; // 1-indexed, matches what the user sees in Excel
	sku: string | undefined;
	name: string;
	description: string | undefined;
	price: number; // minor units
	stock: number;
}

export interface ProductImportRowError {
	rowNumber: number;
	raw: RawImportRow;
	errors: string[];
}

export interface ParsedProductImport {
	validRows: ProductImportRow[];
	errorRows: ProductImportRowError[];
	totalRows: number;
}

// Back-compat re-exports for consumers still using the CSV-flavored names.
export type { ProductImportRow as ProductCsvRow };
export type { ProductImportRowError as ProductCsvRowError };
export type { ParsedProductImport as ParsedProductsCsv };

/**
 * Validate a single row of already-normalized key/value data. Returns either a
 * typed row or an error description with the issues found. Row numbering is
 * caller-provided so CSV can use "header is row 1" and XLSX can reuse its own
 * sheet-relative numbers.
 */
export function validateProductRow(
	raw: RawImportRow,
	rowNumber: number,
): ProductImportRow | ProductImportRowError {
	const errors: string[] = [];

	const skuRaw = (raw.sku ?? "").trim();
	const sku = skuRaw.length > 0 ? skuRaw : undefined;
	if (sku !== undefined && sku.length > PRODUCT_SKU_MAX_LENGTH) {
		errors.push(`sku must be at most ${PRODUCT_SKU_MAX_LENGTH} characters`);
	}

	const name = (raw.name ?? "").trim();
	if (name.length === 0) errors.push("name is required");
	if (name.length > PRODUCT_NAME_MAX_LENGTH)
		errors.push(`name must be at most ${PRODUCT_NAME_MAX_LENGTH} characters`);

	const descriptionRaw = (raw.description ?? "").trim();
	const description = descriptionRaw.length > 0 ? descriptionRaw : undefined;
	if (description && description.length > PRODUCT_DESCRIPTION_MAX_LENGTH) {
		errors.push(
			`description must be at most ${PRODUCT_DESCRIPTION_MAX_LENGTH} characters`,
		);
	}

	const priceStr = (raw.price ?? "").trim();
	let priceMinor = 0;
	if (priceStr.length === 0) {
		errors.push("price is required");
	} else if (!/^\d+(\.\d{1,2})?$/.test(priceStr)) {
		errors.push("price must be a number, e.g. 120 or 120.50");
	} else {
		priceMinor = Math.round(Number.parseFloat(priceStr) * 100);
	}

	const stockStr = (raw.stock ?? "").trim();
	let stock = 0;
	if (stockStr.length === 0) {
		errors.push("stock is required");
	} else if (!/^\d+$/.test(stockStr)) {
		errors.push("stock must be a whole number");
	} else {
		stock = Number.parseInt(stockStr, 10);
	}

	if (errors.length > 0) return { rowNumber, raw, errors };

	return { rowNumber, sku, name, description, price: priceMinor, stock };
}

/**
 * Validate an array of raw rows and return the full parsed result. `headers`
 * lets the parser hand over the detected column list so we can emit a single
 * "missing required column" error instead of N per-row errors.
 *
 * `rowNumberOffset` is the file-row of the first data row. CSV uses 2 (header
 * is row 1). XLSX / paste-from-sheet can pick their own.
 */
export function validateProductRows(
	rows: RawImportRow[],
	headers: string[],
	rowNumberOffset = 2,
): ParsedProductImport {
	const missing = PRODUCT_IMPORT_REQUIRED_COLUMNS.filter(
		(c) => !headers.includes(c),
	);
	if (missing.length > 0) {
		return {
			validRows: [],
			errorRows: [
				{
					rowNumber: 0,
					raw: {},
					errors: [
						`Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
					],
				},
			],
			totalRows: 0,
		};
	}

	const validRows: ProductImportRow[] = [];
	const errorRows: ProductImportRowError[] = [];

	rows.forEach((raw, i) => {
		const rowNumber = rowNumberOffset + i;
		const result = validateProductRow(raw, rowNumber);
		if ("errors" in result) errorRows.push(result);
		else validRows.push(result);
	});

	return {
		validRows,
		errorRows,
		totalRows: validRows.length + errorRows.length,
	};
}

/**
 * Detect intra-batch duplicate SKUs. Blank SKUs are ignored (they always
 * insert). Returns a list of error messages — empty when no collisions.
 */
export function findDuplicateSkus(
	rows: { rowNumber: number; sku: string | undefined }[],
): { sku: string; rowNumbers: number[] }[] {
	const byKey = new Map<string, number[]>();
	for (const row of rows) {
		if (!row.sku) continue;
		const existing = byKey.get(row.sku);
		if (existing) existing.push(row.rowNumber);
		else byKey.set(row.sku, [row.rowNumber]);
	}
	return Array.from(byKey.entries())
		.filter(([, nums]) => nums.length > 1)
		.map(([sku, rowNumbers]) => ({ sku, rowNumbers }));
}

// ---------------------------------------------------------------------------
// Variant-aware import (one-row-per-variant)
//
// A product spans N rows (one per variant). Rows are grouped by
// `product_handle` (falling back to `name`), option axes are inferred from the
// option columns, and any cartesian combination the sheet omits is AUTO-FILLED
// as an inactive 0-price/0-stock variant so the data always forms the full grid
// the variant model requires (validateVariantSet on the server). The seller
// re-activates auto-filled variants later when stock exists.
// See docs/product-variants.md §9 + the import/export rework ticket.
// ---------------------------------------------------------------------------

// Mirror of the caps in convex/lib/variant.ts — kept in sync manually.
export const MAX_OPTION_AXES = 2;
export const MAX_VARIANTS_PER_PRODUCT = 50;
export const PRODUCT_HANDLE_MAX_LENGTH = 80;
export const PRODUCT_WEIGHT_MAX = 1_000_000; // 1000kg, sanity bound

export const VARIANT_IMPORT_COLUMNS = [
	"product_handle",
	"name",
	"description",
	"option1_name",
	"option1_value",
	"option2_name",
	"option2_value",
	"sku",
	"price",
	"stock",
	"weight_grams",
] as const;

export const VARIANT_IMPORT_HEADER = VARIANT_IMPORT_COLUMNS.join(",");

/** A single parsed variant row before grouping. */
export interface VariantImportRow {
	rowNumber: number;
	/** Lowercased grouping key (product_handle ?? name). */
	groupingKey: string;
	name: string;
	description: string | undefined;
	optionNames: string[]; // [] for single-variant rows
	optionValues: string[]; // aligned to optionNames
	sku: string | undefined;
	price: number; // minor units
	onHand: number;
	// undefined = the weight cell was blank → preserve the existing variant's
	// weight on update (server falls back to 0 on insert). See validateVariantRow.
	parcelWeightG: number | undefined;
}

export interface GroupedVariant {
	optionValues: string[];
	sku: string | undefined;
	price: number; // minor units
	onHand: number;
	parcelWeightG: number | undefined; // undefined = preserve-on-update (see above)
	active: boolean; // false for auto-filled combinations
}

export interface GroupedProductImport {
	name: string;
	description: string | undefined;
	options: { name: string; values: string[] }[];
	variants: GroupedVariant[];
	autoFilledCount: number;
	warnings: string[];
}

export interface GroupedImportResult {
	products: GroupedProductImport[];
	errorRows: ProductImportRowError[];
	summary: {
		productCount: number;
		variantCount: number;
		autoFilledCount: number;
	};
}

/** Parse the two option columns for one row into aligned name/value arrays. */
function parseRowOptions(
	raw: RawImportRow,
	errors: string[],
): { names: string[]; values: string[] } {
	const names: string[] = [];
	const values: string[] = [];
	for (const [nameKey, valueKey, label] of [
		["option1_name", "option1_value", "option1"],
		["option2_name", "option2_value", "option2"],
	] as const) {
		const n = (raw[nameKey] ?? "").trim();
		const v = (raw[valueKey] ?? "").trim();
		if (n.length === 0 && v.length === 0) continue;
		if (n.length === 0 || v.length === 0) {
			errors.push(`${label} needs both a name and a value`);
			continue;
		}
		if (label === "option2" && names.length === 0)
			errors.push("option2 set without option1");
		names.push(n);
		values.push(v);
	}
	return { names, values };
}

/** Validate one variant row of normalized key/value data. */
export function validateVariantRow(
	raw: RawImportRow,
	rowNumber: number,
): VariantImportRow | ProductImportRowError {
	const errors: string[] = [];

	const name = (raw.name ?? "").trim();
	if (name.length === 0) errors.push("name is required");
	if (name.length > PRODUCT_NAME_MAX_LENGTH)
		errors.push(`name must be at most ${PRODUCT_NAME_MAX_LENGTH} characters`);

	const handle = (raw.product_handle ?? "").trim();
	if (handle.length > PRODUCT_HANDLE_MAX_LENGTH)
		errors.push(
			`product_handle must be at most ${PRODUCT_HANDLE_MAX_LENGTH} characters`,
		);

	const descriptionRaw = (raw.description ?? "").trim();
	const description = descriptionRaw.length > 0 ? descriptionRaw : undefined;
	if (description && description.length > PRODUCT_DESCRIPTION_MAX_LENGTH)
		errors.push(
			`description must be at most ${PRODUCT_DESCRIPTION_MAX_LENGTH} characters`,
		);

	const skuRaw = (raw.sku ?? "").trim();
	const sku = skuRaw.length > 0 ? skuRaw : undefined;
	if (sku !== undefined && sku.length > PRODUCT_SKU_MAX_LENGTH)
		errors.push(`sku must be at most ${PRODUCT_SKU_MAX_LENGTH} characters`);

	const { names: optionNames, values: optionValues } = parseRowOptions(
		raw,
		errors,
	);

	const priceStr = (raw.price ?? "").trim();
	let price = 0;
	if (priceStr.length === 0) errors.push("price is required");
	else {
		const n = Number.parseFloat(priceStr);
		if (!Number.isFinite(n) || n < 0)
			errors.push("price must be a non-negative number, e.g. 120 or 120.50");
		// Rounded to integer sen (2 dp) — matches the dashboard editor rule.
		else price = Math.round(n * 100);
	}

	const stockStr = (raw.stock ?? "").trim();
	let onHand = 0;
	if (stockStr.length === 0) errors.push("stock is required");
	else if (!/^\d+$/.test(stockStr)) errors.push("stock must be a whole number");
	else onHand = Number.parseInt(stockStr, 10);

	// Blank weight stays UNDEFINED (not 0) so importing an edit sheet that leaves
	// the column blank preserves the existing variant's weight on update (server:
	// `parcelWeightG ?? existing`); on insert it defaults to 0. Exports always
	// populate this column, so only hand-blanked cells hit the preserve path.
	const weightStr = (raw.weight_grams ?? "").trim();
	let parcelWeightG: number | undefined;
	if (weightStr.length > 0) {
		if (!/^\d+$/.test(weightStr))
			errors.push("weight_grams must be a whole number");
		else {
			const w = Number.parseInt(weightStr, 10);
			if (w > PRODUCT_WEIGHT_MAX)
				errors.push("weight_grams is unreasonably large");
			else parcelWeightG = w;
		}
	}

	if (errors.length > 0) return { rowNumber, raw, errors };

	const groupingKey = (handle.length > 0 ? handle : name).toLowerCase();
	return {
		rowNumber,
		groupingKey,
		name,
		description,
		optionNames,
		optionValues,
		sku,
		price,
		onHand,
		parcelWeightG,
	};
}

type AxisOption = { name: string; values: string[] };

/** One-line grouping error builder (the synthetic `raw: {}` matches callers). */
function groupingError(
	rowNumber: number,
	message: string,
): ProductImportRowError {
	return { rowNumber, raw: {}, errors: [message] };
}

/**
 * Infer the option axes for one product's rows. Every row must declare the same
 * axes (names + order, case-insensitively); distinct values are then collected
 * per axis in first-appearance order (first casing wins). Returns the options or
 * a single grouping error (axis mismatch / no-option product spanning >1 row).
 */
export function inferAxes(
	groupRows: VariantImportRow[],
): { options: AxisOption[] } | { error: ProductImportRowError } {
	const first = groupRows[0];
	const axisNames = first.optionNames;

	const mismatch = groupRows.find(
		(r) =>
			r.optionNames.length !== axisNames.length ||
			!r.optionNames.every(
				(n, i) => n.toLowerCase() === axisNames[i].toLowerCase(),
			),
	);
	if (mismatch)
		return {
			error: groupingError(
				mismatch.rowNumber,
				`Option columns for "${first.name}" don't match its other rows`,
			),
		};

	if (axisNames.length === 0 && groupRows.length > 1)
		return {
			error: groupingError(
				groupRows[1].rowNumber,
				`"${first.name}" has no option columns but spans multiple rows`,
			),
		};

	const axisValues: string[][] = axisNames.map(() => []);
	for (const r of groupRows)
		r.optionValues.forEach((val, i) => {
			if (!axisValues[i].some((v) => v.toLowerCase() === val.toLowerCase()))
				axisValues[i].push(val);
		});

	return {
		options: axisNames.map((name, i) => ({ name, values: axisValues[i] })),
	};
}

/**
 * Canonicalize a row's option values to each axis's first-appearance casing, so
 * a value typed with different casing across rows ("Fillet" vs "fillet") maps to
 * the SAME variant. Without this the raw-case label would miss the canonical
 * combo and the row's price/stock/SKU would be silently discarded.
 */
function canonicalizeValues(
	optionValues: string[],
	options: AxisOption[],
): string[] {
	return optionValues.map(
		(val, i) =>
			options[i]?.values.find((v) => v.toLowerCase() === val.toLowerCase()) ??
			val,
	);
}

/**
 * Map each provided combination to its row, keyed by the CANONICAL variant label
 * so case-only differences collide and are reported as a duplicate (never
 * silently discarded). Returns the map or the first duplicate error.
 */
export function dedupeProvidedVariants(
	groupRows: VariantImportRow[],
	options: AxisOption[],
): { provided: Map<string, VariantImportRow> } | { error: ProductImportRowError } {
	const provided = new Map<string, VariantImportRow>();
	for (const r of groupRows) {
		const label = variantLabel(canonicalizeValues(r.optionValues, options));
		if (provided.has(label))
			return {
				error: groupingError(
					r.rowNumber,
					`Duplicate variant "${label || groupRows[0].name}"`,
				),
			};
		provided.set(label, r);
	}
	return { provided };
}

/**
 * Expand the full cartesian grid from `options`: each combination the sheet
 * provided keeps its row; every omitted one is AUTO-FILLED as an inactive 0/0
 * variant. Errors if the grid exceeds the per-product cap.
 */
export function buildVariantGrid(
	options: AxisOption[],
	provided: Map<string, VariantImportRow>,
	first: VariantImportRow,
):
	| { variants: GroupedVariant[]; autoFilled: number }
	| { error: ProductImportRowError } {
	const combos = cartesian(options);
	if (combos.length > MAX_VARIANTS_PER_PRODUCT)
		return {
			error: groupingError(
				first.rowNumber,
				`"${first.name}" expands to ${combos.length} variants (max ${MAX_VARIANTS_PER_PRODUCT})`,
			),
		};

	let autoFilled = 0;
	const variants: GroupedVariant[] = combos.map((optionValues) => {
		const r = provided.get(variantLabel(optionValues));
		if (r)
			return {
				optionValues,
				sku: r.sku,
				price: r.price,
				onHand: r.onHand,
				parcelWeightG: r.parcelWeightG,
				active: true,
			};
		autoFilled++;
		return {
			optionValues,
			sku: undefined,
			price: 0,
			onHand: 0,
			parcelWeightG: 0,
			active: false,
		};
	});
	return { variants, autoFilled };
}

/** Product-level fields are last-writer-wins; warn when rows disagree. */
function productFieldsWithWarnings(groupRows: VariantImportRow[]): {
	name: string;
	description: string | undefined;
	warnings: string[];
} {
	const last = groupRows[groupRows.length - 1];
	const warnings: string[] = [];
	if (new Set(groupRows.map((r) => r.name)).size > 1)
		warnings.push(`Multiple names; using "${last.name}"`);
	if (new Set(groupRows.map((r) => r.description ?? "")).size > 1)
		warnings.push("Multiple descriptions; using the last row's");
	return { name: last.name, description: last.description, warnings };
}

/**
 * Group validated variant rows into products. Orchestrates the per-product
 * rules — each a small, independently testable helper: {@link inferAxes} (axis
 * names + values), {@link dedupeProvidedVariants} (one row per combination,
 * case-insensitive), {@link buildVariantGrid} (cartesian expand + auto-fill +
 * cap), and last-writer-wins product fields. Returns grouped products + per-row
 * grouping errors.
 */
export function groupVariantRows(
	rows: VariantImportRow[],
): GroupedImportResult {
	const errorRows: ProductImportRowError[] = [];
	const order: string[] = [];
	const groups = new Map<string, VariantImportRow[]>();
	for (const row of rows) {
		const g = groups.get(row.groupingKey);
		if (g) g.push(row);
		else {
			groups.set(row.groupingKey, [row]);
			order.push(row.groupingKey);
		}
	}

	const products: GroupedProductImport[] = [];
	let variantCount = 0;
	let autoFilledTotal = 0;

	for (const key of order) {
		const groupRows = groups.get(key) as VariantImportRow[];
		const first = groupRows[0];

		const axes = inferAxes(groupRows);
		if ("error" in axes) {
			errorRows.push(axes.error);
			continue;
		}
		const deduped = dedupeProvidedVariants(groupRows, axes.options);
		if ("error" in deduped) {
			errorRows.push(deduped.error);
			continue;
		}
		const grid = buildVariantGrid(axes.options, deduped.provided, first);
		if ("error" in grid) {
			errorRows.push(grid.error);
			continue;
		}

		const { name, description, warnings } =
			productFieldsWithWarnings(groupRows);
		autoFilledTotal += grid.autoFilled;
		variantCount += grid.variants.length;
		products.push({
			name,
			description,
			options: axes.options,
			variants: grid.variants,
			autoFilledCount: grid.autoFilled,
			warnings,
		});
	}

	return {
		products,
		errorRows,
		summary: {
			productCount: products.length,
			variantCount,
			autoFilledCount: autoFilledTotal,
		},
	};
}

/**
 * End-to-end: validate raw variant rows → group into products with auto-filled
 * variants. Rejects missing required columns and intra-file duplicate SKUs.
 * This is the single entry point the CSV/XLSX parsers + preview/commit share.
 */
export function parseVariantImport(
	rows: RawImportRow[],
	headers: string[],
	rowNumberOffset = 2,
): GroupedImportResult {
	const missing = PRODUCT_IMPORT_REQUIRED_COLUMNS.filter(
		(c) => !headers.includes(c),
	);
	if (missing.length > 0) {
		return {
			products: [],
			errorRows: [
				{
					rowNumber: 0,
					raw: {},
					errors: [
						`Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
					],
				},
			],
			summary: { productCount: 0, variantCount: 0, autoFilledCount: 0 },
		};
	}

	const valid: VariantImportRow[] = [];
	const errorRows: ProductImportRowError[] = [];
	rows.forEach((raw, i) => {
		const res = validateVariantRow(raw, rowNumberOffset + i);
		if ("errors" in res) errorRows.push(res);
		else valid.push(res);
	});

	for (const dup of findDuplicateSkus(valid)) {
		errorRows.push({
			rowNumber: dup.rowNumbers[1] ?? dup.rowNumbers[0],
			raw: {},
			errors: [
				`Duplicate sku "${dup.sku}" in rows ${dup.rowNumbers.join(", ")}`,
			],
		});
	}

	const grouped = groupVariantRows(valid);
	return {
		products: grouped.products,
		errorRows: [...errorRows, ...grouped.errorRows],
		summary: grouped.summary,
	};
}
