/**
 * Theme (light / dark) — the one source of truth for both the seller dashboard
 * and the buyer storefront (z8r3fdadub).
 *
 * WHY A MODULE STORE AND NOT A CONTEXT: the theme is global browser state, read
 * from several disconnected places at once — the Appearance settings screen, the
 * storefront's own toggle, and `<Toaster>` up in `__root.tsx` outside every
 * provider. A context would force a provider above all of them and still not
 * cover a second tab. `useSyncExternalStore` over this module keeps every reader
 * in sync, follows the OS when the preference is "system", and mirrors changes
 * across tabs via the `storage` event.
 *
 * WHY localStorage AND NOT CONVEX: this is a per-DEVICE preference, not a per-
 * ACCOUNT one — a seller working the counter on a bright phone and doing the
 * evening's orders on a laptop in bed wants different answers, and syncing would
 * fight that. Buyers have no account at all, so the storefront has nowhere else
 * to put it. Same key for both surfaces: one origin, one browser, one human —
 * "this device is in dark mode" is the honest mental model. It joins the
 * existing `kedaipal:` client-preference family (`kedaipal:cart:*`,
 * `kedaipal:src:*`, `kedaipal:lastAddress*`).
 *
 * WHY NOT A COOKIE, given buyer routes SSR: because the DEFAULT preference is
 * "system", and the server cannot resolve it. `prefers-color-scheme` never
 * reaches the server (no client hints here, and no SSR code reads request
 * headers), so a cookie holding "system" leaves the server exactly as blind —
 * we would ship both mechanisms and still need the script for the common case.
 * The one cookie-backed preference we do have, Paraglide's locale, pays for
 * server resolution with a full page RELOAD on change (docs/i18n.md) — fine for
 * a language switch, unacceptable for a theme toggle. (Note for reviewers: this
 * is NOT an edge-caching argument. Nothing in this app caches SSR HTML today.)
 *
 * THE FLASH: the class must be on <html> before first paint or every visitor
 * gets a white flash on a dark page. React can't do that (it paints after
 * hydration), so `THEME_INIT_SCRIPT` runs synchronously in <head>. Everything
 * here must agree with that script — change one, change the other, and
 * `theme.dom.test.ts` pins them together with a truth table.
 *
 * WHERE IT APPLIES: the seller app (`/app/*`) and the buyer surfaces
 * (storefront, /track, /claim) only — see `isThemedRouteId`. The marketing site
 * stays light: it is a designed brand surface with hardcoded mesh backgrounds,
 * and it is deliberately out of this ticket's scope.
 */

import { isBuyerRouteId } from "./buyer-routes";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Shared with THEME_INIT_SCRIPT — keep in sync (pinned by theme.dom.test.ts). */
export const THEME_STORAGE_KEY = "kedaipal:theme";

export const THEME_PREFERENCES: readonly ThemePreference[] = [
	"light",
	"dark",
	"system",
];

/**
 * "system" by default: the visitor's OS already answered this question, and a
 * buyer arriving cold from a WhatsApp link should never have to answer it again.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === "light" || value === "dark" || value === "system";
}

export function systemPrefersDark(): boolean {
	if (typeof window === "undefined" || !window.matchMedia) return false;
	try {
		return window.matchMedia(DARK_QUERY).matches;
	} catch {
		return false;
	}
}

export function resolveTheme(
	preference: ThemePreference,
	prefersDark: boolean = systemPrefersDark(),
): ResolvedTheme {
	if (preference === "system") return prefersDark ? "dark" : "light";
	return preference;
}

export function readStoredPreference(): ThemePreference {
	if (typeof window === "undefined") return DEFAULT_THEME_PREFERENCE;
	try {
		const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
		return isThemePreference(raw) ? raw : DEFAULT_THEME_PREFERENCE;
	} catch {
		// Private mode / storage disabled — fall back to following the OS.
		return DEFAULT_THEME_PREFERENCE;
	}
}

/**
 * Writes the resolved theme to the document. `colorScheme` is not decoration:
 * it is what tells the browser to paint native scrollbars, form controls and
 * the autofill background dark, which CSS variables cannot reach.
 */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	root.classList.toggle("dark", resolved === "dark");
	root.style.colorScheme = resolved;
}

/**
 * Puts the document back to light regardless of preference — for the marketing
 * routes, which are out of scope (see the header note) and must never inherit a
 * seller's dark choice when they navigate `/app` → `/pricing`.
 */
export function clearAppliedTheme(): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	root.classList.remove("dark");
	root.style.colorScheme = "light";
}

/**
 * Which routes the theme applies to. Uses matched ROUTE IDS, not pathnames, so
 * the router's own precedence settles `/pricing` (marketing, always light) vs
 * `/$slug` (a storefront, themed) — the same reason `buyer-routes.ts` keys on
 * ids. Adding a themed surface means adding it here; `theme-routes.test.ts`
 * fails if an id listed here stops existing.
 */
