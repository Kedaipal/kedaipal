import { useEffect } from "react";
import { trackEvent } from "../lib/ga-events";
import { captureMarketingSource } from "../lib/marketing-attribution";

/**
 * Mounted on every marketing route (`/`, `/pricing`, `/cost`): captures the
 * visit's `?src=`/`utm_source` tag (z8r3fdd1v0 — see `marketing-attribution`)
 * and fires the `land_marketing` funnel event.
 *
 * Capture runs FIRST so the landing event already carries the tag it arrived
 * with. The event fires once per page load — SPA-navigating between marketing
 * routes is one landing, not three (GA4's own page_location says which route
 * it was); capture still runs on every mount so a later tagged hit keeps
 * last-touch semantics.
 */

let landed = false;

export function useMarketingLanding(): void {
	useEffect(() => {
		captureMarketingSource(window.location.search);
		if (landed) return;
		landed = true;
		trackEvent("land_marketing");
	}, []);
}
