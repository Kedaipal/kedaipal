import { ConvexError } from "convex/values";

/**
 * Minimum order rules (86ey9unyx): per-product minimum quantity + store-wide
 * minimum order value. Pure logic shared by the server (orders.create — the
 * authoritative gate) and the storefront client (checkout sheet + product
 * detail — the friendly, pre-emptive UX), so the two sides can never disagree
 * about what blocks an order. Mirrors the convex/lib/fulfilmentDate.ts pattern.
 *
 * Scope decisions (locked 18 Jul 2026):
 * - Min quantity lives on `products` and is enforced on the SUMMED quantity of
 *   that product's cart lines (mixing variants counts — "min 20 pax" across
 *   flavours, the catering mental model).
 * - Min order value is store-wide, compared against the item subtotal (before
 *   pickup/delivery fees), boundary inclusive (subtotal ≥ min passes — the
 *   freeAbove posture).
 * - Custom / price-on-quote lines are outside both rules: they never count
 *   toward a product's minimum (qty-locked 1, one bespoke negotiation) and
 *   their presence exempts the order from the value minimum (the real price is
 *   settled by the seller's quote, so a "RM0" custom cake must not be blocked
 *   by a RM100 floor).
 * - Counter checkout is exempt from both (the seller is standing there) — the
 *   checks live only in orders.create, never in counterCheckout.
 */

/** Ceiling on a per-product minimum quantity — beyond this it's a typo. */
export const MIN_QUANTITY_MAX = 999;

/** Ceiling on the store minimum order value (minor units) — RM10,000, the same
 * "unrealistically large" bar as pickup/delivery fees. */
export const MIN_ORDER_VALUE_MAX = 1_000_000;

/**
 * Validate a product minimum quantity. Whole number, ≤ MIN_QUANTITY_MAX.
 * 0 and 1 normalize to undefined — "at least one" is just an order, so a
 * stored minimum is always ≥ 2 and every read can treat undefined as "no rule".
 */
export function sanitizeMinQuantity(
	raw: number | undefined,
): number | undefined {
	if (raw === undefined) return undefined;
	if (!Number.isInteger(raw) || raw < 0) {
		throw new ConvexError("Minimum quantity must be a whole number");
	}
	if (raw > MIN_QUANTITY_MAX) {
		throw new ConvexError(
			`Minimum quantity can't exceed ${MIN_QUANTITY_MAX}`,
		);
	}
	return raw <= 1 ? undefined : raw;
}

/**
 * Validate a store minimum order value (minor units). Whole non-negative sen
 * with the MIN_ORDER_VALUE_MAX ceiling. 0 normalizes to undefined so "no
 * minimum" is stored one way only (the pickup-fee posture).
 */
export function sanitizeMinOrderValue(
	raw: number | undefined,
): number | undefined {
	if (raw === undefined) return undefined;
	if (!Number.isInteger(raw) || raw < 0) {
		throw new ConvexError(
			"Minimum order value must be a whole, non-negative amount",
		);
	}
	if (raw > MIN_ORDER_VALUE_MAX) {
		throw new ConvexError(
			"Minimum order value is unrealistically large — check the amount",
		);
	}
	return raw === 0 ? undefined : raw;
}

/** The per-line shape both sides can produce: the cart maps CartItems, the
 * server maps its resolved variant+product pairs. */
export type MinRuleItem = {
	productId: string;
	/** Product display name (without variant label) — used in the message. */
	name: string;
	quantity: number;
	/** Product-level minimum (already sanitized ≥2, or undefined). */
	minQuantity?: number;
	/** Custom / made-to-order line — excluded from quantity sums. */
	isCustom?: boolean;
	/** Price-on-quote line (requiresProof at price 0) — with isCustom, exempts
	 * the order from the value minimum. */
	quoteOnRequest?: boolean;
};

export type MinQuantityShortfall = {
	productId: string;
	name: string;
	minQuantity: number;
	have: number;
};

/**
 * Group non-custom lines by product and report every product whose summed
 * quantity is below its minimum. A product represented ONLY by a custom line
 * has no standard quantity to judge — no shortfall (the bespoke negotiation
 * stands on its own).
 */
export function collectMinQuantityShortfalls(
	items: ReadonlyArray<MinRuleItem>,
): MinQuantityShortfall[] {
	const byProduct = new Map<string, MinQuantityShortfall>();
	for (const item of items) {
		if (item.isCustom) continue;
		if (!item.minQuantity || item.minQuantity <= 1) continue;
		const entry = byProduct.get(item.productId);
		if (entry) {
			entry.have += item.quantity;
		} else {
			byProduct.set(item.productId, {
				productId: item.productId,
				name: item.name,
				minQuantity: item.minQuantity,
				have: item.quantity,
			});
		}
	}
	return [...byProduct.values()].filter((s) => s.have < s.minQuantity);
}

/** An order carrying any custom or price-on-quote line has an unknown real
 * value — the seller settles it on the quote — so the store value minimum
 * doesn't apply. */
export function isMinOrderValueExempt(
	items: ReadonlyArray<Pick<MinRuleItem, "isCustom" | "quoteOnRequest">>,
): boolean {
	return items.some((i) => i.isCustom === true || i.quoteOnRequest === true);
}

/**
 * The remaining amount (minor units) an order must add to reach the store
 * minimum, or 0 when it already qualifies (boundary inclusive) / no minimum is
 * set / the order is exempt.
 */
export function minOrderValueShortfall(
	minOrderValue: number | undefined,
	subtotal: number,
	items: ReadonlyArray<Pick<MinRuleItem, "isCustom" | "quoteOnRequest">>,
): number {
	if (!minOrderValue || minOrderValue <= 0) return 0;
	if (isMinOrderValueExempt(items)) return 0;
	return Math.max(0, minOrderValue - subtotal);
}

/** Buyer-facing message for a quantity shortfall — one vocabulary on the
 * storefront alert and the server error. */
export function minQuantityMessage(s: MinQuantityShortfall): string {
	return `Minimum ${s.minQuantity} × ${s.name} per order — you have ${s.have}`;
}
