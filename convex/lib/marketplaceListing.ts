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
 * `Doc<"retailers">` so the rule is testable without a database. */
export interface MarketplaceListableRow {
	marketplaceUnlistedAt?: number;
	purgeStartedAt?: number;
}

/**
 * Row-level listable rule: may this store appear on /stores at all?
 *
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
