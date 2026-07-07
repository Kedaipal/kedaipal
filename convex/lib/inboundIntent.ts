/**
 * Inbound message intent classifier — the minimal seed of the "Inbound Intent
 * Router" (ClickUp 1.0). Pure (no Convex imports) so it's unit-testable in
 * isolation. Given the text of an inbound WhatsApp message, decide what the
 * sender is trying to do, so `handleInbound` can dispatch to the right handler
 * instead of growing a tangle of regex branches.
 *
 * Order of precedence matters: a Counter Checkout store-QR scan (`KPS-<token>`)
 * is the most specific intent and is checked before an order confirmation
 * (`ORD-XXXX`). Add new intents (e.g. STOP opt-out) here, not in the handler.
 */

import { SHORT_ID_REGEX } from "./whatsappCopy";

// KPS-<token>: a scan of the seller's PERMANENT printed store QR (poster) —
// starts a buyer-initiated counter session (86ey5m35w). The token has the shape
// of `generateTrackingToken()` (24 URL-safe chars), so we match exactly that —
// stray prose can't trigger a session lookup. This is the ONLY counter-checkout
// QR: the older per-session `KP-<token>` bind flow was removed (86ey5neg6).
export const STORE_QR_TOKEN_REGEX = /KPS-([A-Za-z0-9]{24})/;

export type InboundIntent =
	| { kind: "store_checkout_start"; token: string }
	| { kind: "order_confirm"; shortId: string }
	| { kind: "unknown" };

export function classifyInbound(text: string): InboundIntent {
	const storeQr = text.match(STORE_QR_TOKEN_REGEX);
	if (storeQr) return { kind: "store_checkout_start", token: storeQr[1] };

	const order = text.match(SHORT_ID_REGEX);
	if (order) return { kind: "order_confirm", shortId: order[0] };

	return { kind: "unknown" };
}
