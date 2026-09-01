// The order-inbox filter, extracted as a pure predicate so the live inbox
// (`searchOrders`) and the CSV export (`exportOrders`) apply EXACTLY the same
// rules — a single source of truth that can't drift between "what the seller
// sees" and "what they export". No Convex imports; unit-tested directly. See
// docs/order-inbox.md + docs/invoices-receipts.md.

import { attributionBucket } from "./attribution";
import {
	type BookingPeriod,
	matchesAnyBookingPeriod,
} from "./bookingPeriod";
import { matchesFulfilmentWindow } from "./fulfilmentDate";
import { type OrderBucket, orderBucket, type OrderStatus } from "./orderBuckets";
import {
	type CsvOrder,
	ORDER_COLUMNS,
	orderColumnDisplay,
} from "./orderCsv";

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
		// BOTH the stored value and the on-screen wording, where they differ
		// (86eyrtz74). A seller typing "storefront" is reading the column; one
		// typing "received" may be reading an old export or a colleague's note.
		// Indexing both means neither guess comes back empty.
		for (const text of new Set([column.value(o), orderColumnDisplay(column, o)])) {
			if (text !== "") out += `${text.toLowerCase()}\n`;
		}
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
 * Excluded on purpose: `searchText` (blank is not a search); `pinMode`, because
 * pinning is all-tier in every one of its modes — a Starter who can pin but
 * can't ask to see only their pins would be paywalled out of the feature's
 * point; and `bookingPeriods`, all-tier because BOOKING is — S4 put the seller
 * calendar deliberately outside this same gate, and a store that gets a free
 * calendar but must pay to ask "who is here right now" is incoherent. It cannot
 * be used to dodge the gate either: a period only ever matches an order carrying
 * a booking span, so on a product inbox it returns nothing.
 */
const NARROWING_FILTER_KEYS: Record<
	Exclude<keyof InboxFilterArgs, "searchText" | "pinMode" | "bookingPeriods">,
	true
> = {
	buckets: true,
	paymentStatuses: true,
	paymentMethods: true,
	methodUnspecified: true,
	dateFrom: true,
	dateTo: true,
	fulfilmentWindow: true,
	mockupPending: true,
	statuses: true,
	categories: true,
	categoriesUnspecified: true,
	sources: true,
	attributionSources: true,
};

/** True when these args ask for anything beyond "the newest orders, unfiltered"
 * — i.e. when the seller is using a gated inbox surface. */
export function narrowsTheInbox(args: InboxFilterArgs): boolean {
	if ((args.searchText ?? "").trim().length > 0) return true;
	return Object.keys(NARROWING_FILTER_KEYS).some((key) => {
		const value = args[key as keyof InboxFilterArgs];
		// An empty array narrows nothing (the predicate treats it as "no filter"),
		// so it must not trip the Pro gate either — the two answer one question.
		if (Array.isArray(value)) return value.length > 0;
		// Same rule for the boolean flags: every one of them is read as
		// `=== true` by the predicate, so an explicit `false` narrows nothing and
		// must not gate. Without this the gate is stricter than the filter it
		// claims to describe, and a client that sends `false` instead of omitting
		// the field gets a paywall for a filter that is switched off.
		if (typeof value === "boolean") return value;
		return value !== undefined;
	});
}

/** True when the order carries no frozen category names at all — either
 * recorded as empty, or predating the field. Both read as blank on screen, so
 * both are "uncategorized" to a seller. */
