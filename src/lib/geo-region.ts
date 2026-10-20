import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie, getRequest } from "@tanstack/react-start/server";
import {
	type Country,
	DEFAULT_COUNTRY,
	isCountry,
} from "../../convex/lib/country";

/**
 * Which region's pricing a visitor is shown, on the public surfaces (landing
 * teaser, `/pricing`, `/cost`).
 *
 * Two signals, resolved at SSR so the first byte of HTML already carries the
 * right currency:
 *
 * 1. **The visitor's own pick**, from the `kp_landing_region` cookie — written
 *    by the `RegionToggle`. An explicit statement always outranks a guess.
 * 2. **Cloudflare's `CF-IPCountry`**, stamped on every request that reaches the
 *    Worker. Strictly better than the time-zone guess it replaced: a time zone
 *    is a *device* setting, so an SG visitor whose phone still says
 *    `Asia/Kuala_Lumpur` — the common case on this border — was quoted RM.
 *
 * A time-zone fallback still exists client-side (`useLandingRegion`) for
 * origins that serve no geo header at all: `vite dev`, `wrangler dev`.
 */

/** Cookie the `RegionToggle` writes. Read here; written in `useLandingRegion`. */
export const REGION_COOKIE = "kp_landing_region";

/**
 * Cookie rather than `localStorage` (which is what this started as): the
 * server can read a cookie, so a visitor who overrode the geo guess gets their
 * currency in the SSR render instead of watching it correct itself after
 * mount. A year, because a person's country is not a session-scoped fact.
 */
export const REGION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Cloudflare's "we could not place this IP" answers. `XX` covers reserved and
 * unknown ranges, `T1` is the Tor network. Both are *present but meaningless*,
 * so they must read as "no answer" — falling through to the time-zone guess —
 * rather than as a positive vote for Malaysia.
 */
const UNRESOLVED_GEO_CODES = new Set(["XX", "T1"]);

/**
 * Map a `CF-IPCountry` value to the region whose pricing we show.
 *
 * `null` means the header could not answer (absent, blank, or one of the
 * unresolved codes above) — the caller falls back to the next signal. A
 * resolvable code that isn't Singapore is a real answer and returns
 * `DEFAULT_COUNTRY`, so a Malaysian visitor's geo result is never silently
 * re-litigated by their device's time zone.
 */
export function detectCountryFromGeoHeader(
	header: string | null | undefined,
): Country | null {
	const code = header?.trim().toUpperCase();
	if (!code || UNRESOLVED_GEO_CODES.has(code)) return null;
	return isCountry(code) ? code : DEFAULT_COUNTRY;
}

/**
 * Read a stored pick. Anything that isn't one of the two countries is treated
 * as absent — the value is client-written, so a stale or hand-edited cookie
 * must degrade to detection, never to a crash or a third state.
 */
export function parseRegionCookie(
	value: string | null | undefined,
): Country | null {
	const trimmed = value?.trim();
	return trimmed && isCountry(trimmed) ? trimmed : null;
}

/**
 * The visitor's region as the server can determine it: their stored pick if
 * they have one, otherwise the edge's geo answer. `null` when neither speaks —
 * a first visit on a non-Cloudflare origin — which hands the decision to the
 * client's time-zone fallback.
 *
 * `createIsomorphicFn` compiles the server arm out of the client bundle, so the
 * server-only imports never reach the browser. The client arm returns `null`:
 * on a client-side navigation the root loader does not re-run, and if it ever
 * does (a router invalidation) the hook simply keeps what it already resolved.
 */
export const readVisitorRegion = createIsomorphicFn()
	.server((): Country | null => {
		try {
			return (
				parseRegionCookie(getCookie(REGION_COOKIE)) ??
				detectCountryFromGeoHeader(getRequest().headers.get("cf-ipcountry"))
			);
		} catch {
			// No request in scope (a prerender pass, a test render) — no answer.
			return null;
		}
	})
	.client((): Country | null => null);
