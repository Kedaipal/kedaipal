/**
 * Strict maps-URL validator shared by Convex mutations (pickupLocations.create
 * / update) and the client-side settings form (src/lib/schemas.ts) so the same
 * domain allowlist is enforced on both sides.
 *
 * Pure — no Convex imports — so it works inside actions, httpActions, and the
 * Vite client bundle alike.
 *
 * Scoped to pickup locations only. The existing delivery-address `mapsUrl`
 * validator in convex/lib/address.ts intentionally stays as a generic http(s)
 * check to avoid invalidating existing rows.
 */

export const MAPS_URL_MAX = 500;

/**
 * Hosts we accept on a pickup location's mapsUrl. Covers the two share-sheet
 * formats Malaysian shoppers actually use: Waze deep links and Google Maps
 * (incl. Google's own short-link domain `maps.app.goo.gl`).
 *
 * Intentionally NOT including the legacy `goo.gl` general shortener — Google
 * shut down `goo.gl` redirects on 2025-08-25 (all return 404), so accepting
 * those URLs would just give buyers a dead link. `maps.app.goo.gl` is the
 * Maps-app share domain and is still live; it stays.
 */
export const ALLOWED_MAPS_HOSTS = new Set<string>([
	"waze.com",
	"www.waze.com",
	"maps.app.goo.gl",
	"maps.google.com",
	"www.google.com",
]);

/**
 * Validates and returns the trimmed URL. Throws `Error` (not ConvexError) so
 * callers control how to surface the message — the Convex mutations wrap it
 * in ConvexError, and the Zod refine uses `.message`.
 */
export function assertValidMapsUrl(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		throw new Error("Maps URL cannot be empty");
	}
	if (trimmed.length > MAPS_URL_MAX) {
		throw new Error(`Maps URL must be at most ${MAPS_URL_MAX} characters`);
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error("Maps URL must be a valid URL");
	}
	if (parsed.protocol !== "https:") {
		throw new Error("Maps URL must use https");
	}
	if (!ALLOWED_MAPS_HOSTS.has(parsed.hostname.toLowerCase())) {
		throw new Error(
			"Maps URL must be from Waze (waze.com) or Google Maps (maps.app.goo.gl, maps.google.com)",
		);
	}
	return trimmed;
}

/** Boolean form of {@link assertValidMapsUrl} for client-side guards. */
export function isValidMapsUrl(raw: string): boolean {
	try {
		assertValidMapsUrl(raw);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve a "best available" Google Maps URL for a pickup location or delivery
 * address. Priority:
 *   1. Seller-pasted `mapsUrl` (legacy rows, full original share URL).
 *   2. `placeId` — opens the named place page in Google Maps with the place's
 *      actual name in the search bar (NOT raw coordinates), thanks to Google's
 *      documented `?q=place_id:<ID>` form. This is the prettiest experience.
 *   3. `latitude`/`longitude` — fallback for rows without a placeId. Opens
 *      with lat/lng in the search bar.
 *   4. Returns undefined when nothing is set.
 *
 * Lives in `convex/lib/` so it's importable from both Convex functions
 * (rendering the WhatsApp confirm message) AND the React client.
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
		return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
	}
	if (
		typeof loc.latitude === "number" &&
		typeof loc.longitude === "number"
	) {
		return `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`;
	}
	return undefined;
}

/**
 * Google Maps deep-link for **navigation**, preferring a named place (`placeId`)
 * over raw coordinates so it opens on the actual place card — not an unnamed pin
 * at lat/lng (the "ugly lat/lng on the map" problem). Unlike `deriveMapsUrl`,
 * this ignores any retailer-pasted custom `mapsUrl` because it is specifically
 * the Google target (used next to a separate Waze button). Returns undefined
 * when neither a placeId nor coordinates are available.
 */
export function googleMapsNavUrl(loc: {
	latitude?: number;
	longitude?: number;
	placeId?: string;
}): string | undefined {
	const placeId = loc.placeId?.trim();
	if (placeId && placeId.length > 0) {
		return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
	}
	if (
		typeof loc.latitude === "number" &&
		typeof loc.longitude === "number"
	) {
		return `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`;
	}
	return undefined;
}

/**
 * Waze deep-link for **navigation**. Waze has no Google `place_id` concept, so it
 * always navigates by coordinates. Returns undefined without coordinates.
 */
export function wazeNavUrl(loc: {
	latitude?: number;
	longitude?: number;
}): string | undefined {
	if (
		typeof loc.latitude === "number" &&
		typeof loc.longitude === "number"
	) {
		return `https://waze.com/ul?ll=${loc.latitude},${loc.longitude}&navigate=yes`;
	}
	return undefined;
}
