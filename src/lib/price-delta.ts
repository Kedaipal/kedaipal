// The negotiation math behind an adjusted counter-checkout price (Wagyu
// Walid's ask, 86eyphh8r): how far a seller-keyed price sits from the catalog
// price, as a whole-number percentage. Pure so it's the same author for the
// cart-line chip and the live in-sheet chip — they must never disagree.

export type PriceDelta = { pct: number; isCut: boolean } | null;

/**
 * `null` when the delta rounds to 0% (the strikethrough alone still marks the
 * line as adjusted — a same-price "adjustment" earns no pill). `isCut` is
 * true for a price BELOW catalog (the normal discount case, rendered mint);
 * false for a price set ABOVE catalog (rendered amber, so an accidental
 * up-adjustment can't hide in the same green as a deal).
 */
export function priceDelta(price: number, catalog: number): PriceDelta {
	if (catalog <= 0) return null;
	const pct = Math.round(((catalog - price) / catalog) * 100);
	if (pct === 0) return null;
	return { pct: Math.abs(pct), isCut: price < catalog };
}
