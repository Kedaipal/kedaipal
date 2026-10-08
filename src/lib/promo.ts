// Storefront-side promotion helpers (z8r3fdcw72). The SERVER has already
// decided whether a promotion applies — `productWithVariants` resolves the
// plan gate, the window and the flash cap, publishes a buyer-safe
// `promoState`, and strips every `promoPrice` when it can't apply. So nothing
// here re-derives any of that; re-deriving is how the storefront would come to
// show a sale the order doors would then refuse.
//
// What the client DOES own is the clock. A page open when `endsAt` passes must
// stop quoting the sale price without waiting for a refetch — the band's
// countdown reaching zero and the price reverting are the same moment.

/** The buyer-safe slice `productWithVariants` publishes. */
export type PromoState = {
	phase: "scheduled" | "live";
	label: string;
	startsAt?: number;
	endsAt?: number;
	unitCap?: number;
	unitsLeft?: number;
	maxPerOrder?: number;
};

export type PromoVariantLike = { price: number; promoPrice?: number };

export type PromoProductLike = {
	promoState?: PromoState;
	priceFrom: number;
	promoPriceFrom?: number;
};

/** Is the sale price in force right now? False for a scheduled teaser (the
 * drop hasn't opened), and false the instant the window closes under an open
 * page. */
export function promoLive(state: PromoState | undefined, now: number): boolean {
	if (!state || state.phase !== "live") return false;
	if (state.endsAt !== undefined && now >= state.endsAt) return false;
	// A capped sale sold out while the page was open: the server stops
	// publishing a sale price on the next read, but until then the count it
	// DID publish is the honest answer.
	if (state.unitsLeft !== undefined && state.unitsLeft <= 0) return false;
	return true;
}

/** What one variant costs right now. Falls back to the list price whenever
 * the sale isn't in force or the variant carries no (valid) sale price —
 * quote lines (price 0) can never discount, by construction. */
export function effectiveVariantPrice(
	variant: PromoVariantLike,
	state: PromoState | undefined,
	now: number,
): number {
	if (!promoLive(state, now)) return variant.price;
	const sale = variant.promoPrice;
	if (sale === undefined || sale <= 0 || sale >= variant.price)
		return variant.price;
	return sale;
}

/** The headline "from" price for a product whose variants differ. Returns the
 * list price unchanged when nothing is on sale, so callers can compare the two
 * to decide whether to strike anything through. */
export function effectivePriceFrom(
	product: PromoProductLike,
	now: number,
): number {
	if (!promoLive(product.promoState, now)) return product.priceFrom;
	return product.promoPriceFrom ?? product.priceFrom;
}

/** Whole-percent saving, for the badge. `null` when there is nothing to show
 * (no sale, or a rounding that lands on 0% — "−0%" is worse than no badge). */
export function promoPercentOff(
	listPrice: number,
	salePrice: number,
): number | null {
	if (listPrice <= 0 || salePrice <= 0 || salePrice >= listPrice) return null;
	const percent = Math.round(((listPrice - salePrice) / listPrice) * 100);
	return percent > 0 ? percent : null;
}

/** What a cart line is worth NOW, given the live catalogue. The cart freezes
 * the price it was added at (`useCart` holds no live join), so a sale that
 * ends — or starts — while items sit there has to be reconciled before the
 * buyer is asked to pay. The order door enforces the same thing server-side
 * via `expectedSubtotal`; this is the honest UI half. */
export function repricedCartLines<
	T extends { variantId: string; price: number; quantity: number },
>(
	items: readonly T[],
	liveFor: (
		variantId: string,
	) => { variant: PromoVariantLike; promoState?: PromoState } | undefined,
	now: number,
): Array<{ line: T; was: number; now: number }> {
	const changed: Array<{ line: T; was: number; now: number }> = [];
	for (const line of items) {
		const live = liveFor(line.variantId);
		if (!live) continue;
		const price = effectiveVariantPrice(live.variant, live.promoState, now);
		if (price !== line.price)
			changed.push({ line, was: line.price, now: price });
	}
	return changed;
}

/** The item subtotal the buyer is actually looking at, in sen — what the
 * order door compares `expectedSubtotal` against. */
export function cartItemSubtotal(
	items: readonly { price: number; quantity: number }[],
): number {
	return items.reduce((sum, i) => sum + i.price * i.quantity, 0);
}
