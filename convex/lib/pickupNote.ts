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

import type { Locale } from "./locale";

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

/**
 * The distinct notes across an order's lines, in cart order: trimmed, blanks
 * dropped, exact duplicates removed.
 *
 * Deduped because a seller with six flavours of one puff writes the same note
 * six times, and "bring an ice bag" six times over is noise wherever it lands.
 * The product is deliberately NOT named alongside: the instruction is about
 * collecting the order, not about which line carried it.
 */
export function distinctPickupNotes(
	notes: readonly (string | undefined)[],
): string[] {
	const seen = new Set<string>();
	for (const raw of notes) {
		const note = raw?.trim();
		if (note) seen.add(note);
	}
	return [...seen];
}

/**
 * The ONE gate for "does this order carry buyer-facing pickup notes?".
 *
 * `orders.create` freezes each line's note on EVERY order regardless of method,
 * so a surface that forgot to check the method would print "Before you collect"
 * on a delivery order. Self-collect only (drop-off meet-ups included — the
 * instruction still applies there), and never a counter sale: the buyer was
 * standing at the counter. Deliberately independent of `pickupSnapshot`, so a
 * self-collect order predating snapshots still shows its notes on /track.
 *
 * Returns plain strings — safe to cross a Convex function boundary, where an
 * `undefined` inside an array is not a valid value.
 */
export function orderPickupNotes(order: {
	deliveryMethod?: string;
	source?: string;
	items: readonly { pickupNote?: string }[];
}): string[] {
	if ((order.deliveryMethod ?? "delivery") !== "self_collect") return [];
	if (order.source === "counter") return [];
	return distinctPickupNotes(order.items.map((item) => item.pickupNote));
}

/** The heading every buyer-facing surface uses for the notes — the WhatsApp
 * confirmation, /track and checkout — so the buyer meets one phrase, not three. */
export const PICKUP_NOTES_HEADING: Record<Locale, string> = {
	en: "Before you collect",
	ms: "Sebelum anda ambil",
	zh: "取货前请注意",
};
