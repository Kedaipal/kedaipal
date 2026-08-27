// The order-inbox filter, extracted as a pure predicate so the live inbox
// (`searchOrders`) and the CSV export (`exportOrders`) apply EXACTLY the same
// rules — a single source of truth that can't drift between "what the seller
// sees" and "what they export". No Convex imports; unit-tested directly. See
// docs/order-inbox.md + docs/invoices-receipts.md.

import { attributionBucket } from "./attribution";
import { matchesFulfilmentWindow } from "./fulfilmentDate";
import { orderBucket, type OrderStatus } from "./orderBuckets";

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
};

/** The order fields the predicate reads. A structural subset of Doc<"orders">. */
export type FilterableOrder = {
	status: OrderStatus;
	/** Seen-state, for the "New" bucket on push-path orders (86eyf1rck). */
	seenAt?: number;
	confirmationPushStatus?: string;
	mockupStatus?: string;
	paymentStatus?: "unpaid" | "claimed" | "received";
	paymentMethod?: string;
	source?: "storefront" | "counter" | "claim";
	attributionSource?: string;
	createdAt: number;
	fulfilmentDate?: number;
	shortId: string;
	customer: { name?: string; waPhone?: string };
	items: Array<{ name: string; variantLabel?: string }>;
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
	return (o) => {
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
			const name = (o.customer.name ?? "").toLowerCase();
			const phone = (o.customer.waPhone ?? "").replace(/\D/g, "");
			const idHit = o.shortId.toLowerCase().includes(term);
			const nameHit = name.length > 0 && name.includes(term);
			// Phone: match on trailing digits (handles +60 / 0 / local-part typing).
			const phoneHit = digits.length >= 4 && phone.endsWith(digits);
			const itemHit = o.items.some(
				(it) =>
					it.name.toLowerCase().includes(term) ||
					(it.variantLabel ?? "").toLowerCase().includes(term),
			);
			if (!idHit && !nameHit && !phoneHit && !itemHit) return false;
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
 */
export function sortInboxOrders<T extends { fulfilmentDate?: number }>(
	orders: readonly T[],
	sort: InboxSort,
): T[] {
	return sort === "due" ? [...orders].sort(compareInboxOrder) : [...orders];
}
