/**
 * Marketplace listing rules (z8r3fdkmyp) — the ONE author for who appears on
 * the public store directory at kedaipal.com/stores, and for the seller-typed
 * `storeArea` card field.
 *
 * Pure — no Convex imports — so the client bundle (settings card, live
 * counters) and the unit tests load it directly, same pattern as
 * `storeProfile.ts`. The one check that needs the database (≥1 storefront-
 * visible product) lives beside the query in `convex/marketplace.ts`; this
 * module owns every row-level rule so the tests can attack them one by one.
 */

/**
 * Card area cap ("Ampang, KL", "Ships nationwide"). Short by design: it is a
 * meta line on a card, not an address — and the card truncates rather than
 * wraps, so anything long would be cut mid-word anyway.
 */
export const STORE_AREA_MAX = 40;

/**
 * The area exactly as the server will store it: one line, inner runs of
 * whitespace collapsed, ends trimmed. Exported so the settings form compares
 * and re-displays the SAVED shape — otherwise "Ampang,   KL" saves as
 * "Ampang, KL" and the form keeps reading as unsaved.
 */
export function collapseStoreArea(input: string): string {
	return input.replace(/\s+/g, " ").trim();
}

/**
 * Collapse (above), treat blank as "clear", reject over-cap input. Mirrors
 * `sanitizeStoreDescription`'s posture: undefined means the field should be
 * UNSET, so an empty area never renders a bare dot separator on the card.
 */
export function sanitizeStoreArea(input: string): string | undefined {
	const collapsed = collapseStoreArea(input);
	if (collapsed.length === 0) return undefined;
	if (collapsed.length > STORE_AREA_MAX) {
		throw new Error(`Area exceeds ${STORE_AREA_MAX} characters`);
	}
	return collapsed;
}

/** The row-level facts the listable rule reads — a structural subset of
 * `Doc<"retailers">` so the rule is testable without a database. `internal`
 * is resolved by the caller (`isInternalStore`): it needs the admin
 * allowlist, which is server-only. */
export interface MarketplaceListableRow {
	marketplaceUnlistedAt?: number;
	purgeStartedAt?: number;
	internal: boolean;
}

/**
 * Comp kinds that join Store highlights automatically (Zaki, 1 Oct 2026): a
 * store Kedaipal is already backing — a partner, a sponsored seller, a pilot —
 * gets the rail for as long as the comp lasts, no separate admin step. NOT
 * `internal`: an internal comp is our own or a test store, which is never
 * listed at all (`isInternalStore`).
 */
export const HIGHLIGHT_COMP_KINDS = ["partner", "sponsor", "pilot"] as const;

/**
 * Is this store Kedaipal's own or a test store? One author for the directory
 * and the admin console. Reuses the founder report's exclusion
 * (`isExcludedRetailer`: admin-owned, internal email fragments, the
 * `EXCLUDED_SLUGS` escape hatch) and adds the `internal` comp kind — an admin
 * labelling a store internal is the most explicit signal there is.
 */
export function isInternalStore(
	excludedByReport: boolean,
	compKind: string | undefined,
): boolean {
	return excludedByReport || compKind === "internal";
}

/**
 * Why a store rides Store highlights, or `null` when it doesn't. ONE author for
 * the buyer rail (convex/marketplace.ts) and every admin surface (pill, menu,
 * dialog, sheet), so the console can never disagree with the page.
 *
 * - `"paid"` — an admin-set window that hasn't ended (read-time expiry).
 * - `"comp"` — comped as a highlight kind and not switched off by an admin.
 *   Derived, never written: revoking the comp takes the store off the rail
 *   with nothing to clean up, which a far-future window could not do.
 *
 * A paid window wins: it's an explicit, dated act, and outlives the switch.
 */
export function highlightSource(
	facts: {
		sponsoredUntil?: number;
		comped: boolean;
		compKind?: string;
		compHighlightOffAt?: number;
	},
	now: number,
): "paid" | "comp" | null {
	if (sponsorshipActive(facts.sponsoredUntil, now)) return "paid";
	if (
		facts.comped &&
		(HIGHLIGHT_COMP_KINDS as readonly string[]).includes(facts.compKind ?? "") &&
		facts.compHighlightOffAt === undefined
	) {
		return "comp";
	}
	return null;
}

/** Comped as a highlight kind — the stores the admin's "feature while
 * comped" switch applies to (on or off). */
export function compHighlightEligible(
	comped: boolean,
	compKind: string | undefined,
): boolean {
	return (
		comped &&
		(HIGHLIGHT_COMP_KINDS as readonly string[]).includes(compKind ?? "")
	);
}

/**
 * Row-level listable rule: may this store appear on /stores at all?
 *
 * - `internal` — Kedaipal's own or a test store (`isInternalStore`). Never on
 *   a public page: prod held three such stores with live products when the
 *   directory shipped (kp-demo, openmarket, deqly-cards).
 * - `marketplaceUnlistedAt` set — the seller opted out. Listed is the default
 *   (the storefront is already a public URL; the directory is distribution),
 *   but an opt-out is absolute and needs no other reason.
 * - `purgeStartedAt` set — the erasure cascade is running; nothing about the
 *   store should gain NEW surface area while it is being deleted.
 *
 * Billing state is deliberately NOT here: the storefront itself never hides
 * on subscription state (convex/subscriptions.ts invariant), and the
 * directory follows the storefront. An `on_hold` store lists as browse-only,
 * exactly as its own page behaves. The remaining gate — the store actually
 * has something a buyer can see (≥1 storefront-visible product) — needs the
 * products table and lives in `convex/marketplace.ts`.
 */
export function isListableRow(row: MarketplaceListableRow): boolean {
	if (row.internal) return false;
	if (row.marketplaceUnlistedAt !== undefined) return false;
	if (row.purgeStartedAt !== undefined) return false;
	return true;
}

/**
 * "New" window for the card chip + the New-this-month filter: a store whose
 * row was created within the last 30 days. Creation, not activation — a
 * stocked store that hasn't taken its first order yet is exactly the one the
 * chip should introduce.
 */
export const NEW_STORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function isNewStore(createdAt: number, now: number): boolean {
	return now - createdAt <= NEW_STORE_WINDOW_MS;
}

/** Is a sponsorship window live? Read-time expiry — no cron ever clears the
 * field, so the ONE comparison must be shared by the query, the admin
 * console's state label, and the tests. */
export function sponsorshipActive(
	sponsoredUntil: number | undefined,
	now: number,
): boolean {
	return sponsoredUntil !== undefined && sponsoredUntil > now;
}
