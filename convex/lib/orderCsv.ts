// The order-inbox COLUMN REGISTRY — one definition of "what an order looks like
// as a row", shared by the CSV export and the dashboard's table view.
//
// Why one registry: the table exists to stop sellers exporting to Excel out of
// habit (86eyrtz74), which only works if the table shows everything the export
// does. Two lists would drift the first time a column was added to one of them,
// and the seller would be back in Excel. So `ORDER_COLUMNS` below is the single
// source of truth: the CSV writes it in order, the table renders from it, and
// the table's "export visible columns" passes a subset of the same keys.
//
// Amounts are plain numbers so spreadsheets sum them — the export's job is
// bookkeeping, which is why this is NOT a PDF. No Convex imports; unit-tested
// in orderCsv.test.ts. See docs/invoices-receipts.md + docs/order-inbox.md.

import { sourceLabel } from "./attribution";
import { orderCustomerLabel } from "./customer";
import { formatFulfilmentTime } from "./fulfilmentDate";
import { PAYMENT_METHOD_LABELS } from "./paymentMethod";

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

/** Flag columns read as "Yes"/"" — never "false", which a spreadsheet shows as
 * text clutter on the majority of rows that don't have the flag. */
function csvFlag(on: boolean | undefined): string {
	return on ? "Yes" : "";
}

/**
 * A stored enum value as a person reads it: `payment_window_expired` →
 * `Payment window expired` (86eyrtz74).
 *
 * Every other cell in this registry is already formatted for a human — money
 * through `csvAmount`, dates through `csvDate`, booleans through `csvFlag`,
 * attribution through `sourceLabel`. The raw enums were the inconsistency, not
 * this. Idempotent, so a value that is already prose passes through unchanged.
 */
export function humanizeEnum(raw: string): string {
	const spaced = raw.replace(/[_-]+/g, " ").trim();
	if (spaced === "") return "";
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * How an order's checkout surface is NAMED — the single source for the Order
 * type column, its header filter and the Filters panel.
 *
 * It lives here because the column and the filter drifting apart is exactly
 * what went wrong: the panel said "Online" while the table printed
 * `storefront`, so a seller ticking a filter saw a value that matched nothing
 * on screen. One map, imported by all three, is the fix for the cause rather
 * than the symptom.
 */
export const ORDER_SOURCE_LABELS: Record<string, string> = {
	storefront: "Online",
	counter: "Counter",
	claim: "Claim link",
};

/**
 * What the Payment method cell shows when no rail was recorded: nothing. The
 * picker names that absence "Unspecified" because an unlabelled row in a list
 * is unpickable — a word in the CELL would read as a real payment rail. Named
 * so the test that holds filter labels and column text together can point at
 * the one place they deliberately differ.
 */
export const METHOD_UNSPECIFIED_CELL = "";

/** Checkout surfaces in the order they are offered, so every picker agrees. */
export const ORDER_SOURCE_KEYS = ["storefront", "counter", "claim"] as const;

/** Payment state as named everywhere. Note `received` reads as **Paid** — the
 * stored value and the seller's word for it were never the same, which is the
 * second place the column and its filter disagreed. */
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
	unpaid: "Unpaid",
	claimed: "Claimed",
	received: "Paid",
};

export const PAYMENT_STATUS_KEYS = ["unpaid", "claimed", "received"] as const;

/** How the order reaches the buyer. `self_collect` humanizes to "Self collect";
 * the app has always written it hyphenated, so it is spelled out here. */
const FULFILMENT_LABELS: Record<string, string> = {
	delivery: "Delivery",
	self_collect: "Self-collect",
	collection: "Collection",
};

