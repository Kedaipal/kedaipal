// Pure helpers for order creation. No Convex imports — keep testable in isolation.

// Alphabet excludes O, 0, I, 1 to avoid visual ambiguity in WhatsApp messages.
const SHORT_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SHORT_ID_LENGTH = 4;

export function generateShortId(): string {
	let id = "ORD-";
	for (let i = 0; i < SHORT_ID_LENGTH; i++) {
		id += SHORT_ID_ALPHABET[Math.floor(Math.random() * SHORT_ID_ALPHABET.length)];
	}
	return id;
}

export type OrderItemPricing = {
	price: number;
	quantity: number;
};

export type OrderTotals = {
	subtotal: number;
	total: number;
};

/**
 * `subtotal` is the sum of line snapshots. `total` adds the optional
 * `quotedAmount` (minor units) — the seller's quote for made-to-order/custom
 * work, set on the mockup and folded in here so there's a single source of
 * truth for the order total. Negative quotes are floored to 0.
 */
export function computeOrderTotals(
	items: ReadonlyArray<OrderItemPricing>,
	quotedAmount?: number,
): OrderTotals {
	const subtotal = items.reduce(
		(sum, item) => sum + item.price * item.quantity,
		0,
	);
	const quote = Math.max(0, quotedAmount ?? 0);
	return { subtotal, total: subtotal + quote };
}
