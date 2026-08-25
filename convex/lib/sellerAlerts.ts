// Which channel tells the seller about an order event — pure, no Convex
// imports, so the rule unit-tests in isolation. See docs/order-notifications.md.
//
// Background: seller order alerts (86eyhw9zy) ship on WhatsApp AND email, which
// was a deliberate double-notify while the WA path bedded in. Zaki's 8 Aug call
// retires the duplicate: **WhatsApp is the channel, email is the fallback.**
//
// The subtlety is that "we scheduled a WhatsApp alert" is not the same as "the
// seller heard about it". The WA alert can be unavailable (Pro-gated, toggle
// off, no number saved, template env unset) or it can fail at send time (opted
// out, per-seller cap, Meta outage). So suppression happens in two steps:
//
//   1. THIS predicate, at schedule time — if the alert can't even be attempted,
//      the email goes out exactly as before. That covers every Starter seller
//      and everyone who never opted in, which is the majority today.
//   2. The WA alert action re-schedules the email with `force` when it gives up
//      (gateway-blocked, or a terminal/exhausted send failure). That covers the
//      case this predicate can't see from a mutation: the send itself failing.
//
// Between them, a seller never ends up with zero notification — the property
// the old unconditional email was there to guarantee.

/** The retailer + order fields the rule reads. */
export type SellerAlertReach = {
	/** retailers.orderWaAlerts — the seller's opt-in toggle (off by default). */
	orderWaAlerts?: boolean;
	/** retailers.notifyWaPhone — where the alert goes; separate from waPhone. */
	notifyWaPhone?: string;
};

/**
 * Will the seller's WhatsApp alert actually be ATTEMPTED for this event?
 *
 * `templateConfigured` is the caller's event-specific env check
 * (`sellerNewOrderTemplateName()` vs `sellerPaymentClaimTemplateName()`) — the
 * two events have separate Meta templates and either can be live without the
 * other, so this must never be assumed from one of them.
 *
 * `isCounterOrder` only suppresses the NEW-ORDER alert: the seller is standing
 * at the counter, so pinging them about a sale they just rang up is noise. A
 * payment CLAIM on a counter pay-later order is different — it lands hours
 * later when nobody is there — so its caller passes `false`.
 *
 * Mirrors the guards inside notifySellerNewOrder / notifySellerPaymentClaim.
 * If those gain a condition, it belongs here too, or the email will be
 * suppressed for an alert that silently never fires.
 */
export function sellerWaAlertWillAttempt(
	retailer: SellerAlertReach,
	opts: { templateConfigured: boolean; isCounterOrder?: boolean },
): boolean {
	if (!opts.templateConfigured) return false;
	if (opts.isCounterOrder === true) return false;
	if (retailer.orderWaAlerts !== true) return false;
	return (
		retailer.notifyWaPhone !== undefined && retailer.notifyWaPhone.length > 0
	);
}
