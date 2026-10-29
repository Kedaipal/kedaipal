// EasyParcel Open API (2026-09) — pure client helpers: OAuth URLs + token
// parsing, request bodies, response parsing, status normalisation, failure
// classes. NO fetch and NO Convex imports, so every piece unit-tests in
// isolation; convex/easyparcel.ts owns the network, the tokens and the db.
// See docs/delivery-easyparcel.md (ClickUp z8r3fdcje2).
//
// API shape (easyparcel.github.io/OpenAPI, version 2026-09, read 27 Oct 2026):
//  - OAuth 2.0 AUTHORIZATION CODE. Kedaipal registers ONE app (client id +
//    secret, Convex env); each SELLER signs in at EasyParcel, picks which of
//    their accounts (Live or Demo) Kedaipal may book with, and allows. The
//    token is bound to that account — environment included, which no
//    response field reports (see `environment` on the connection row).
//  - One host for every country and both environments:
//    https://api.easyparcel.com/open_api/2026-09/…, JSON, Bearer token.
//  - Batch-shaped endpoints answer HTTP 200 even when an item fails: the
//    verdict is each item's `status`, never the HTTP code.
//  - Submit CHARGES the connected account's prepaid wallet in the same call —
//    there is no separate pay step.
//  - Status arrives by webhook (unsigned — see convex/http.ts) and by
//    `/shipment/details`, which takes ONE shipment number per call.

import { COUNTRY_CURRENCY, type Country } from "./country";
import type { DeliveryJobStatus } from "./deliveryJobs";

export const EASYPARCEL_API_BASE =
	"https://api.easyparcel.com/open_api/2026-09";
export const EASYPARCEL_AUTHORIZE_URL =
	"https://api.easyparcel.com/oauth/login";
export const EASYPARCEL_TOKEN_URL = "https://api.easyparcel.com/oauth/token";

/** Refresh this long before the access token's stated expiry, so a call made
 * a moment before expiry never races it. */
export const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function buildAuthorizeUrl(args: {
	clientId: string;
	redirectUri: string;
	state: string;
}): string {
	const params = new URLSearchParams({
		client_id: args.clientId,
		redirect_uri: args.redirectUri,
		state: args.state,
	});
	return `${EASYPARCEL_AUTHORIZE_URL}?${params.toString()}`;
}

/** `Authorization: Basic base64(client_id:client_secret)` — the token
 * endpoint's documented client authentication. */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
	return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

/** Token request body for both grants. Sent form-encoded — the OAuth 2.0
 * standard (RFC 6749 §4.1.3); the docs give fields but no content type. */
export function buildTokenRequestBody(
	grant:
		| { kind: "authorization_code"; code: string; redirectUri: string }
		| { kind: "refresh_token"; refreshToken: string; redirectUri: string },
): string {
	const params = new URLSearchParams();
	if (grant.kind === "authorization_code") {
		params.set("grant_type", "authorization_code");
		params.set("code", grant.code);
	} else {
		params.set("grant_type", "refresh_token");
		params.set("refresh_token", grant.refreshToken);
	}
	params.set("redirect_uri", grant.redirectUri);
	return params.toString();
}

export type EasyparcelTokens = {
	accessToken: string;
	/** Absent when a refresh response doesn't rotate it — keep the old one. */
	refreshToken?: string;
	accessExpiresAt: number;
	refreshExpiresAt?: number;
};

/**
 * The token response. Expiry is computed from `expires_in` (seconds), never
 * the `expires_at` timestamp: the documented sample's two timestamps disagree
 * with its own durations, and a relative duration can't be wrong about the
 * server's clock.
 */
export function parseTokenResponse(
	body: string,
	now: number,
): EasyparcelTokens {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(body) as Record<string, unknown>;
	} catch {
		throw new EasyparcelApiError("token_unparseable", 0, body.slice(0, 200));
	}
	const accessToken = str(parsed.access_token);
	if (!accessToken) {
		throw new EasyparcelApiError(
			"token_missing",
			0,
			str(parsed.error_description) ?? str(parsed.error) ?? "No access token",
		);
	}
	const expiresIn = num(parsed.expires_in) ?? 3600;
	const refreshIn = num(parsed.refresh_token_expires_in);
	return {
		accessToken,
		refreshToken: str(parsed.refresh_token),
		accessExpiresAt: now + expiresIn * 1000,
		refreshExpiresAt:
			refreshIn !== undefined ? now + refreshIn * 1000 : undefined,
	};
}

