import Clarity from "@microsoft/clarity";
import { isCapabilityTokenPath } from "./analytics-privacy";
import { clientEnv } from "./env";
import type { FunnelEvent } from "./ga-events";
import { readMarketingSource } from "./marketing-attribution";

/**
 * Microsoft Clarity's half of the funnel (z8r3fdd1v2): every `FunnelEvent`
 * `trackEvent` emits is mirrored here as a Clarity **Smart event**, so the
 * weekly review can filter recordings by "clicked a signup CTA" instead of
 * hunting for them. Catalog + ritual: docs/analytics.md.
 *
 * The "Clarity is booted" flag lives here, not in `useClarity`, for the same
 * reason GA's lives in `ga-events.ts`: child-route effects run BEFORE the root
 * document's effect, so a route firing `land_marketing` on mount must be able
 * to boot the library itself rather than race the root hook.
 */

let clarityInitialized = false;

/**
 * The `upgrade` reason attached to sessions that clicked a signup CTA. Clarity
 * prioritises upgraded sessions for full recording, so the exact sessions the
 * weekly ritual wants to watch are never sampled away.
 */
export const SIGNUP_CTA_UPGRADE_REASON = "signup-cta";

/**
 * Boot Clarity once, iff allowed here: returns false (and never injects the
 * script) when the project ID is unset or `pathname` is a capability-token
 * route — `/track/*`/`/claim/*` URLs are the buyer's secret and a session
 * replay would export them alongside the buyer's checkout (see
 * `isCapabilityTokenPath`).
 */
export function ensureClarityInitialized(pathname: string): boolean {
	const projectId = clientEnv.VITE_CLARITY_PROJECT_ID;
	if (!projectId) return false;
	if (isCapabilityTokenPath(pathname)) return false;

	if (!clarityInitialized) {
		Clarity.init(projectId);
		clarityInitialized = true;
	}
	return true;
}

/**
 * Mirror a funnel event into Clarity. No-ops without a project ID and on
 * capability-token paths; never throws — analytics must never break the page.
 * That guard is load-bearing here: every Clarity API call is
 * `window.clarity(...)`, which does not exist until `init` injected the
 * script, so an unbooted call would throw.
 *
 * `cta_signup_click` also upgrades the session (see
 * `SIGNUP_CTA_UPGRADE_REASON`), and a captured marketing `src` is set as a
 * session tag so recordings segment by acquisition channel like GA does.
 */
export function trackClarityEvent(name: FunnelEvent): void {
	try {
		if (typeof window === "undefined") return;
		if (!ensureClarityInitialized(window.location.pathname)) return;

		const src = readMarketingSource();
		if (src) Clarity.setTag("src", src);

		Clarity.event(name);
		if (name === "cta_signup_click") Clarity.upgrade(SIGNUP_CTA_UPGRADE_REASON);
	} catch {
		// Swallow — see doc comment.
	}
}
