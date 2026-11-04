// The admin seller directory's filter language — ONE author for the server
// and the page. `adminSellers.listSellersPage` applies these predicates to
// each raw retailer page before it builds a row, `adminSellers.countSellerBuckets`
// tallies the same predicates over the whole book, and the page reads the
// labels, the groups and the URL guards from here. Before pagination the page
// filtered a 500-row list in the browser; moving the filter server-side without
// moving its definition would have made the chip counts and the list disagree
// the first time one side changed.
//
// Pure: no Convex function module, no env read. `ownerIsAdmin` (an env list)
// is computed by the caller and passed in as a fact.

/** The status chips. `none` = no subscription row at all; `unclaimed` = a
 * pre-built store waiting for its vendor (docs/prebuilt-stores.md). */
export type SellerBucket =
	| "unclaimed"
	| "past_due"
	| "trialing"
	| "active"
	| "on_hold"
	| "cancelled"
	| "comped"
	| "admin"
	| "none";

export type SellerFilter =
	| "all"
	| SellerBucket
	| "wants_enterprise"
	| "unavailable"
	| "untagged_payers";

/** Menu order. Past due sits first after All — it is the urgent bucket, and
 * an urgent filter never sits last (CLAUDE.md, "own the structure"). The
 * front group is every bucket where KEDAIPAL owes someone an action (chase a
 * payment, finish a handover, answer an Enterprise ask, check a paused store,
 * tag a payer); the back group describes a seller's own billing state. */
export const SELLER_FILTERS: readonly SellerFilter[] = [
	"all",
	"past_due",
	"unclaimed",
	"wants_enterprise",
	"unavailable",
	"untagged_payers",
	"trialing",
	"active",
	"on_hold",
	"cancelled",
	"comped",
	"admin",
	"none",
];

/** The Status menu's two sections, in order. Every filter but `all` appears
 * in exactly one (pinned by adminSellerFilters.test.ts). */
export const SELLER_FILTER_GROUPS: ReadonlyArray<{
	heading: string;
	filters: readonly Exclude<SellerFilter, "all">[];
}> = [
	{
		heading: "Needs your action",
		filters: [
			"past_due",
			"unclaimed",
			"wants_enterprise",
			"unavailable",
			"untagged_payers",
		],
	},
	{
		heading: "By subscription",
		filters: [
			"trialing",
			"active",
			"on_hold",
			"cancelled",
			"comped",
			"admin",
			"none",
		],
	},
];

export const SELLER_FILTER_LABEL: Record<SellerFilter, string> = {
	all: "All sellers",
	past_due: "Past due",
	unclaimed: "Unclaimed",
	trialing: "Trialing",
	active: "Active",
	on_hold: "On hold",
	cancelled: "Cancelled",
	comped: "Comped",
	admin: "Admin",
	none: "No subscription",
	wants_enterprise: "Wants Enterprise",
	unavailable: "Paused / offline",
	untagged_payers: "Untagged payers",
};

/** Filters whose count is a to-do for Kedaipal, so a non-zero count is drawn
 * in the attention tone (amber) wherever counts show. */
export const ATTENTION_FILTERS: ReadonlySet<SellerFilter> = new Set<SellerFilter>([
	"past_due",
	"untagged_payers",
]);

/** The empty state's noun for a filter — "No {noun}{ match …}". The menu
 * label lowercased works for the status buckets ("past due sellers") and
 * falls apart for the lead filter ("wants enterprise sellers"), so the phrase
 * is owned here beside the labels. */
export function sellerFilterEmptyNoun(filter: SellerFilter): string {
	if (filter === "all") return "sellers";
	if (filter === "wants_enterprise") return "open Enterprise asks";
	if (filter === "unavailable") return "paused or offline stores";
	if (filter === "untagged_payers") return "untagged payers";
	return `${SELLER_FILTER_LABEL[filter].toLowerCase()} sellers`;
}

export function isSellerFilter(value: unknown): value is SellerFilter {
	return (
		typeof value === "string" &&
		(SELLER_FILTERS as readonly string[]).includes(value)
	);
}

/**
 * The facts a filter decision needs — deliberately narrow, so the server can
 * decide a filter from a retailer doc plus ONE subscription read (and, for two
 * filters, one more cheap probe) before paying the ~10 reads a full
 * `AdminSellerRow` costs. A full row satisfies this shape structurally through
 * `sellerFactsOf` in `src/lib/admin-seller-view.ts`.
 */
export interface SellerFacts {
	unclaimed: boolean;
	ownerIsAdmin: boolean;
	comped: boolean;
	subscriptionStatus: SellerBucket | undefined;
	enterpriseInterestAt: number | undefined;
	hasEnterpriseContract: boolean;
	availabilityState: "open" | "paused" | "offline";
	hasPaidInvoice: boolean;
	acquisitionSetBy: "admin" | "seller" | undefined;
}

/** Which bucket a store belongs to. Admin and comped outrank the raw status —
 * both are "never billed", so their subscription status is not the story.
 *
 * Unclaimed outranks BOTH, and must: a pre-built store runs on an `internal`
 * comp while it is being built, so filing it under "Comped" would hide every
 * half-finished handover inside the sponsored-deals bucket and show the admin
 * a store that reads as live. "Nobody owns this yet" is the only fact about it
 * that matters. */
