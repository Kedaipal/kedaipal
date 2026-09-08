/**
 * "Powered by Kedaipal" — the buyer-facing growth loop's ONE link builder
 * (86ey8zh3r, widened to every buyer surface in z8r3fdcwd0).
 *
 * Every buyer-facing surface (storefront pages, the order tracking page, the
 * claim-link checkout, the order receipt/invoice PDF, the despatch label)
 * carries a badge that links back to the marketing site. The link is tagged
 * so a seller who signs up after seeing another seller's badge is attributable
 * twice over:
 *
 *   - `?src=powered-by[-<surface>]` — WHICH surface the click came from. Rides
 *     Kedaipal's own acquisition funnel (`src/lib/marketing-attribution.ts` →
 *     GA4 events → `retailers.signupSource`). Surfaces are suffixed rather
 *     than folded into one tag because "does the receipt badge convert at all"
 *     is the question that decides whether it is worth polishing; the bare
 *     `powered-by` stays the storefront's tag so its GA history is continuous.
 *   - `&store=<slug>` — WHOSE badge. Captured alongside the tag and stamped as
 *     `retailers.signupReferrerId` at signup, so the admin console can answer
 *     "which of our sellers bring us sellers" (the ticket's CAC ledger).
 *
 * Pure module, no Convex imports: shared by the web footer, the PDF renderer
 * and the server-side sanitizer so no side can disagree on the tag vocabulary
 * or the URL shape. Same posture as `attribution.ts`.
 */

import { SLUG_MAX, SLUG_MIN } from "./slug";

/** The marketing site the badge points at — never a storefront. */
export const MARKETING_SITE_URL = "https://kedaipal.com";

/**
 * Which buyer surface the badge sits on → its `?src=` tag. Extending this map
 * is the whole cost of a new surface; the tag vocabulary is documented in
 * docs/analytics.md ("Naming convention").
 */
export const POWERED_BY_TAGS = {
	/** Store home, category, product and checkout pages. */
	storefront: "powered-by",
	/** The buyer's order page, `/track/<token>`. */
	track: "powered-by-track",
	/** The claim-link checkout, `/claim/<token>`. */
	claim: "powered-by-claim",
	/** The order receipt / invoice PDF (a clickable link annotation). */
	receipt: "powered-by-receipt",
} as const;

export type PoweredBySurface = keyof typeof POWERED_BY_TAGS;

/** Query param carrying the referring store's slug. */
export const REFERRER_STORE_PARAM = "store";

/**
 * The badge's href for a surface. `slug` is the store whose surface it is —
 * omitted where no store is in scope yet (a loading skeleton, a not-found
 * page for an unknown slug), in which case the link is tagged but unattributed
 * to a store.
 */
export function poweredByHref(
	surface: PoweredBySurface,
	slug?: string,
): string {
	const params = new URLSearchParams({ src: POWERED_BY_TAGS[surface] });
	const ref = sanitizeReferrerSlug(slug);
	if (ref) params.set(REFERRER_STORE_PARAM, ref);
	return `${MARKETING_SITE_URL}/?${params.toString()}`;
}

/**
 * The one line the paper label prints — a despatch label is stuck to a parcel,
 * so there is nothing to click and the URL has to be read by a human.
 */
export const POWERED_BY_PRINT_LINE = "Powered by Kedaipal · kedaipal.com";

const SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Sanitize a raw `?store=` value into a slug worth looking up, or undefined.
 *
 * Stricter than `sanitizeAttributionSource`: a referrer that isn't shaped like
 * one of our slugs can't name a store, so it is dropped rather than bucketed —
 * there is no "other" store. Shape only; whether the slug exists is the
 * server's question (`createRetailer` resolves it against `by_slug`). Never
 * throws.
 */
export function sanitizeReferrerSlug(
	raw: string | null | undefined,
): string | undefined {
	if (raw == null) return undefined;
	const s = raw.trim().toLowerCase();
	if (s.length < SLUG_MIN || s.length > SLUG_MAX) return undefined;
	return SLUG_SHAPE.test(s) ? s : undefined;
}
