/**
 * Which storefronts search engines are told about (z8r3fdh2ye) — ONE rule,
 * read by the sitemap queries, the storefront's `robots` meta and the
 * directory, so the index and the sitemap can never disagree.
 *
 * A storefront is indexable when a buyer can actually order from it:
 *   - it has an owner (an unclaimed pre-built store is nobody's shop yet),
 *   - Kedaipal has not taken it offline (the page is a noindex "unavailable"
 *     screen — see `storeAvailability`),
 *   - its subscription is not cancelled (a churned store still serves 200;
 *     keeping it in the index spends kedaipal.com's authority on a page that
 *     can't sell),
 *   - it lists at least one storefront-visible product (an empty storefront
 *     is a thin page, the kind that drags the whole domain's quality).
 *
 * Deliberately INCLUDED: `trialing` (live and selling), `past_due` (the
 * store still works while dunning runs) and `on_hold` (ordering paused, but
 * the catalogue is live and the page is valid — the audit called this one;
 * a paused banner over a real catalogue is not a dead page). The seller's
 * own "Accepting orders" pause is the same: a real store that is closed
 * today is still the store Google should know about.
 */

export type SubscriptionStatusForIndex =
	| "trialing"
	| "active"
	| "past_due"
	| "cancelled"
	| "on_hold";

export interface StorefrontIndexFacts {
	unclaimed: boolean;
	offline: boolean;
	/** `null` when the store has no subscription row at all — a pre-billing
	 * store is treated as live, the same as the order doors treat it. */
	subscriptionStatus: SubscriptionStatusForIndex | null;
	visibleProductCount: number;
}

export function storefrontIndexable(facts: StorefrontIndexFacts): boolean {
	if (facts.unclaimed) return false;
	if (facts.offline) return false;
	if (facts.subscriptionStatus === "cancelled") return false;
	return facts.visibleProductCount > 0;
}

/**
 * The sitemap's `lastmod` for a store: the most recent of the store's own
 * last write and its newest product write. The creation time never moves,
 * and a `lastmod` that never moves teaches Google the field means nothing.
 */
export function storefrontLastmod(args: {
	retailerUpdatedAt: number;
	productUpdatedAts: readonly number[];
}): number {
	return Math.max(args.retailerUpdatedAt, ...args.productUpdatedAts);
}
