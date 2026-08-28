import type { GoogleAddressComponent } from "../../convex/google";

// Re-export the shared maps-URL helper so existing client callsites don't
// have to update their import path. The canonical home is `convex/lib/mapsUrl.ts`
// because the same logic is needed inside Convex functions (rendering the
// WhatsApp confirm message), and src/ cannot be imported from convex/.
export {
	deriveMapsUrl,
	googleMapsNavUrl,
	wazeNavUrl,
} from "../../convex/lib/mapsUrl";

import { SG_STATE_LABEL } from "../../convex/lib/address";
import { type Country, DEFAULT_COUNTRY } from "../../convex/lib/country";
import { type CheckoutAddressValues, MY_STATES, type MyState } from "./schemas";

/**
 * Map Google Places `addressComponents` into the storefront's structured
 * delivery-address shape. Lives client-side because the result feeds directly
 * into TanStack Form state — no server round-trip needed.
 *
 * Returns a partial: callers spread the result over their current form values
 * so untouched fields aren't overwritten. Notes and mapsUrl are intentionally
 * never written from Google — they're user-typed channels.
 */
export type GoogleParsedAddress = Pick<
	CheckoutAddressValues,
	"line1" | "city" | "state" | "postcode"
>;

function findComponent(
	components: GoogleAddressComponent[],
	type: string,
): GoogleAddressComponent | undefined {
	return components.find((c) => c.types.includes(type));
}

function getLongText(
	components: GoogleAddressComponent[],
	type: string,
): string {
	return findComponent(components, type)?.longText ?? "";
}

/**
 * Normalize Google's administrative_area_level_1 long text into one of our
 * MY_STATES enum values. Google returns full territory names ("Wilayah
 * Persekutuan Kuala Lumpur", "Federal Territory of Kuala Lumpur") and
 * sometimes alternate spellings ("Penang" instead of "Pulau Pinang",
 * "Malacca" instead of "Melaka") — this maps them all to our canonical form.
 *
 * Returns `undefined` for non-Malaysian or unrecognised values, in which case
 * the parent form leaves the state field blank for the buyer to pick.
 */
export function normalizeMyState(raw: string): MyState | undefined {
	if (raw.length === 0) return undefined;
	const lc = raw.toLowerCase().trim();

	// Federal Territories — strip the territory prefix and route to the WP form.
	const wpAliases: ReadonlyArray<[RegExp, MyState]> = [
		[
			/^(wilayah persekutuan |federal territory of |wp )?kuala lumpur$/,
			"WP Kuala Lumpur",
		],
		[/^(wilayah persekutuan |federal territory of |wp )?labuan$/, "WP Labuan"],
		[
			/^(wilayah persekutuan |federal territory of |wp )?putrajaya$/,
			"WP Putrajaya",
		],
	];
	for (const [pattern, mapped] of wpAliases) {
		if (pattern.test(lc)) return mapped;
	}

	// Alternate spellings → canonical form
	const synonyms: Record<string, MyState> = {
		penang: "Pulau Pinang",
		"pulau pinang": "Pulau Pinang",
		malacca: "Melaka",
		melaka: "Melaka",
	};
	if (synonyms[lc]) return synonyms[lc];

	// Exact match against MY_STATES (case-insensitive)
	const match = MY_STATES.find((s) => s.toLowerCase() === lc);
	return match;
}

/**
 * Compose line1 from `street_number` + `route` when both are present, else
 * `route` alone, else the first comma-segment of the formatted address (catches
 * named buildings like "Suria KLCC" that have no street decomposition).
 */
function composeLine1(
	components: GoogleAddressComponent[],
	formattedAddress: string,
): string {
	const streetNumber = getLongText(components, "street_number");
	const route = getLongText(components, "route");
	if (route.length > 0) {
		return streetNumber.length > 0 ? `${streetNumber} ${route}` : route;
	}
	// Fallback: first chunk before a comma — usually the building name or the
	// premise name for non-street addresses.
	const firstChunk = formattedAddress.split(",")[0]?.trim() ?? "";
	return firstChunk;
}

export function parseGoogleAddress(
	components: GoogleAddressComponent[],
	formattedAddress: string,
	// The STORE's country — keys the parse arm explicitly (SG-lite, 86eynw29u)
	// rather than guessing it from the components: the autocomplete is already
	// region-locked server-side, so the pick can only be in this country.
	country: Country = DEFAULT_COUNTRY,
): GoogleParsedAddress {
	if (country === "SG") {
		// Singapore has no state tier and the whole island is one city — both
		// fields carry the canonical literal the server arm enforces. Google's
		// SG results put the 6-digit postal code under postal_code as usual.
		return {
			line1: composeLine1(components, formattedAddress),
			city: SG_STATE_LABEL,
			state: SG_STATE_LABEL,
			postcode: getLongText(components, "postal_code"),
		};
	}

	const stateRaw = getLongText(components, "administrative_area_level_1");
	const state = normalizeMyState(stateRaw) ?? "";

	// Locality is the standard city. Some KL addresses come back with
	// `postal_town` instead of `locality` — fall through if needed.
	const city =
		getLongText(components, "locality") ||
		getLongText(components, "postal_town") ||
		"";

	return {
		line1: composeLine1(components, formattedAddress),
		city,
		state,
		postcode: getLongText(components, "postal_code"),
	};
}
