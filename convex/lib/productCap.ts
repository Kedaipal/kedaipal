import { ConvexError } from "convex/values";

/**
 * Product cap (86eyjmf4q): the ceiling on how many products a single store may
 * hold. Pure logic shared by the server (the authoritative gate in
 * products.create + products.bulkUpsert) and the dashboard client (the counter,
 * the disabled-with-reason New button, the import preview), so the two sides can
 * never disagree about what blocks a save. Mirrors the convex/lib/minOrderRules.ts
 * pattern.
 *
 * Scope decisions (locked 9 Aug 2026):
 *
 * - **200, every tier.** Catalog size is deliberately NOT a plan lever. A
 *   seller's menu *is* their business, so capping it on Starter would stop them
 *   representing their shop rather than persuade them to upgrade — `orderCap`
 *   is the monetization lever. A store that genuinely needs >200 distinct SKUs
 *   is an Enterprise conversation handled by hand (see the admin escape below),
 *   not a paywall.
 *
 * - **The cap counts TOTAL rows — active AND archived.** Three reasons, in
 *   order of weight:
 *
 *   1. It is the only semantic that cannot be breached. Restoring an archived
 *      product is `products.update({ active: true })`, which has no cap check
 *      and shouldn't need one; an active-only cap would silently let a seller
 *      at the ceiling restore their way past it. Counting rows keeps `create`
 *      and `bulkUpsert` as the ONLY two mutations that can grow the count, so
 *      the invariant is enforced in exactly two places.
 *   2. Archived rows are not free — `products.listAll` collects every product
 *      including archived ones and hydrates each one's variants and signed
 *      image URLs for the dashboard.
 *   3. It keeps the contract sayable: "200 products." An active-only cap means
 *      200 live plus an unbounded graveyard, which is 300+ rows of real cost
 *      wearing a "200" label.
 *
 * - **Because of that, deleting is the escape valve, not archiving.** Archive
 *   hides a product from the storefront and KEEPS its slot; only
 *   `products.deletePermanently` frees one. That pairing is what makes "200
 *   total" an honest contract rather than a one-way ratchet — before this
 *   ticket there was no delete path for a product at all, so a store that
 *   filled its slots with test rows could never reclaim one.
 */

/**
 * Maximum products per store — TOTAL rows (active + archived). See the module
 * comment for why archived rows count and why this is not tiered by plan.
 */
export const MAX_PRODUCTS_PER_RETAILER = 200;

/**
 * Fraction of the cap past which the dashboard starts showing the "N of 200"
 * counter. Below it the counter is pure noise — a 12-product store does not
 * need to think about a ceiling it will never approach — so the limit stays
 * invisible until it's plausibly relevant, then never surprises anyone at save
 * time. 0.8 → the counter appears at 160 products.
 */
export const PRODUCT_COUNTER_VISIBLE_FRACTION = 0.8;

/** Product count past which the dashboard surfaces the counter. */
export const PRODUCT_COUNTER_VISIBLE_AT = Math.floor(
	MAX_PRODUCTS_PER_RETAILER * PRODUCT_COUNTER_VISIBLE_FRACTION,
);

export type ProductCapState = {
	/** Products the store holds today — active + archived. */
	used: number;
	cap: number;
	/** Slots left before the ceiling. Never negative (see `overCap`). */
	remaining: number;
	/** No more products may be added by this caller. */
	atCap: boolean;
	/**
	 * This caller bypasses the cap entirely (Kedaipal admin act-as). Exposed
	 * rather than left implicit because "is there room for N more?" can't be
	 * answered from `remaining` alone — an exempt caller always has room, and a
	 * client that reasoned from `remaining` would wrongly block a white-glove
	 * bulk import.
	 */
	exempt: boolean;
	/**
	 * The store already holds MORE than the cap. Only reachable when a Kedaipal
	 * admin stocked it past the ceiling on the seller's behalf (see
	 * `exemptFromProductCap`) — so the UI must not render "250 of 200", which
	 * reads as a bug rather than a bespoke arrangement.
	 */
	overCap: boolean;
	/** Surface the counter in the dashboard header. */
	showCounter: boolean;
};

/**
 * Resolve the cap state for a store. `exempt` is the admin escape hatch — a
 * Kedaipal admin operating the store (act-as) can stock it past the ceiling for
 * a white-glove Enterprise setup, matching how admin act-as already bypasses
 * the subscription soft-lock. The seller themselves stays capped, which is the
 * intended asymmetry: we cater to an oversized catalog by hand rather than
 * shipping a self-serve tier we haven't designed yet.
 */
export function productCapState(used: number, exempt = false): ProductCapState {
	const remaining = Math.max(0, MAX_PRODUCTS_PER_RETAILER - used);
	return {
		used,
		cap: MAX_PRODUCTS_PER_RETAILER,
		remaining,
		atCap: !exempt && used >= MAX_PRODUCTS_PER_RETAILER,
		exempt,
		overCap: used > MAX_PRODUCTS_PER_RETAILER,
		showCounter: used >= PRODUCT_COUNTER_VISIBLE_AT,
	};
}

/**
 * Would adding `adding` products fit? The client-side mirror of
 * `assertProductCap`'s condition, for surfaces that must decide BEFORE calling
 * it — chiefly the CSV import, which is chunked across several `bulkUpsert`
 * calls and so could otherwise half-apply a too-large sheet before one chunk
 * throws.
 */
export function fitsWithinProductCap(
	state: ProductCapState,
	adding: number,
): boolean {
	return state.exempt || state.used + adding <= state.cap;
}

/**
 * Seller-facing reason a product can't be added right now, or null when it can.
 * One author for the wording so the disabled button's tooltip, the wizard's
 * blocked state and the server's thrown error all say the same thing.
 */
export function productCapBlockReason(
	used: number,
	exempt = false,
): string | null {
	if (!productCapState(used, exempt).atCap) return null;
	return `You've reached the ${MAX_PRODUCTS_PER_RETAILER}-product limit. Delete a product you no longer sell to free up a slot, or message us if you need more.`;
}

/**
 * Authoritative gate. Throws when adding `adding` products would cross the cap.
 * Called by products.create (adding = 1) and products.bulkUpsert (adding = the
 * number of rows that would be INSERTED — an import that only updates existing
 * products never consumes a slot).
 *
 * The error names how many would actually fit, because the import case is where
 * a bare "limit reached" is most useless: a seller who just prepared a 60-row
 * sheet needs to know that 12 of them fit, not merely that something is full.
 */
export function assertProductCap(
	used: number,
	adding: number,
	exempt = false,
): void {
	if (exempt || used + adding <= MAX_PRODUCTS_PER_RETAILER) return;
	const remaining = Math.max(0, MAX_PRODUCTS_PER_RETAILER - used);
	if (adding <= 1) {
		throw new ConvexError(
			`This store is at the ${MAX_PRODUCTS_PER_RETAILER}-product limit (archived products count). Delete a product you no longer sell to free up a slot.`,
		);
	}
	throw new ConvexError(
		remaining === 0
			? `This store is at the ${MAX_PRODUCTS_PER_RETAILER}-product limit (archived products count), so none of these ${adding} new products fit. Delete products you no longer sell to free up slots.`
			: `Only ${remaining} of these ${adding} new products fit — this store holds ${used} of its ${MAX_PRODUCTS_PER_RETAILER} (archived products count). Delete products you no longer sell to free up slots.`,
	);
}
