/**
 * Google Places API proxy. The API key (`GOOGLE_MAPS_API_KEY`) is a server-only
 * Convex deployment env var — never exposed to the browser bundle. Both actions
 * here are the seam between our React forms and the Places API (New); the
 * client calls them via `useAction` and gets back lean, normalized payloads.
 *
 * Why a proxy at all (vs a referrer-restricted public key):
 *   - Key stays fully server-side, so we can rotate it without a client deploy.
 *   - We can rate-limit per retailer / per user via the existing rateLimiter,
 *     preventing a malicious script from blowing through Google's free credit.
 *   - Future logging / analytics / cost accounting all live in one place.
 *
 * Pricing model: we use Google's **session-token** billing pattern. The client
 * generates a UUID per "search → pick" cycle and passes it to BOTH actions;
 * Google bundles autocomplete queries + one Place Details fetch into a single
 * billable session at the Essentials tier (~$17 per 1000 sessions) instead of
 * billing per request.
 */

import { ConvexError, v } from "convex/values";
import { type ActionCtx, action } from "./_generated/server";
import { rateLimiter } from "./lib/rateLimiter";

// New Places API endpoints. Old `maps.googleapis.com/maps/api/place/...`
// endpoints are deprecated for new projects.
const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const PLACE_DETAILS_BASE = "https://places.googleapis.com/v1/places";

// Lock results to Malaysia for v1. When we expand markets, take a country
// arg on the action and validate against an allowlist.
const REGION_CODES = ["my"] as const;

// Essentials field mask — gives us everything we need (formatted address,
// structured components for delivery field auto-fill, lat/lng for the maps
// pin) without paying for Pro tiers.
const PLACE_DETAILS_FIELD_MASK =
	"id,formattedAddress,addressComponents,location";

function readApiKey(): string {
	const key = process.env.GOOGLE_MAPS_API_KEY;
	if (!key) {
		throw new ConvexError(
			"Google Maps is not configured on this deployment. Contact support.",
		);
	}
	return key;
}

/**
 * Resolve a rate-limit key. Prefers the authenticated Clerk subject when
 * available (settings/dashboard caller); falls back to `retailerId` for the
 * public storefront flow. One of the two must be present — otherwise we have
 * no way to scope abuse and we refuse the call.
 */
async function resolveRateKey(
	ctx: ActionCtx,
	retailerId: string | undefined,
): Promise<string> {
	const identity = await ctx.auth.getUserIdentity();
	if (identity?.subject) return `user:${identity.subject}`;
	if (retailerId) return `retailer:${retailerId}`;
	throw new ConvexError(
		"Missing rate-limit context. Provide retailerId for unauthenticated calls.",
	);
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

export const autocompleteAddress = action({
	args: {
		input: v.string(),
		sessionToken: v.string(),
		// Required for public (unauthenticated) storefront callers; ignored when
		// Clerk identity is present. See `resolveRateKey`.
		retailerId: v.optional(v.id("retailers")),
	},
	handler: async (
		ctx,
		{ input, sessionToken, retailerId },
	): Promise<{
		predictions: Array<{
			placeId: string;
			primaryText: string;
			secondaryText: string;
		}>;
	}> => {
		const trimmed = input.trim();
		// Short input yields garbage from Google + wastes session budget.
		if (trimmed.length < 2) return { predictions: [] };

		const rateKey = await resolveRateKey(ctx, retailerId);
		await rateLimiter.limit(ctx, "googleAutocomplete", {
			key: rateKey,
			throws: true,
		});

		const apiKey = readApiKey();
		const res = await fetch(AUTOCOMPLETE_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Goog-Api-Key": apiKey,
			},
			body: JSON.stringify({
				input: trimmed,
				sessionToken,
				includedRegionCodes: REGION_CODES,
				languageCode: "en",
			}),
		});

		if (!res.ok) {
			const body = await res.text();
			console.error("Google autocomplete failed", {
				status: res.status,
				body: body.slice(0, 200),
			});
			throw new ConvexError(
				"Address lookup is unavailable right now. Please try again or type your address manually.",
			);
		}

		const payload = (await res.json()) as {
			suggestions?: Array<{
				placePrediction?: {
					placeId?: string;
					structuredFormat?: {
						mainText?: { text?: string };
						secondaryText?: { text?: string };
					};
				};
			}>;
		};

		const predictions = (payload.suggestions ?? [])
			.map((s) => {
				const p = s.placePrediction;
				if (!p?.placeId) return null;
				return {
					placeId: p.placeId,
					primaryText: p.structuredFormat?.mainText?.text ?? "",
					secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
				};
			})
			.filter((p): p is NonNullable<typeof p> => p !== null);

		return { predictions };
	},
});

// ---------------------------------------------------------------------------
// Place Details
// ---------------------------------------------------------------------------

/**
 * Subset of Google's address_components we care about. `types` is the Google
 * component-type vocabulary (e.g. "locality", "postal_code"). `longText` is
 * what we typically display; `shortText` is the abbreviated form (e.g. state
 * codes — useful when Google returns the full territory name).
 */
export type GoogleAddressComponent = {
	types: string[];
	longText: string;
	shortText: string;
};

export const getPlaceDetails = action({
	args: {
		placeId: v.string(),
		sessionToken: v.string(),
		retailerId: v.optional(v.id("retailers")),
	},
	handler: async (
		ctx,
		{ placeId, sessionToken, retailerId },
	): Promise<{
		formattedAddress: string;
		latitude: number;
		longitude: number;
		addressComponents: GoogleAddressComponent[];
	}> => {
		const rateKey = await resolveRateKey(ctx, retailerId);
		await rateLimiter.limit(ctx, "googlePlaceDetails", {
			key: rateKey,
			throws: true,
		});

		const apiKey = readApiKey();
		// sessionToken in query-string per Google's spec — it ties this details
		// fetch to the autocomplete session for billing purposes.
		const url = `${PLACE_DETAILS_BASE}/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
		const res = await fetch(url, {
			method: "GET",
			headers: {
				"X-Goog-Api-Key": apiKey,
				"X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK,
			},
		});

		if (!res.ok) {
			const body = await res.text();
			console.error("Google place details failed", {
				status: res.status,
				body: body.slice(0, 200),
			});
			throw new ConvexError(
				"Couldn't load that address from Google. Please try again or type it manually.",
			);
		}

		const payload = (await res.json()) as {
			formattedAddress?: string;
			location?: { latitude?: number; longitude?: number };
			addressComponents?: Array<{
				types?: string[];
				longText?: string;
				shortText?: string;
			}>;
		};

		const lat = payload.location?.latitude;
		const lng = payload.location?.longitude;
		const formattedAddress = payload.formattedAddress ?? "";
		if (
			typeof lat !== "number" ||
			typeof lng !== "number" ||
			formattedAddress.length === 0
		) {
			throw new ConvexError(
				"That address didn't return usable coordinates. Try another suggestion.",
			);
		}

		const addressComponents = (payload.addressComponents ?? []).map((c) => ({
			types: c.types ?? [],
			longText: c.longText ?? "",
			shortText: c.shortText ?? "",
		}));

		return {
			formattedAddress,
			latitude: lat,
			longitude: lng,
			addressComponents,
		};
	},
});
