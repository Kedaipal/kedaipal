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
 * One column can't participate: `Categories (current)` is resolved from the
 * junction table at export time and isn't on the order document, so it renders
 * blank here. Searching by category would mean a per-product fan-out on every
 * keystroke across the whole scan window — the Insights/category surfaces are
 * the right place for that question.
 */
function searchHaystack(o: CsvOrder): string {
	let out = "";
	for (const column of ORDER_COLUMNS) {
		const text = column.value(o);
		if (text !== "") out += `${text.toLowerCase()}\n`;
	}
	return out;
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
	// Checkout surface: "storefront" (public web / wa.me) vs "counter" (walk-in).
	// Legacy orders with no stamped source read as "storefront". Undefined = no
	// source filtering. See orders.source in convex/schema.ts.
	source?: "storefront" | "counter" | "claim";
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
		// Source filter — legacy/undefined source reads as "storefront".
		if (args.source !== undefined && (o.source ?? "storefront") !== args.source)
			return false;
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
