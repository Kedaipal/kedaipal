import Clarity from "@microsoft/clarity";
import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { isTrackingTokenPath } from "../lib/analytics-privacy";
import { clientEnv } from "../lib/env";

let clarityInitialized = false;

/**
 * Boots Microsoft Clarity (session replays + heatmaps) once on the client.
 *
 * No-ops when VITE_CLARITY_PROJECT_ID is unset, so local dev and preview
 * builds never pollute the production Clarity project. Unlike GA, there's
 * nothing to fire per navigation — Clarity hooks the History API on init and
 * tracks SPA route changes on its own; the pathname is read only to decide
 * whether booting is allowed at all.
 *
 * Never boots on `/track/*` — the tracking URL is the buyer's capability
 * secret; see `isTrackingTokenPath` for the full rationale shared with
 * `useGoogleAnalytics`.
 */
export function useClarity() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	useEffect(() => {
		const projectId = clientEnv.VITE_CLARITY_PROJECT_ID;
		if (!projectId || clarityInitialized) return;
		if (isTrackingTokenPath(pathname)) return;

		Clarity.init(projectId);
		clarityInitialized = true;
	}, [pathname]);
}
