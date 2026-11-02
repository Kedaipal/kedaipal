import { useSyncExternalStore } from "react";

/** Tailwind's `lg` breakpoint — where the dashboard swaps bottom nav for the
 * sidebar, and where a list can afford to become a table. */
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
	const mql = window.matchMedia(DESKTOP_QUERY);
	mql.addEventListener("change", onChange);
	return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
	return window.matchMedia(DESKTOP_QUERY).matches;
}

/**
 * Whether the viewport is `lg` or wider — a JS gate, not just CSS, for
 * surfaces whose desktop and mobile shapes are different components rather
 * than one layout with responsive classes (the admin seller directory renders
 * a table on desktop and cards on a phone; rendering both and hiding one
 * would put 500 rows of dead DOM on a phone). The dashboard is client-only,
 * so the server snapshot is simply "not desktop": a phone never flashes a
 * table, and a desktop resolves on hydration.
 */
export function useIsDesktop(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
