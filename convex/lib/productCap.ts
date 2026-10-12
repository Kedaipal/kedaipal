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
 *   not a paywall. It is therefore NOT a `PlanCaps` entry: a tier never buys
 *   you more products.
 *
 * - **A FULL-ACCESS store is uncapped (z8r3fdrph7).** "No limits" has one
 *   author, `storeHasFullAccess` in convex/lib/plans.ts, and the two stores it
 *   names — an admin's own, and a SPONSORED (comped) one — are uncapped here
 *   as well as in `fullAccessCaps()`. That is not a tier making catalogue size
 *   negotiable; it is the absence of a plan. Zaki, 10 Oct 2026: a comp has "no
 *   restrictions in number of products and credit limit per month, just that
 *   they don't have admin access". Note this is a property of the STORE, where
 *   the act-as escape below is a property of the CALLER — a sponsored seller is
 *   uncapped on their own login, which is the whole point.
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
	 * The cap does not apply here — admin act-as, or a full-access store (see
	 * `ProductCapExemption` for why the two are told apart).
	 * Exposed rather than left implicit because "is there room for N more?"
	 * can't be answered from `remaining` alone — an exempt caller always has
	 * room, and a client that reasoned from `remaining` would wrongly block a
	 * white-glove bulk import or a sponsored seller's own.
	 */
	exempt: boolean;
	/**
	 * The store already holds MORE than the cap. Only reachable through an
	 * exemption — a Kedaipal admin stocked it past the ceiling on the seller's
	 * behalf, or the store has full access — so the UI must not render
	 * "250 of 200", which reads as a bug rather than a bespoke arrangement.
	 */
	overCap: boolean;
	/** Surface the counter in the dashboard header. False for a store with no
	 * ceiling (`full_access`) however many products it holds. */
	showCounter: boolean;
};

/**
 * Resolve the cap state for a store. `exempt` means the cap does not apply,
 * for either of two independent reasons (resolved by `productCapExempt` in
 * convex/products.ts, which is the one place that answers it):
 *  - the CALLER is a Kedaipal admin operating someone else's store (act-as) —
 *    a white-glove catalogue gets stocked past the ceiling by hand, matching
 *    how act-as already bypasses the subscription soft-lock. A list-price
 *    seller stays capped on their own login, which is the intended asymmetry:
 *    we cater to an oversized catalog by hand rather than shipping a
 *    self-serve tier we haven't designed yet.
 *  - the STORE has full access (`storeHasFullAccess`) — admin-owned or
 *    sponsored. There is no plan behind it to cap.
 */
/**
 * WHY the cap is lifted — not just that it is. The two reasons differ in what
 * the seller should SEE, which a boolean cannot carry:
 *
 *  - `admin_acting`: the CALLER is a Kedaipal admin on someone else's store
 *    (act-as). This call may exceed the ceiling, but the store still HAS one
 *    — its seller is capped the moment the admin leaves — so the counter
 *    stays on screen. That is the number the admin needs to see.
 *  - `full_access`: the STORE has no ceiling at all (`storeHasFullAccess` —
 *    admin-owned or sponsored). The counter is HIDDEN: "180 of 200 used" in
 *    front of a store with no limit is the same wrong impression the credit
 *    meter's "200 of 200" gave sponsored sellers (z8r3fdrph7), and shipping
 *    the fix on one surface while the other kept printing a ceiling would
 *    just move the bug.
 */
export type ProductCapExemption = "admin_acting" | "full_access";

/**
 * Which exemption applies, or null. The PURE half of `productCapExempt`
 * (convex/products.ts), whose two inputs the dashboard already holds on its
 * retailer payload (`actingAsAdmin`, `fullAccess`). One author, so the
 * counter and the disabled New button can never disagree with what the save
 * will do. `full_access` wins when both hold — an admin standing in an
 * uncapped store is still in an uncapped store.
 */
export function productCapExemption(args: {
	actingAsAdmin: boolean;
	fullAccess: boolean;
}): ProductCapExemption | null {
	if (args.fullAccess) return "full_access";
	return args.actingAsAdmin ? "admin_acting" : null;
}

export function productCapState(
	used: number,
	exemption: ProductCapExemption | null = null,
): ProductCapState {
	const remaining = Math.max(0, MAX_PRODUCTS_PER_RETAILER - used);
	const exempt = exemption !== null;
	return {
		used,
		cap: MAX_PRODUCTS_PER_RETAILER,
		remaining,
		atCap: !exempt && used >= MAX_PRODUCTS_PER_RETAILER,
		exempt,
		overCap: used > MAX_PRODUCTS_PER_RETAILER,
		showCounter:
			used >= PRODUCT_COUNTER_VISIBLE_AT && exemption !== "full_access",
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
	exemption: ProductCapExemption | null = null,
): string | null {
	if (!productCapState(used, exemption).atCap) return null;
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
	exemption: ProductCapExemption | null = null,
): void {
	if (exemption !== null || used + adding <= MAX_PRODUCTS_PER_RETAILER) return;
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
