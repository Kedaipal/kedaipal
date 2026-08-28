// The order-inbox filter, extracted as a pure predicate so the live inbox
// (`searchOrders`) and the CSV export (`exportOrders`) apply EXACTLY the same
// rules — a single source of truth that can't drift between "what the seller
// sees" and "what they export". No Convex imports; unit-tested directly. See
// docs/order-inbox.md + docs/invoices-receipts.md.

import { attributionBucket } from "./attribution";
import { matchesFulfilmentWindow } from "./fulfilmentDate";
import { orderBucket, type OrderStatus } from "./orderBuckets";
import { type CsvOrder, ORDER_COLUMNS } from "./orderCsv";

/**
 * Every column's rendered text for one order, lowercased and joined — the
 * haystack free-text search runs against (86eyrtz74).
 *
 * Built from the SAME registry the table renders and the CSV writes, so a
 * seller can search anything they can see. Built lazily (only when there IS a
 * term) because it allocates ~36 strings per order.
 *
 * Every column participates, categories included — they are frozen onto the
 * order at checkout, so no lookup is needed. Sellers who want the precise
 * version of a column question reach for that column's header filter instead;
 * this is the "I half-remember something about this order" path.
 */
function searchHaystack(o: CsvOrder): string {
	let out = "";
	for (const column of ORDER_COLUMNS) {
		const text = column.value(o);
		if (text !== "") out += `${text.toLowerCase()}\n`;
	}
	return out;
}

/**
 * Every arg that NARROWS the list, as a key set the compiler forces you to keep
 * complete: adding a field to `InboxFilterArgs` fails this object to typecheck
 * until it is listed here too.
 *
 * It exists because the Pro gate in `searchOrders` decides "is this seller using
 * the paid inbox surfaces?" by asking whether any filter is set, and that was a
 * hand-maintained list. It silently failed OPEN the moment three filters were
 * added without touching it (86eyrtz74) — a gate that quietly stops guarding is
 * worse than no gate, because nothing looks wrong.
 *
 * Excluded on purpose: `bucket` (its "all" default isn't a narrowing, so it's
 * compared rather than presence-checked), `searchText` (blank is not a search),
 * and `showPinned`, which WIDENS the result and is all-tier because pinning is.
 */
const NARROWING_FILTER_KEYS: Record<
	Exclude<keyof InboxFilterArgs, "bucket" | "searchText" | "showPinned">,
	true
> = {
	paymentStatuses: true,
	paymentMethods: true,
	methodUnspecified: true,
	dateFrom: true,
	dateTo: true,
	fulfilmentWindow: true,
	mockupPending: true,
	statuses: true,
	categories: true,
	sources: true,
	attributionSources: true,
};

/** True when these args ask for anything beyond "the newest orders, unfiltered"
 * — i.e. when the seller is using a gated inbox surface. */
export function narrowsTheInbox(args: InboxFilterArgs): boolean {
	if (args.bucket !== "all") return true;
	if ((args.searchText ?? "").trim().length > 0) return true;
	return Object.keys(NARROWING_FILTER_KEYS).some(
		(key) => args[key as keyof InboxFilterArgs] !== undefined,
	);
}

/** True when any of the order's lines was sold under one of `wanted`. */
function matchesAnyCategory(o: CsvOrder, wanted: ReadonlySet<string>): boolean {
	for (const item of o.items) {
		for (const name of item.categoryNames ?? []) {
			if (wanted.has(name)) return true;
		}
	}
	return false;
}

export type InboxBucket = "all" | "new" | "in_progress" | "completed" | "cancelled";

