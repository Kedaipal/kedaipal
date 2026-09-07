import {
	ATTRIBUTION_PARAMS,
	sanitizeAttributionSource,
} from "../../convex/lib/attribution";

/**
 * Kedaipal's OWN acquisition attribution (z8r3fdd1v0) — "where did this
 * SELLER come from", the seller-side sibling of the buyer-side storefront
 * capture in `useSourceAttribution` (86eyq0eq9). A marketing-route hit
 * arriving with `?src=` (fallback `utm_source`) persists the tag for the
 * session; it rides every GA4 funnel event (see `ga-events.ts`) and lands on
 * the retailer record at signup as `retailers.signupSource`.
 *
 * Why sessionStorage and not the URL: the funnel crosses the Clerk sign-up
 * redirect, and query params get mangled round-tripping through it (see
 * `onboarding-link.ts`) — same-origin sessionStorage survives the whole
 * marketing → sign-up → onboarding path in one tab. Same last-touch rule as
 * the buyer side: a later hit WITH a tag overwrites, a hit without one leaves
 * the stored tag alone. Own storage key, so a seller browsing a storefront
 * and kedaipal.com in one tab can never cross-attribute.
 *
 * Naming convention for tags Kedaipal itself emits: `powered-by`,
 * `spotlight-<member>`, `referral-<member>`, `tiktok-live`, `directory`,
 * `qr-poster`. Free-form tags still sanitize and store verbatim.
 */

const MARKETING_SRC_KEY = "kedaipal:marketing-src";

/** Capture the visit's `?src=`/`utm_source` tag, if present. Never throws. */
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
		if (tag) sessionStorage.setItem(MARKETING_SRC_KEY, tag);
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
