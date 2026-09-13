import {
	ATTRIBUTION_PARAMS,
	sanitizeAttributionSource,
} from "../../convex/lib/attribution";
import {
	REFERRER_STORE_PARAM,
	sanitizeReferrerSlug,
} from "../../convex/lib/poweredBy";

/**
 * Kedaipal's OWN acquisition attribution (z8r3fdd1v0) — "where did this
 * SELLER come from", the seller-side sibling of the buyer-side storefront
 * capture in `useSourceAttribution` (86eyq0eq9). A marketing-route hit
 * arriving with `?src=` (fallback `utm_source`) persists the tag for the
 * session; it rides every GA4 funnel event (see `ga-events.ts`) and lands on
 * the retailer record at signup as `retailers.signupSource`.
 *
 * A second value rides beside it (z8r3fdcwd0): `?store=<slug>`, the store
 * whose "Powered by Kedaipal" badge the visitor clicked. It lands as
 * `retailers.signupReferrerId`, so the admin console can say which sellers
 * bring us sellers. It travels WITH the tag, never alone — see
 * `captureMarketingSource`.
 *
 * Why sessionStorage and not the URL: the funnel crosses the Clerk sign-up
 * redirect, and query params get mangled round-tripping through it (see
 * `onboarding-link.ts`) — same-origin sessionStorage survives the whole
 * marketing → sign-up → onboarding path in one tab. Same last-touch rule as
 * the buyer side: a later hit WITH a tag overwrites, a hit without one leaves
 * the stored tag alone. Own storage keys, so a seller browsing a storefront
 * and kedaipal.com in one tab can never cross-attribute.
 *
 * Naming convention for tags Kedaipal itself emits: `powered-by` (+ the
 * per-surface `powered-by-track` / `-claim` / `-receipt`, one author:
 * convex/lib/poweredBy.ts), `spotlight-<member>`, `referral-<member>`,
 * `tiktok-live`, `directory`, `qr-poster`. Free-form tags still sanitize and
 * store verbatim.
 */

const MARKETING_SRC_KEY = "kedaipal:marketing-src";
/** The referring STORE's slug — only ever set alongside a tag. */
const MARKETING_REF_STORE_KEY = "kedaipal:marketing-ref-store";

/**
 * Capture the visit's `?src=`/`utm_source` tag (and the `?store=` referrer
 * beside it), if present. Never throws.
 */
export function captureMarketingSource(search: string): void {
	try {
		const params = new URLSearchParams(search);
		// First param that yields a USABLE tag wins — `?src=&utm_source=x` reads
		// as x (an empty `?src=` is an authoring accident), while a garbage
		// `src` still wins because it sanitizes to "other" (a real signal).
		let tag: string | undefined;
		for (const key of ATTRIBUTION_PARAMS) {
			tag = sanitizeAttributionSource(params.get(key));
			if (tag) break;
		}
		if (!tag) return;
		sessionStorage.setItem(MARKETING_SRC_KEY, tag);
		// The referrer describes THIS tagged visit, so it is rewritten in
		// lockstep with the tag: a tagged hit without `store=` clears a stale
		// one (a spotlight link must not inherit a badge's referrer), and a
		// `store=` arriving without any tag says nothing and never gets here.
		const referrer = sanitizeReferrerSlug(params.get(REFERRER_STORE_PARAM));
		if (referrer) sessionStorage.setItem(MARKETING_REF_STORE_KEY, referrer);
		else sessionStorage.removeItem(MARKETING_REF_STORE_KEY);
	} catch {
		// Storage/URL access denied — attribution is best-effort, never fatal.
	}
}

/** The tag this session arrived with, or undefined (= untagged/direct). */
export function readMarketingSource(): string | undefined {
	try {
		return sessionStorage.getItem(MARKETING_SRC_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * The slug of the store whose powered-by badge this session came through, or
 * undefined (no badge, or a tag that carried no referrer).
 */
export function readMarketingReferrerStore(): string | undefined {
	try {
		return sessionStorage.getItem(MARKETING_REF_STORE_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}