function hasNoCategories(o: CsvOrder): boolean {
	for (const item of o.items) {
		if ((item.categoryNames ?? []).length > 0) return false;
	}
	return true;
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
	/**
	 * Workflow buckets to keep — MULTI since 86eyrtz74 (was one `bucket` with an
	 * "all" sentinel). "Completed or Cancelled" — everything closed — is a real
	 * question the single value could not ask, and every other enumerable filter
	 * on the inbox is already a multi-select, so a seller who has learnt "tap
	 * several chips" everywhere else expects it here too. Empty or undefined =
	 * every bucket, which retires the "all" sentinel from this shape entirely
	 * (the wire still accepts the old singular; see `toInboxFilterArgs`).
	 */
	buckets?: OrderBucket[];
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
	/**
	 * Keep orders whose lines carry NO frozen categories (86eyrtz74) — the exact
	 * twin of `methodUnspecified`, and there for the same reason.
	 *
	 * Without it, "select every category" silently drops every uncategorized
	 * order, because `matchesAnyCategory` can only ever match a name. Categories
	 * are optional, so a partially-categorized catalogue is the COMMON case, not
	 * an edge one — and the panel was telling the seller that selecting them all
	 * changed nothing while their list quietly shrank.
	 */
	categoriesUnspecified?: boolean;
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
	/**
	 * Where a booking sits in TIME (S8) — active, ending soon, upcoming, ended.
	 *
	 * **ORs with `buckets`, in ONE flat set** (owner call, 1 Sep). These two
	 * fields are separate on the wire only because they are computed from
	 * different data — a bucket from `status`, a period from the booking span —
	 * but to the seller they are one row of status chips, and "In progress +
	 * Active now" means *either*, exactly like "New + Completed" does.
	 *
	 * It shipped first as a separate AND dimension, on the reasoning that
	 * buckets are a partition (every order in exactly one, so the counts sum)
	 * while an active booking is *simultaneously* `in_progress`. That reasoning
	 * is sound about the data and wrong about the product: it produced a chip row
	 * where two visually identical chips combined by different rules, an "All"
	 * that stayed lit while a booking chip narrowed the list, and — once "no
	 * status" existed — a chip reading `1` above an empty list. A distinction the
	 * seller cannot see is not a distinction worth having.
	 *
	 * The partition property survives where it is actually load-bearing: the
	 * COUNTS are still per-chip tallies over the full window, which under a union
	 * is exactly the honest reading ("this is what tapping me adds").
	 *
	 * Non-bookings and cancelled bookings never match — see
	 * `matchesBookingPeriod` for why those exclusions live in the predicate
	 * rather than being left to compose.
	 */
	bookingPeriods?: BookingPeriod[];
	searchText?: string;
	/**
	 * What the seller's pins do to this list (86eyrtz74, extended 1 Sep):
	 *
	 * - `"top"` (default) — a pinned order is kept even if it fails every other
	 *   rule. Sellers pin an order so they can then filter to something else and
	 *   compare against it, so the pin has to survive the filter or the feature
	 *   does nothing for its main use.
	 * - `"off"` — pins are filtered like any other order, for when they want a
	 *   filter that means exactly what it says.
	 * - `"only"` — show ONLY pinned orders. Deliberately still ANDs with every
	 *   other filter rather than short-circuiting them: "pinned + New" is a
	 *   sensible question, and a mode that silently ignored the lit status chips
	 *   would leave them on screen asserting something false.
	 *
	 * One field rather than two booleans, so `{off, only}` can't both be set.
	 * Applied by `buildInboxPredicate` so the live inbox and the export can't
	 * diverge (the invariant this module exists for).
	 */
	pinMode?: PinMode;
};

/** See `InboxFilterArgs.pinMode`. */
export type PinMode = "top" | "off" | "only";

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
	/** Booking span (S8) — the period filter's inputs. Deliberately NOT on
	 * `CsvOrder`: the inbox filters on these, the table and the export don't
	 * render them, and widening the column registry for a filter would put a
	 * column on every seller's export to serve a chip. */
	bookingCheckIn?: number;
	bookingCheckOut?: number;
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
	/** Sampled ONCE per build, not per order: a list evaluated across midnight
	 * must not classify its first rows against one day and its last against the
	 * next. Injected for the same reason `matchesFulfilmentWindow` takes it. */
	now: number = Date.now(),
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
	const bucketSet =
		args.buckets && args.buckets.length > 0 ? new Set(args.buckets) : null;
	const statusSet =
		args.statuses && args.statuses.length > 0 ? new Set(args.statuses) : null;
	const categorySet =
		args.categories && args.categories.length > 0
			? new Set(args.categories)
			: null;
	const wantUncategorized = args.categoriesUnspecified === true;
	// `Set<string>`, not `Set<OrderSource>`: `CsvOrder.source` is a plain string
	// (the CSV shape predates the union) and a legacy row can hold anything.
	const sourceSet =
		args.sources && args.sources.length > 0
			? new Set<string>(args.sources)
			: null;
	const periodList =
		args.bookingPeriods && args.bookingPeriods.length > 0
			? args.bookingPeriods
			: null;
	const pinMode = args.pinMode ?? "top";
	return (o) => {
		// "Only pinned" is a narrowing gate, so it runs before everything and then
		// falls through to the rest of the filters — see InboxFilterArgs.pinMode.
		if (pinMode === "only" && o.pinnedAt === undefined) return false;
		// Pin privilege short-circuits EVERY rule below (86eyrtz74).
		if (pinMode === "top" && o.pinnedAt !== undefined) return true;
		// ONE flat status set: workflow buckets and booking periods OR together
		// (owner call, 1 Sep — see InboxFilterArgs.bookingPeriods). Same shape as
		// the category arm below, and for the same reason: two ways of naming a
		// member of one set must not become an intersection.
		//
		// Bucket membership goes through the same seen-aware resolver the counts
		// use, so the chip count and the list can't disagree: an unseen push-path
		// order shows under "New" and NOT under "In progress" (86eyf1rck).
		if (bucketSet || periodList) {
			const byBucket = bucketSet ? bucketSet.has(orderBucket(o)) : false;
			const byPeriod = periodList
				? matchesAnyBookingPeriod(o, periodList, now)
				: false;
			if (!byBucket && !byPeriod) return false;
		}
		if (args.mockupPending && !needsMockup(o.mockupStatus)) return false;
		if (statusSet && !statusSet.has(o.status)) return false;
		// Category filter — the same shape as the method filter below: the named
		// set ORs with the "none recorded" arm, so selecting every category plus
		// Uncategorized genuinely matches every order.
		if (categorySet || wantUncategorized) {
			const byCategory = categorySet
				? matchesAnyCategory(o, categorySet)
				: false;
			const byUncategorized = wantUncategorized && hasNoCategories(o);
			if (!byCategory && !byUncategorized) return false;
		}
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
