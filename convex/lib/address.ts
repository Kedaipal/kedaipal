/**
 * Server-side delivery-address validation. Kept free of Convex imports so it
 * can be unit-tested in isolation and mirrors the client-side Zod schema in
 * `src/lib/schemas.ts`.
 *
 * Malaysia-only for v1. When we expand markets, replace MY_STATES with a
 * country-keyed map and accept a country code on the address object.
 */

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

const POSTCODE_PATTERN = /^\d{5}$/;

const LINE1_MIN = 3;
const LINE1_MAX = 120;
const LINE2_MAX = 120;
const CITY_MIN = 2;
const CITY_MAX = 60;
const NOTES_MAX = 200;
const MAPS_URL_MAX = 500;

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

export function assertValidAddress(addr: RawAddress): SanitizedAddress {
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

	const state = addr.state.trim();
	if (!MY_STATE_SET.has(state)) {
		throw new Error(`Unknown state: ${state}`);
	}

	const postcode = addr.postcode.trim();
	if (!POSTCODE_PATTERN.test(postcode)) {
		throw new Error("Postcode must be 5 digits");
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
	};
}
