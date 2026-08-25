import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import ReactGA from "react-ga4";
import { isTrackingTokenPath } from "../lib/analytics-privacy";
import { clientEnv } from "../lib/env";

let gaInitialized = false;

/**
 * Boots GA4 once on the client and fires a pageview per SPA navigation.
 *
 * Never initializes or sends on `/track/*`: the tracking URL is the buyer's
 * capability secret (see `isTrackingTokenPath`), and gtag auto-collects the
 * full `page_location` from the browser on every hit once loaded — so sending
 * a redacted path would not be enough; the library must never load there at
 * all. A buyer who lands on /track and later navigates into the storefront
 * boots GA on that first non-token pathname instead.
 */
export function useGoogleAnalytics() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	useEffect(() => {
		const id = clientEnv.VITE_GA_MEASUREMENT_ID;
		if (!id) return;
		if (isTrackingTokenPath(pathname)) return;

		if (!gaInitialized) {
			ReactGA.initialize(id);
			gaInitialized = true;
		}

		ReactGA.send({ hitType: "pageview", page: pathname });
	}, [pathname]);
}
