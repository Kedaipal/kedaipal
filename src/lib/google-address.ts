import type { GoogleAddressComponent } from "../../convex/google";
import {
	type CheckoutAddressValues,
	type MyState,
	MY_STATES,
} from "./schemas";

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
		[/^(wilayah persekutuan |federal territory of |wp )?kuala lumpur$/, "WP Kuala Lumpur"],
		[/^(wilayah persekutuan |federal territory of |wp )?labuan$/, "WP Labuan"],
		[/^(wilayah persekutuan |federal territory of |wp )?putrajaya$/, "WP Putrajaya"],
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

/**
 * Resolve a "best available" Google Maps URL for a pickup location or delivery
 * address. Priority:
 *   1. Seller-pasted `mapsUrl` (legacy rows, full original share URL).
 *   2. `placeId` — opens the named place page in Google Maps with the place's
 *      actual name in the search bar (NOT raw coordinates), thanks to Google's
 *      documented `?q=place_id:<ID>` form. This is the prettiest experience.
 *   3. `latitude`/`longitude` — fallback for delivery addresses (no place ID)
 *      or legacy rows. Opens with lat/lng in the search bar.
 *   4. Returns undefined when nothing is set.
 *
 * Used by:
 *   - The checkout sheet's pickup picker + summary card (storefront "Open in
 *     maps" link).
 *   - The `wa.me` prefilled message builder (gives the seller a short, working
 *     navigation link instead of the ugly 350-char Google places share URL).
 *   - Seller order detail + settings pickup list.
 */
export function deriveMapsUrl(loc: {
	mapsUrl?: string;
	latitude?: number;
	longitude?: number;
	placeId?: string;
}): string | undefined {
	const url = loc.mapsUrl?.trim();
	if (url && url.length > 0) return url;
	const placeId = loc.placeId?.trim();
	if (placeId && placeId.length > 0) {
		// Place-by-id form: Google Maps opens centered on the place with its
		// name shown in the search bar instead of raw coordinates. This is the
		// API Google documents for "open a place from a stored place_id".
		return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
	}
	if (
		typeof loc.latitude === "number" &&
		typeof loc.longitude === "number"
	) {
		// Same URL form as the tracking-page "Open in Google Maps" button so
		// retailers get a consistent destination regardless of entry point.
		return `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`;
	}
	return undefined;
}

export function parseGoogleAddress(
	components: GoogleAddressComponent[],
	formattedAddress: string,
): GoogleParsedAddress {
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
