/**
 * Splits seller-authored plain text into text and link segments, so a link in
 * a note becomes tappable without the text being interpreted as anything else.
 *
 * Two spellings (see convex/lib/noteLinks.ts, which owns the rule):
 *   - a bare URL — "Pin: https://maps.app.goo.gl/abc" links the URL itself
 *   - a Markdown link — "[Parking guide](https://…)" links the words, so a
 *     long URL doesn't swallow a 200-character note (z8r3fdn2uj)
 *
 * Nothing else is Markdown — no bold, lists or headings; a note stays one
 * plain line. Plain-text channels (WhatsApp, the PDF) get the same note via
 * `noteToPlainText`, so a Markdown link reads "Parking guide: https://…"
 * there instead of raw brackets.
 *
 * Only `http(s)://…` and `www.…` are recognised; the href is rebuilt through
 * `URL` and anything that isn't http/https stays text, so no `javascript:`
 * can ever reach an `href`.
 */

import { MARKDOWN_LINK_PATTERN } from "../../convex/lib/noteLinks";

/**
 * The one line telling a seller that links in a note work (z8r3fdn2uj) —
 * shown under every note field whose text reaches a buyer, so the feature is
 * found where it's used rather than discovered by accident.
 */
export const NOTE_LINK_HINT =
	"Links are tappable for buyers — paste one, or write [Parking guide](https://…) to link words.";

export type LinkifySegment =
	| { kind: "text"; text: string }
	| { kind: "link"; text: string; href: string };

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

/** Sentence punctuation that ends a URL in prose rather than belonging to it:
 * "Pin: https://x.co/a." links `https://x.co/a`, not the full stop. */
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;

function trimUrl(raw: string): string {
	let url = raw.replace(TRAILING_PUNCTUATION, "");
	// "(see https://x.co/a)" — the closing paren is the sentence's, unless the
	// URL opened one itself (Wikipedia-style paths).
	while (url.endsWith(")") && !url.includes("(")) {
		url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
	}
	return url;
}

function safeHref(text: string): string | null {
	const candidate = /^www\./i.test(text) ? `https://${text}` : text;
	try {
		const url = new URL(candidate);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: null;
	} catch {
		return null;
	}
}

export function linkify(text: string): LinkifySegment[] {
	const segments: LinkifySegment[] = [];
	const pushText = (value: string) => {
		if (value.length === 0) return;
		const last = segments[segments.length - 1];
		if (last?.kind === "text") {
			segments[segments.length - 1] = { kind: "text", text: last.text + value };
		} else {
			segments.push({ kind: "text", text: value });
		}
	};
	// Bare URLs in a stretch of text that holds no Markdown link.
	const pushWithBareUrls = (value: string) => {
		let cursor = 0;
		for (const match of value.matchAll(URL_PATTERN)) {
			const start = match.index ?? 0;
			const url = trimUrl(match[0]);
			const href = safeHref(url);
			if (href === null) continue;
			pushText(value.slice(cursor, start));
			segments.push({ kind: "link", text: url, href });
			cursor = start + url.length;
		}
		pushText(value.slice(cursor));
	};

	// Markdown links first: their URL must not also be caught as a bare one.
	let cursor = 0;
	for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
		const href = safeHref(match[2]);
		if (href === null) continue;
		const start = match.index ?? 0;
		pushWithBareUrls(text.slice(cursor, start));
		segments.push({ kind: "link", text: match[1].trim() || match[2], href });
		cursor = start + match[0].length;
	}
	pushWithBareUrls(text.slice(cursor));
	return segments;
}