/**
 * Whether a token belongs to EasyParcel's sandbox. No API response reports
 * the environment (the token is bound to whichever account the seller picked
 * at sign-in), so the only possible tell is the token itself — when it is a
 * JWT carrying an environment claim. Anything else is `undefined`: unknown is
 * an honest answer, and every surface renders it as unknown, never as live.
 */
export function tokenEnvironment(
	token: string,
): "sandbox" | "live" | undefined {
	const parts = token.split(".");
	if (parts.length !== 3) return undefined;
	let payload: Record<string, unknown>;
	try {
		const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		payload = JSON.parse(
			atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")),
		) as Record<string, unknown>;
	} catch {
		return undefined;
	}
	for (const key of ["environment", "env", "mode", "account_environment"]) {
		const value = payload[key];
		if (typeof value !== "string") continue;
		const v = value.toLowerCase();
		if (v.includes("sandbox") || v.includes("demo") || v.includes("test"))
			return "sandbox";
		if (v.includes("live") || v.includes("prod")) return "live";
	}
	for (const key of ["is_demo", "isDemo", "demo", "sandbox", "is_sandbox"]) {
		const value = payload[key];
		if (typeof value === "boolean") return value ? "sandbox" : "live";
	}
	return undefined;
}

/**
 * Sandbox or live for a fresh connection. The token's own claim wins; when
 * it has none (EasyParcel's tokens carried none in the 28 Oct /test-code run),
 * the account NAME decides — EasyParcel names a sandbox account "… Sandbox
 * Account" in its Developer Hub, and the account picker at sign-in asks only
 * "SG or MY", never "sandbox or live". A name without the word stays
 * UNKNOWN, never "live": a guess at live is the claim that sends a courier.
 */
export function connectionEnvironment(
	accessToken: string,
	accountName: string | undefined,
): "sandbox" | "live" | undefined {
	return (
		tokenEnvironment(accessToken) ??
		(accountName && /\b(sandbox|demo)\b/i.test(accountName)
			? "sandbox"
			: undefined)
	);
}

/**
 * Which country an EasyParcel account belongs to, read from its WALLET
 * currency — the one structured signal the API gives (an account's wallet is
 * in its home currency; the account read carries no country). Unknown when
 * the wallet read failed or names a currency we don't sell in.
 */
export function accountCountryFromCurrency(
	currency: string | undefined,
): Country | undefined {
	if (!currency) return undefined;
	const match = (Object.keys(COUNTRY_CURRENCY) as Country[]).find(
		(c) => COUNTRY_CURRENCY[c] === currency.toUpperCase(),
	);
	return match;
}

/**
 * The other country an account belongs to, if it isn't the store's. A LIVE
 * mismatch can't serve the store — its prices and wallet are in the wrong
 * currency — so callers refuse it; a SANDBOX is exempt at the call site:
 * EasyParcel issues one sandbox per login, in the login's home country (MY
 * for the 28 Oct /test-code tester), and it quotes SG-to-SG fine, so the card
 * labels it instead. Unknown ⇒ no claim.
 */
export function accountCountryMismatch(args: {
	balanceCurrency: string | undefined;
	storeCountry: Country;
}): Country | undefined {
	const accountCountry = accountCountryFromCurrency(args.balanceCurrency);
	return accountCountry && accountCountry !== args.storeCountry
		? accountCountry
		: undefined;
}

