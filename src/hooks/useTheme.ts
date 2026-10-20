import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useSyncExternalStore,
} from "react";
import {
	applyResolvedTheme,
	getServerThemeSnapshot,
	getThemeSnapshot,
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
 * Keeps the `.dark` class on <html> in step with the preference. Mounted once,
 * in the root shell.
 *
 * The pre-paint script already set the class before React ran, so on the happy
 * path this is an idempotent no-op. It stays for the moments the script cannot
 * reach: a preference change, an OS flip, another tab's choice — each of those
 * also writes the DOM directly in `lib/theme.ts`, and this layout effect is the
 * belt to those braces, running before paint so a change never flashes.
 *
 * It writes the STORE's value, never the rendered `resolved`. During hydration
 * React renders from the server snapshot ("light") and only afterwards
 * re-renders from the store, and this effect fires in between — written from
 * `resolved`, it stripped `.dark` off a page the script had already darkened
 * and put it back a second later: a white flash on every full load, and the
 * "components loaded on a white page, then it switched" Zaki saw on the
 * landing page (21 Oct 2026 hands-on test). The store has read storage by the
 * time any effect runs, so it is the truth on the client; `resolved` stays the
 * dependency because its changes are exactly the moments the DOM may have moved.
 * `useTheme.test.tsx` hydrates a darkened document and asserts it never passes
 * through light.
 */
export function useThemeSync(): { resolved: ResolvedTheme } {
	const { resolved } = useTheme();
	useIsomorphicLayoutEffect(() => {
		applyResolvedTheme(getThemeSnapshot().resolved);
	}, [resolved]);
	return { resolved };
}
