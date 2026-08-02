import Clarity from "@microsoft/clarity";
import { useEffect } from "react";
import { clientEnv } from "../lib/env";

let clarityInitialized = false;

/**
 * Boots Microsoft Clarity (session replays + heatmaps) once on the client.
 *
 * No-ops when VITE_CLARITY_PROJECT_ID is unset, so local dev and preview
 * builds never pollute the production Clarity project. Unlike GA, there's
 * nothing to fire per navigation — Clarity hooks the History API on init and
 * tracks SPA route changes on its own.
 */
export function useClarity() {
	useEffect(() => {
		const projectId = clientEnv.VITE_CLARITY_PROJECT_ID;
		if (!projectId || clarityInitialized) return;

		Clarity.init(projectId);
		clarityInitialized = true;
	}, []);
}