export function accessTokenNeedsRefresh(
	accessExpiresAt: number,
	now: number,
): boolean {
	return accessExpiresAt - TOKEN_REFRESH_SKEW_MS <= now;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * One error type for the whole API. `kind` is OUR classification — the API's
 * own error shapes differ by endpoint (four documented 401 bodies), so the
 * HTTP status and the per-item messages are what we classify on.
 */
export class EasyparcelApiError extends Error {
	constructor(
		public readonly code: string,
		public readonly httpStatus: number,
		public readonly detail: string,
	) {
		super(`EasyParcel ${code} (${httpStatus}): ${detail}`);
	}
}

export type EasyparcelFailure =
	| "auth" // the seller's grant is dead — reconnect
	| "credit" // prepaid wallet can't cover it
	| "invalid_address"
	| "rate_limited"
	| "unknown";

export function classifyEasyparcelFailure(
	err: EasyparcelApiError,
): EasyparcelFailure {
	if (err.httpStatus === 401 || err.code === "auth") return "auth";
	if (err.httpStatus === 429) return "rate_limited";
	const d = err.detail.toLowerCase();
	if (
		d.includes("insufficient") ||
		d.includes("credit") ||
		d.includes("balance") ||
		d.includes("top up") ||
		d.includes("topup")
	)
		return "credit";
	if (
		d.includes("postcode") ||
		d.includes("postal") ||
		d.includes("address") ||
		d.includes("subdivision")
	)
		return "invalid_address";
	return "unknown";
}

/** Read the shared envelope `{ status_code, message, data }`. An envelope
 * whose own `status_code` isn't 2xx throws (some endpoints carry 404 inside
 * an HTTP 200); per-ITEM failures are the caller's to read. */
function readEnvelope(body: string, httpStatus: number): unknown {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(body) as Record<string, unknown>;
	} catch {
		throw new EasyparcelApiError("unparseable", httpStatus, body.slice(0, 200));
	}
	const code = num(parsed.status_code) ?? httpStatus;
	if (code < 200 || code >= 300) {
		const detail =
			str(parsed.message) ??
			(typeof parsed.data === "string" ? parsed.data : undefined) ??
			"Request failed";
		throw new EasyparcelApiError(
			code === 401 ? "auth" : "envelope",
			code,
			detail,
		);
	}
	return parsed.data;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Our canonical MY state names → ISO 3166-2:MY codes, exactly the list the
 * Open API documents (MY-01 Johor … MY-16 Putrajaya).
 */
export const MY_SUBDIVISION_CODES: Record<string, string> = {
	Johor: "MY-01",
	Kedah: "MY-02",
	Kelantan: "MY-03",
	Melaka: "MY-04",
	"Negeri Sembilan": "MY-05",
	Pahang: "MY-06",
	"Pulau Pinang": "MY-07",
	Perak: "MY-08",
	Perlis: "MY-09",
	Selangor: "MY-10",
	Terengganu: "MY-11",
	Sabah: "MY-12",
	Sarawak: "MY-13",
	"WP Kuala Lumpur": "MY-14",
	"WP Labuan": "MY-15",
	"WP Putrajaya": "MY-16",
};

/**
 * Singapore has no state tier in our model, but quotations REQUIRE a
 * subdivision code. ISO 3166-2:SG splits the island into five CDC districts
 * (SG-01…05) that no postal sector maps onto cleanly — and the docs' own SG
 * example pairs a Central postcode (018916) with SG-04, so EasyParcel
 * evidently doesn't price on it. One constant, verified against the sandbox:
 * if that ever changes, this is the single line to revisit.
 */
export const SG_SUBDIVISION_CODE = "SG-01";

export function subdivisionCode(
	country: Country,
	stateName: string | undefined,
): string | undefined {
	if (country === "SG") return SG_SUBDIVISION_CODE;
	return stateName ? MY_SUBDIVISION_CODES[stateName] : undefined;
}

/** ISO code → our canonical state name, for importing the pickup address
 * EasyParcel already holds (`province_code` on account info). */
export function stateNameForSubdivision(code: string | undefined): string | undefined {
	if (!code) return undefined;
	for (const [name, iso] of Object.entries(MY_SUBDIVISION_CODES)) {
		if (iso === code) return name;
	}
	return undefined;
}

const DIAL_CODE: Record<Country, string> = { MY: "60", SG: "65" };

/**
 * Bare digits ("60123456789") → the Open API's phone pair: the ISO alpha-2
 * country of the number + the national number WITHOUT the country code
 * (documented sample: "MY" + "1126760658"). A number from neither country
 * returns null — the caller hands the courier the store's number instead.
 */
export function splitPhone(
	digits: string,
): { countryCode: Country; nationalNumber: string } | null {
	const clean = digits.replace(/\D/g, "");
	for (const country of ["MY", "SG"] as const) {
		const dial = DIAL_CODE[country];
		if (clean.startsWith(dial) && clean.length > dial.length + 5) {
			return { countryCode: country, nationalNumber: clean.slice(dial.length) };
		}
	}
	return null;
}

/** One stop of a shipment in our vocabulary. `state` is our canonical
 * display name; the builders map it to an ISO subdivision. */
export type EasyparcelParty = {
	name: string;
	/** Bare digits incl. country code ("6591234567"). */
	phone: string;
	email?: string;
	company?: string;
	/** SG unit ("#05-11") — folded into address line 1, the Open API has no
	 * unit field. */
	unit?: string;
	address1: string;
	address2?: string;
	city: string;
	state?: string;
	postcode: string;
	country: Country;
};

function addressLine1(party: EasyparcelParty): string {
	return party.unit ? `${party.unit} ${party.address1}` : party.address1;
}

/** Box dimensions in cm. Couriers price on the volumetric weight too, so the
 * box is part of every quote, never only of the booking. */
export type ParcelDims = { lengthCm: number; widthCm: number; heightCm: number };

/** The three boxes the dispatch card offers — sized to common courier box
 * tiers, each stated on the pill so the seller knows what's being declared. */
export const PARCEL_BOXES = {
	small: { lengthCm: 20, widthCm: 15, heightCm: 10 },
	medium: { lengthCm: 30, widthCm: 25, heightCm: 15 },
	large: { lengthCm: 40, widthCm: 30, heightCm: 25 },
} as const satisfies Record<string, ParcelDims>;

export type ParcelBox = keyof typeof PARCEL_BOXES;

/** Couriers charge the greater of a parcel's real weight and its size weight
 * (length × width × height in cm ÷ 5000) — the industry divisor. */
export const VOLUMETRIC_DIVISOR = 5000;

/** The weight a box is charged as when it's light for its size, in kg. */
export function boxSizeWeightKg(box: ParcelBox): number {
	const d = PARCEL_BOXES[box];
	return (d.lengthCm * d.widthCm * d.heightCm) / VOLUMETRIC_DIVISOR;
}

/**
 * The box a checkout quotes with, guessed from the cart's weight (Zaki, 30
 * Oct): the smallest box whose size weight covers the parcel's real weight —
 * a parcel that heavy rarely fits anything smaller. Small ≤ 0.6 kg, Medium
 * ≤ 2.25 kg, else Large. The seller still picks the real box at booking.
 */
export function boxForWeight(kg: number): ParcelBox {
	for (const box of ["small", "medium", "large"] as const) {
		if (kg <= boxSizeWeightKg(box)) return box;
	}
	return "large";
}

/** kg → the API's double(8,2), rounded UP so a declared weight is never
 * lighter than the real one (an under-declared parcel is surcharged by the
 * courier after the fact). */
export function apiWeight(kg: number): number {
	return Math.max(0.01, Math.ceil(kg * 100) / 100);
}

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

export function buildQuotationBody(args: {
	sender: { postcode: string; state?: string; country: Country };
	receiver: { postcode: string; state?: string; country: Country };
	weightKg: number;
	dims: ParcelDims;
	/** Declared parcel value, major units. */
	parcelValue?: number;
}): Record<string, unknown> {
	return {
		api_rate_on: true,
		shipment: [
			{
				sender: {
					postcode: args.sender.postcode,
					subdivision_code: subdivisionCode(
						args.sender.country,
						args.sender.state,
					),
					country: args.sender.country,
				},
				receiver: {
					postcode: args.receiver.postcode,
					subdivision_code: subdivisionCode(
						args.receiver.country,
						args.receiver.state,
					),
					country: args.receiver.country,
				},
				parcel_value: args.parcelValue,
				weight: apiWeight(args.weightKg),
				length: args.dims.lengthCm,
				width: args.dims.widthCm,
				height: args.dims.heightCm,
			},
		],
	};
}

/** One quoted courier service, normalised. */
export type EasyparcelRate = {
	/** What a submit books with. */
	serviceId: string;
	serviceName: string;
	courierName: string;
	courierLogo?: string;
	/** Courier collects from the seller's door. */
	isPickup: boolean;
	/** Seller drops the parcel at a point. */
	isDropoff: boolean;
	/** What the seller's wallet pays, minor units. */
	priceMinor: number;
	currency: string;
} & EasyparcelServiceFacts;

/**
 * What a service promises the BUYER and the seller beyond its price — the
 * three facts a seller actually chooses on (z8r3fdcje2 /test-code F9–F13).
 *
 * EasyParcel's quotation has NO structured field for where the buyer
 * receives the parcel or for a minimum parcel count, and `delivery_duration`
 * is documented as "string/null" and arrives null. What it does carry, on
 * every Singapore service, is a stable naming convention:
 *
 *   "Ninja - Standard [1-3 Days] (Pick Up) (From Door to Door | 5 MOQ)"
 *
 * So each fact is read from the structured field first (a `service_tag`
 * "Service Methods" of "Deliver to Door", `delivery_duration`), then from the
 * name — and where neither says, the fact is UNDEFINED and the card claims
 * nothing. A wrong "to your door" is worse than no label.
 */
export type EasyparcelServiceFacts = {
	/** The service name without the bracketed facts the chips now show. */
	label: string;
	/** Where the BUYER gets the parcel. "point" = a locker or shop they
	 * collect from — a different promise from a delivery order's. */
	deliversTo?: "door" | "point";
	/** The courier only collects this many parcels or more at once. */
	minParcels?: number;
	/** Transit after collection, in days. Same-day / hour services = 0. */
	transit?: { minDays: number; maxDays: number };
	/** How the parcel leaves the SELLER — read from a STORED service name,
	 * where the quote's is_pickup / is_dropoff booleans are no longer at hand
	 * (a booked job keeps only the name). */
	sellerHandoff?: "pickup" | "dropoff";
};

export function describeEasyparcelService(
	serviceName: string,
	serviceTags: ReadonlyArray<{ name?: string; value?: string }> = [],
	deliveryDuration?: string,
): EasyparcelServiceFacts {
	const methods = serviceTags
		.filter((t) => /service methods/i.test(t.name ?? ""))
		.map((t) => t.value ?? "");
	const route = /\(From\s+(Door|Point)\s+to\s+(Door|Point)(?:\s+OR\s+to\s+(Door|Point))?/i.exec(
		serviceName,
	);
	const deliversTo: EasyparcelServiceFacts["deliversTo"] = methods.some((m) =>
		/deliver to door/i.test(m),
	)
		? "door"
		: route
			? [route[2], route[3]].some((end) => end && /door/i.test(end))
				? "door"
				: "point"
			: undefined;

	const moq = /(\d+)\s*MOQ/i.exec(serviceName);
	const minParcels = moq ? Number(moq[1]) : undefined;

	return {
		label: cleanServiceLabel(serviceName),
		sellerHandoff: /\((?:pick\s*up)\)/i.test(serviceName)
			? "pickup"
			: /\(drop[-\s]?off\)/i.test(serviceName)
				? "dropoff"
				: undefined,
		deliversTo,
		minParcels: minParcels && minParcels > 1 ? minParcels : undefined,
		transit: parseTransit(deliveryDuration) ?? parseTransit(serviceName),
	};
}

function parseTransit(
	text: string | undefined,
): EasyparcelServiceFacts["transit"] {
	if (!text) return undefined;
	const range = /(\d+)\s*-\s*(\d+)\s*(?:working\s+)?days?/i.exec(text);
	if (range) return { minDays: Number(range[1]), maxDays: Number(range[2]) };
	if (/same[-\s]?day|\d+\s*hours?/i.test(text)) return { minDays: 0, maxDays: 0 };
	if (/next[-\s]?day/i.test(text)) return { minDays: 1, maxDays: 1 };
	const single = /(\d+)\s*(?:working\s+)?days?/i.exec(text);
	if (single) return { minDays: Number(single[1]), maxDays: Number(single[1]) };
	return undefined;
}

function cleanServiceLabel(serviceName: string): string {
	const cleaned = serviceName
		.replace(/\[[^\]]*\]/g, " ")
		.replace(/\((?:pick\s*up|drop[-\s]?off)\)/gi, " ")
		.replace(/\(From[^)]*\)/gi, " ")
		.replace(/\(\s*\d+\s*MOQ\s*\)/gi, " ")
		.replace(/\s{2,}/g, " ")
		.trim()
		.replace(/[\s\-–|]+$/, "");
	return cleaned || serviceName;
}

