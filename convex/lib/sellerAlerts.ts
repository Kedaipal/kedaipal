// Which channel tells the seller about an order event — pure, no Convex
// runtime imports, so the rule unit-tests in isolation. See
// docs/order-notifications.md.
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
//
// z8r3fdv55f (Zaki, 16 Oct 2026): the alert is ON BY DEFAULT and belongs to
// the SUBSCRIPTION, not a tier — it is the "you never lose an order" promise,
// so every store we are serving gets it, Starter included. Two consequences
// this module owns:
//   - the toggle is tri-state: absent = on, only an explicit `false` (the
//     seller switched it off) = off. A seller with no number yet reads "on"
//     and alerts start the moment a number is saved;
//   - "the store is entitled" is now a real input. It used to be implied by
//     the toggle (only Pro could write `true`), but an ABSENT toggle reads on
//     for every store, so entitlement must be checked at send time — or a
//     lapsed store would keep receiving billable alerts.

import type { SubscriptionStatus } from "../subscriptions";

/** The fields of a subscription row the entitlement rule reads. */
export type SellerAlertSubscription = {
	status: SubscriptionStatus;
	comped?: boolean;
};

/**
 * Is this store one we are SERVING, so its seller gets WhatsApp order alerts?
 *
 *  - `trialing` / `active` — yes. A trial is where a seller first meets the
 *    promise, so it is included on purpose (Zaki, 16 Oct). `active` also
 *    covers the renewal grace after a period ends: access only changes at
 *    the lock.
 *  - `past_due` — no. It is the LOCK state (a trial that expired unpaid, or a
 *    renewal left unpaid past its grace), the dashboard is view-only, and
 *    nothing ever moves a store out of it on its own, so it is indefinite.
 *    The seller still gets the free email.
 *  - `on_hold` (ordering is off) / `cancelled` — no.
 *  - comped or an admin's own store — yes, whatever the status: full access
 *    means full access (`storeHasFullAccess`).
 *  - no subscription row — yes. A missing row is a data fault that
 *    `resolveAccess` fails OPEN as comped full access, and the Billing tab
 *    says so; failing CLOSED here would put "Paused — subscription isn't
 *    active" on the alerts card beside a Billing tab reporting full access.
 *    One store, one answer (PR #387 review).
 */
export function subscriptionCoversWaAlerts(
	sub: SellerAlertSubscription | null,
	ownerIsAdmin: boolean,
): boolean {
	if (ownerIsAdmin) return true;
	if (!sub || sub.comped === true) return true;
	return sub.status === "trialing" || sub.status === "active";
}

/** The retailer + order fields the rule reads. */
export type SellerAlertReach = {
	/** retailers.orderWaAlerts — tri-state: absent = ON (the default), only an
	 * explicit `false` (the seller switched it off) = off. */
	orderWaAlerts?: boolean;
	/** retailers.notifyWaPhone — where the alert goes; separate from waPhone. */
	notifyWaPhone?: string;
	/** `subscriptionCoversWaAlerts` for this store, resolved by the caller. */
	subscriptionCovers: boolean;
};

/** The seller's switch, with the default applied: on unless switched off. */
export function sellerWaAlertsSwitchedOn(orderWaAlerts: boolean | undefined) {
	return orderWaAlerts !== false;
}

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
	if (!sellerWaAlertsSwitchedOn(retailer.orderWaAlerts)) return false;
	if (!retailer.subscriptionCovers) return false;
	return (
		retailer.notifyWaPhone !== undefined && retailer.notifyWaPhone.length > 0
	);
}
