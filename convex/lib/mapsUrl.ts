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
 * (incl. the short-link domain).
 */
export const ALLOWED_MAPS_HOSTS = new Set<string>([
	"waze.com",
	"www.waze.com",
	"maps.app.goo.gl",
	"goo.gl",
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
