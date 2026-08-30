import ExcelJS from "exceljs";
import Papa from "papaparse";
import { VARIANT_IMPORT_COLUMNS } from "./product-import";

/**
 * Product bulk export — one row per variant.
 *
 * TWO JOBS, one file, in a deliberate order:
 *
 *  1. **Import template.** The first eleven columns are exactly
 *     `VARIANT_IMPORT_COLUMNS`, in that order, so an export → edit → re-import
 *     round-trip works with no column mapping. Those columns keep their names
 *     and positions forever.
 *  2. **Catalogue report** (86eyrtz74). Everything after them answers "what is
 *     actually in my store" — categories, storefront visibility, order rules,
 *     stock policy, photos. `bulkUpsert` never writes these fields, so
 *     re-importing an edited sheet cannot clobber them; but it also cannot
 *     APPLY them, which is why they are grouped last, named in
 *     `EXPORT_ONLY_COLUMNS`, and called out by the import screen
 *     (`exportOnlyColumnsPresent`) rather than silently ignored.
 *
 *     ONE exception: `variant_status` is read back on the CREATE path
 *     (`ROUNDTRIP_REPORT_COLUMNS`) so the round-trip cannot resurrect a variant
 *     the seller switched off. Read for fidelity, never as an editable field.
 *
 * Prices are written as major-unit strings ("120.50"); flags read "Yes"/blank
 * rather than "false", which would be text clutter on most rows.
 */

/** Columns the import reads. Never reorder or rename — a seller's sheet keys on them. */
export const PRODUCT_IMPORT_ROUNDTRIP_COLUMNS = VARIANT_IMPORT_COLUMNS;

/** Every reporting column added by 86eyrtz74, in export order. */
export const REPORT_COLUMNS = [
	"currency",
	"categories",
	"product_status",
	"variant_status",
	"storefront",
	"product_url",
	"min_order_qty",
	"min_notice_days",
	"stock_policy",
	"needs_mockup",
	"custom_line",
	"reserved",
	"photos",
] as const;

/**
 * The report columns the import READS BACK, for round-trip fidelity only.
 *
 * `variant_status` and `product_status`. The export includes variants the seller
 * built and then
 * switched off (see `isExportableVariant`); the import's create path defaults a
 * provided row to active, so without reading this back, exporting a catalogue
 * and importing it into a second store — or re-importing after deleting a
 * product — would resurrect those variants live and purchasable at their old
 * price. It is NOT an editable field: on an existing product the import never
 * patches `active` at all, in either direction.
 */
export const ROUNDTRIP_REPORT_COLUMNS = [
	"variant_status",
	"product_status",
] as const;

/**
 * Report columns the import ignores entirely: editing them in a sheet and
 * re-importing changes nothing. Exported so the import screen can say so out
 * loud instead of no-op'ing silently.
 */
export const EXPORT_ONLY_COLUMNS: readonly string[] = REPORT_COLUMNS.filter(
	(c) => !(ROUNDTRIP_REPORT_COLUMNS as readonly string[]).includes(c),
);

export const PRODUCT_EXPORT_COLUMNS = [
	...PRODUCT_IMPORT_ROUNDTRIP_COLUMNS,
	...REPORT_COLUMNS,
] as const;

export interface ExportableVariant {
	optionValues: string[];
	sku?: string;
	price: number; // minor units
	onHand: number;
	parcelWeightG: number;
	active: boolean;
	/** Units held by unpaid/pending orders — explains "stock says 5 but I can't sell 5". */
	reserved?: number;
	/** Resolved per-variant (falls back to the product flag server-side).
	 * `true` = hard stock block; false/undefined = made-to-order. */
	blockWhenOutOfStock?: boolean;
	/** Order containing this variant is mockup-gated. */
	requiresProof?: boolean;
	/** The bespoke line that sits outside the option cartesian. */
	isCustom?: boolean;
	customLabel?: string;
	imageCount?: number;
}

export interface ExportableProduct {
	handle: string; // stable grouping key (product id)
	name: string;
	description?: string;
	options: { name: string; values: string[] }[];
	variants: ExportableVariant[];
	currency?: string;
	/** Category names this product is filed under (86eyrtz74). */
	categories?: string[];
	/** false = archived. */
	active?: boolean;
	/** Seller's own storefront off-switch. */
	hidden?: boolean;
	/** Every category it belongs to is hidden, so it drops off the storefront. */
	hiddenByCategory?: boolean;
	/** Storefront path (`/<store>/p/<slug>`) — resolved by the caller. */
	url?: string;
	/** Summed minimum order quantity across the product's variants. */
	minQuantity?: number;
	minNoticeDays?: number;
	imageCount?: number;
}

type ExportRow = Record<(typeof PRODUCT_EXPORT_COLUMNS)[number], string>;

const yesBlank = (on: boolean | undefined): string => (on ? "Yes" : "");

/**
 * An inactive variant is EXPORTED only when the seller put something in it.
 *
 * Importing a partial grid auto-fills the missing combinations as
 * `{ sku: undefined, price: 0, onHand: 0, active: false }` (see
 * `buildVariantGrid`), and a 5x4 product with six real rows would otherwise
 * drag fourteen empty ones into every export — noise that also bloats the
 * round-trip. A variant the seller named, priced or stocked and then switched
 * off is real catalogue data and belongs in the report; that was previously
 * dropped too, which is the gap this rule closes.
 */
export function isExportableVariant(vr: ExportableVariant): boolean {
	if (vr.active) return true;
	return Boolean(vr.sku) || vr.price > 0 || vr.onHand > 0;
}

/** One export row per exportable variant of a product. */
function productToExportRows(p: ExportableProduct): ExportRow[] {
	const categories = (p.categories ?? []).join(", ");
	const storefront = !p.active
		? "archived"
		: p.hidden
			? "hidden"
			: p.hiddenByCategory
				? "hidden (category)"
				: "visible";
	return p.variants.filter(isExportableVariant).map((vr) => ({
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
		// ---- report-only from here ----
		currency: p.currency ?? "",
		categories,
		product_status: p.active === false ? "archived" : "active",
		variant_status: vr.active ? "active" : "inactive",
		storefront,
		product_url: p.url ?? "",
		min_order_qty: p.minQuantity ? String(p.minQuantity) : "",
		min_notice_days:
			p.minNoticeDays === undefined ? "" : String(p.minNoticeDays),
		// The one that most often explains "why didn't my stock go down".
		stock_policy: vr.blockWhenOutOfStock ? "tracked" : "made-to-order",
		needs_mockup: yesBlank(vr.requiresProof),
		// Label rather than "Yes": on a custom line the seller's own wording is
		// the useful answer, and its presence already means isCustom.
		custom_line: vr.isCustom ? vr.customLabel?.trim() || "Custom" : "",
		reserved: vr.reserved ? String(vr.reserved) : "0",
		photos: String(vr.imageCount ?? p.imageCount ?? 0),
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

/** Column widths — the report columns are mostly short flags. */
function columnWidth(col: (typeof PRODUCT_EXPORT_COLUMNS)[number]): number {
	if (col === "description") return 40;
	if (col === "name" || col === "product_url") return 28;
	if (col === "categories") return 24;
	return 14;
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
		width: columnWidth(col),
	}));
	ws.getRow(1).font = { bold: true };
	// Freeze the header AND the two identity columns, so scrolling right through
	// 24 columns never loses which product a row belongs to.
	ws.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
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
