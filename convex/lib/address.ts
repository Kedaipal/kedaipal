/**
 * Server-side delivery-address validation. Kept free of Convex imports so it
 * can be unit-tested in isolation and mirrors the client-side Zod schema in
 * `src/lib/schemas.ts`.
 *
 * Country-keyed since SG-lite (86eynw29u): the caller resolves the RETAILER's
 * country and passes it — an address is judged against the store's country,
 * never sniffed from its own fields. Omitted country = MY, so every
 * pre-existing caller and order keeps today's behaviour byte-identical.
 */

import { type Country, DEFAULT_COUNTRY } from "./country";

export const MY_STATES = [
	"Johor",
	"Kedah",
	"Kelantan",
	"Melaka",
	"Negeri Sembilan",
	"Pahang",
	"Perak",
	"Perlis",
	"Pulau Pinang",
	"Sabah",
	"Sarawak",
	"Selangor",
	"Terengganu",
	"WP Kuala Lumpur",
	"WP Labuan",
	"WP Putrajaya",
] as const;

export type MyState = (typeof MY_STATES)[number];

const MY_STATE_SET: ReadonlySet<string> = new Set(MY_STATES);

/**
 * Singapore has no state tier — the whole country is one city-state, so SG
 * addresses store this literal in BOTH `city` and `state`. Storing a real
 * value (never undefined) keeps every downstream consumer — zone matching,
 * display renderers, CSV — on the same required-string shape as MY; display
 * sites dedupe the repetition via `displayAddressState` below.
 */
export const SG_STATE_LABEL = "Singapore";

/**
 * Display rule for the address's state line (SG-lite, 86eynw29u).
 *
 * SG addresses store "Singapore" in BOTH `city` and `state` (see above), so any
 * renderer that prints "postcode city" followed by the state would read
 * "123456 Singapore, Singapore". One author of the dedupe: the state is display
 * noise whenever it merely repeats the city, whatever the country — no MY
 * address triggers it (no MY city shares a name with a state).
 *
 * Lives here, in the pure address module, because BOTH sides need it: the
 * client renderers (re-exported by `src/lib/address-display.ts`, the
 * `src/lib/phone.ts` precedent) and the server-side despatch-label view-model
 * (`convex/lib/pdf/awb.ts`, 86eyp63mp) — a label that prints the state twice is
 * the same bug on paper.
 */
export function displayAddressState(addr: {
	city: string;
	state: string;
}): string | undefined {
	const state = addr.state.trim();
	if (state.length === 0) return undefined;
	return state.toLowerCase() === addr.city.trim().toLowerCase()
		? undefined
		: state;
}

const POSTCODE_RULES: Record<Country, { pattern: RegExp; error: string }> = {
	MY: { pattern: /^\d{5}$/, error: "Postcode must be 5 digits" },
	SG: { pattern: /^\d{6}$/, error: "Postal code must be 6 digits" },
};

const LINE1_MIN = 3;
const LINE1_MAX = 120;
const LINE2_MAX = 120;
const CITY_MIN = 2;
const CITY_MAX = 60;
const NOTES_MAX = 200;
const MAPS_URL_MAX = 500;
// Google Place IDs are typically 27–100 chars; cap at 300 with headroom.
// Kept in lockstep with `PLACE_ID_MAX` in convex/pickupLocations.ts — both
// the seller-supplied (pickup) and buyer-supplied (delivery checkout)
// surfaces apply the same cap.
const PLACE_ID_MAX = 300;

export interface RawAddress {
	line1: string;
	line2?: string;
	city: string;
	state: string;
	postcode: string;
	notes?: string;
	mapsUrl?: string;
	latitude?: number;
	longitude?: number;
	placeId?: string;
}

export interface SanitizedAddress {
	line1: string;
	line2?: string;
	city: string;
	state: string;
	postcode: string;
	notes?: string;
	mapsUrl?: string;
	latitude?: number;
	longitude?: number;
	placeId?: string;
}

function trimmedOrUndefined(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const s = raw.trim();
	return s.length > 0 ? s : undefined;
}