export type CsvOrder = {
	shortId: string;
	createdAt: number;
	fulfilmentDate?: number;
	/** Buyer's chosen time slot, minutes since MYT midnight. Stored separately
	 * from `fulfilmentDate` (which keeps a whole-day invariant), so it needs its
	 * own column — a date alone can't tell a made-to-order seller when the
	 * customer is actually coming. */
	fulfilmentTimeMinutes?: number;
	status: string;
	paymentStatus?: string;
	paymentMethod?: string;
	/** Buyer/seller-entered payment reference — the join key for reconciling a
	 * bank statement, and the single most-requested bookkeeping field. */
	paymentReference?: string;
	/** When the money actually landed. Distinct from `createdAt`: cash-flow
	 * accounting is keyed on the date PAID, not the date ordered. */
	paymentReceivedAt?: number;
	deliveryMethod?: string;
	/** Frozen trip direction (86eyg0n8e). A collection order's rider went
	 * buyer -> store, so the Fulfilment CELL reads "collection" instead of
	 * "delivery". Deliberately a value, not a column: one export can hold
	 * both directions (a store that switched modes, and routinely once
	 * direction varies per order), so the header must stay fixed — a
	 * seller's bookkeeping template keys on column names. */
	deliveryDirection?: string;
	/** Checkout surface (storefront / counter / claim). The inbox filters on it;
	 * before 86eyrtz74 the export couldn't tell a walk-in from a web order. */
	source?: string;
	/** Marketing origin the buyer arrived from (86eyq0eq9). Insights reports it;
	 * the export now carries it so the two can be reconciled. */
	attributionSource?: string;
	customer: { name?: string; waPhone?: string };
	items: Array<{
		name: string;
		variantLabel?: string;
		quantity: number;
		/** Categories the product was filed under AT SALE TIME (86eyrtz74) —
		 * frozen per line at order create, not looked up. See
		 * `orders.items[].categoryNames` in convex/schema.ts. */
		categoryNames?: string[];
	}>;
	subtotal: number;
	/** Accepted/proposed mockup quote on a made-to-order order (minor units).
	 * `computeOrderTotals` ADDS it to `total` alongside the fees, so WITHOUT
	 * this column `Subtotal + Pickup fee + Delivery fee` silently fails to
	 * reconcile against `Total` on every custom order — the bug this column
	 * exists to fix. Prints "0.00" (never blank) so the identity sums. */
	mockupQuotedAmount?: number;
	/** Frozen per-location pickup fee (minor units). Undefined/0 = free — the
	 * column prints "0.00" (never blank) so `Subtotal + Custom work + Pickup fee
	 * + Delivery fee = Total` sums in a spreadsheet for every order shape. */
	pickupFee?: number;
	/** Frozen delivery charge (minor units) — same "0.00 never blank" rule as
	 * pickupFee so the totals identity sums. */
	deliveryFee?: number;
	/** True while the delivery charge is still unquoted: `total` is provisional
	 * and understates the final bill. Without this column the Total column lies
	 * with no way to tell which rows are affected. */
	deliveryFeePending?: boolean;
	total: number;
	currency: string;
	customerNote?: string;
	/** Structured shipping address. Split across columns rather than joined into
	 * one cell so a seller can mail-merge into a courier portal — the reported
	 * gap that started 86eyrtz74. Absent on self-collect orders. */
	deliveryAddress?: {
		line1: string;
		line2?: string;
		city: string;
		state: string;
		postcode: string;
		notes?: string;
	};
	/** Frozen pickup location for self-collect orders. The sibling of the address
	 * gap: without it a multi-outlet seller cannot split self-collect orders by
	 * outlet. Survives the location being deleted later (it's a snapshot). */
	pickupSnapshot?: { label: string; address: string };
	/** Manual parcel-courier shipment info (delivery orders marked shipped via
	 * J&T/DD Cold Chain/etc). Blank when not attached — most orders. */
	courierName?: string;
	trackingNo?: string;
	cancelledReason?: string;
	/** Seller's manual bookmark (86eyrtz74). Exported so a pinned row stays
	 * identifiable — and removable — once the CSV is open in Excel. */
	pinnedAt?: number;
};

/**
 * The categories an order touched — deduped and sorted across its lines.
 *
 * Deduped ACROSS lines because the column answers "what kinds of thing is this
 * order", not "what is each line": a 12-line order of one category should read
 * "Kuih", not "Kuih, Kuih, Kuih…". The per-line values stay per-line on the
 * document so a future sales-by-category report can attribute revenue to a
 * line rather than guessing from the union.
 */
export function orderCategoryNames(o: CsvOrder): string[] {
	const names = new Set<string>();
	for (const it of o.items) for (const n of it.categoryNames ?? []) names.add(n);
	return [...names].sort((a, b) => a.localeCompare(b));
}

