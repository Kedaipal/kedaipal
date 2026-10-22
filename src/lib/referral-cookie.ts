import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { sanitizeReferrerSlug } from "../../convex/lib/poweredBy";

/**
 * The referral a visitor arrived with (z8r3fdetf5, docs/referrals.md) — the
 * slug of the store whose `/referral/<slug>` link they opened, kept for 30
 * days so it reaches `createRetailer` even when the signup happens another
 * day.
 *
 * A cookie, not sessionStorage like the marketing tag (`marketing-attribution.ts`):
 * a referral carries a PROMISE — bonus credits, named on the page — and a
 * session dies with the tab. A referee who taps the link in WhatsApp, closes
 * it, and signs up tomorrow by typing kedaipal.com must still be the referee
 * they were told they are. A cookie also reaches the server, so the landing
 * can reserve the invite's space in the first paint instead of shifting the
 * hero when it arrives.
 *
 * Written only for an invite that resolved (the page showed the offer); the
 * server re-checks the referrer at signup either way. Cleared once the store
 * is created — the referral is recorded then, and has nothing left to do.
 * First-party, `SameSite=Lax`, no PII (a public store slug).
 */
export const REFERRAL_COOKIE = "kp_referral";

/** 30 days: long enough for "I'll set it up this weekend", short enough that
 * a link opened months ago doesn't quietly decide a later signup. */
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** A stored value → a slug worth looking up, or undefined. Client-written, so
 * anything not shaped like a slug degrades to "no referral", never a crash. */
export function parseReferralCookie(
	value: string | null | undefined,
): string | undefined {
	return sanitizeReferrerSlug(value);
}

/** Read the referral slug out of a `document.cookie`-shaped string. Never
 * throws — `decodeURIComponent` raises on a malformed escape. */
export function readReferralSlug(cookieHeader: string): string | undefined {
	for (const part of cookieHeader.split(";")) {
		const [name, ...rest] = part.split("=");
		if (name?.trim() !== REFERRAL_COOKIE) continue;
		try {
			return parseReferralCookie(decodeURIComponent(rest.join("=")));
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function writeCookie(value: string, maxAge: number): void {
	try {
		const secure = window.location.protocol === "https:" ? "; Secure" : "";
		// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is unavailable in Safari and Firefox, and the SSR render must be able to read this cookie on the next request — same reasoning as the region cookie (useLandingRegion).
		document.cookie = `${REFERRAL_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
	} catch {
		// Cookies blocked — the referral still holds for this tab via the
		// marketing tag; it just won't survive a closed tab.
	}
}

/** Remember the referral the visitor just saw (latest link wins). */
export function writeReferralCookie(slug: string): void {
	const clean = parseReferralCookie(slug);
	if (clean) writeCookie(clean, REFERRAL_COOKIE_MAX_AGE_SECONDS);
}

/** Forget it — the store has been created and the referral recorded. */
export function clearReferralCookie(): void {
	writeCookie("", 0);
}

/**
 * The referral slug as the SERVER sees it, for the root loader — so the
 * landing knows during SSR that an invite is coming and holds its place.
 * `createIsomorphicFn` keeps the server-only import out of the client
 * bundle; the client arm answers null (the hook reads `document.cookie`
 * itself after mount).
 */
export const readReferralSlugOnServer = createIsomorphicFn()
	.server((): string | null => {
		try {
			return parseReferralCookie(getCookie(REFERRAL_COOKIE)) ?? null;
		} catch {
			// No request in scope (a prerender pass, a test render).
			return null;
		}
	})
	.client((): string | null => null);
