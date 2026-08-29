import { useMatches } from "@tanstack/react-router";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useSyncExternalStore,
} from "react";
import {
	applyResolvedTheme,
	clearAppliedTheme,
	getServerThemeSnapshot,
	getThemeSnapshot,
	isThemedRouteId,
	type ResolvedTheme,
	setThemePreference,
	subscribeTheme,
	type ThemePreference,
} from "../lib/theme";

/** useLayoutEffect warns during SSR; on the server there is no paint to beat. */
const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type UseThemeResult = {
	/** What the user chose: "light", "dark" or "system". */
	preference: ThemePreference;
	/** What that currently means on this device — never "system". */
	resolved: ResolvedTheme;
	setPreference: (next: ThemePreference) => void;
};

/**
 * Reads and writes the device theme. Backed by the module store in
 * `lib/theme.ts`, so every caller (Appearance settings, the storefront toggle,
 * the toaster) stays in sync — including across browser tabs.
 *
 * During SSR and the first hydration pass this reports the light default; the
 * pre-paint script has already put the real class on <html>, so the PAGE is
 * correct even while this value is catching up. Don't drive layout off
 * `resolved` — use it only where a value must be handed to a non-CSS consumer
 * (sonner's theme prop, a canvas fill, an aria-label).
 */
export function useTheme(): UseThemeResult {
	const snapshot = useSyncExternalStore(
		subscribeTheme,
		getThemeSnapshot,
		getServerThemeSnapshot,
	);

	const setPreference = useCallback((next: ThemePreference) => {
		setThemePreference(next);
	}, []);

	return {
		preference: snapshot.preference,
		resolved: snapshot.resolved,
		setPreference,
	};
}

/**
 * Keeps the `.dark` class on <html> in step with BOTH the preference and the
 * current route. Mounted once, in the root shell.
 *
 * Three jobs, and each is load-bearing:
 *  1. Marketing routes stay light. Navigating `/app` → `/pricing` is a SPA
 *     transition, so nothing else would ever take the class back off.
 *  2. It re-applies on every commit, which repairs the one case the pre-paint
 *     script cannot: when hydration fails and React re-renders the root, it
 *     strips every attribute off <html> — class and colorScheme included — and
 *     a dark-mode seller would otherwise sit on a white page until they
 *     reloaded. The DOM write is idempotent, so this costs nothing normally.
 *  3. It runs in a layout effect, before paint, so entering `/app` from a
 *     marketing page doesn't flash light first.
 *
 * Returns whether the current route is themed, so the shell knows whether to
 * emit the pre-paint script at all.
 */
export function useThemeScope(): { themed: boolean; resolved: ResolvedTheme } {
	const { resolved } = useTheme();
	const themed = useMatches().some((m) => isThemedRouteId(m.routeId));

	useIsomorphicLayoutEffect(() => {
		if (themed) applyResolvedTheme(resolved);
		else clearAppliedTheme();
	}, [themed, resolved]);

	return { themed, resolved };
}