export type OrderColumnKey =
	| "shortId"
	| "createdAt"
	| "fulfilmentDate"
	| "fulfilmentTime"
	| "customer"
	| "phone"
	| "fulfilment"
	| "addressLine1"
	| "addressLine2"
	| "city"
	| "state"
	| "postcode"
	| "addressNotes"
	| "pickupLocation"
	| "pickupAddress"
	| "courierName"
	| "trackingNo"
	| "status"
	| "orderType"
	| "attribution"
	| "paymentStatus"
	| "paymentMethod"
	| "paymentReference"
	| "paidAt"
	| "items"
	| "categories"
	| "subtotal"
	| "customWork"
	| "pickupFee"
	| "deliveryFee"
	| "total"
	| "currency"
	| "feePending"
	| "note"
	| "cancelledReason"
	| "pinned";

/** Column groups, used to section the table's show/hide picker. */
export type OrderColumnGroup =
	| "order"
	| "customer"
	| "fulfilment"
	| "payment"
	| "items"
	| "money";

export const ORDER_COLUMN_GROUP_LABELS: Record<OrderColumnGroup, string> = {
	order: "Order",
	customer: "Customer",
	fulfilment: "Fulfilment",
	payment: "Payment",
	items: "Items",
	money: "Money",
};

/**
 * Resize bounds for a table column, in px (86eyrtz74).
 *
 * The floor keeps a column readable — below ~80px a header truncates to two
 * characters and a sort glyph, which is a column you can no longer identify,
 * and a column dragged to nothing has no handle left to drag back. The ceiling
 * stops one column (an address, a long item list) from being dragged so wide
 * that everything else is pushed out of the viewport with no visible cue as to
 * why. Both are deliberately generous: they exist to prevent dead ends, not to
 * second-guess the seller's layout.
 */
export const ORDER_COLUMN_MIN_WIDTH = 80;
export const ORDER_COLUMN_MAX_WIDTH = 640;

/** Hold a width inside those bounds. Applied on every path that can set one —
 * a keyboard nudge, and reading a stored layout back — so a width the bounds
 * have since moved past can't survive a reload. */
export function clampColumnWidth(width: number): number {
	return Math.min(
		ORDER_COLUMN_MAX_WIDTH,
		Math.max(ORDER_COLUMN_MIN_WIDTH, Math.round(width)),
	);
}

export interface OrderColumn {
	key: OrderColumnKey;
	/** CSV header AND table header — one label, so a seller reading the table
	 * and a seller reading the spreadsheet are looking at the same word. */
	label: string;
	group: OrderColumnGroup;
	/** Right-aligned + tabular in the table (amounts). */
	numeric?: boolean;
	/** In the table's default column set. The rest are opt-in via the picker —
	 * every column is available, but 36 at once is unreadable. */
	defaultVisible?: boolean;
	/** Table column width in px — the DEFAULT. The seller can drag it between
	 * `ORDER_COLUMN_MIN_WIDTH` and `ORDER_COLUMN_MAX_WIDTH`, and double-clicking
	 * the handle returns the column to this value. */
	width: number;
	value: (o: CsvOrder) => string;
	/**
	 * Value the TABLE sorts on, when the rendered string would sort wrong
	 * (86eyrtz74). Money is a string of digits ("125.00" < "86.00"
	 * lexically) and a 12-hour time is worse ("3:30 PM" < "9:00 AM"), so those
	 * columns hand back the underlying number instead. Dates could ride their
	 * ISO string, but the epoch is exact and needs no reasoning about it.
	 *
	 * `undefined` means "no value" and always sinks to the bottom regardless of
	 * direction — a dateless order is not "earliest", it is unscheduled.
	 * Columns without a `sortKey` sort on their lowercased display string.
	 */
	sortKey?: (o: CsvOrder) => number | string | undefined;
}

/**
 * Every column, in export order.
 *
 * ORDERING RULE: the 18 columns that existed before 86eyrtz74 keep their
 * relative order — new columns are interleaved where they belong rather than
 * bolted on the end, so a seller's name-keyed spreadsheet template still reads
 * left-to-right in the same sequence. The one thing that MUST stay adjacent is
 * the money run: `Subtotal · Custom work · Pickup fee · Delivery fee · Total`
 * reconciles by inspection, which is the whole point of adding Custom work.
 *
 * DELIBERATELY ABSENT: `trackingToken`. It is the capability that unlocks the
 * buyer's no-auth tracking page (see schema `orders.trackingToken`), so it must
 * never reach a spreadsheet that gets emailed to a bookkeeper. Same for the
 * internal ids, storage ids and `gateway*` / `confirmationPush*` plumbing —
 * none of it is bookkeeping data.
 */
