/**
 * The landing page's search + share copy — ONE author, because two routes
 * render the landing: `/` and a referral link's `/referral/<slug>`, whose
 * page falls back to exactly this copy when its link names no live invite.
 * The referral route once carried its own copy of these two strings, and it
 * had already drifted from the landing's title within a week (z8r3fdetf5).
 *
 * Exported constants, not a route file's locals: a route module's only
 * export should be `Route`, so the copy that both read lives here.
 */

/**
 * "Home sellers" was the pre-Jul-2026 ICP. The feature-grounded cohort is a
 * behaviour, not a venue — multi-outlet stalls, central kitchens and service
 * shops all match it and none of them sell from home. Keep this and the
 * Organization description below on the pattern, never on a venue or vertical.
 */
export const SEO_TITLE =
	"Kedaipal — WhatsApp Order Hub for Sellers in Malaysia & Singapore";
/**
 * Mirrors the hero: the locked 8 Sep 2026 tagline, then the promise. Kept
 * under 155 chars — Google truncates around 155-160, so the structural
 * differentiator ("no Meta setup") must sit inside the cut; a 173-char draft
 * put it at char 159 and `landing-seo.test.ts` now measures it. The regions
 * live in SEO_TITLE and the Organization description, not here — "for
 * Malaysia & Singapore" was the 20 chars that pushed the differentiator out.
 * "Free until your first order" is the start-when-you-sell framing (pricing
 * reset, 30 Aug), and still true under the 30 Sep trial model. This line never
 * names a trial length; the page states it once, in the FAQ answer, as "14
 * days or 200 orders" from the first order — the two bounds together
 * (landing-redesign.test.ts).
 */
export const SEO_DESC =
	"Sell on WhatsApp. Never lose an order or a payment. Orders, payments and couriers on one screen. Free until your first order, no Meta setup.";
