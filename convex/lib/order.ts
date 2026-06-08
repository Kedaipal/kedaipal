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

/** The mockup fields needed to evaluate the gate — a subset of the orders doc. */
export type MockupGateFields = {
	mockupStatus?: "pending" | "submitted" | "changes_requested" | "approved";
	mockupWaivedAt?: number;
};

/**
 * The mockup gate is "closed" while a custom item still needs buyer sign-off:
 * the order carries a `mockupStatus`, it isn't `approved`, and the seller hasn't
 * waived. While closed, BOTH production (→ packed) and payment (buyer claim /
 * seller mark-received) are blocked — the buyer isn't asked to pay until the
 * design + price are agreed. Opens on approve, waive, or removing the custom
 * item (which clears `mockupStatus`). Non-custom orders (no `mockupStatus`) are
 * never gated.
 *
 * **Single source of truth** — imported by `convex/orders.ts`,
 * `convex/whatsapp.ts`, and the dashboard/tracking pages. Define the gate here
 * only; if the rule changes (e.g. a new "seller-cancelled" state), change it here.
 */
export function isMockupGateClosed(order: MockupGateFields): boolean {
	return (
		order.mockupStatus !== undefined &&
		order.mockupStatus !== "approved" &&
		order.mockupWaivedAt === undefined
	);
}
