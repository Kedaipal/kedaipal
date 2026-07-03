import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import ReactGA from "react-ga4";
import { clientEnv } from "../lib/env";

let gaInitialized = false;

export function useGoogleAnalytics() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	useEffect(() => {
		const id = clientEnv.VITE_GA_MEASUREMENT_ID;
		if (!id) return;

		if (!gaInitialized) {
			ReactGA.initialize(id);
			gaInitialized = true;
		}

		ReactGA.send({ hitType: "pageview", page: pathname });
	}, [pathname]);
}
