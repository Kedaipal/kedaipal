/**
 * Settings → Billing's history list: settled/voided subscription invoices and
 * PAID credit-pack top-ups (Credits T2) in one timeline, newest first. Each row
 * is dated by what it shows — an invoice by when it was paid (or voided, or
 * issued), a top-up by when it was paid — so the list reads as "what happened
 * to my billing, most recent first" whichever kind a row is.
 */

type InvoiceLike = {
	_id: string;
	createdAt: number;
	markedPaidAt?: number;
	voidedAt?: number;
};

type PurchaseLike = {
	_id: string;
	createdAt: number;
	paidAt: number | null;
};

export type BillingHistoryRow<I extends InvoiceLike, P extends PurchaseLike> =
	| { kind: "invoice"; key: string; at: number; invoice: I }
	| { kind: "credit_purchase"; key: string; at: number; purchase: P };

export function mergeBillingHistory<
	I extends InvoiceLike,
	P extends PurchaseLike,
>(invoices: I[], purchases: P[]): BillingHistoryRow<I, P>[] {
	const rows: BillingHistoryRow<I, P>[] = [
		...invoices.map((invoice) => ({
			kind: "invoice" as const,
			key: invoice._id,
			at: invoice.markedPaidAt ?? invoice.voidedAt ?? invoice.createdAt,
			invoice,
		})),
		...purchases.map((purchase) => ({
			kind: "credit_purchase" as const,
			key: purchase._id,
			at: purchase.paidAt ?? purchase.createdAt,
			purchase,
		})),
	];
	// Array.prototype.sort is stable, so equal dates keep invoices-then-top-ups
	// in their server order.
	return rows.sort((a, b) => b.at - a.at);
}
