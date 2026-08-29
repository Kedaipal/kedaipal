import { sourceLabel } from "../../../convex/lib/attribution";
import type { Country } from "../../../convex/lib/country";
import type { FulfilmentWindow } from "../../../convex/lib/fulfilmentDate";
import {
	ORDER_SOURCE_KEYS,
	ORDER_SOURCE_LABELS,
	type OrderColumnKey,
	PAYMENT_STATUS_KEYS,
	PAYMENT_STATUS_LABELS,
} from "../../../convex/lib/orderCsv";
import {
	COUNTRY_PAYMENT_METHODS,
	ORDER_PAYMENT_METHODS,
	type OrderPaymentMethod,
	PAYMENT_METHOD_LABELS,
} from "../../../convex/lib/paymentMethod";
import { ORDER_STATUS_KEYS, type OrderStatus } from "../../lib/orderStatus";
import type { ColumnFilterOption } from "../ui/column-filter-menu";

/**
 * Which order-table columns can be filtered from their own header, and how
 * (86eyrtz74).
 *
 * This is the order-specific half of the header-filter feature; the panel that
 * renders it (`ui/column-filter-menu.tsx`) knows nothing about orders. Adding a
 * filterable column means one entry here.
 *
 * **The rule for what belongs here:** a filter earns a header slot when it is
 * *about that column's values* and those values are enumerable. Everything
 * else — date RANGES (two bounds, no fixed option list), cross-cutting toggles
 * like "needs mockup" that aren't any column, and the summary of everything
 * currently applied — stays in the filter panel.
 *
 * **Header filters mirror the panel; they do not replace it.** Moving them out
 * of the panel would strip cards view of its filters entirely, and would remove
 * the one surface that shows every active filter at once. Both write the same
 * URL state through the same shared predicate, so a filter set in one is active
 * in the other, and the CSV export honours whichever was used.
 */

/** Every dimension a header filter can drive. Values are the wire values, not
 * labels — the URL and the Convex args speak these. */
export interface OrderColumnFilterState {
	statuses: string[];
	categories: string[];
	/** Keep orders with NO categories. Folded into the picker as an
	 * "Uncategorized" option via `CATEGORY_UNCATEGORIZED`, split back out on
	 * apply — exactly how `paymentMethods` carries its own absence. */
	categoriesUnspecified: boolean;
	/** Checkout surface. */
	sources: string[];
	paymentStatuses: string[];
	/**
	 * Settlement methods, with `""` standing for "no method recorded". The URL
	 * keeps those apart (`method` + `munspec`) because one is a list and one is
	 * a boolean; the picker shouldn't have to care, so the sentinel is folded in
	 * here and split back out on change.
	 */
	paymentMethods: string[];
	attributionSources: string[];
	/** Mutually-exclusive due-date preset, so at most one. */
	fulfilmentWindow?: FulfilmentWindow;
}

/** Per-option row counts over the UNFILTERED window, from `searchOrders`. */
export interface OrderFilterFacets {
	status: Record<string, number>;
	category: Record<string, number>;
	source: Record<string, number>;
	paymentStatus: Record<string, number>;
	paymentMethod: Record<string, number>;
	attribution: Record<string, number>;
}

export interface OrderColumnFilterBinding {
	label: string;
	options: ColumnFilterOption[];
	selected: string[];
	onChange: (next: string[]) => void;
	mode?: "single" | "multi";
	emptyHint?: string;
}

/** The sentinel the payment-method picker uses for "no method recorded". */
export const METHOD_UNSPECIFIED = "";

/** The picker sentinel for "no categories recorded". A seller's category can
 * never be the empty string, so it cannot collide with a real name. */
export const CATEGORY_UNCATEGORIZED = "";

const DUE_WINDOW_LABELS: Record<FulfilmentWindow, string> = {
	today: "Due today",
	tomorrow: "Due tomorrow",
	this_week: "Due this week",
};

export interface BuildOrderColumnFiltersArgs {
	state: OrderColumnFilterState;
	facets?: OrderFilterFacets;
	/** Attribution keys present in the window, most-used first (the server owns
	 * that ordering, and its stability is tested there). */
	availableSources: string[];
	/** Category names present in the window, same ordering rule. */
	availableCategories: string[];
	country: Country;
	/** Resolves a raw status to the retailer's own stage wording, so the filter
	 * offers the same words the Status column shows. */
	statusLabel: (status: OrderStatus) => string;
	/** Apply a partial change. The route turns this into a URL navigate. */
	onApply: (patch: Partial<OrderColumnFilterState>) => void;
}

/** Rails to offer: what the country sells, plus whatever the window actually
 * contains. Mirrors `methodChoicesFor` in the Filters panel. */
function methodChoicesForPicker(
	country: Country,
	facets: OrderFilterFacets | undefined,
): OrderPaymentMethod[] {
	const offered = COUNTRY_PAYMENT_METHODS[country];
	const extra = ORDER_PAYMENT_METHODS.filter(
		(m) => !offered.includes(m) && (facets?.paymentMethod[m] ?? 0) > 0,
	);
	return [...offered, ...extra];
}

