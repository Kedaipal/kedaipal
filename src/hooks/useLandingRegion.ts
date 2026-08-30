import { useCallback, useEffect, useState } from "react";
import { type Country, DEFAULT_COUNTRY } from "../../convex/lib/country";

const STORAGE_KEY = "kp_landing_region";

/**
 * Best-effort region guess from the browser's IANA time zone — used only as
 * the FIRST-VISIT default before a visitor picks a side on the segmented
 * toggle. Not geo-IP: Cloudflare's `request.cf.country` would be more
 * accurate but needs the Worker's raw Request plumbed into a TanStack Start
 * loader, which this pass didn't wire up (see docs/landing-redesign-mobbin.md).
 * Unknown/unavailable time zones fall back to `DEFAULT_COUNTRY` (MY).
 */
export function detectCountryFromTimeZone(timeZone: string): Country {
	return timeZone === "Asia/Singapore" ? "SG" : DEFAULT_COUNTRY;
}

function readStoredCountry(): Country | null {
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		return stored === "MY" || stored === "SG" ? stored : null;
	} catch {
		return null;
	}
}

/**
 * The visitor's region for landing-page pricing display (MY/SG). Always
 * initializes to `DEFAULT_COUNTRY` for the first render — server and client
 * must agree on that render for hydration to match — then corrects itself
 * once mounted from a stored override or a time-zone guess, same fallback
 * shape as `useSupportWaNumber`/`getSpotsRemaining`.
 */
export function useLandingRegion(): [Country, (next: Country) => void] {
	const [country, setCountryState] = useState<Country>(DEFAULT_COUNTRY);

	useEffect(() => {
		const stored = readStoredCountry();
		if (stored) {
			setCountryState(stored);
			return;
		}
		try {
			const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
			setCountryState(detectCountryFromTimeZone(timeZone));
		} catch {
			// Intl unavailable — stay on DEFAULT_COUNTRY.
		}
	}, []);

	const setCountry = useCallback((next: Country) => {
		setCountryState(next);
		try {
			window.localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// Storage unavailable (private mode, quota) — the toggle still works
			// for this render, it just won't persist across visits.
		}
	}, []);

	return [country, setCountry];
}