export const ORDER_COLUMNS: readonly OrderColumn[] = [
	{
		key: "shortId",
		label: "Order ID",
		group: "order",
		defaultVisible: true,
		width: 108,
		value: (o) => o.shortId,
	},
	{
		key: "createdAt",
		label: "Order date",
		group: "order",
		defaultVisible: true,
		width: 116,
		value: (o) => csvDate(o.createdAt),
		sortKey: (o) => o.createdAt,
	},
	{
		key: "fulfilmentDate",
		label: "Fulfilment date",
		group: "fulfilment",
		defaultVisible: true,
		width: 128,
		value: (o) => csvDate(o.fulfilmentDate),
		sortKey: (o) => o.fulfilmentDate,
	},
	{
		key: "fulfilmentTime",
		label: "Fulfilment time",
		group: "fulfilment",
		width: 124,
		value: (o) =>
			o.fulfilmentTimeMinutes === undefined
				? ""
				: formatFulfilmentTime(o.fulfilmentTimeMinutes),
		// "3:30 PM" would sort before "9:00 AM" as text.
		sortKey: (o) => o.fulfilmentTimeMinutes,
	},
	{
		key: "customer",
		label: "Customer",
		group: "customer",
		defaultVisible: true,
		width: 160,
		// "" (not "Anonymous") stays the default for a phone-only order with no
		// name, so existing exports are unchanged; an anonymous walk-in (no phone)
		// reads "Walk-in customer" instead of blank.
		value: (o) => orderCustomerLabel(o.customer, ""),
	},
	{
		key: "phone",
		label: "Phone",
		group: "customer",
		defaultVisible: true,
		width: 140,
		value: (o) => o.customer.waPhone ?? "",
	},
	{
		key: "fulfilment",
		label: "Fulfilment",
		group: "fulfilment",
		defaultVisible: true,
		width: 116,
		value: (o) => {
			const key =
				o.deliveryDirection === "collection"
					? "collection"
					: (o.deliveryMethod ?? "");
			return FULFILMENT_LABELS[key] ?? humanizeEnum(key);
		},
	},
	{
		key: "addressLine1",
		label: "Address line 1",
		group: "fulfilment",
		width: 200,
		value: (o) => o.deliveryAddress?.line1 ?? "",
	},
	{
		key: "addressLine2",
		label: "Address line 2",
		group: "fulfilment",
		width: 170,
		value: (o) => o.deliveryAddress?.line2 ?? "",
	},
	{
		key: "city",
		label: "City",
		group: "fulfilment",
		width: 130,
		value: (o) => o.deliveryAddress?.city ?? "",
	},
	{
		key: "state",
		label: "State",
		group: "fulfilment",
		width: 130,
		value: (o) => o.deliveryAddress?.state ?? "",
	},
	{
		key: "postcode",
		label: "Postcode",
		group: "fulfilment",
		width: 100,
		value: (o) => o.deliveryAddress?.postcode ?? "",
	},
	{
		key: "addressNotes",
		label: "Address notes",
		group: "fulfilment",
		width: 180,
		value: (o) => o.deliveryAddress?.notes ?? "",
	},
	{
		key: "pickupLocation",
		label: "Pickup location",
		group: "fulfilment",
		width: 150,
		value: (o) => o.pickupSnapshot?.label ?? "",
	},
	{
		key: "pickupAddress",
		label: "Pickup address",
		group: "fulfilment",
		width: 200,
		value: (o) => o.pickupSnapshot?.address ?? "",
	},
	{
		key: "courierName",
		label: "Courier",
		group: "fulfilment",
		width: 120,
		value: (o) => o.courierName ?? "",
	},
	{
		key: "trackingNo",
		label: "Tracking no",
		group: "fulfilment",
		width: 150,
		value: (o) => o.trackingNo ?? "",
	},
	{
		key: "status",
		label: "Status",
		group: "order",
		defaultVisible: true,
		// Wide enough for the longest stock stage plus a two-word custom one
		// ("Ready for Pickup") on one line — the pill truncates rather than wraps
		// (StatusBadge), and a truncated status is a status you have to hover to
		// read, so the column is sized to make that the exception.
		width: 148,
		// Capitalised, but NOT the retailer's custom stage name: resolving that
		// needs their `orderStages` config, which this pure registry cannot
		// reach. The TABLE renders `StatusBadge` with the resolved label instead,
		// so a store that renamed "packed" to "Ready for Pickup" sees the custom
		// word on screen and the anchor word in the CSV. Tracked separately.
		value: (o) => humanizeEnum(o.status),
	},
	{
		key: "orderType",
		label: "Order type",
		group: "order",
		width: 110,
		// Legacy orders carry no stamped source and read as "storefront" —
		// the same default the inbox predicate applies.
		// The label the seller sees everywhere else, not the stored key: the
		// header filter offers "Online" and the column printed `storefront`.
		value: (o) => {
			const key = o.source ?? "storefront";
			return ORDER_SOURCE_LABELS[key] ?? humanizeEnum(key);
		},
	},
	{
		key: "attribution",
		label: "Came from",
		group: "order",
		width: 124,
		value: (o) =>
			o.attributionSource ? sourceLabel(o.attributionSource) : "",
	},
	{
		key: "paymentStatus",
		label: "Payment",
		group: "payment",
		defaultVisible: true,
		width: 110,
		// `received` reads as "Paid" — the stored value and the seller's word for
		// it were never the same, and only the filter knew that.
		value: (o) => {
			const key = o.paymentStatus ?? "unpaid";
			return PAYMENT_STATUS_LABELS[key] ?? humanizeEnum(key);
		},
	},
	{
		key: "paymentMethod",
		label: "Payment method",
		group: "payment",
		width: 140,
		// The same rail names the settings screen and the filter use — `tng` and
		// `bank_transfer` are storage, not language.
		value: (o) => {
			const key = o.paymentMethod;
			if (!key) return "";
			// `CsvOrder.paymentMethod` is a plain string (a legacy row can hold a
			// rail no longer offered), so the lookup is widened rather than the
			// type narrowed — an unknown rail humanizes instead of blanking.
			const known: Record<string, string> = PAYMENT_METHOD_LABELS;
			return known[key] ?? humanizeEnum(key);
		},
	},
	{
		key: "paymentReference",
		label: "Payment reference",
		group: "payment",
		width: 170,
		value: (o) => o.paymentReference ?? "",
	},
	{
		key: "paidAt",
		label: "Paid on",
		group: "payment",
		width: 116,
		value: (o) => csvDate(o.paymentReceivedAt),
		sortKey: (o) => o.paymentReceivedAt,
	},
	{
		key: "items",
		label: "Items",
		group: "items",
		defaultVisible: true,
		width: 280,
		value: (o) =>
			o.items
				.map(
					(it) =>
						`${it.quantity}x ${it.name}${
							it.variantLabel ? ` (${it.variantLabel})` : ""
						}`,
				)
				.join("; "),
	},
	{
		key: "categories",
		label: "Categories",
		group: "items",
		width: 180,
		// Deduped, sorted union across the order's lines — the per-line values
		// are frozen at sale time, so this needs no reads and no "(current)"
		// hedge: it is what these products WERE filed under when sold.
		value: (o) => orderCategoryNames(o).join(", "),
	},
	{
		key: "subtotal",
		label: "Subtotal",
		group: "money",
		numeric: true,
		width: 106,
		value: (o) => csvAmount(o.subtotal),
		sortKey: (o) => o.subtotal,
	},
	{
		key: "customWork",
		label: "Custom work",
		group: "money",
		numeric: true,
		width: 118,
		value: (o) => csvAmount(o.mockupQuotedAmount ?? 0),
		sortKey: (o) => o.mockupQuotedAmount ?? 0,
	},
	{
		key: "pickupFee",
		label: "Pickup fee",
		group: "money",
		numeric: true,
		width: 110,
		value: (o) => csvAmount(o.pickupFee ?? 0),
		sortKey: (o) => o.pickupFee ?? 0,
	},
	{
		key: "deliveryFee",
		label: "Delivery fee",
		group: "money",
		numeric: true,
		width: 116,
		value: (o) => csvAmount(o.deliveryFee ?? 0),
		sortKey: (o) => o.deliveryFee ?? 0,
	},
	{
		key: "total",
		label: "Total",
		group: "money",
		numeric: true,
		defaultVisible: true,
		width: 110,
		value: (o) => csvAmount(o.total),
		sortKey: (o) => o.total,
	},
	{
		key: "currency",
		label: "Currency",
		group: "money",
		width: 96,
		value: (o) => o.currency,
	},
	{
		key: "feePending",
		label: "Fee pending",
		group: "money",
		width: 116,
		value: (o) => csvFlag(o.deliveryFeePending),
	},
	{
		key: "note",
		label: "Note",
		group: "items",
		width: 220,
		value: (o) => o.customerNote ?? "",
	},
	{
		key: "cancelledReason",
		label: "Cancelled reason",
		group: "order",
		width: 180,
		value: (o) => humanizeEnum(o.cancelledReason ?? ""),
	},
	{
		key: "pinned",
		label: "Pinned",
		group: "order",
		width: 92,
		value: (o) => csvFlag(o.pinnedAt !== undefined),
	},
] as const;