function opt(
	value: string,
	label: string,
	facet: Record<string, number> | undefined,
): ColumnFilterOption {
	return { value, label, count: facet?.[value] ?? 0 };
}

/**
 * Build the header-filter bindings, keyed by column. Returns a plain map so the
 * table can ask `filters.get(column.key)` and render nothing when there's no
 * entry — the presence of the funnel icon is what tells a seller the column is
 * filterable at all.
 */
export function buildOrderColumnFilters({
	state,
	facets,
	availableSources,
	availableCategories,
	country,
	statusLabel,
	onApply,
}: BuildOrderColumnFiltersArgs): Map<OrderColumnKey, OrderColumnFilterBinding> {
	const map = new Map<OrderColumnKey, OrderColumnFilterBinding>();

	// Status — in LIFECYCLE order, never alphabetical or by count: a seller
	// reading a status list is reading a pipeline, and "Cancelled, Confirmed,
	// Delivered, Packed…" destroys the one thing that makes it scannable.
	map.set("status", {
		label: "Status",
		options: ORDER_STATUS_KEYS.map((s) =>
			opt(s, statusLabel(s), facets?.status),
		),
		selected: state.statuses,
		onChange: (statuses) => onApply({ statuses }),
	});

	// Categories — only possible because they're frozen onto the order at
	// checkout (86eyrtz74); a live junction lookup per row could never back a
	// filter. Empty for a seller who has never made a category, which the hint
	// has to explain rather than showing a blank panel.
	// "Uncategorized" is one of the choices, last and named — without it,
	// selecting every category silently drops every uncategorized order, and
	// categories are optional so that is the common case (PR #235 review).
	map.set("categories", {
		label: "Categories",
		options: [
			...availableCategories.map((c) => opt(c, c, facets?.category)),
			opt(CATEGORY_UNCATEGORIZED, "Uncategorized", facets?.category),
		],
		selected: state.categoriesUnspecified
			? [...state.categories, CATEGORY_UNCATEGORIZED]
			: state.categories,
		onChange: (picked) =>
			onApply({
				categories: picked.filter((c) => c !== CATEGORY_UNCATEGORIZED),
				categoriesUnspecified: picked.includes(CATEGORY_UNCATEGORIZED),
			}),
		emptyHint: "No categories on these orders yet",
	});

	map.set("orderType", {
		label: "Order type",
		options: ORDER_SOURCE_KEYS.map((v) =>
			opt(v, ORDER_SOURCE_LABELS[v] ?? v, facets?.source),
		),
		selected: state.sources,
		onChange: (sources) => onApply({ sources }),
	});

	map.set("attribution", {
		label: "Came from",
		options: availableSources.map((v) =>
			opt(v, sourceLabel(v), facets?.attribution),
		),
		selected: state.attributionSources,
		onChange: (attributionSources) => onApply({ attributionSources }),
		emptyHint: "No tagged links used yet",
	});

	map.set("paymentStatus", {
		label: "Payment",
		options: PAYMENT_STATUS_KEYS.map((v) =>
			opt(v, PAYMENT_STATUS_LABELS[v] ?? v, facets?.paymentStatus),
		),
		selected: state.paymentStatuses,
		onChange: (paymentStatuses) => onApply({ paymentStatuses }),
	});

	// Methods are country-scoped (a Malaysian seller has no business seeing
	// PayNow), with "Unspecified" last because it is the absence of an answer
	// rather than one of them.
	map.set("paymentMethod", {
		label: "Payment method",
		// Country rails PLUS any rail the seller's orders actually used: a
		// GrabPay-settled order in an MY store had no pickable option at all, so
		// it could not be filtered to and select-all excluded it (PR #235 review).
		// paymentMethod.ts: never gate a filter MATCH on the country list.
		options: [
			...methodChoicesForPicker(country, facets).map((m) =>
				opt(m, PAYMENT_METHOD_LABELS[m], facets?.paymentMethod),
			),
			opt(METHOD_UNSPECIFIED, "Unspecified", facets?.paymentMethod),
		],
		selected: state.paymentMethods,
		onChange: (paymentMethods) => onApply({ paymentMethods }),
	});

	// The one SINGLE-select header filter: the due windows overlap (today is
	// inside this week), so offering them as a set would let a seller build a
	// combination that reads like an intersection and behaves like a union.
	// Ranges stay in the panel — a header dropdown is the wrong shape for two
	// bounds and a calendar.
	map.set("fulfilmentDate", {
		label: "Fulfilment date",
		mode: "single",
		options: (["today", "tomorrow", "this_week"] as FulfilmentWindow[]).map(
			(w) => ({ value: w, label: DUE_WINDOW_LABELS[w] }),
		),
		selected: state.fulfilmentWindow ? [state.fulfilmentWindow] : [],
		onChange: ([w]) =>
			onApply({ fulfilmentWindow: (w as FulfilmentWindow) ?? undefined }),
	});

	return map;
}
