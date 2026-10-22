/**
 * Seller text → search snippet (storefront SEO audit, 21 Oct 2026).
 *
 * A product description is uncapped markdown (`**bold**`, `- lists`, `#`),
 * and a category blurb runs to 280 chars; both were reaching
 * `<meta name="description">` and the JSON-LD verbatim. Google cuts the
 * snippet around 155–160 chars and shows markdown punctuation literally, so
 * one helper strips the markup, collapses whitespace and cuts at a word
 * boundary. The store description is capped at 150 at write time and passes
 * through unchanged.
 */

/** Google's snippet cut; the landing's `SERP_BUDGET` is the same number. */
export const SNIPPET_MAX = 155;

const MARKDOWN = [
	/!\[[^\]]*\]\([^)]*\)/g, // images
	/\[([^\]]*)\]\([^)]*\)/g, // links → their text
	/(\*\*|__)(.*?)\1/g, // bold
	/(\*|_)(.*?)\1/g, // italics
	/`{1,3}([^`]*)`{1,3}/g, // code
	/~~(.*?)~~/g, // strike
	/^\s{0,3}#{1,6}\s+/gm, // headings
	/^\s{0,3}>\s?/gm, // blockquotes
	/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, // list markers
	/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, // rules
];

/** Markdown → plain prose on one line. */
export function stripMarkdown(text: string): string {
	let out = text;
	out = out.replace(MARKDOWN[0], "");
	out = out.replace(MARKDOWN[1], "$1");
	out = out.replace(MARKDOWN[2], "$2");
	out = out.replace(MARKDOWN[3], "$2");
	out = out.replace(MARKDOWN[4], "$1");
	out = out.replace(MARKDOWN[5], "$1");
	for (const re of MARKDOWN.slice(6)) out = out.replace(re, "");
	return out.replace(/\s+/g, " ").trim();
}

/** Cut at a word boundary with an ellipsis; never mid-word, never longer
 * than `max`. */
export function truncateAtWord(text: string, max = SNIPPET_MAX): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max - 1);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!?-]+$/, "")}…`;
}

/** The one call every storefront loader makes for its meta description. */
export function seoDescription(text: string | undefined | null): string | null {
	if (!text) return null;
	const plain = stripMarkdown(text);
	return plain ? truncateAtWord(plain) : null;
}
