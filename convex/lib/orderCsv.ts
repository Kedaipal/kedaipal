// Pure CSV serialization for the orders-inbox bulk export. The export's job is
// bookkeeping — one row per order, amounts as plain numbers so spreadsheets sum
// them — so this is intentionally NOT a PDF. No Convex imports; unit-tested in
// orders.test.ts. See docs/invoices-receipts.md.

import { orderCustomerLabel } from "./customer";

// Malaysia is UTC+8, no DST — render the calendar day with a fixed offset.
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Epoch ms -> "2026-06-30" (MYT), the sortable form spreadsheets prefer. */
export function csvDate(epochMs: number | undefined): string {
	if (epochMs === undefined) return "";
	const d = new Date(epochMs + MYT_OFFSET_MS);
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/** Minor units -> "120.00" (no currency prefix — the currency has its own
 * column, and a bare number sums in Sheets/Excel). */
export function csvAmount(minorUnits: number): string {
	return (minorUnits / 100).toFixed(2);
}

export type CsvOrder = {
	shortId: string;
	createdAt: number;
	fulfilmentDate?: number;
	status: string;
	paymentStatus?: string;
	paymentMethod?: string;
	deliveryMethod?: string;
	customer: { name?: string; waPhone?: string };
	items: Array<{ name: string; variantLabel?: string; quantity: number }>;
	subtotal: number;
	/** Frozen per-location pickup fee (minor units). Undefined/0 = free — the
	 * column prints "0.00" (never blank) so `Subtotal + Pickup fee + Delivery
	 * fee = Total` sums in a spreadsheet for a standard order. (A made-to-order/
	 * custom order also folds a mockup quote into `total`, and there's no quote
	 * column, so that identity doesn't hold there — the quote never was in the
	 * export.) */
	pickupFee?: number;
	/** Frozen delivery charge (minor units) — same "0.00 never blank" rule as
	 * pickupFee so the totals identity sums. */
	deliveryFee?: number;
	total: number;
	currency: string;
	customerNote?: string;
};

/** Fixed column order — the header row and every record follow this. */
export const CSV_COLUMNS = [
	"Order ID",
	"Order date",
	"Fulfilment date",
	"Customer",
	"Phone",
	"Fulfilment",
	"Status",
	"Payment",
	"Payment method",
	"Items",
	"Subtotal",
	"Pickup fee",
	"Delivery fee",
	"Total",
	"Currency",
	"Note",
] as const;

/** One order -> the column values (same order as CSV_COLUMNS). */
export function orderToCsvRow(o: CsvOrder): string[] {
	const items = o.items
		.map(
			(it) =>
				`${it.quantity}x ${it.name}${
					it.variantLabel ? ` (${it.variantLabel})` : ""
				}`,
		)
		.join("; ");
	return [
		o.shortId,
		csvDate(o.createdAt),
		csvDate(o.fulfilmentDate),
		// "" (not "Anonymous") stays the default for a phone-only order with no
		// name, so existing exports are unchanged; an anonymous walk-in (no phone)
		// reads "Walk-in customer" instead of blank.
		orderCustomerLabel(o.customer, ""),
		o.customer.waPhone ?? "",
		o.deliveryMethod ?? "",
		o.status,
		o.paymentStatus ?? "unpaid",
		o.paymentMethod ?? "",
		items,
		csvAmount(o.subtotal),
		csvAmount(o.pickupFee ?? 0),
		csvAmount(o.deliveryFee ?? 0),
		csvAmount(o.total),
		o.currency,
		o.customerNote ?? "",
	];
}

/**
 * Escape one field per RFC 4180, with CSV-injection defense: a value starting
 * with `= + - @` (or a tab/CR) is prefixed with a `'` so a spreadsheet treats it
 * as text, not a formula — buyer-controlled fields (name, note) flow into this
 * export. Quoting wraps any field containing a comma, quote, or newline.
 */
export function escapeCsvField(value: string): string {
	let v = value;
	if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
	if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
	return v;
}

/** Serialize ordered rows (header + records) into a CSV document (CRLF lines). */
export function toCsv(rows: string[][]): string {
	return rows.map((r) => r.map(escapeCsvField).join(",")).join("\r\n");
}

/** Full export document: header row + one row per order. */
export function ordersToCsv(orders: CsvOrder[]): string {
	return toCsv([[...CSV_COLUMNS], ...orders.map(orderToCsvRow)]);
}
