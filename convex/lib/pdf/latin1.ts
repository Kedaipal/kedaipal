/**
 * The Latin-1 clamp every printed document passes through.
 *
 * pdf-lib's standard fonts encode WinAnsi ONLY and THROW on anything outside
 * it, so all text is clamped before it is drawn. The clamp lives HERE, apart
 * from the renderer, because the pure view-model builders have to reason about
 * what will actually appear on paper: a fallback chosen on the RAW string ("no
 * name? then print the phone") silently fails when the raw string is Chinese —
 * non-empty in memory, empty on the page. Builders clamp FIRST, then decide.
 *
 * This is a clamp, not internationalisation. Printing Chinese/Tamil/Jawi needs
 * `fontkit` plus an embedded font carrying those glyphs — the same dependency
 * the zh receipt work is blocked on (see docs/i18n.md). Until that lands, a
 * document that loses characters says so out loud rather than printing
 * confident nonsense.
 */

/** Typographic glyphs with a faithful ASCII spelling — folded, never lost. */
function fold(text: string): string {
	return text
		.replace(/[‘’‚‛]/g, "'")
		.replace(/[“”„]/g, '"')
		.replace(/[–—]/g, "-")
		.replace(/…/g, "...")
		.replace(/×/g, "x");
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional WinAnsi clamp
const UNPRINTABLE = /[^\x20-\x7E\xA0-\xFF]/g;

/** Clamp to what pdf-lib's standard fonts can draw. */
export function toLatin1(text: string): string {
	return fold(text).replace(UNPRINTABLE, "");
}

/**
 * True when clamping would DROP characters — as opposed to merely folding a
 * curly quote to a straight one, which loses nothing a reader would miss. This
 * is the signal a document uses to warn that what it printed is not what it
 * was given.
 */
export function losesCharacters(text: string): boolean {
	const folded = fold(text);
	return folded.replace(UNPRINTABLE, "").length !== folded.length;
}

/**
 * Clamped and trimmed, or `undefined` when nothing printable survives — the
 * shape every "…else fall back to something we CAN print" decision wants.
 */
export function printable(text: string | undefined): string | undefined {
	if (text === undefined) return undefined;
	const clean = toLatin1(text).trim();
	return clean.length > 0 ? clean : undefined;
}