/** "1–3 days", "Same day", "Next day" — the chip text for a transit. */
export function transitLabel(
	transit: NonNullable<EasyparcelServiceFacts["transit"]>,
): string {
	if (transit.maxDays === 0) return "Same day";
	if (transit.minDays === transit.maxDays)
		return transit.maxDays === 1 ? "Next day" : `${transit.maxDays} days`;
	return `${transit.minDays}–${transit.maxDays} days`;
}

/** Money as the API sends it — a JSON number in the quotation, a decimal
 * STRING in submit/details. Either way → integer minor units; anything that
 * isn't money throws (a mis-parsed price must never freeze onto a job). */
export function easyparcelAmountToMinor(raw: unknown): number {
	const s = typeof raw === "number" ? raw.toFixed(2) : String(raw ?? "").trim();
	if (!/^\d+(\.\d{1,2})?$/.test(s)) {
		throw new Error(`Unparseable EasyParcel amount: ${JSON.stringify(raw)}`);
	}
	const [whole, frac = ""] = s.split(".");
	return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** Quotation response → rates, cheapest first. An empty list is an answer
 * (nothing covers the shipment); an item-level error throws with its
 * messages so the card can say what EasyParcel objected to. */
export function parseQuotationResponse(
	body: string,
	httpStatus = 200,
): EasyparcelRate[] {
	const data = readEnvelope(body, httpStatus);
	const item = Array.isArray(data)
		? (data[0] as Record<string, unknown> | undefined)
		: undefined;
	if (!item) return [];
	if (str(item.status) === "error") {
		throw new EasyparcelApiError("item", httpStatus, itemErrors(item));
	}
	const rates: EasyparcelRate[] = [];
	for (const q of arr(item.quotations)) {
		const courier = obj(q.courier);
		const pricing = obj(q.pricing);
		const serviceId = str(courier.service_id);
		if (!serviceId) continue;
		let priceMinor: number;
		try {
			priceMinor = easyparcelAmountToMinor(
				pricing.seller_payable_amount ?? pricing.total_amount,
			);
		} catch {
			continue; // one malformed row must not sink the quote
		}
		const serviceName =
			str(courier.service_name) ?? str(courier.courier_name) ?? serviceId;
		rates.push({
			serviceId,
			serviceName,
			courierName: str(courier.courier_name) ?? "Courier",
			courierLogo: str(courier.courier_logo),
			isPickup: courier.is_pickup === true,
			isDropoff: courier.is_dropoff === true,
			priceMinor,
			currency: str(pricing.currency) ?? "",
			...describeEasyparcelService(
				serviceName,
				arr(courier.service_tag).map((t) => ({
					name: str(t.name),
					value: str(t.value),
				})),
				str(courier.delivery_duration),
			),
		});
	}
	return rates.sort((a, b) => a.priceMinor - b.priceMinor);
}

// ---------------------------------------------------------------------------
// Submit (books AND charges the wallet)
// ---------------------------------------------------------------------------

export type EasyparcelItem = {
	content: string;
	/** Per-unit weight, kg. */
	weightKg: number;
	/** Per-unit value, major units. */
	value: number;
	quantity: number;
};

function party(p: EasyparcelParty): Record<string, unknown> {
	const phone = splitPhone(p.phone);
	return {
		name: p.name.slice(0, 100),
		company: p.company,
		phone_number_country_code: phone?.countryCode ?? p.country,
		phone_number: phone?.nationalNumber ?? p.phone.replace(/\D/g, ""),
		email: p.email,
		address_1: addressLine1(p).slice(0, 255),
		address_2: p.address2,
		postcode: p.postcode,
		city: p.city,
		subdivision_code: subdivisionCode(p.country, p.state),
		country_code: p.country,
	};
}

export function buildSubmitBody(args: {
	serviceId: string;
	/** "YYYY-MM-DD". */
	collectionDate: string;
	weightKg: number;
	dims: ParcelDims;
	items: EasyparcelItem[];
	currency: string;
	sender: EasyparcelParty;
	receiver: EasyparcelParty;
	/** Our order shortId — shown on the seller's EasyParcel dashboard. */
	reference: string;
}): Record<string, unknown> {
	return {
		shipment: [
			{
				reference: args.reference,
				service_id: args.serviceId,
				collection_date: args.collectionDate,
				weight: apiWeight(args.weightKg),
				length: args.dims.lengthCm,
				width: args.dims.widthCm,
				height: args.dims.heightCm,
				item: args.items.map((i) => ({
					content: i.content.slice(0, 100),
					weight: apiWeight(i.weightKg),
					length: args.dims.lengthCm,
					width: args.dims.widthCm,
					height: args.dims.heightCm,
					currency_code: args.currency,
					value: Math.round(i.value * 100) / 100,
					quantity: i.quantity,
				})),
				sender: party(args.sender),
				receiver: party(args.receiver),
				// Required object. Every add-on stays OFF: each is a charge on
				// the seller's wallet they didn't choose, and EasyParcel's own
				// buyer SMS/WhatsApp would duplicate what the track page already
				// tells the buyer.
				feature: {
					sms_tracking: false,
					email_tracking: false,
					whatsapp_tracking: false,
				},
			},
		],
	};
}

export type EasyparcelBooked = {
	/** "ES-YYMM-XXXXX" — what details, cancel and webhooks key on. */
	shipmentNumber: string;
	/** "EI-…" — the order it sits in on the seller's dashboard. */
	orderNumber?: string;
	courierName?: string;
	awb?: string;
	labelUrl?: string;
	trackingUrl?: string;
	paidMinor?: number;
	currency?: string;
};

/** Submit response → the one shipment we booked. An item-level failure
 * throws with EasyParcel's own messages (HTTP is 200 either way). */
export function parseSubmitResponse(
	body: string,
	httpStatus = 200,
): EasyparcelBooked {
	const data = readEnvelope(body, httpStatus);
	const order = Array.isArray(data)
		? (data[0] as Record<string, unknown> | undefined)
		: undefined;
	if (!order) throw new EasyparcelApiError("empty", httpStatus, "No order returned");
	const shipment = arr(order.shipments)[0];
	if (!shipment) {
		throw new EasyparcelApiError(
			"item",
			httpStatus,
			itemErrors(order) || "No shipment returned",
		);
	}
	if (str(shipment.status) !== "success") {
		throw new EasyparcelApiError("item", httpStatus, itemErrors(shipment));
	}
	const shipmentNumber = str(shipment.shipment_number);
	if (!shipmentNumber) {
		throw new EasyparcelApiError("empty", httpStatus, "No shipment number");
	}
	const pricing = obj(shipment.pricing_breakdown);
	let paidMinor: number | undefined;
	try {
		paidMinor = easyparcelAmountToMinor(pricing.total_paid_amount);
	} catch {
		paidMinor = undefined;
	}
	return {
		shipmentNumber,
		orderNumber: str(obj(order.order_details).order_number),
		courierName: str(shipment.courier),
		awb: str(shipment.awb_number),
		labelUrl: labelUrlOf(shipment.awb_url, shipment.awb_urls_by_format),
		trackingUrl: str(shipment.tracking_url),
		paidMinor,
		currency: str(pricing.currency_code),
	};
}

/** The label to link: A6 first (the thermal-printer size most couriers
 * accept), then whatever `awb_url` is. Empty strings mean "not yet". */
function labelUrlOf(awbUrl: unknown, byFormat: unknown): string | undefined {
	const formats = obj(byFormat);
	return str(formats.A6) ?? str(awbUrl) ?? str(formats.A4);
}

// ---------------------------------------------------------------------------
// Details (status + AWB) — one shipment per call
// ---------------------------------------------------------------------------

export type EasyparcelShipmentState = {
	shipmentNumber: string;
	statusCode?: number;
	statusText?: string;
	awb?: string;
	labelUrl?: string;
	trackingUrl?: string;
};

export function parseDetailsResponse(
	body: string,
	httpStatus = 200,
): EasyparcelShipmentState {
	const data = readEnvelope(body, httpStatus);
	const row = Array.isArray(data)
		? (data[0] as Record<string, unknown> | undefined)
		: undefined;
	const shipmentNumber = row ? str(row.shipment_number) : undefined;
	if (!row || !shipmentNumber) {
		throw new EasyparcelApiError("empty", httpStatus, "Shipment not found");
	}
	const d = obj(row.shipment_details);
	return {
		shipmentNumber,
		statusCode: num(d.shipment_status_code),
		statusText: str(d.shipment_status),
		awb: str(d.awb_number),
		labelUrl: str(d.awb_url),
		trackingUrl: str(d.tracking_url),
	};
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export function buildCancelBody(
	shipmentNumber: string,
	remark: string,
): Record<string, unknown> {
	return { cancel_list: [{ shipment_number: shipmentNumber, remark }] };
}

/** `ok: false` carries EasyParcel's own sentence ("…cancellation period is
 * over (7 days from collection date…)") — it IS the seller-facing reason. */
export function parseCancelResponse(
	body: string,
	httpStatus = 200,
): { ok: true } | { ok: false; message: string } {
	const data = readEnvelope(body, httpStatus);
	const row = Array.isArray(data)
		? (data[0] as Record<string, unknown> | undefined)
		: undefined;
	if (row && str(row.status) === "success") return { ok: true };
	return {
		ok: false,
		message: (row && str(row.message)) || "EasyParcel didn't cancel it",
	};
}

// ---------------------------------------------------------------------------
// Wallet + account
// ---------------------------------------------------------------------------

export function parseWalletResponse(
	body: string,
	httpStatus = 200,
): { balanceMinor: number; currency: string } {
	const data = obj(readEnvelope(body, httpStatus));
	const wallet = arr(data.wallet)[0];
	if (!wallet) throw new EasyparcelApiError("empty", httpStatus, "No wallet");
	return {
		balanceMinor: easyparcelAmountToMinor(wallet.balance),
		currency: str(wallet.currency) ?? "",
	};
}

export type EasyparcelAccount = {
	name?: string;
	accountType?: string;
	/** The pickup address the account already holds — imported as a PREFILL
	 * (fill-if-unset), never trusted over what the seller saved with us. */
	pickupAddress?: {
		address1: string;
		address2?: string;
		city: string;
		state?: string;
		postcode: string;
		country?: string;
	};
};

export function parseAccountResponse(
	body: string,
	httpStatus = 200,
): EasyparcelAccount {
	const data = obj(readEnvelope(body, httpStatus));
	const account = obj(data.account);
	const pickup = obj(obj(data.address).pickup_address);
	const address1 = str(pickup.address1);
	const city = str(pickup.city);
	const postcode = str(pickup.postcode);
	return {
		name: str(account.name),
		accountType: str(account.account_type),
		pickupAddress:
			address1 && city && postcode
				? {
						address1,
						address2: str(pickup.address2),
						city,
						state: stateNameForSubdivision(str(pickup.province_code)),
						postcode,
						country: str(pickup.country_code),
					}
				: undefined,
	};
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * EasyParcel's shipment status codes → our job status (the code table is
 * shared by details, tracking and webhooks):
 *
 *   7  Schedule In Arrangement   → assigning
 *   2  To Be Collected           → assigning
 *   3  Collected                 → picked_up (the courier HAS it)
 *   11 Drop Off                  → picked_up (parcel left at a point)
 *   4  Delivery In Transit       → picked_up
 *   5  Delivered                 → completed
 *   0  Cancel                    → canceled
 *   6  Returned                  → rejected (terminal without delivery)
 *   8  On Hold                   → undefined — informational; a hold must
 *                                   never move or terminate the job
 *
 * Unknown codes → undefined: "codes may vary by courier and region", so the
 * job simply doesn't move rather than moving wrong.
 */
export function normalizeEasyparcelStatus(
	code: number | undefined,
): DeliveryJobStatus | undefined {
	switch (code) {
		case 7:
		case 2:
			return "assigning";
		case 3:
		case 11:
		case 4:
			return "picked_up";
		case 5:
			return "completed";
		case 0:
			return "canceled";
		case 6:
			return "rejected";
		default:
			return undefined;
	}
}

export const EASYPARCEL_ON_HOLD = 8;

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/**
 * The only thing we take from a webhook body is WHICH shipment it's about.
 * Payloads are unsigned (the docs define no signature), so nothing in them is
 * trusted: the route re-reads the shipment with the seller's own token and
 * applies that. A forged event can at most cause one extra lookup.
 */
export function parseWebhookShipmentNumber(body: string): string | null {
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		const shipmentNumber = str(parsed.shipment_number);
		return shipmentNumber && /^ES-[A-Z0-9-]{4,40}$/i.test(shipmentNumber)
			? shipmentNumber
			: null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// small readers
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
	return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()))
		return Number(v);
	return undefined;
}
function obj(v: unknown): Record<string, unknown> {
	return v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {};
}
function arr(v: unknown): Record<string, unknown>[] {
	if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object");
	// Some documented samples print arrays as {"0": {...}} objects.
	if (v && typeof v === "object") {
		return Object.values(v as Record<string, unknown>).filter(
			(x): x is Record<string, unknown> => !!x && typeof x === "object",
		);
	}
	return [];
}
function itemErrors(item: Record<string, unknown>): string {
	const errs = item.errors;
	if (Array.isArray(errs)) return errs.map(String).join(" ");
	return str(item.message) ?? "EasyParcel rejected the request";
}
