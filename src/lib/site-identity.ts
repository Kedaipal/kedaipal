/**
 * The facts about Kedaipal-the-company that every public surface repeats —
 * the Organization JSON-LD on `/`, the footer's social links, `/llms.txt`, and
 * the canonical block pasted into third-party directories (z8r3fdh2z8).
 *
 * One author, because the audit (22 Sep 2026) found the footer linking to
 * profiles the schema never declared, and the GEO ticket's whole premise is
 * that a listing which disagrees with the site makes an answer engine hedge.
 * A profile URL or the description changes here and nowhere else.
 */

import { INSTAGRAM_URL, TIKTOK_URL } from "./site-links";

export const SITE_URL = "https://kedaipal.com";

/** The entity behind the product. Singapore-incorporated (see `/terms`). */
export const LEGAL_ENTITY = "Kedaipal Pte. Ltd.";
export const LEGAL_COUNTRY = "SG";
export const FOUNDING_DATE = "2026";

/** The 8 Sep 2026 positioning — the pattern, never a venue or vertical. */
export const ORG_DESCRIPTION =
	"B2B SaaS order hub for sellers in Malaysia and Singapore who take orders, deposits and bookings in WhatsApp — meat suppliers, central kitchens, bakers, service shops and apparel drops. Real storefront, real order pipeline, courier booking from the order, no Meta setup needed.";

export const SUPPORT_EMAIL = "hello@kedaipal.com";

/** Where Kedaipal sells. ISO 3166-1 alpha-2, the order the product lists them. */
export const AREA_SERVED = ["MY", "SG"] as const;

/** Every language the product and support speak. */
export const AVAILABLE_LANGUAGES = ["en", "ms", "zh"] as const;

/**
 * Public profiles, in the order the footer shows them. The URLs themselves
 * are `site-links.ts` constants (where `footer.test.tsx` pins the live
 * handles — a wrong one once shipped). Add a directory here once its listing
 * is live and it joins `sameAs` automatically.
 */
export const SOCIAL_LINKS = [
	{ id: "instagram", label: "Instagram", url: INSTAGRAM_URL },
	{ id: "tiktok", label: "TikTok", url: TIKTOK_URL },
] as const;

export type SocialLinkId = (typeof SOCIAL_LINKS)[number]["id"];

export const SAME_AS: readonly string[] = SOCIAL_LINKS.map((l) => l.url);