export function sellerBucket(facts: SellerFacts): SellerBucket {
	if (facts.unclaimed) return "unclaimed";
	if (facts.ownerIsAdmin) return "admin";
	if (facts.comped) return "comped";
	return facts.subscriptionStatus ?? "none";
}

/** A store that has paid Kedaipal and has no admin-confirmed acquisition
 * channel (86eye3eyp) — CAC can't count it. A seller's own onboarding answer
 * doesn't clear it: it's a claim until confirmed. Admin stores never pay. */
export function isUntaggedPayer(facts: SellerFacts): boolean {
	return (
		facts.hasPaidInvoice &&
		!facts.ownerIsAdmin &&
		facts.acquisitionSetBy !== "admin"
	);
}

/** An OPEN Enterprise lead: the owner asked and nobody has answered — no
 * contract attached, not dismissed. A store already on a contract never
 * counts, whatever stale stamp a row might carry. */
export function isEnterpriseLead(facts: SellerFacts): boolean {
	return facts.enterpriseInterestAt !== undefined && !facts.hasEnterpriseContract;
}

export function passesSellerFilter(
	facts: SellerFacts,
	filter: SellerFilter,
): boolean {
	switch (filter) {
		case "all":
			return true;
		case "wants_enterprise":
			return isEnterpriseLead(facts);
		case "unavailable":
			return facts.availabilityState !== "open";
		case "untagged_payers":
			return isUntaggedPayer(facts);
		default:
			return sellerBucket(facts) === filter;
	}
}

export type SellerBucketCounts = Record<SellerFilter, number>;

export function emptySellerBucketCounts(): SellerBucketCounts {
	return {
		all: 0,
		past_due: 0,
		unclaimed: 0,
		trialing: 0,
		active: 0,
		on_hold: 0,
		cancelled: 0,
		comped: 0,
		admin: 0,
		none: 0,
		wants_enterprise: 0,
		unavailable: 0,
		untagged_payers: 0,
	};
}

/** Add one store's facts to a running tally — the orthogonal filters
 * (`wants_enterprise`, `unavailable`, `untagged_payers`) count on top of the
 * store's bucket, so the numbers across a group never sum to `all`. Returns a
 * new object; the caller threads it. */
export function tallySellerFacts(
	counts: SellerBucketCounts,
	facts: SellerFacts,
): SellerBucketCounts {
	const bucket = sellerBucket(facts);
	return {
		...counts,
		all: counts.all + 1,
		[bucket]: counts[bucket] + 1,
		wants_enterprise: counts.wants_enterprise + (isEnterpriseLead(facts) ? 1 : 0),
		unavailable: counts.unavailable + (facts.availabilityState !== "open" ? 1 : 0),
		untagged_payers: counts.untagged_payers + (isUntaggedPayer(facts) ? 1 : 0),
	};
}

// --- Sort ---------------------------------------------------------------

/** Only sorts an index can serve: the list is paginated by cursor, so a sort
 * is an index order or it is nothing. `expiry` and `credits` (derived from the
 * subscription and credit tables per row) were retired with pagination; the
 * Past due and Trialing filters answer "who lapses next". */
export type SellerSort = "founding" | "newest" | "name";

export const SELLER_SORTS: ReadonlyArray<{ key: SellerSort; label: string }> = [
	{ key: "founding", label: "Founding rank" },
	{ key: "newest", label: "Newest store" },
	{ key: "name", label: "Name A–Z" },
];

/** A literal, not a `SellerSort`, so `next === DEFAULT_SELLER_SORT` narrows
 * the URL type (`Exclude<SellerSort, "founding">`) at the call site. */
export const DEFAULT_SELLER_SORT = "founding" as const satisfies SellerSort;

export function isSellerSort(value: unknown): value is SellerSort {
	return SELLER_SORTS.some((s) => s.key === value);
}

// --- Search -------------------------------------------------------------

/** What the search reads off a store: name, slug, every email it has (the
 * owner's, and the handover address — a pre-built store has no owner email at
 * all, so the address an admin was given has to find it), and both phones. */
export interface SellerSearchFields {
	storeName: string;
	slug: string;
	emails: ReadonlyArray<string | undefined>;
	phones: ReadonlyArray<string | undefined>;
}

/** Substring match on name, slug and emails; a query with three or more
 * digits is also matched against the stored phone digits, so "0123" or
 * "+60 12" finds the number however it was typed. Zero extra reads: every
 * field lives on the retailer doc, which is why the server can run this over
 * a raw page before building rows. */
export function matchesSellerSearch(
	fields: SellerSearchFields,
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	const text = [fields.storeName, fields.slug, ...fields.emails]
		.map((s) => s ?? "")
		.join(" ")
		.toLowerCase();
	if (text.includes(needle)) return true;
	const digits = needle.replace(/\D/g, "");
	if (digits.length < 3) return false;
	return fields.phones.some(
		(p) => p?.replace(/\D/g, "").includes(digits) === true,
	);
}
