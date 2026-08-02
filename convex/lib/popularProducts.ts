import { todayMytMidnight } from "./fulfilmentDate";
import { isRevenueOrder } from "./insights";

/**
 * "Popular this week" — the storefront landing's featured lead story
 * (86eybrhrt PR3). Pure ranking logic, imported by BOTH the public query
 * (`products.popularProducts`) and its tests.
 *
 * Popularity is real order data, not a seller-curated flag: zero seller work
 * (the target cohort won't merchandise by hand) and the claim stays honest —
 * a store with no qualifying orders simply shows no featured card.
 */

/** Rolling window the storefront asks about. The buyer-facing cap says
 * "Popular this week", so the window must stay 7 days — change both or
 * neither. */
export const POPULAR_WINDOW_DAYS = 7;

/** Orders needed inside the window before we'll call a product "popular".
 * One order is an anecdote, not a bestseller — below this the row hides. */
export const POPULAR_MIN_ORDERS = 2;

/**
 * How many ids the query returns — the shelf's ceiling.
 *
 * The cap is applied by the QUERY, and only **after** it has dropped products
 * that aren't publicly listed. Capping first (which this did until the PR #155
 * review) starves the shelf: ranking reads `orders.items[].productId` with no
 * product lookup, so a counter-only SKU — hidden from the storefront but fully
 * counter-sellable, and its orders count — would take a slot and then be
 * filtered out on the client, with no rank-11 to back-fill it. A stall seller
 * whose top ten are counter-only got an empty "Popular this week".
 *
 * 10 is a deliberate ceiling, not a guess: the row scrolls, so more items cost
 * nothing in layout, but every id here is a product the client must resolve
 * and render, and past ~10 a "popular this week" shelf stops being a
 * shortlist and starts being the catalog (which the grid below already is).
 */
export const POPULAR_TOP_CANDIDATES = 10;

/**
 * Newest-first scan bound. At the cohort's volume (20+ orders/week) a 7-day
 * window is a few dozen rows; the cap is the abuse guard that keeps the read
 * bounded whatever `since` a client sends. Truncation just means "popular
 * among the most recent 500" — fine for merchandising.
 */
export const POPULAR_SCAN_CAP = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The `since` anchor the storefront sends: MYT midnight, 7 days back.
 *
 * This is a ROLLING window ending *now*, not a calendar week — on 3 Oct it
 * spans 26 Sep 00:00 → now, and on 4 Oct it spans 27 Sep 00:00 → now. There
 * is no upper bound and nothing resets on a week boundary, so the shelf never
 * blanks out on a particular weekday; it always reflects the last 7 days of
 * trading. (Verified by test below.)
 *
 * Aligned to the day boundary so every buyer on the same date sends identical
 * args and shares one cached query result (the insights cache discipline) —
 * the server rejects unaligned values for exactly that reason.
 */
export function popularSince(now: number = Date.now()): number {
	return todayMytMidnight(now) - POPULAR_WINDOW_DAYS * DAY_MS;
}

/** The projection of an order the ranking needs. */
export type PopularOrderInput = {
	status: string;
	items: ReadonlyArray<{ productId: string; quantity: number }>;
};

/**
 * Rank product ids by how many DISTINCT orders contained them (quantity as
 * the tiebreak, id as the stable final tie-break). Distinct orders — not
 * units — is the honest "popular" signal: one customer buying 40 pax of a
 * min-quantity product shouldn't outrank ten customers buying one cake each.
 * Pending/cancelled orders don't count (the insights revenue-status set).
 *
 * Returns the FULL ranked list, deliberately uncapped: the caller filters to
 * storefront-visible products first and only then takes the top
 * `POPULAR_TOP_CANDIDATES`, so an unlisted bestseller can't eat a slot. Length
 * is naturally bounded — distinct products across one retailer's recent orders,
 * itself under the per-retailer product cap.
 *
 * Returns ONLY ids, no counts — this feeds an unauthenticated storefront
 * query, and a store's sales volume is the seller's business, not a
 * competitor's scraping target.
 */
export function rankPopularProducts(
	orders: ReadonlyArray<PopularOrderInput>,
): string[] {
	const stats = new Map<string, { orderCount: number; quantity: number }>();
	for (const order of orders) {
		if (!isRevenueOrder(order.status)) continue;
		const seenInOrder = new Set<string>();
		for (const item of order.items) {
			const stat = stats.get(item.productId) ?? { orderCount: 0, quantity: 0 };
			stat.quantity += item.quantity;
			if (!seenInOrder.has(item.productId)) {
				stat.orderCount += 1;
				seenInOrder.add(item.productId);
			}
			stats.set(item.productId, stat);
		}
	}
	return [...stats.entries()]
		.filter(([, s]) => s.orderCount >= POPULAR_MIN_ORDERS)
		.sort(
			([idA, a], [idB, b]) =>
				b.orderCount - a.orderCount ||
				b.quantity - a.quantity ||
				idA.localeCompare(idB),
		)
		.map(([id]) => id);
}
