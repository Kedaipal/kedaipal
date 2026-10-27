import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { type Country, DEFAULT_COUNTRY } from "../../convex/lib/country";
import { readTimeZoneCountry } from "./useLandingRegion";

/**
 * Which market `/stores` shows (z8r3fdwduz): **geo-IP → time zone → MY**, and
 * nothing the visitor can flip. The marketplace is Shopee-style — a buyer sees
 * their own market's stores and never browses the other side — so unlike
 * `useLandingRegion` there is no stored pick and no setter. The pricing
 * toggle's cookie is deliberately NOT a signal here (see `readVisitorMarket`).
 *
 * The time zone only speaks where the edge gave no answer — `vite dev`,
 * `wrangler dev`, or an unplaceable IP (`XX`/`T1`).
 */
export function resolveMarketplaceRegion(signals: {
	server: Country | null;
	timeZone: Country | null;
}): Country {
	return signals.server ?? signals.timeZone ?? DEFAULT_COUNTRY;
}

/** The root loader's geo-only `market`, re-validated (loader data is `unknown`
 * to a hook that reads it off router state). */
function useServerMarket(): Country | null {
	return useRouterState({
		select: (state) => {
			const data = state.matches[0]?.loaderData as
				| { market?: unknown }
				| undefined;
			const market = data?.market;
			return market === "MY" || market === "SG" ? market : null;
		},
	});
}

/**
 * The buyer's market. First render — server and client — uses the server's
 * answer, so the SSR paint and hydration agree; the client corrects only where
 * the server had nothing to say.
 */
export function useMarketplaceRegion(): Country {
	const server = useServerMarket();
	const [region, setRegion] = useState<Country>(
		() => server ?? DEFAULT_COUNTRY,
	);
	/** Kept for the same reason as `useLandingRegion`'s: an error-retry
	 * `router.invalidate()` re-runs the root loader on the CLIENT, where it
	 * answers `null`, and that must not knock an SG buyer back to MY. */
	const lastServerAnswer = useRef<Country | null>(server);

	useEffect(() => {
		if (server) lastServerAnswer.current = server;
		setRegion(
			resolveMarketplaceRegion({
				server: lastServerAnswer.current,
				timeZone: readTimeZoneCountry(),
			}),
		);
	}, [server]);

	return region;
}
