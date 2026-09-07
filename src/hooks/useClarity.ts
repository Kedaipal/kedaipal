import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { ensureClarityInitialized } from "../lib/clarity-events";

/**
 * Boots Microsoft Clarity (session replays + heatmaps) once on the client.
 * The funnel's Smart events share the same boot via `ensureClarityInitialized`
 * — see `src/lib/clarity-events.ts`, which owns the init flag (a route firing
 * `land_marketing` on mount runs before this root effect, so the flag can't
 * live here).
 *
 * No-ops when VITE_CLARITY_PROJECT_ID is unset, so local dev and preview
 * builds never pollute the production Clarity project. Unlike GA, there's
 * nothing to fire per navigation — Clarity hooks the History API on init and
 * tracks SPA route changes on its own; the pathname is read only to decide
 * whether booting is allowed at all.
 *
 * Never boots on `/track/*` or `/claim/*` — those URLs are the buyer's
 * capability secret; see `isCapabilityTokenPath` for the full rationale shared
 * with `useGoogleAnalytics`.
 */
export function useClarity() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	useEffect(() => {
		ensureClarityInitialized(pathname);
	}, [pathname]);
}
