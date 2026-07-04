/**
 * Inbound message intent classifier — the minimal seed of the "Inbound Intent
 * Router" (ClickUp 1.0). Pure (no Convex imports) so it's unit-testable in
 * isolation. Given the text of an inbound WhatsApp message, decide what the
 * sender is trying to do, so `handleInbound` can dispatch to the right handler
 * instead of growing a tangle of regex branches.
 *
 * Order of precedence matters: a Counter Checkout bind (`KP-<token>`) is the
 * most specific intent and is checked before an order confirmation
 * (`ORD-XXXX`). Add new intents (e.g. STOP opt-out) here, not in the handler.
 */

import { SHORT_ID_REGEX } from "./whatsappCopy";

// KP-<token>: a Counter Checkout session bind. The token has the shape of
// `generateTrackingToken()` (24 URL-safe chars), so we match exactly that —
// stray "KP-" prose can't trigger a session lookup.
export const CHECKOUT_TOKEN_REGEX = /KP-([A-Za-z0-9]{24})/;

// KPS-<token>: a scan of the seller's PERMANENT printed store QR (poster) —
// starts a buyer-initiated counter session (86ey5m35w). Same token shape.
// Checked BEFORE `KP-` so the more specific literal wins; the two can't
// shadow each other ("KPS-…" contains no "KP-" substring and vice versa),
// and a test pins that.
export const STORE_QR_TOKEN_REGEX = /KPS-([A-Za-z0-9]{24})/;

export type InboundIntent =
	| { kind: "store_checkout_start"; token: string }
	| { kind: "checkout_bind"; token: string }
	| { kind: "order_confirm"; shortId: string }
	| { kind: "unknown" };

export function classifyInbound(text: string): InboundIntent {
	const storeQr = text.match(STORE_QR_TOKEN_REGEX);
	if (storeQr) return { kind: "store_checkout_start", token: storeQr[1] };

	const checkout = text.match(CHECKOUT_TOKEN_REGEX);
	if (checkout) return { kind: "checkout_bind", token: checkout[1] };

	const order = text.match(SHORT_ID_REGEX);
	if (order) return { kind: "order_confirm", shortId: order[0] };

	return { kind: "unknown" };
}
