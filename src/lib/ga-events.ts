import ReactGA from "react-ga4";
import { extractGaClientId } from "../../convex/lib/ga4";
import { isCapabilityTokenPath } from "./analytics-privacy";
import { trackClarityEvent } from "./clarity-events";
import { clientEnv } from "./env";
import {
	readMarketingReferrerStore,
	readMarketingSource,
} from "./marketing-attribution";

/**
 * Custom events for the acquisition funnel (z8r3fdd1v0):
 * `land_marketing` → `view_pricing`/`calc_used` → `cta_signup_click` →
 * `onboarding_start` → `store_created`. Event catalog + which are marked as
 * key events in the GA4 UI: docs/analytics.md.
 *
 * `trackEvent` is the funnel's SINGLE emitter: it fans out to GA4 (here) and
 * to Microsoft Clarity as Smart events (`clarity-events.ts`, z8r3fdd1v2),
 * each provider gated independently on its own env var so an unset GA never
 * silences Clarity or vice-versa. Call sites know nothing about providers.
 *
 * One shared "GA is booted" flag lives here — `useGoogleAnalytics` (pageviews)
 * and `trackEvent` (custom events) both go through `ensureGaInitialized`, so
 * whichever runs first boots the library exactly once. That matters because
 * child-route effects run BEFORE the root document's effect: a route firing
 * `land_marketing` on mount must not race the pageview hook's init.
 */

/**
 * The funnel event catalog — the ONLY names `trackEvent` accepts, so a typo'd
 * call site is a compile error, not a stray GA4 event nobody notices (GA
 * validates nothing at send time). Widen here, and mirror docs/analytics.md.
 */
export type FunnelEvent =
	| "land_marketing"
	| "view_pricing"
	| "calc_used"
	| "cta_signup_click"
	| "onboarding_start"
	| "store_created";

let gaInitialized = false;

/**
 * Boot GA4 once, iff allowed here: returns false (and never loads the
 * library) when the measurement ID is unset or `pathname` is a
 * capability-token route — `/track/*`/`/claim/*` URLs are the buyer's secret
 * and gtag auto-collects the full page_location once loaded (see
 * `useGoogleAnalytics` for the long-form rationale).
 */
export function ensureGaInitialized(pathname: string): boolean {
	const id = clientEnv.VITE_GA_MEASUREMENT_ID;
	if (!id) return false;
	if (isCapabilityTokenPath(pathname)) return false;

	if (!gaInitialized) {
		ReactGA.initialize(id);
		gaInitialized = true;
	}
	return true;
}

/**
 * Fire a funnel event to every provider. Clarity gets the bare name (its own
 * gate + `src` tag live in `trackClarityEvent`); GA4 gets the name plus
 * params, with the captured marketing `src` (if any) attached to EVERY event
 * so the funnel stays segmentable by source end to end — and, when the
 * session came through another seller's powered-by badge, `ref_store` (that
 * store's slug, z8r3fdcwd0) beside it. An explicit `src` in `params` out-ranks
 * the stored one. GA no-ops without a measurement ID and on capability-token
 * paths; never throws — analytics must never break the page.
 */
export function trackEvent(
	name: FunnelEvent,
	params?: Record<string, string | number | boolean>,
): void {
	try {
		if (typeof window === "undefined") return;
		trackClarityEvent(name);
		if (!ensureGaInitialized(window.location.pathname)) return;
		const src = readMarketingSource();
		const refStore = readMarketingReferrerStore();
		ReactGA.event(name, {
			...(src ? { src } : {}),
			...(refStore ? { ref_store: refStore } : {}),
			...params,
		});
	} catch {
		// Swallow — see doc comment.
	}
}

/**
 * The visitor's GA4 client id from the `_ga` cookie, or undefined (GA never
 * booted here — ad-blocker, unset env). Captured at signup and stored as
 * `retailers.gaClientId` so the SERVER-side key events (`first_order`,
 * `subscribe_paid` — see convex/ga4Events.ts) stitch into the same GA4 user
 * journey as the client funnel. Parsing is shared with the server catalog
 * (convex/lib/ga4.ts) so validation can never drift. Never throws.
 */
export function readGaClientId(): string | undefined {
	try {
		if (typeof document === "undefined") return undefined;
		return extractGaClientId(document.cookie);
	} catch {
		return undefined;
	}
}

/**
 * A signup CTA was clicked. `placement` names the surface ("nav", "hero",
 * "final-cta", "pricing-teaser", "pricing-card", …) so the funnel can say
 * WHICH button converts, not just that one did.
 */
export function trackSignupCta(placement: string): void {
	trackEvent("cta_signup_click", { placement });
}