export function isThemedRouteId(routeId: string): boolean {
	if (isBuyerRouteId(routeId)) return true;
	return routeId === "/app" || routeId.startsWith("/app/");
}

// --- external store -------------------------------------------------------

type ThemeSnapshot = {
	preference: ThemePreference;
	resolved: ResolvedTheme;
};

/**
 * The server has no device to ask, so it renders the light-mode markup and the
 * init script corrects the DOM before paint. `getServerSnapshot` must return a
 * stable reference or React re-renders forever.
 */
const SERVER_SNAPSHOT: ThemeSnapshot = {
	preference: DEFAULT_THEME_PREFERENCE,
	resolved: "light",
};

let snapshot: ThemeSnapshot = SERVER_SNAPSHOT;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
	for (const listener of listeners) listener();
}

/** Recomputes the cached snapshot; only replaces the object when it changed, so
 *  `useSyncExternalStore` sees a stable reference and skips no-op renders. */
function refresh(preference: ThemePreference = snapshot.preference): void {
	const resolved = resolveTheme(preference);
	if (snapshot.preference === preference && snapshot.resolved === resolved) {
		return;
	}
	snapshot = { preference, resolved };
	emit();
}

/**
 * Reads storage once on first client subscribe. It deliberately does NOT touch
 * the DOM: `useThemeScope` owns every write, because only it knows whether the
 * current route is themed at all.
 */
function hydrateOnce(): void {
	if (hydrated || typeof window === "undefined") return;
	hydrated = true;
	const preference = readStoredPreference();
	snapshot = { preference, resolved: resolveTheme(preference) };
}

export function subscribeTheme(listener: () => void): () => void {
	hydrateOnce();
	listeners.add(listener);

	// One media listener and one storage listener for the whole app, attached
	// only while something is subscribed.
	if (listeners.size === 1 && typeof window !== "undefined") {
		attachGlobalListeners();
	}

	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) detachGlobalListeners();
	};
}

let mediaQuery: MediaQueryList | null = null;

function onSystemChange(): void {
	// Only "system" tracks the OS; an explicit choice must not be overridden.
	if (snapshot.preference !== "system") return;
	refresh("system");
	applyResolvedTheme(resolveTheme("system"));
}

function onStorage(event: StorageEvent): void {
	if (event.key !== THEME_STORAGE_KEY) return;
	const preference = isThemePreference(event.newValue)
		? event.newValue
		: DEFAULT_THEME_PREFERENCE;
	refresh(preference);
	applyResolvedTheme(resolveTheme(preference));
}

function attachGlobalListeners(): void {
	try {
		mediaQuery = window.matchMedia(DARK_QUERY);
		mediaQuery.addEventListener("change", onSystemChange);
	} catch {
		mediaQuery = null;
	}
	window.addEventListener("storage", onStorage);
}

function detachGlobalListeners(): void {
	try {
		mediaQuery?.removeEventListener("change", onSystemChange);
	} catch {
		// Listener never attached — nothing to clean up.
	}
	mediaQuery = null;
	if (typeof window !== "undefined") {
		window.removeEventListener("storage", onStorage);
	}
}

export function getThemeSnapshot(): ThemeSnapshot {
	hydrateOnce();
	return snapshot;
}

export function getServerThemeSnapshot(): ThemeSnapshot {
	return SERVER_SNAPSHOT;
}

export function setThemePreference(preference: ThemePreference): void {
	refresh(preference);
	applyResolvedTheme(resolveTheme(preference));
	try {
		window.localStorage.setItem(THEME_STORAGE_KEY, preference);
	} catch {
		// Storage unavailable — the choice still applies for this page's life.
	}
}

/** Test-only: drop cached state so each case starts from a clean store. */
export function __resetThemeStoreForTests(): void {
	detachGlobalListeners();
	listeners.clear();
	snapshot = SERVER_SNAPSHOT;
	hydrated = false;
}

// --- pre-paint script -----------------------------------------------------

/**
 * Runs synchronously in <head>, before the browser paints anything. Mirrors
 * `readStoredPreference` + `resolveTheme` + `applyResolvedTheme` in plain ES5
 * so it needs no bundle. Kept as one line: it ships in every HTML response.
 *
 * Silent on failure by design — a theme is never worth a white screen.
 */
export const THEME_INIT_SCRIPT =
	`(function(){try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");` +
	`var p=(s==="light"||s==="dark"||s==="system")?s:"system";` +
	`var d=p==="dark"||(p==="system"&&window.matchMedia("${DARK_QUERY}").matches);` +
	`var e=document.documentElement;e.classList.toggle("dark",d);` +
	`e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;
