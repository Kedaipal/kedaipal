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
 *
 * ## Enum vs. offered list (SG-lite, 86eyph341)
 *
 * Two different questions, deliberately kept apart:
 *
 * - **`ORDER_PAYMENT_METHODS` — what may be STAMPED on an order.** A closed
 *   SET (not a display order), spanning every country we operate in, because
 *   the HitPay gateway stamps whatever rail the buyer actually used. An MY
 *   order settled through GrabPay is stamped `grabpay` and must render its
 *   label, even though MY's picker doesn't offer GrabPay by hand.
 * - **`COUNTRY_PAYMENT_METHODS` — what the seller is OFFERED to hand-pick**,
 *   in the order they see it. Country-scoped so an SG seller is never asked to
 *   file a PayNow transfer under "Other" (rails that don't exist there made
 *   the Insights donut and the inbox Method filter meaningless).
 *
 * So: never gate a *label*, a *filter match*, or a *stamp* on the country
 * list — only the pickers.
 */

import { v } from "convex/values";
import type { Country } from "./country";

export const ORDER_PAYMENT_METHODS = [
	"cash",
	"duitnow",
	"tng",
	"bank_transfer",
	// FPX (online-banking checkout rail) — distinct from a manual bank transfer:
	// stamped by the HitPay gateway (86eyb6z3a), never hand-picked at a counter.
	"fpx",
	"card",
	"other",
	// Singapore rails (86eyph341). Appended rather than interleaved so the diff
	// stays reviewable — the array is a set, and `COUNTRY_PAYMENT_METHODS` below
	// owns every display order.
	"paynow",
	// PayLah! is its own option even though a PayLah!-to-PayLah! transfer
	// usually settles over PayNow underneath. Deliberate: this tag is the
	// seller HAND-PICKING what they saw, and an SG seller says "he PayLah-ed
	// me". The seller's vocabulary beats rail purity for a manual tag — do not
	// "correct" this into a PayNow alias.
	"paylah",
	// NETS — the seller's own terminal / NETS QR at a counter. Not a HitPay
	// rail we mint, so it's picker-only.
	"nets",
	// GrabPay — hand-pickable in SG and also stamped by the HitPay gateway in
	// BOTH markets (see mapHitpayPaymentType).
	"grabpay",
] as const;

export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

/** Buyer-facing labels for the method chips / order detail. Covers the whole
 * enum, never just the store's country — a gateway-stamped rail must render. */
export const PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
	cash: "Cash",
	duitnow: "DuitNow",
	tng: "Touch 'n Go",
	bank_transfer: "Bank transfer",
	fpx: "FPX",
	card: "Card",
	other: "Other",
	paynow: "PayNow",
	paylah: "PayLah!",
	nets: "NETS",
	grabpay: "GrabPay",
};

/**
 * What the seller is offered when hand-picking how an order was settled — the
 * counter "Paid now" select and the order-detail "Mark payment received"
 * chips — in display order, keyed by the store's country.
 *
 * MY is byte-identical to the pre-SG list (pinned by test): every existing
 * store sees exactly what it saw before. SG drops the three MY-only rails
 * (DuitNow / Touch 'n Go / FPX) and leads with PayNow, the default way a
 * Singaporean pays a small business.
 *
 * GrabPay is deliberately NOT in MY's list yet: HitPay MY can stamp it, but no
 * MY seller has asked to hand-pick it. One line to add when one does.
 */
export const COUNTRY_PAYMENT_METHODS: Record<
	Country,
	readonly OrderPaymentMethod[]
> = {
	MY: ["cash", "duitnow", "tng", "bank_transfer", "fpx", "card", "other"],
	SG: [
		"cash",
		"paynow",
		"paylah",
		"nets",
		"grabpay",
		"bank_transfer",
		"card",
		"other",
	],
};

/** Convex validator — reused by the schema field and every mutation arg. */
export const orderPaymentMethodValidator = v.union(
	v.literal("cash"),
	v.literal("duitnow"),
	v.literal("tng"),
	v.literal("bank_transfer"),
	v.literal("fpx"),
	v.literal("card"),
	v.literal("other"),
	v.literal("paynow"),
	v.literal("paylah"),
	v.literal("nets"),
	v.literal("grabpay"),
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
