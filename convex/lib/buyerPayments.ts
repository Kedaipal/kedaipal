// Buyer-facing copy for a store whose payments are paused because it is
// lapsed (z8r3fdr6gg). The RULE lives in `subscriptions.buyerPaymentsPaused`;
// this file is only what the buyer is told, so the checkout notice, the order
// page and every server refusal say the same thing.
//
// Deliberately neutral: it never says "inactive", "unpaid" or "suspended". A
// buyer reading "inactive" assumes the store is gone and abandons an order a
// real seller — maybe one day late on their bill — would have honoured. What
// the buyer needs is what happens to THEM: the order still goes through, they
// pay later from the same page, and they shouldn't pay outside Kedaipal in the
// meantime (the one line that protects them if the seller isn't genuine).

/** Heading on every paused surface — the sibling of "Ordering paused". */
export const PAYMENTS_PAUSED_HEADING = "Payments paused";

function storeLabel(storeName: string | undefined): string {
	const name = storeName?.trim();
	return name ? name : "This store";
}

/** Checkout, before the order exists. */
export function paymentsPausedCheckoutLine(storeName: string | undefined): string {
	return `${storeLabel(storeName)} isn't taking payments on Kedaipal right now. You can still place your order — you'll pay from your order page once they are. Please don't pay the seller outside Kedaipal until then.`;
}

/** The order page, where the payment card would be. */
export function paymentsPausedOrderLine(storeName: string | undefined): string {
	return `${storeLabel(storeName)} isn't taking payments on Kedaipal right now. Your order is saved — you can pay right here once they are. Please don't pay the seller outside Kedaipal until then. Already paid them? Keep your receipt — you can attach it here once they're back.`;
}

/** Server refusal for a direct call to a payment door while paused. */
export function paymentsPausedRefusal(storeName: string | undefined): string {
	return `${storeLabel(storeName)} isn't taking payments on Kedaipal right now — your order is saved, and you can pay from your order page once they are.`;
}

/** Server refusal for the "I've paid" door while paused. A claim means the
 * buyer says they ALREADY paid (often a transfer made just before the pause),
 * so "you can pay later" would be wrong for exactly the person asking: tell
 * them to keep the receipt, and that it can be attached once the store is
 * back — the seller can't confirm a payment before then anyway. */
export function paymentsPausedClaimRefusal(storeName: string | undefined): string {
	return `${storeLabel(storeName)} isn't taking payments on Kedaipal right now, so a payment can't be confirmed here yet. Already paid them? Keep your receipt — you can attach it on your order page once they're back.`;
}
