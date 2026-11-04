import { effectiveKind } from "../../convex/lib/productKind";

/**
 * The counter catalog's one-tap filter (`z8r3fdkugx`): All, Products,
 * Services, Events, Hidden — one at a time, composing with the text search.
 *
 * Products / Services / Events are ONE axis and partition the catalog, so
 * their counts add up to All: an event is an Event whatever kind it was
 * created as, because at the counter what matters is that it carries its own
 * date and seat cap. Hidden is a SECOND axis (an off-storefront product can be
 * any kind) — it is a chip here because "the counter-only SKUs" is the
 * front desk's most common one-tap ask, not because it is a kind.
 *
 * Booking listings never reach the counter (`listForCounter` drops them), so
 * there is no Bookings chip.
 */
export type CounterCatalogFilter =
	| "all"
	| "products"
	| "services"
	| "events"
	| "hidden";

export type CounterFilterRow = {
	kind?: string;
	event?: unknown;
	hidden?: boolean;
};

export const COUNTER_CATALOG_FILTERS: ReadonlyArray<{
	id: CounterCatalogFilter;
	label: string;
	/** Lower-case plural for sentences — "No services match …". */
	noun: string;
	/** Why the chip is disabled when nothing is in it. */
	emptyReason: string;
}> = [
	{ id: "all", label: "All", noun: "products", emptyReason: "" },
	{
		id: "products",
		label: "Products",
		noun: "products",
		emptyReason: "No products yet",
	},
	{
		id: "services",
		label: "Services",
		noun: "services",
		emptyReason: "No services yet",
	},
	{
		id: "events",
		label: "Events",
		noun: "events",
		emptyReason: "No events yet",
	},
	{
		id: "hidden",
		label: "Hidden",
		noun: "hidden products",
		emptyReason: "No hidden products — every product is on your storefront",
	},
];

export function matchesCounterFilter(
	row: CounterFilterRow,
	filter: CounterCatalogFilter,
): boolean {
	switch (filter) {
		case "all":
			return true;
		case "hidden":
			return row.hidden === true;
		case "events":
			return row.event !== undefined;
		case "services":
			return row.event === undefined && effectiveKind(row.kind) === "service";
		case "products":
			return row.event === undefined && effectiveKind(row.kind) !== "service";
	}
}

export function counterFilterCounts(
	rows: readonly CounterFilterRow[],
): Record<CounterCatalogFilter, number> {
	const counts: Record<CounterCatalogFilter, number> = {
		all: 0,
		products: 0,
		services: 0,
		events: 0,
		hidden: 0,
	};
	for (const row of rows) {
		for (const { id } of COUNTER_CATALOG_FILTERS) {
			if (matchesCounterFilter(row, id)) counts[id] += 1;
		}
	}
	return counts;
}

/**
 * Does the chip row narrow anything? Only when some chip holds part of the
 * catalog — a store selling nothing but physical goods would otherwise carry
 * a row whose every live chip shows exactly what All shows.
 */
export function counterFilterIsUseful(
	counts: Record<CounterCatalogFilter, number>,
): boolean {
	return COUNTER_CATALOG_FILTERS.some(
		({ id }) => id !== "all" && counts[id] > 0 && counts[id] < counts.all,
	);
}

/**
 * The chip actually applied. A chip whose last item left the catalog (a
 * product un-hidden in another tab) falls back to All rather than leaving the
 * seller on an empty list behind a disabled chip — derived, never synced.
 */
export function effectiveCounterFilter(
	picked: CounterCatalogFilter,
	counts: Record<CounterCatalogFilter, number>,
): CounterCatalogFilter {
	return picked !== "all" && counts[picked] === 0 ? "all" : picked;
}

/** The empty-result line — names the chip AND the search when both apply. */
export function counterFilterEmptyMessage(
	filter: CounterCatalogFilter,
	query: string,
): string {
	const q = query.trim();
	const noun =
		COUNTER_CATALOG_FILTERS.find((f) => f.id === filter)?.noun ?? "products";
	if (filter === "all") return q ? `No products match “${q}”.` : "No products.";
	return q ? `No ${noun} match “${q}”.` : `No ${noun}.`;
}
