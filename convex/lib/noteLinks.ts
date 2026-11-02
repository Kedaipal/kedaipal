/**
 * Links inside a seller's short notes (z8r3fdn2uj) — the product pickup note,
 * a pickup point's note, a payment method's note.
 *
 * Two spellings are recognised everywhere a note is shown:
 *   - a bare URL — `https://…`, `http://…` or `www.…`
 *   - a Markdown link — `[Parking guide](https://…)` — so the buyer taps
 *     words instead of a wall of characters. It saves DISPLAY space, not the
 *     200-character budget: the cap counts the stored text, and the Markdown
 *     form is longer than the bare URL.
 *
 * Nothing else is Markdown: a note stays one plain line. Pages render the link
 * (`src/lib/linkify.ts`); plain-text channels — WhatsApp, the PDF receipt —
 * can't, so `noteToPlainText` spells a Markdown link out as `label: url`,
 * which WhatsApp then makes tappable on its own. Raw brackets never reach a
 * buyer.
 *
 * Only http(s) and `www.` targets count as links. `[x](javascript:…)` doesn't
 * match the pattern at all, so it's left as the text it is.
 *
 * No Convex imports: shared by the server copy and the frontend.
 */

/** `[label](url)` — label on one line, no nested brackets; the URL must start
 * with a web scheme or `www.` and contain no spaces or parentheses. */
export const MARKDOWN_LINK_PATTERN =
	/\[([^[\]\n]+)\]\(((?:https?:\/\/|www\.)[^\s()<>"]+)\)/gi;

/**
 * A note as plain text: every `[label](url)` becomes `label: url` (just `url`
 * when the label IS the URL). Bare URLs are already plain text and pass
 * through untouched.
 */
export function noteToPlainText(note: string): string {
	return note.replace(MARKDOWN_LINK_PATTERN, (_match, label: string, url: string) => {
		const trimmed = label.trim();
		return trimmed === "" || trimmed === url ? url : `${trimmed}: ${url}`;
	});
}
