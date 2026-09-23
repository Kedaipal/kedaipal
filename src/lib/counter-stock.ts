import { isSellable, type VariantLike } from "./variant";

/**
 * Stock rules for the COUNTER catalog (Zaki, 27 Aug).
 *
 * Before this, a sold-out choice looked identical to a stocked one: the seller
 * could tap Add, build the whole cart, and only learn the truth when
 * `createOrderFromSession` refused it — with a customer standing there. The
 * server rule never changed; what was missing was saying it up front.
 *
 * These helpers are the display side of `isSellable` — one source for "can it
 * go in the cart", one for "what does the row say about it".
 */

/** Below this many units a tracked choice is called out rather than stated. */
export const LOW_STOCK_THRESHOLD = 3;

export type StockNote = {
	text: string;
	/** danger = sold out, warn = nearly gone, muted = just information. */
	tone: "danger" | "warn" | "muted";
};

/**
 * The stock line for one variant, or `null` when there is nothing to say.
 *
 * A made-to-order variant says so explicitly instead of showing nothing: a
 * blank where its neighbours show a count reads as missing data, when in fact
 * it's the answer ("no number because there is no ceiling").
 *
 * `seatsLeft` (event products, `z8r3fdff9u`) folds the event's shared seat
 * pool in: the row shows ONE number — the binding ceiling, min(stock, seats)
 * — because "48 left" beside a 8-seat event is two numbers telling two
 * stories. Zero seats reads "Fully booked" (the event's word), zero stock
 * with seats still open stays "Sold out" (this option ran out, others may
 * not have).
 */
export function variantStockNote(
	variant: VariantLike,
	seatsLeft?: number,
): StockNote | null {
	if (seatsLeft !== undefined) {
		if (seatsLeft <= 0) return { text: "Fully booked", tone: "danger" };
		const ceiling = variant.blockWhenOutOfStock
			? Math.min(Math.max(0, variant.onHand), seatsLeft)
			: seatsLeft;
		if (ceiling <= 0) return { text: "Sold out", tone: "danger" };
		if (ceiling <= LOW_STOCK_THRESHOLD)
			return { text: `Only ${ceiling} left`, tone: "warn" };
		return { text: `${ceiling} left`, tone: "muted" };
	}
	if (!variant.blockWhenOutOfStock)
		return { text: "Made to order", tone: "muted" };
	if (variant.onHand <= 0) return { text: "Sold out", tone: "danger" };
	if (variant.onHand <= LOW_STOCK_THRESHOLD)
		return { text: `Only ${variant.onHand} left`, tone: "warn" };
	return { text: `${variant.onHand} left`, tone: "muted" };
}

/**
 * The most units of this variant a counter cart may hold, or `undefined` for
 * made-to-order (no ceiling). Mirrors the server's stock check, so the stepper
 * stops where `createOrderFromSession` would have refused — the seller finds
 * the ceiling by feel instead of by error message. An event's seat pool caps
 * every row the same way (`seatsLeft` is minus committed orders; the server
 * still arbitrates two carts racing the last seat).
 */
export function maxAddableQty(
	variant: VariantLike,
	seatsLeft?: number,
): number | undefined {
	const stockCeiling = variant.blockWhenOutOfStock
		? Math.max(0, variant.onHand)
		: undefined;
	if (seatsLeft === undefined) return stockCeiling;
	return Math.min(stockCeiling ?? seatsLeft, seatsLeft);
}

/** Can this variant go into the counter cart at all? (Sold out ⇒ no; a fully
 * booked event ⇒ no, whatever its stock says.) */
export function canAddToCounterCart(
	variant: VariantLike,
	seatsLeft?: number,
): boolean {
	return isSellable(variant) && (seatsLeft === undefined || seatsLeft > 0);
}

/**
 * Is every choice on this product unsellable right now? The counter tile/row
 * greys out on this — the product stays TAPPABLE (the seller may want to see
 * which size ran out, or restock from the product page), it just stops
 * pretending to be orderable.
 */
export function productSoldOut(product: {
	variants: readonly VariantLike[];
}): boolean {
	return (
		product.variants.length > 0 && !product.variants.some((v) => isSellable(v))
	);
}
