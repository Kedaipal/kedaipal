import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { type Country, DEFAULT_COUNTRY } from "../../convex/lib/country";
import {
	parseRegionCookie,
	REGION_COOKIE,
	REGION_COOKIE_MAX_AGE_SECONDS,
} from "../lib/geo-region";

/**
 * Best-effort region guess from the browser's IANA time zone. This is the LAST
 * resort, not the first: `src/lib/geo-region.ts` resolves the stored pick and
 * Cloudflare's `CF-IPCountry` at SSR, and the time zone only gets a vote where
 * neither answered — `vite dev`, `wrangler dev`, or any non-Cloudflare origin.
 * A time zone is a device setting, so it misreads the case that matters most
 * here (an SG visitor whose phone still says `Asia/Kuala_Lumpur`).
 */
export function detectCountryFromTimeZone(timeZone: string): Country {
	return timeZone === "Asia/Singapore" ? "SG" : DEFAULT_COUNTRY;
}

/** The time-zone guess, or `null` where `Intl` can't be reached at all. */
function readTimeZoneCountry(): Country | null {
	try {
		return detectCountryFromTimeZone(
			Intl.DateTimeFormat().resolvedOptions().timeZone,
		);
	} catch {
		return null;
	}
}

/**
 * The stored pick as the CLIENT sees it. The server reads the same cookie in
 * the root loader, so this normally agrees with what was already rendered —
 * it matters on a client-side navigation, where the loader doesn't re-run.
 */
export function readStoredRegion(cookieHeader: string): Country | null {
	for (const part of cookieHeader.split(";")) {
		const [name, ...rest] = part.split("=");
		if (name?.trim() !== REGION_COOKIE) continue;
		return parseRegionCookie(decodeURIComponent(rest.join("=")));
	}
	return null;
}

/**
 * Which region to show prices for, given every signal we hold.
 *
 * Order is deliberate — **stored pick → server answer (cookie or geo-IP) →
 * time zone → MY**:
 *
 * - A stored pick is the visitor clicking the toggle. An explicit statement
 *   outranks any guess, and a toggle that silently undoes itself on the next
 *   visit reads as a bug.
 * - The server's answer already folds in the cookie, so the two agree on a
 *   full page load; the client's own cookie read is what covers a
 *   client-side navigation, where the root loader doesn't re-run.
 * - The time zone only speaks when neither of the above did.
 */
export function resolveLandingRegion(signals: {
	stored: Country | null;
	server: Country | null;
	timeZone: Country | null;
}): Country {
	return (
		signals.stored ?? signals.server ?? signals.timeZone ?? DEFAULT_COUNTRY
	);
}

/**
 * The region resolved on the server and handed down in the root route's loader
 * data (`__root.tsx`). Read off router state rather than imported from the
 * route module — that keeps this hook free of a cycle back through the root
 * document — and re-validated here, because loader data is `unknown` to us.
 */
function useServerRegion(): Country | null {
	return useRouterState({
		select: (state) => {
			const data = state.matches[0]?.loaderData as
				| { region?: unknown }
				| undefined;
			const region = data?.region;
			return region === "MY" || region === "SG" ? region : null;
		},
	});
}

/**
 * The visitor's region for pricing display (MY/SG) plus the setter the
 * `RegionToggle` drives.
 *
 * First render — server and client alike — uses the server's answer, so the
 * first paint already carries the right currency and there is no RM→S$
 * flicker; both sides read the same dehydrated value, so hydration matches.
 * The client corrects afterwards only where it holds something the server
 * couldn't see.
 */
export function useLandingRegion(): [Country, (next: Country) => void] {
	const server = useServerRegion();
	const [region, setRegionState] = useState<Country>(
		() => server ?? DEFAULT_COUNTRY,
	);

	useEffect(() => {
		// Only reachable on the client, where `document` and `Intl` exist.
		setRegionState(
			resolveLandingRegion({
				stored: readStoredRegion(document.cookie),
				server,
				timeZone: readTimeZoneCountry(),
			}),
		);
	}, [server]);

	const setRegion = useCallback((next: Country) => {
		setRegionState(next);
		try {
			// `SameSite=Lax` + first-party + no PII: a functional preference the
			// visitor asked for by clicking, not tracking. Not `HttpOnly` — this
			// line is the only writer. `Secure` only where the page already is,
			// so `http://localhost` dev still persists.
			const secure = window.location.protocol === "https:" ? "; Secure" : "";
			// biome-ignore lint/suspicious/noDocumentCookie: the suggested Cookie Store API is unavailable in Safari and Firefox, and this cookie's whole point is being readable by the SSR render on the next request — a store we can't write in every browser we ship to is not a substitute.
			document.cookie = `${REGION_COOKIE}=${next}; Path=/; Max-Age=${REGION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
		} catch {
			// Storage unavailable (private mode, cookies blocked) — the toggle
			// still works for this render, it just won't persist across visits.
		}
	}, []);

	return [region, setRegion];
}
