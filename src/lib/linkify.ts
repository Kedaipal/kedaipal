/**
 * Splits seller-authored plain text into text and link segments, so a bare
 * URL ("Pin: https://maps.app.goo.gl/abc") becomes tappable without the text
 * being interpreted as anything else.
 *
 * Deliberately NOT markdown. A pickup note also rides the WhatsApp
 * confirmation, where `[Pin](https://…)` would print as raw brackets — but
 * WhatsApp links a BARE url on its own. Recognising bare URLs only means the
 * note reads the same in the chat and on the page, and the 200-character cap
 * counts exactly what the buyer sees.
 *
 * Only `http(s)://…` and `www.…` are recognised; the href is rebuilt through
 * `URL` and anything that isn't http/https stays text, so no `javascript:`
 * can ever reach an `href`.
 */

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
	let cursor = 0;
	const pushText = (value: string) => {
		if (value.length === 0) return;
		const last = segments[segments.length - 1];
		if (last?.kind === "text") {
			segments[segments.length - 1] = { kind: "text", text: last.text + value };
		} else {
			segments.push({ kind: "text", text: value });
		}
	};
	for (const match of text.matchAll(URL_PATTERN)) {
		const start = match.index ?? 0;
		const url = trimUrl(match[0]);
		const href = safeHref(url);
		if (href === null) continue;
		pushText(text.slice(cursor, start));
		segments.push({ kind: "link", text: url, href });
		cursor = start + url.length;
	}
	pushText(text.slice(cursor));
	return segments;
}