/** Lookup by key — the table and the export both resolve subsets through this. */
export const ORDER_COLUMNS_BY_KEY = new Map<OrderColumnKey, OrderColumn>(
	ORDER_COLUMNS.map((c) => [c.key, c]),
);

/** Every column LABEL, in export order — the header row of a full export. */
export const CSV_COLUMNS: readonly string[] = ORDER_COLUMNS.map((c) => c.label);

/** Every key, in export order. */
export const ALL_ORDER_COLUMN_KEYS: readonly OrderColumnKey[] =
	ORDER_COLUMNS.map((c) => c.key);

/** The table's opening column set — the ten that answer "what is this order?"
 * without a horizontal scroll. Everything else is one tap away in the picker. */
export const DEFAULT_ORDER_COLUMN_KEYS: readonly OrderColumnKey[] =
	ORDER_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

/**
 * Resolve a caller-supplied key list to real columns, IN THE ORDER GIVEN.
 *
 * Order is honoured (not normalised to the registry's) so an export matches the
 * column arrangement the seller dragged into place in the table — "what I see
 * is what I get" extends to left-to-right, not just which columns appear.
 * Duplicates collapse to their first position.
 *
 * Tolerant of unknown keys: they arrive from a client that may be running an
 * older build, where a column the seller had visible could since have been
 * renamed or dropped, and a stale key must never fail an export — it just isn't
 * a column any more. An empty/undefined list means "everything", so a client
 * that sends nothing still gets a complete export rather than an empty file.
 */
