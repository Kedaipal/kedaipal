// Payment-provider seam. The whole point of v1 manual billing is that the
// *entitlement + rank-claim* logic (invoices.markPaid / foundingMembers) is
// provider-agnostic: it consumes a normalized `PaymentRecord`, never raw provider
// data. When Stripe / FPX / HitPay land, a new adapter implements this interface
// and the webhook handler produces the SAME `PaymentRecord` — downstream code
// doesn't change. See docs/manual-subscription.md ("architectural seam").

import { ConvexError } from "convex/values";

/** Normalized payment fact stamped onto an invoice when it settles. Stable across
 * providers — manual admin flip today, a Stripe webhook tomorrow. */
export type PaymentRecord = {
	/** Free-form method label: "duitnow", "bank_transfer" (v1) → "stripe_card" etc. */
	method: string;
	/** Who/what recorded it: admin Clerk subject (v1) → provider txn id (future). */
	recordedBy: string;
	paidAt: number;
};

export interface PaymentProvider {
	/** Stable id for logging / future routing. */
	readonly id: string;
	/**
	 * Turn provider-specific settle inputs into the normalized record. Pure — no
	 * DB writes; the caller (markPaid) owns the transaction. Throws on invalid
	 * input so a malformed settle never produces a partial record.
	 */
	recordPayment(input: {
		method?: string;
		recordedBy: string;
		paidAt: number;
	}): PaymentRecord;
}

const DEFAULT_METHOD = "manual";

/** v1 provider: an admin flips an invoice to paid out-of-band (DuitNow / bank). */
export const ManualAdminProvider: PaymentProvider = {
	id: "manual_admin",
	recordPayment({ method, recordedBy, paidAt }) {
		if (!recordedBy || recordedBy.trim().length === 0)
			throw new ConvexError("recordPayment: missing recordedBy");
		if (!Number.isFinite(paidAt) || paidAt <= 0)
			throw new ConvexError("recordPayment: invalid paidAt");
		const m = (method ?? "").trim();
		return {
			method: m.length > 0 ? m : DEFAULT_METHOD,
			recordedBy,
			paidAt,
		};
	},
};

/**
 * Gateway settles (86eyb6z4r): a HitPay charge/payment on Kedaipal's own
 * account — the tokenised auto-renewal charge or the invoice Pay-now link.
 * `method` is the rail tag ("hitpay_card" / "hitpay_touch_n_go", bare
 * "hitpay" when the v1 webhook omits the rail); `recordedBy` is the HitPay
 * payment/charge id, which doubles as the settle-idempotency handle.
 */
export const HitPayProvider: PaymentProvider = {
	id: "hitpay",
	recordPayment({ method, recordedBy, paidAt }) {
		if (!recordedBy || recordedBy.trim().length === 0)
			throw new ConvexError("recordPayment: missing HitPay payment id");
		if (!Number.isFinite(paidAt) || paidAt <= 0)
			throw new ConvexError("recordPayment: invalid paidAt");
		const m = (method ?? "").trim();
		if (m.length === 0)
			throw new ConvexError("recordPayment: missing gateway method tag");
		return { method: m, recordedBy, paidAt };
	},
};

export type PaymentSettleSource = "manual_admin" | "hitpay";

/** Route by settle source — the admin mark-paid flow stays on the manual
 * provider, gateway webhooks/charges produce the same normalized record via
 * HitPay's. Downstream (settleInvoicePaid → founding → emails) is identical. */
export function getPaymentProvider(
	source: PaymentSettleSource = "manual_admin",
): PaymentProvider {
	return source === "hitpay" ? HitPayProvider : ManualAdminProvider;
}