export type InboxFilterArgs = {
	bucket: InboxBucket;
	paymentStatuses?: Array<"unpaid" | "claimed" | "received">;
	paymentMethods?: string[];
	methodUnspecified?: boolean;
	dateFrom?: number;
	dateTo?: number;
	fulfilmentWindow?: "today" | "tomorrow" | "this_week";
	mockupPending?: boolean;
	/**
	 * Exact order status (86eyrtz74), multi-select — OR within itself, AND with
	 * everything else.
	 *
	 * Deliberately a SEPARATE dimension from `bucket`, not a replacement for it.
	 * A bucket is the coarse workflow stage a seller navigates by ("what's in
	 * progress"); this is the precise state a seller *questions* ("what is packed
	 * or shipped — out of my hands but not delivered"), which no single bucket
	 * expresses. They compose: bucket narrows, statuses narrow further.
	 */
	statuses?: OrderStatus[];
	/**
	 * Category names frozen on the order's lines (86eyrtz74), multi-select. An
	 * order matches when ANY of its lines carries ANY of these names — a mixed
	 * order belongs to every category it contains, which is what "show me the
	 * cake orders" means to a seller with a cake and a drink on one ticket.
	 *
	 * Only possible because categories are frozen at checkout: a live junction
	 * lookup per order is not something a filter predicate can afford.
	 */
	categories?: string[];
	// Checkout surface: "storefront" (public web / wa.me) vs "counter" (walk-in)
	// vs "claim". Legacy orders with no stamped source read as "storefront".
	// MULTI-select since 86eyrtz74 (was one value) — "online or claim link, but
	// not counter" is a real question and a single value can't ask it. Empty or
	// undefined = no source filtering. See orders.source in convex/schema.ts.
	sources?: Array<"storefront" | "counter" | "claim">;
	// Marketing origin (86eyq0eq9) — the `attributionBucket` keys the seller
	// picked: a stamped `?src=` tag, "counter", or "direct". MULTI-select (an
	// OR within the filter, ANDed with the rest), because "how did my socials
	// do" is a question about several channels at once. Deliberately a separate
	// dimension from `source` above: that one is the checkout SURFACE
	// (storefront vs counter vs claim link), this one is where the buyer came
	// FROM. Empty or undefined = no attribution filtering.
	attributionSources?: string[];
	searchText?: string;
	/**
	 * Pin privilege (86eyrtz74). When true, a PINNED order is kept even if it
	 * fails every other rule above; when false, pins are filtered like any other
	 * order.
	 *
	 * This is deliberately not "filter to pinned only". Sellers pin an order so
	 * they can then filter the inbox to something else and compare against it —
	 * so the pin has to survive the filter, or the feature does nothing for its
	 * main use. Turning the toggle off is how they get a filter that means
	 * exactly what it says. Applied by `buildInboxPredicate` so the live inbox
	 * and the export can't diverge (the invariant this module exists for).
	 */
	showPinned?: boolean;
};

/**
 * The order fields the predicate reads. A structural subset of Doc<"orders">.
 *
 * Built on `CsvOrder` since 86eyrtz74, because **search now runs over every
 * column the seller can see** — address, courier, tracking number, payment
 * reference, note, order type, origin and the rest — not just order #, name,
 * phone and item names. One shape means the thing you can search is exactly the
 * thing the table shows and the CSV exports; a separate, narrower search shape
 * is how "why can't I find that order by its tracking number?" happens.
 */
export type FilterableOrder = CsvOrder & {
	status: OrderStatus;
	/** Seen-state, for the "New" bucket on push-path orders (86eyf1rck). */
	seenAt?: number;
	confirmationPushStatus?: string;
	mockupStatus?: string;
	paymentStatus?: "unpaid" | "claimed" | "received";
};

/** An order is awaiting the seller's mockup action. */
export function needsMockup(mockupStatus: string | undefined): boolean {
	return mockupStatus === "pending" || mockupStatus === "changes_requested";
}

/**
 * Build the inbox filter predicate from the raw filter args. All set/term
 * precomputation happens once here, so `.filter(predicate)` stays O(n) over the
 * scanned orders.
 */
