import Clarity from "@microsoft/clarity";
import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { clientEnv } from "../lib/env";

let clarityInitialized = false;

/**
 * Routes Clarity must never boot on.
 *
 * Masking governs DOM content, not the recorded page address, and
 * `/track/<token>` carries the buyer's capability secret in the URL itself —
 * that token grants reading the order, claiming payment, and editing the
 * delivery address/phone with no auth (see CLAUDE.md). Recording it would
 * export the secret to Microsoft and to everyone with Clarity dashboard
 * access, weakening a boundary the architecture deliberately made unguessable.
 *
 * Nothing links to `/track` client-side — buyers always arrive from a WhatsApp
 * link, i.e. a fresh document load — so refusing to boot here is a complete
 * exclusion, not a partial one.
 */
export function isClarityExcludedPath(pathname: string): boolean {
	return pathname === "/track" || pathname.startsWith("/track/");
}

/**
 * Boots Microsoft Clarity (session replays + heatmaps) once on the client.
 *
 * No-ops when VITE_CLARITY_PROJECT_ID is unset, so local dev and preview
 * builds never pollute the production Clarity project. Unlike GA, there's
 * nothing to fire per navigation — Clarity hooks the History API on init and
 * tracks SPA route changes on its own; the pathname is read only to decide
 * whether booting is allowed at all.
 */
export function useClarity() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	useEffect(() => {
		const projectId = clientEnv.VITE_CLARITY_PROJECT_ID;
		if (!projectId || clarityInitialized) return;
		if (isClarityExcludedPath(pathname)) return;

		Clarity.init(projectId);
		clarityInitialized = true;
	}, [pathname]);
}
