import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import ReactGA from "react-ga4";
import { ensureGaInitialized } from "../lib/ga-events";

/**
 * Boots GA4 once on the client and fires a pageview per SPA navigation.
 * Custom funnel events share the same boot via `ensureGaInitialized` — see
 * `src/lib/ga-events.ts`, which owns the init flag.
 *
 * Never initializes or sends on `/track/*`: the tracking URL is the buyer's
 * capability secret (see `isCapabilityTokenPath`), and gtag auto-collects the
 * full `page_location` from the browser on every hit once loaded — so sending
 * a redacted path would not be enough; the library must never load there at
 * all. A buyer who lands on /track and later navigates into the storefront
 * boots GA on that first non-token pathname instead.
 */
export function useGoogleAnalytics() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	useEffect(() => {
		if (!ensureGaInitialized(pathname)) return;

		ReactGA.send({ hitType: "pageview", page: pathname });
	}, [pathname]);
}
