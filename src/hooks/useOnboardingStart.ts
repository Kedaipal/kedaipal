import { useEffect, useRef } from "react";
import { trackEvent } from "../lib/ga-events";
import { captureMarketingSource } from "../lib/marketing-attribution";

/**
 * Fires the `onboarding_start` funnel event (z8r3fdd1v0) — but only once the
 * retailer query has resolved to "no store yet" (`null`). Gating on the
 * resolved state, not on mount, is load-bearing: an already-onboarded seller
 * who lands on /onboarding (stale bookmark, reused invite link, back button)
 * is redirected to /app a beat later, and counting them as a funnel entry
 * would depress the onboarding_start → store_created conversion this ticket
 * exists to measure.
 *
 * Capture runs first so a directly shared /onboarding?src=… link tags the
 * event (normally the tag was stored back on the marketing route and rode
 * sessionStorage through the Clerk redirect).
 *
 * `retailer`: the `getMyRetailer` result — `undefined` = loading, `null` = no
 * store yet, object = already onboarded.
 */
export function useOnboardingStart(retailer: object | null | undefined): void {
	const fired = useRef(false);
	useEffect(() => {
		if (retailer !== null) return;
		if (fired.current) return;
		fired.current = true;
		captureMarketingSource(window.location.search);
		trackEvent("onboarding_start");
	}, [retailer]);
}
