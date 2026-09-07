// The ONE place that decides which face an order's document wears. A settled
// order prints (and is offered as) a "Receipt" — proof of payment; an unpaid or
// claimed order prints an "Invoice" — a bill. The PDF builder, the download
// filename, and every button that offers the document must agree, so they all
// read this module instead of re-deriving `paymentStatus === "received"`
// locally (z8r3fdcrzj — the buttons said "receipt" while the PDF said
// "Invoice", which buried the invoice feature). Pure + framework-free so both
// Convex functions and React components can import it.

export type OrderPaymentStatus = "unpaid" | "claimed" | "received";

/** True once payment is confirmed received — the document is then a receipt. */
export function isOrderDocPaid(paymentStatus: OrderPaymentStatus | undefined): boolean {
	return paymentStatus === "received";
}

/** Lowercase noun for running copy ("Download the invoice…"). */
export function orderDocumentNoun(paid: boolean): "receipt" | "invoice" {
	return paid ? "receipt" : "invoice";
}

/** Capitalized noun for titles, labels and filenames ("Invoice-ORD-1234"). */
export function orderDocumentTitle(paid: boolean): "Receipt" | "Invoice" {
	return paid ? "Receipt" : "Invoice";
}