function assertValidUrl(raw: string): string {
	if (raw.length > MAPS_URL_MAX) {
		throw new Error(`Maps URL must be at most ${MAPS_URL_MAX} characters`);
	}
	try {
		const u = new URL(raw);
		if (u.protocol !== "http:" && u.protocol !== "https:") {
			throw new Error("Maps URL must use http or https");
		}
		return raw;
	} catch {
		throw new Error("Maps URL must be a valid URL");
	}
}

/**
 * Per-country state validation. MY: membership in the canonical MY_STATES set
 * (exact spelling — the client's dropdown and Google normalizer both emit it).
 * SG: the literal "Singapore", accepted case-insensitively and normalized, so
 * a hand-built caller writing "singapore" can't fork the stored spelling.
 */
function assertValidState(raw: string, country: Country): string {
	const state = raw.trim();
	switch (country) {
		case "MY":
			if (!MY_STATE_SET.has(state)) {
				throw new Error(`Unknown state: ${state}`);
			}
			return state;
		case "SG":
			if (state.toLowerCase() !== SG_STATE_LABEL.toLowerCase()) {
				throw new Error(
					`Singapore addresses carry "${SG_STATE_LABEL}" as the state`,
				);
			}
			return SG_STATE_LABEL;
	}
}

export function assertValidAddress(
	addr: RawAddress,
	country: Country = DEFAULT_COUNTRY,
): SanitizedAddress {
	const line1 = addr.line1.trim();
	if (line1.length < LINE1_MIN) {
		throw new Error(`Address line 1 must be at least ${LINE1_MIN} characters`);
	}
	if (line1.length > LINE1_MAX) {
		throw new Error(`Address line 1 must be at most ${LINE1_MAX} characters`);
	}

	const line2 = trimmedOrUndefined(addr.line2);
	if (line2 !== undefined && line2.length > LINE2_MAX) {
		throw new Error(`Address line 2 must be at most ${LINE2_MAX} characters`);
	}

	const city = addr.city.trim();
	if (city.length < CITY_MIN) {
		throw new Error(`City must be at least ${CITY_MIN} characters`);
	}
	if (city.length > CITY_MAX) {
		throw new Error(`City must be at most ${CITY_MAX} characters`);
	}

	const state = assertValidState(addr.state, country);

	const postcode = addr.postcode.trim();
	const postcodeRule = POSTCODE_RULES[country];
	if (!postcodeRule.pattern.test(postcode)) {
		throw new Error(postcodeRule.error);
	}

	const notes = trimmedOrUndefined(addr.notes);
	if (notes !== undefined && notes.length > NOTES_MAX) {
		throw new Error(`Notes must be at most ${NOTES_MAX} characters`);
	}

	const mapsUrlRaw = trimmedOrUndefined(addr.mapsUrl);
	const mapsUrl = mapsUrlRaw !== undefined ? assertValidUrl(mapsUrlRaw) : undefined;

	// Coordinates flow through as an all-or-nothing pair. Bounded checks keep a
	// malformed client from poisoning the order doc; we silently drop instead
	// of throwing because the address is still valid without them — the only
	// downstream consumer is the WhatsApp location pin (optional feature).
	let latitude: number | undefined;
	let longitude: number | undefined;
	if (
		typeof addr.latitude === "number" &&
		typeof addr.longitude === "number" &&
		Number.isFinite(addr.latitude) &&
		Number.isFinite(addr.longitude) &&
		addr.latitude >= -90 &&
		addr.latitude <= 90 &&
		addr.longitude >= -180 &&
		addr.longitude <= 180
	) {
		latitude = addr.latitude;
		longitude = addr.longitude;
	}

	const placeId = trimmedOrUndefined(addr.placeId);
	if (placeId !== undefined && placeId.length > PLACE_ID_MAX) {
		throw new Error(`Invalid place ID (max ${PLACE_ID_MAX} characters)`);
	}

	return {
		line1,
		line2,
		city,
		state,
		postcode,
		notes,
		mapsUrl,
		latitude,
		longitude,
		placeId,
	};
}
