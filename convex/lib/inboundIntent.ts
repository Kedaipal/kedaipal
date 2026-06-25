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

export type InboundIntent =
	| { kind: "checkout_bind"; token: string }
	| { kind: "order_confirm"; shortId: string }
	| { kind: "unknown" };

export function classifyInbound(text: string): InboundIntent {
	const checkout = text.match(CHECKOUT_TOKEN_REGEX);
	if (checkout) return { kind: "checkout_bind", token: checkout[1] };

	const order = text.match(SHORT_ID_REGEX);
	if (order) return { kind: "order_confirm", shortId: order[0] };

	return { kind: "unknown" };
}