export function buildInboxPredicate(
	args: InboxFilterArgs,
): (o: FilterableOrder) => boolean {
	const term = (args.searchText ?? "").trim().toLowerCase();
	const digits = term.replace(/\D/g, "");
	const payset =
		args.paymentStatuses && args.paymentStatuses.length > 0
			? new Set(args.paymentStatuses)
			: null;
	const methodSet =
		args.paymentMethods && args.paymentMethods.length > 0
			? new Set(args.paymentMethods)
			: null;
	const wantUnspecified = args.methodUnspecified === true;
	const attributionSet =
		args.attributionSources && args.attributionSources.length > 0
			? new Set(args.attributionSources)
			: null;
	const statusSet =
		args.statuses && args.statuses.length > 0 ? new Set(args.statuses) : null;
	const categorySet =
		args.categories && args.categories.length > 0
			? new Set(args.categories)
			: null;
	// `Set<string>`, not `Set<OrderSource>`: `CsvOrder.source` is a plain string
	// (the CSV shape predates the union) and a legacy row can hold anything.
	const sourceSet =
		args.sources && args.sources.length > 0
			? new Set<string>(args.sources)
			: null;
	const pinPrivilege = args.showPinned === true;
	return (o) => {
		// Pin privilege short-circuits EVERY rule below (86eyrtz74) — see
		// InboxFilterArgs.showPinned for why a pin outranks the filter.
		if (pinPrivilege && o.pinnedAt !== undefined) return true;
		// Bucket membership goes through the same seen-aware resolver the counts
		// use, so the chip count and the list can't disagree: an unseen push-path
		// order shows under "New" and NOT under "In progress" (86eyf1rck).
		if (args.bucket !== "all" && orderBucket(o) !== args.bucket) return false;
		if (args.mockupPending && !needsMockup(o.mockupStatus)) return false;
		if (statusSet && !statusSet.has(o.status)) return false;
		if (categorySet && !matchesAnyCategory(o, categorySet)) return false;
		// Source filter — legacy/undefined source reads as "storefront".
		if (sourceSet && !sourceSet.has(o.source ?? "storefront")) return false;
		// Marketing-origin filter — bucketed through the SAME resolver Insights
		// reports with (attribution.ts), so a row in the by-source breakdown and
		// the inbox it drills into can never disagree about which orders count.
		if (attributionSet && !attributionSet.has(attributionBucket(o)))
			return false;
		// Undefined paymentStatus reads as "unpaid".
		if (payset && !payset.has(o.paymentStatus ?? "unpaid")) return false;
		// Method filter (concrete methods OR "unspecified" for no recorded method).
		if (methodSet || wantUnspecified) {
			const byMethod = o.paymentMethod
				? (methodSet?.has(o.paymentMethod) ?? false)
				: false;
			const byUnspecified = !o.paymentMethod && wantUnspecified;
			if (!byMethod && !byUnspecified) return false;
		}
		if (args.dateFrom !== undefined && o.createdAt < args.dateFrom) return false;
		if (args.dateTo !== undefined && o.createdAt > args.dateTo) return false;
		if (args.fulfilmentWindow !== undefined) {
			if (o.fulfilmentDate === undefined) return false;
			if (!matchesFulfilmentWindow(o.fulfilmentDate, args.fulfilmentWindow))
				return false;
		}
		if (term.length > 0) {
			// Phone keeps its own rule: match on TRAILING digits, so "123456789"
			// finds "+60123456789" however the seller stored or typed it. Plain
			// substring matching can't do that, which is why it survives the
			// move to the column haystack.
			const phone = (o.customer.waPhone ?? "").replace(/\D/g, "");
			const phoneHit = digits.length >= 4 && phone.endsWith(digits);
			if (!phoneHit && !searchHaystack(o).includes(term)) return false;
		}
		return true;
	};
}

/**
 * The two ways the inbox can order the list:
 *   - `recent` — newest-created first (the default). Matches the mental model
 *     sellers bring from WhatsApp/Shopee/email and stops far-future orders from
 *     burying orders that just arrived.
 *   - `due` — by fulfilment date ascending (the fulfilment queue), for planning
 *     the day. Fulfilment urgency is also surfaced via the Due chips + today
 *     banner + Home strip, so this is a deliberate opt-in, not the default.
 * See docs/order-inbox.md ("Sort").
 */
export type InboxSort = "recent" | "due";

/**
 * `due`-sort comparator: fulfilment date ascending (soonest first) so the most
 * urgent orders sort to the top. Dateless orders sink to the bottom; the caller
 * must pass an already-createdAt-desc list so the stable sort keeps that as the
 * tiebreaker within each group.
 */
export function compareInboxOrder(
	a: { fulfilmentDate?: number },
	b: { fulfilmentDate?: number },
): number {
	const ad = a.fulfilmentDate;
	const bd = b.fulfilmentDate;
	if (ad === undefined && bd === undefined) return 0; // keep createdAt-desc
	if (ad === undefined) return 1; // a (dateless) after b
	if (bd === undefined) return -1; // b (dateless) after a
	return ad - bd; // both dated → soonest first
}

/**
 * Order a list for the inbox by the chosen sort. The input MUST already be
 * newest-created first (the `by_retailer` scan order) — `recent` returns that
 * order untouched, and `due` relies on it for the within-date tiebreaker (see
 * compareInboxOrder). Always returns a fresh array; never mutates the input.
 *
 * Pinned orders (86eyrtz74) are partitioned to the FRONT, with the chosen sort
 * applied independently inside each partition. It is a partition, not a sort
 * key: pinning is orthogonal to "newest" and "due", so it must not become a
 * third sort option competing with them, and every bucket/filter/sort
 * combination has to put pins on top or the feature is unreliable.
 *
 * Within the pinned group, most-recently-pinned leads under `recent` (the pin
 * you just made jumps to the top, which is the confirmation that it worked);
 * under `due` the fulfilment date wins and pinned-at is only the tiebreaker,
 * because a pinned group that ignored the due sort would be a second list
 * obeying different rules.
 */
export function sortInboxOrders<
	T extends { fulfilmentDate?: number; pinnedAt?: number },
>(orders: readonly T[], sort: InboxSort): T[] {
	const pinned: T[] = [];
	const rest: T[] = [];
	for (const o of orders) (o.pinnedAt !== undefined ? pinned : rest).push(o);
	if (pinned.length === 0) {
		return sort === "due" ? [...rest].sort(compareInboxOrder) : rest;
	}
	pinned.sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
	if (sort === "due") {
		pinned.sort(compareInboxOrder);
		rest.sort(compareInboxOrder);
	}
	return [...pinned, ...rest];
}
