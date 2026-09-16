/**
 * Per-product pickup note (ClickUp `z8r3fdff97`) — the one line a buyer must
 * read before collecting: "side counter", "bring an ice bag, ice-cream puffs
 * melt in 20 min", "ring the bell, the shutter looks closed".
 *
 * It lived in the product description before, where it reached the storefront
 * and then died: the description never rides the order, so the instruction was
 * absent from checkout, the WhatsApp confirmation and `/track` — which is
 * exactly where a buyer standing outside the shop needs it.
 *
 * No Convex imports: the server sanitizes with it (products.create/update) and
 * the seller's form counts against the same cap, so the two cannot disagree
 * about what fits — the fulfilmentDate.ts way.
 */

/** How long a note may be, measured on the STORED text (see `collapseNote`).
 * Long enough for a real instruction, short enough that it can sit on a cart
 * line and inside a WhatsApp message without becoming the message. */
export const MAX_PICKUP_NOTE_LENGTH = 200;

/**
 * The stored spelling of a note: inner whitespace collapsed to single spaces,
 * then trimmed. One line stays one line wherever it lands — a cart row, a
 * WhatsApp message, a PDF label — so a seller pasting a paragraph can never
 * break a layout downstream. Empty → `undefined`, the "no rule has one
 * spelling" posture shared with `minQuantity` and `prepMinutes`.
 */
export function collapseNote(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const collapsed = raw.replace(/\s+/g, " ").trim();
	return collapsed.length === 0 ? undefined : collapsed;
}

/** Whether a draft would be accepted — the cap applies to what we STORE, so a
 * note padded past the limit with whitespace is fine. Shared by the form (to
 * warn before the round trip) and the server (which is the judge). */
export function pickupNoteFits(raw: string | undefined): boolean {
	const collapsed = collapseNote(raw);
	return collapsed === undefined || collapsed.length <= MAX_PICKUP_NOTE_LENGTH;
}