export function resolveOrderColumns(
	keys?: readonly string[],
): readonly OrderColumn[] {
	if (!keys || keys.length === 0) return ORDER_COLUMNS;
	const seen = new Set<string>();
	const picked: OrderColumn[] = [];
	for (const key of keys) {
		if (seen.has(key)) continue;
		const col = ORDER_COLUMNS_BY_KEY.get(key as OrderColumnKey);
		if (!col) continue;
		seen.add(key);
		picked.push(col);
	}
	return picked.length > 0 ? picked : ORDER_COLUMNS;
}

/**
 * Comparable value for a column, for the table's per-column sort.
 *
 * Falls back to the lowercased display string, so a column that never declared
 * a `sortKey` still sorts sensibly (alphabetically) instead of not at all.
 */
export function orderColumnSortValue(
	column: OrderColumn,
	o: CsvOrder,
): number | string | undefined {
	if (column.sortKey) return column.sortKey(o);
	const text = column.value(o);
	return text === "" ? undefined : text.toLowerCase();
}

/** Header labels for a resolved column set. */
export function csvHeaderRow(columns: readonly OrderColumn[]): string[] {
	return columns.map((c) => c.label);
}

/** One order -> the column values, aligned to `columns`. */
export function orderToCsvRow(
	o: CsvOrder,
	columns: readonly OrderColumn[] = ORDER_COLUMNS,
): string[] {
	return columns.map((c) => c.value(o));
}

/**
 * Escape one field per RFC 4180, with CSV-injection defense: a value starting
 * with `= + - @` (or a tab/CR) is prefixed with a `'` so a spreadsheet treats it
 * as text, not a formula — buyer-controlled fields (name, note, and now every
 * address line) flow into this export. Quoting wraps any field containing a
 * comma, quote, or newline.
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

/**
 * Full export document: header row + one row per order.
 *
 * `columnKeys` narrows the export to a subset — the table's "export visible
 * columns" path. Omit it (the cards view, and any older client) to export every
 * column.
 */
export function ordersToCsv(
	orders: CsvOrder[],
	columnKeys?: readonly string[],
): string {
	const columns = resolveOrderColumns(columnKeys);
	return toCsv([
		csvHeaderRow(columns),
		...orders.map((o) => orderToCsvRow(o, columns)),
	]);
}
