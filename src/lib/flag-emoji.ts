/**
 * Country flags for the buyer's picker, at zero bytes (z8r3fdm36y follow-up).
 *
 * The picker listed 241 countries with a real flag for exactly two of them
 * (MY and SG, whose SVGs were drawn for the SELLER's fixed plate and reused
 * here) and a two-letter ISO badge for everyone else — which reads as a
 * half-finished feature rather than a decision.
 *
 * Shipping flag artwork was priced and rejected, with numbers: all 271
 * `flag-icons` SVGs are 2.0 MB raw / **600 KB gzipped** (most of that weight is
 * coats of arms that are invisible at 28x14 px), and a 2x retina WebP sprite of
 * the same set measures **91 KB**. Buyers arrive cold from a WhatsApp link on
 * mobile data, so neither is worth it for decoration.
 *
 * So the flags come from the OS emoji font instead and cost nothing to ship.
 *
 * **The catch, and why `supportsFlagEmoji` exists.** Windows' Segoe UI Emoji
 * has no flag glyphs at all: a regional-indicator pair renders there as the two
 * letters, so a naive emoji switch would quietly look WORSE than the badge it
 * replaced. We detect it once and let the whole list fall back to badges
 * together, so any one device is internally consistent — flags everywhere, or
 * badges everywhere, never a mix.
 */

import { useSyncExternalStore } from "react";

/** `"JP"` → `"🇯🇵"` — the two regional indicator symbols for the ISO code. */
export function flagEmoji(iso: string): string {
	const code = iso.trim().toUpperCase();
	if (!/^[A-Z]{2}$/.test(code)) return "";
	return String.fromCodePoint(
		...[...code].map((ch) => 0x1f1e6 + (ch.charCodeAt(0) - 65)),
	);
}

/** Memoised across calls — the answer can't change for a given device/session,
 * and the measurement touches canvas. */
let cached: boolean | undefined;

/**
 * Does this device actually draw a flag for a regional-indicator pair?
 *
 * A pair that composes renders as ONE glyph, so it measures about as wide as a
 * single indicator. Where there is no flag glyph the two fall back to separate
 * letterforms and the pair measures roughly twice as wide. That width ratio is
 * the whole test.
 *
 * Returns `false` without a DOM (SSR) and on any canvas failure — the badge is
 * the safe answer, because it is what shipped before and it always renders.
 */
export function supportsFlagEmoji(): boolean {
	if (cached !== undefined) return cached;
	// No DOM to measure with. Deliberately NOT cached: this is SSR, and the
	// client that hydrates can measure for real.
	if (typeof document === "undefined") return false;
	cached = measureFlagSupport();
	return cached;
}

/** The measurement itself, kept separate from the memo so each does one job. */
function measureFlagSupport(): boolean {
	try {
		const ctx = document.createElement("canvas").getContext("2d");
		if (!ctx) return false;
		ctx.font = "32px system-ui";
		const pair = ctx.measureText(flagEmoji("MY")).width;
		const single = ctx.measureText(String.fromCodePoint(0x1f1f2)).width;
		// Zero-width metrics mean we learned nothing; the badge always renders.
		if (!pair || !single) return false;
		return pair < single * 1.8;
	} catch {
		return false;
	}
}

/**
 * React binding for the probe, SSR-safe by construction.
 *
 * `useSyncExternalStore` renders `getServerSnapshot` on the server AND through
 * hydration, then re-renders with `getSnapshot` — so the first client paint
 * always matches the HTML and the flags arrive a tick later, instead of
 * tripping a hydration mismatch.
 *
 * This is not theoretical. The plate is SSR'd with whatever dial country it was
 * given, and since `z8r3fdh274` that can be a FOREIGN one (the `/track` number
 * repair form prefills the country of the number that failed). The server has
 * no `document`, so it draws the ISO badge; a flag-capable client would have
 * drawn the emoji. Buyer loaders happen to discard the SSR payload today, which
 * is the only reason nothing mismatches yet — closing that double-fetch
 * (`86eydh4vd`) would have turned this into a real warning and flash.
 */
export function useFlagEmojiSupport(): boolean {
	return useSyncExternalStore(subscribeNever, supportsFlagEmoji, serverFalse);
}

/** The answer can't change for a device, so there is nothing to subscribe to. */
function subscribeNever(): () => void {
	return () => {};
}

/** No DOM on the server: the badge is what the HTML must contain. */
function serverFalse(): boolean {
	return false;
}

/** Tests only — the memo would otherwise leak between cases. */
export function resetFlagEmojiSupportForTest(value?: boolean): void {
	cached = value;
}
