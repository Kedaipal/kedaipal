/**
 * How an order was *settled* — the buyer's payment method. Distinct from
 * `convex/lib/payment.ts`'s `PaymentMethod`, which is the RETAILER's configured
 * payout details (bank accounts / QRs shown on the storefront). This is a single
 * structured tag on the order, captured only where it's reliably known:
 *   - Counter Checkout "Paid now" — the seller witnesses the payment.
 *   - Seller "mark payment received" — the seller has just verified the channel.
 * The buyer's online "I've paid" self-claim NEVER sets it (unreliable), so an
 * online order keeps `paymentMethod = undefined` ("online / unknown"). See
 * docs/counter-checkout.md + docs/payment-handshake.md.
 *
 * Pure module (no Convex server imports beyond the values validator) so the
 * client, server, and tests share one source of truth. Adjust the enum here.
 */

import { v } from "convex/values";

export const ORDER_PAYMENT_METHODS = [
	"cash",
	"duitnow",
	"tng",
	"bank_transfer",
	"card",
	"other",
] as const;

export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

/** Buyer-facing labels for the method chips / order detail. */
export const PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
	cash: "Cash",
	duitnow: "DuitNow",
	tng: "Touch 'n Go",
	bank_transfer: "Bank transfer",
	card: "Card",
	other: "Other",
};

/** Convex validator — reused by the schema field and every mutation arg. */
export const orderPaymentMethodValidator = v.union(
	v.literal("cash"),
	v.literal("duitnow"),
	v.literal("tng"),
	v.literal("bank_transfer"),
	v.literal("card"),
	v.literal("other"),
);

export function isOrderPaymentMethod(
	value: string,
): value is OrderPaymentMethod {
	return (ORDER_PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Human label, tolerant of an unknown/legacy value. */
export function paymentMethodLabel(
	value: string | undefined,
): string | undefined {
	if (!value) return undefined;
	return isOrderPaymentMethod(value) ? PAYMENT_METHOD_LABELS[value] : value;
}
