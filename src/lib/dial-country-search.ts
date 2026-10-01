/**
 * Ranking for the buyer's country-code picker (z8r3fdm36y).
 *
 * The picker holds 241 countries. Before this it was a native `<select>`, whose
 * only search is the OS type-ahead over the option's VISIBLE TEXT — so on
 * desktop you had to know the country's English name ("Japan"), and typing the
 * thing actually printed on the plate (`+81`, or `81`) matched nothing at all.
 * On a phone there was no search whatsoever: an iOS wheel with 241 stops.
 *
 * So a query here matches three ways, because all three are things a buyer
 * plausibly knows about their own number:
 *
 *  - the **dial code** — `+81`, `81`, or a partial `+6` to see the neighbours
 *  - the **ISO code** — `MY`, `SG` (what the plate shows for a flagless country)
 *  - the **name** — `japan`, and `korea` finding "South Korea" mid-string
 *
 * Pure and dependency-free so the ordering is unit-testable without rendering
 * a sheet; the component does nothing but display what this returns.
 */

import { type DialIso, dialCountryName } from "../../convex/lib/buyerPhone";
import { DIAL_ROWS } from "../../convex/lib/dialCodes";

/** A query of only digits/spaces, optionally led by `+` or the `00` IDD. */
const NUMERIC_QUERY = /^(?:\+|00)?[\d\s-]+$/;

export interface DialCountryOption {
	iso: DialIso;
	/** "Japan" */
	name: string;
	/** "81" — bare, no `+`. */
	dial: string;
}

const ALL_OPTIONS: readonly DialCountryOption[] = DIAL_ROWS.map((row) => ({
	iso: row.iso as DialIso,
	name: dialCountryName(row.iso as DialIso),
	dial: row.dial,
})).sort((a, b) => a.name.localeCompare(b.name));

/** Every country, A–Z by name. The picker's unfiltered "All countries" group. */
export function allDialCountries(): readonly DialCountryOption[] {
	return ALL_OPTIONS;
}

export function dialCountryOption(iso: DialIso): DialCountryOption {
	const found = ALL_OPTIONS.find((o) => o.iso === iso);
	// Every DialIso comes from DIAL_ROWS, so this is unreachable — but a picker
	// that throws is worse than one that shows the code it was handed.
	return found ?? { iso, name: iso, dial: "" };
}

/**
 * Score a row against a query. Lower is better; `null` means "no match".
 *
 * A numeric query is judged ONLY against the dial code: digits are never a
 * country name, and letting "1" fall through to a name substring would bury
 * the +1 countries under every name containing a "1".
 */
function score(option: DialCountryOption, query: string): number | null {
	if (NUMERIC_QUERY.test(query)) {
		// Drop the IDD prefix BEFORE stripping separators, or "0081" keeps its
		// leading zeros and matches no code at all. `+` falls out either way.
		const digits = query.replace(/^00/, "").replace(/[^\d]/g, "");
		if (digits === "") return null;
		if (option.dial === digits) return 0;
		if (option.dial.startsWith(digits)) return 1;
		return null;
	}
	const name = option.name.toLowerCase();
	// An exact ISO hit wins outright: someone typing "MY" wants Malaysia at the
	// top, not every name containing the letters "my".
	if (option.iso.toLowerCase() === query) return 0;
	if (name.startsWith(query)) return 1;
	// A word start inside the name — "korea" should find "South Korea" above a
	// country that merely contains the letters somewhere.
	if (name.includes(` ${query}`)) return 2;
	if (name.includes(query)) return 3;
	return null;
}

/**
 * The rows to show for `query`, best match first and A–Z within a tier. An
 * empty/blank query returns everything (the component groups it instead).
 */
export function searchDialCountries(
	query: string,
): readonly DialCountryOption[] {
	const q = query.trim().toLowerCase();
	if (q === "") return ALL_OPTIONS;
	const hits: Array<{ option: DialCountryOption; rank: number }> = [];
	for (const option of ALL_OPTIONS) {
		const rank = score(option, q);
		if (rank !== null) hits.push({ option, rank });
	}
	// ALL_OPTIONS is already A–Z, and Array#sort is stable, so equal ranks keep
	// alphabetical order for free.
	hits.sort((a, b) => a.rank - b.rank);
	return hits.map((h) => h.option);
}
