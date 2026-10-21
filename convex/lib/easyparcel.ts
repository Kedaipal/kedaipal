// EasyParcel legacy "Individual API" — pure client helpers (form encoding,
// request building, response parsing, status normalization). NO fetch and NO
// Convex imports so every piece unit-tests in isolation; the actions in
// convex/easyparcel.ts own the network + db. See docs/delivery-easyparcel.md
// (ClickUp z8r3fdcje2).
//
// API shape (developers.easyparcel.com MY Individual 1.4.0.0 + SG Individual
// 1.1.0.0, cross-checked against EasyParcel's own WooCommerce plugin source,
// extracted 20 Oct 2026):
//  - One host PER COUNTRY, and a separate demo host per country:
//    connect.easyparcel.my / connect.easyparcel.sg (demo.connect.…). The
//    seller's account lives on one platform; the store's country picks it.
//  - Every call is POST form-encoded (PHP http_build_query bracket notation)
//    to `{host}/?ac={Action}`, authenticated by a single `api` key field.
//  - Flow: EPRateCheckingBulk (service list w/ prices) → EPSubmitOrderBulk
//    (order_number; EasyParcel re-validates) → EPPayOrderBulk (pays from the
//    seller's PREPAID wallet; returns AWB + label PDF link + tracking URL).
//  - Status is POLLED: EPParcelStatusBulk by order_number (ship_status
//    strings), EPTrackingBulk by AWB. No webhook in the Individual docs —
//    the status cron in convex/crons.ts is the sync mechanism.
//  - Rates/prices arrive as STRINGS in major units ("8.00").
//  - SG differences the builders encode: no state tier (rate check sends no
//    *_state at all; submit sends the literal "Singapore", the plugin's own
//    behaviour), 6-digit postcodes, `pick_unit`/`send_unit` address fields,
//    and thinner responses (no rate_id/dropoff points; pay returns no
//    tracking_url).

import { decryptSecret } from "./credentialCrypto";
import type { Country } from "./country";
import type { DeliveryJobStatus } from "./deliveryJobs";

/** Production + demo hosts per country. The demo host is a real, separate
 * environment (same key format; support tops up play-money credit) — which
 * host a key authenticates on is how connect resolves `isDemo`. */
export function easyparcelBaseUrl(country: Country, isDemo: boolean): string {
	const tld = country === "SG" ? "sg" : "my";
	return isDemo
		? `https://demo.connect.easyparcel.${tld}`
		: `https://connect.easyparcel.${tld}`;
}

export function easyparcelActionUrl(
	country: Country,
	isDemo: boolean,
	action: string,
): string {
	return `${easyparcelBaseUrl(country, isDemo)}/?ac=${encodeURIComponent(action)}`;
}

export type EasyparcelCredentials = {
	/** The seller's Individual API key (≤25 chars plaintext; stored
	 * `enc.v1.`-encrypted). The ONLY credential this API has. */
	apiKey: string;
};

/** BYO-only resolver, same posture as the Delyva/Lalamove/HitPay siblings:
 * the seller's own account or nothing — incomplete reads as null and callers
 * fail closed. */
export function resolveEasyparcelCredentials(
	config: { apiKey?: string } | undefined,
): EasyparcelCredentials | null {
	const apiKey = config?.apiKey?.trim();
	if (!apiKey) return null;
	return { apiKey };
}

/** Decrypt-at-use (the 86eyn25gk posture): stored values are ciphertext;
 * called by the network client right before every request. */
export async function decryptEasyparcelCredentials(
	credentials: EasyparcelCredentials,
): Promise<EasyparcelCredentials> {
	return { apiKey: await decryptSecret(credentials.apiKey) };
}

/**
 * PHP `http_build_query` equivalent: flattens nested objects/arrays into
 * bracket-notation form fields (`bulk[0][pick_code]=43700`). EasyParcel's
 * endpoints read exactly this shape (their own plugin posts it); JSON bodies
 * are NOT accepted on the standard actions. Booleans are the caller's job to
 * spell ("1"/"0" — the plugin's submit convention) so nothing here guesses a
 * representation the API might read differently.
 */
export function encodeEasyparcelForm(params: Record<string, unknown>): string {
	const pairs: string[] = [];
	const walk = (prefix: string, value: unknown) => {
		if (value === undefined || value === null) return;
		if (Array.isArray(value)) {
			value.forEach((item, i) => walk(`${prefix}[${i}]`, item));
			return;
		}
		if (typeof value === "object") {
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				walk(`${prefix}[${k}]`, v);
			}
			return;
		}
		pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
	};
	for (const [k, v] of Object.entries(params)) walk(k, v);
	return pairs.join("&");
}

/**
 * EasyParcel money → integer minor units (sen/cents). Their prices arrive as
 * strings in major units ("8.00", "99999755.99"); string math avoids float
 * dust, and anything that doesn't look like money throws — a mis-parsed fee
 * must never freeze onto a job (the Delyva rule).
 */
export function easyparcelAmountToMinor(raw: string | number): number {
	const s = String(raw).trim();
	if (!/^\d+(\.\d{1,2})?$/.test(s)) {
		throw new Error(`Unparseable EasyParcel amount: ${JSON.stringify(raw)}`);
	}
	const [whole, frac = ""] = s.split(".");
	return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/**
 * Our canonical MY state names → EasyParcel's Appendix III codes. Error 1005
 * is explicit that the API takes CODES, never names. SG has no state tier, so
 * this map is the one MY-only piece of the module — kept here so the future
 * MY lane (cross-border z8r3fdr5yy) is a registry flip, not a rebuild.
 */
export const MY_EASYPARCEL_STATE_CODES: Record<string, string> = {
	Johor: "jhr",
	Kedah: "kdh",
	Kelantan: "ktn",
	Melaka: "mlk",
	"Negeri Sembilan": "nsn",
	Pahang: "phg",
	Perak: "prk",
	Perlis: "pls",
	"Pulau Pinang": "png",
	Sabah: "sbh",
	Sarawak: "srw",
	Selangor: "sgr",
	Terengganu: "trg",
	"WP Kuala Lumpur": "kul",
	"WP Labuan": "lbn",
	"WP Putrajaya": "pjy",
};

export function easyparcelStateCode(
	country: Country,
	stateName: string | undefined,
): string | undefined {
	if (country !== "MY") return undefined;
	return stateName ? MY_EASYPARCEL_STATE_CODES[stateName] : undefined;
}

/** One side of a shipment, in our vocabulary. `unit` is the SG unit number
 * ("#05-11"); `state` is our canonical display name (mapped to the MY code or
 * the SG literal inside the builders, never by callers). */
export type EasyparcelParty = {
	name: string;
	/** Bare digits MSISDN ("6591234567"). */
	phone: string;
	company?: string;
	unit?: string;
	address1: string;
	address2?: string;
	city?: string;
	state?: string;
	postcode: string;
	country: Country;
};

/** EPRateCheckingBulk — one shipment per call (bulk of 1: dispatch quotes one
 * order at a time, and a 1-item bulk keeps the response parse trivial). */
export function buildRateCheckForm(args: {
	apiKey: string;
	pickup: { postcode: string; state?: string; country: Country };
	send: { postcode: string; state?: string; country: Country };
	weightKg: number;
	/** "YYYY-MM-DD"; omitted → EasyParcel defaults to today. */
	dateColl?: string;
}): string {
	const item: Record<string, unknown> = {
		pick_code: args.pickup.postcode,
		pick_country: args.pickup.country,
		send_code: args.send.postcode,
		send_country: args.send.country,
		// The plugin floors at 0.25kg — a 0 weight quotes nothing but errors
		// nowhere, which reads as "no courier serves this address". Never that.
		weight: Math.max(args.weightKg, 0.25).toFixed(3),
		date_coll: args.dateColl,
	};
	// MY requires Appendix III state codes on BOTH ends; the SG doc has no
	// state fields at all (sending none is the documented shape).
	const pickState = easyparcelStateCode(args.pickup.country, args.pickup.state);
	const sendState = easyparcelStateCode(args.send.country, args.send.state);
	if (pickState) item.pick_state = pickState;
	if (sendState) item.send_state = sendState;
	return encodeEasyparcelForm({ api: args.apiKey, bulk: [item] });
}

/** One quoted courier service, normalized across the rich MY response and the
 * thinner SG one (no rate_id / points / COD keys there). */
export type EasyparcelRate = {
	/** What EPSubmitOrderBulk books with. */
	serviceId: string;
	serviceName: string;
	courierName: string;
	courierLogo?: string;
	/** "parcel" | "document" (their vocabulary, passed through). */
	serviceType?: string;
	/** Human ETA, e.g. "3-5 working day(s)". */
	deliveryEta?: string;
	/** Earliest pickup date EasyParcel offers ("YYYY-MM-DD"). */
	pickupDate?: string;
	/** Total price (shipping + addons), minor units. */
	priceMinor: number;
	/** MY only: whether the service is dropoff / pickup / both. */
	serviceDetail?: string;
};

export class EasyparcelResponseError extends Error {
	constructor(
		public readonly errorCode: string,
		public readonly errorRemark: string,
	) {
		super(`EasyParcel error ${errorCode}: ${errorRemark}`);
	}
}

type RawEnvelope = {
	api_status?: unknown;
	error_code?: unknown;
	error_remark?: unknown;
	result?: unknown;
};

const str = (v: unknown): string | undefined =>
	typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Parse the shared `{api_status, error_code, error_remark, result}` envelope.
 * error_code arrives as number OR string ("0"); anything non-zero throws with
 * the machine code preserved for classification. */
export function parseEasyparcelEnvelope(body: string): {
	result: unknown;
} {
	let parsed: RawEnvelope;
	try {
		parsed = JSON.parse(body) as RawEnvelope;
	} catch {
		throw new EasyparcelResponseError("unparseable", body.slice(0, 200));
	}
	const code = String(parsed.error_code ?? "");
	if (code !== "0" && code !== "") {
		throw new EasyparcelResponseError(
			code,
			str(parsed.error_remark) ?? "Unknown EasyParcel error",
		);
	}
	return { result: parsed.result };
}

/** EPRateCheckingBulk response → normalized rates, cheapest first. An empty
 * list is a normal answer (no courier covers the shipment), never a throw. */
export function parseRateCheckResponse(body: string): EasyparcelRate[] {
	const { result } = parseEasyparcelEnvelope(body);
	if (!Array.isArray(result)) return [];
	const first = result[0] as { rates?: unknown } | undefined;
	if (!first || !Array.isArray(first.rates)) return [];
	const rates: EasyparcelRate[] = [];
	for (const raw of first.rates as Array<Record<string, unknown>>) {
		const serviceId = str(raw.service_id);
		const price = raw.price;
		if (!serviceId || (typeof price !== "string" && typeof price !== "number"))
			continue;
		let priceMinor: number;
		try {
			priceMinor = easyparcelAmountToMinor(price);
		} catch {
			continue; // one malformed row must not sink the quote
		}
		rates.push({
			serviceId,
			serviceName: str(raw.service_name) ?? str(raw.courier_name) ?? serviceId,
			courierName: str(raw.courier_name) ?? "Courier",
			courierLogo: str(raw.courier_logo),
			serviceType: str(raw.service_type),
			deliveryEta: str(raw.delivery),
			pickupDate: str(raw.pickup_date),
			priceMinor,
			serviceDetail: str(raw.service_detail),
		});
	}
	return rates.sort((a, b) => a.priceMinor - b.priceMinor);
}

/** EPSubmitOrderBulk — one shipment. Field set follows the plugin (it sends
 * the superset for both countries and the API ignores what a country doesn't
 * use); flags ride as "1"/"0", the plugin's submit convention. */
export function buildSubmitOrderForm(args: {
	apiKey: string;
	pickup: EasyparcelParty;
	send: EasyparcelParty;
	weightKg: number;
	/** Label description, truncated here — their validator rejects essays. */
	content: string;
	/** Declared parcel value, MAJOR units string ("120.00"). */
	value: string;
	serviceId: string;
	/** "YYYY-MM-DD". */
	collectDate?: string;
	/** Our order shortId — echoed back on their dashboard rows. */
	reference?: string;
}): string {
	const party = (p: EasyparcelParty, prefix: "pick" | "send") => {
		const stateCode = easyparcelStateCode(p.country, p.state);
		return {
			[`${prefix}_name`]: p.name,
			[`${prefix}_company`]: p.company,
			[`${prefix}_contact`]: p.phone,
			[`${prefix}_mobile`]: p.phone,
			[`${prefix}_unit`]: p.unit,
			[`${prefix}_addr1`]: p.address1,
			[`${prefix}_addr2`]: p.address2,
			[`${prefix}_city`]: p.city,
			// MY: Appendix III code. SG: the literal "Singapore" — the SG doc
			// marks send_state required and the plugin sends exactly this.
			[`${prefix}_state`]: p.country === "SG" ? "Singapore" : stateCode,
			[`${prefix}_code`]: p.postcode,
			[`${prefix}_country`]: p.country,
		};
	};
	const item: Record<string, unknown> = {
		...party(args.pickup, "pick"),
		...party(args.send, "send"),
		weight: Math.max(args.weightKg, 0.25).toFixed(3),
		content: args.content.slice(0, 100),
		value: args.value,
		service_id: args.serviceId,
		collect_date: args.collectDate,
		reference: args.reference,
		sms: "0",
		addon_tracking_email_enabled: "0",
		addon_whatsapp_tracking_enabled: "0",
		eori_acknowledged: "0",
	};
	return encodeEasyparcelForm({ api: args.apiKey, bulk: [item] });
}

export type EasyparcelSubmitResult = {
	/** "EI-…" — the handle EPPayOrderBulk + status polling key on. */
	orderNumber: string;
	/** Total price EasyParcel will charge the wallet, minor units. */
	priceMinor: number;
};

/** EPSubmitOrderBulk response. A per-row "Fail" throws with the row's remarks
 * (the envelope is Success even when the row fails). SG rows carry no
 * parcel_number — only order_number is universal, so it is all we keep. */
export function parseSubmitOrderResponse(body: string): EasyparcelSubmitResult {
	const { result } = parseEasyparcelEnvelope(body);
	const row = Array.isArray(result)
		? (result[0] as Record<string, unknown> | undefined)
		: undefined;
	if (!row) throw new EasyparcelResponseError("empty", "No submit result row");
	const status = str(row.status);
	const orderNumber = str(row.order_number);
	if (status?.toLowerCase() !== "success" || !orderNumber) {
		throw new EasyparcelResponseError(
			"row_fail",
			str(row.remarks) ?? "Order was not accepted",
		);
	}
	let priceMinor = 0;
	if (typeof row.price === "string" || typeof row.price === "number") {
		try {
			priceMinor = easyparcelAmountToMinor(row.price);
		} catch {
			priceMinor = 0;
		}
	}
	return { orderNumber, priceMinor };
}

export function buildPayOrderForm(args: {
	apiKey: string;
	orderNumber: string;
}): string {
	return encodeEasyparcelForm({
		api: args.apiKey,
		bulk: [{ order_no: args.orderNumber }],
	});
}

export type EasyparcelPayResult =
	| {
			paid: true;
			awb?: string;
			/** Courier AWB label PDF (their `awb_id_link`). */
			labelUrl?: string;
			/** MY responses only; SG omits it (tracking rides the AWB). */
			trackingUrl?: string;
	  }
	| {
			paid: false;
			/** "Insufficient Credit" arrives INSIDE a Success envelope — the
			 * message string is the verdict, so it is preserved verbatim. */
			message: string;
	  };

export function parsePayOrderResponse(body: string): EasyparcelPayResult {
	const { result } = parseEasyparcelEnvelope(body);
	const row = Array.isArray(result)
		? (result[0] as Record<string, unknown> | undefined)
		: undefined;
	if (!row) throw new EasyparcelResponseError("empty", "No pay result row");
	const message = str(row.messagenow) ?? "";
	if (!/fully paid/i.test(message)) {
		return { paid: false, message: message || "Payment was not completed" };
	}
	const parcel = Array.isArray(row.parcel)
		? (row.parcel[0] as Record<string, unknown> | undefined)
		: undefined;
	return {
		paid: true,
		awb: str(parcel?.awb),
		labelUrl: str(parcel?.awb_id_link),
		trackingUrl: str(parcel?.tracking_url),
	};
}

export function buildParcelStatusForm(args: {
	apiKey: string;
	orderNumbers: string[];
}): string {
	return encodeEasyparcelForm({
		api: args.apiKey,
		bulk: args.orderNumbers.map((order_no) => ({ order_no })),
	});
}

export type EasyparcelParcelStatus = {
	orderNumber: string;
	shipStatus?: string;
	awb?: string;
	labelUrl?: string;
};

/** EPParcelStatusBulk response — one entry per queried order_no, in order. */
export function parseParcelStatusResponse(
	body: string,
): EasyparcelParcelStatus[] {
	const { result } = parseEasyparcelEnvelope(body);
	if (!Array.isArray(result)) return [];
	const out: EasyparcelParcelStatus[] = [];
	for (const raw of result as Array<Record<string, unknown>>) {
		const orderNumber = str(raw.order_no);
		if (!orderNumber) continue;
		const parcel = Array.isArray(raw.parcel)
			? (raw.parcel[0] as Record<string, unknown> | undefined)
			: undefined;
		out.push({
			orderNumber,
			shipStatus: str(parcel?.ship_status),
			awb: str(parcel?.awb),
			labelUrl: str(parcel?.awb_id_link),
		});
	}
	return out;
}

export function buildCheckBalanceForm(apiKey: string): string {
	return encodeEasyparcelForm({ api: apiKey });
}

/** EPCheckCreditBalance — `result` is the balance string; `currency` is
 * undocumented but present live (their plugin reads it). */
export function parseCheckBalanceResponse(body: string): {
	balanceMinor: number;
	currency?: string;
} {
	let parsed: RawEnvelope & { currency?: unknown };
	try {
		parsed = JSON.parse(body) as RawEnvelope & { currency?: unknown };
	} catch {
		throw new EasyparcelResponseError("unparseable", body.slice(0, 200));
	}
	const code = String(parsed.error_code ?? "");
	if (code !== "0") {
		throw new EasyparcelResponseError(
			code,
			str(parsed.error_remark) ?? "Unknown EasyParcel error",
		);
	}
	if (typeof parsed.result !== "string" && typeof parsed.result !== "number") {
		throw new EasyparcelResponseError("empty", "No balance in response");
	}
	return {
		balanceMinor: easyparcelAmountToMinor(parsed.result),
		currency: str(parsed.currency),
	};
}

/**
 * EasyParcel `ship_status` → our normalized job status. Their vocabulary is
 * free-ish prose (MY and SG enums differ slightly), so matching is
 * case-insensitive and unknown strings return undefined — status simply
 * doesn't move, the webhook-vocab posture normalizeDelyvaStatus set.
 *
 *   pre-collection (incl. drop-off pending)  → assigning
 *   collected / dropped off / in transit     → picked_up (the courier HAS the
 *                                              parcel — mirrors Delyva 500/600)
 *   Successfully Delivered                   → completed
 *   Cancel / Cancel By Admin                 → canceled
 *   Expired (Unpaid)                         → expired
 *   Returned                                 → rejected (terminal: the flow
 *                                              ended without delivery)
 *   On Hold / Other Status                   → undefined (informational; a
 *                                              hold must never regress or
 *                                              terminate the job)
 */
export function normalizeEasyparcelShipStatus(
	shipStatus: string | undefined,
): DeliveryJobStatus | undefined {
	if (!shipStatus) return undefined;
	const s = shipStatus.trim().toLowerCase();
	if (
		s === "waiting payment" ||
		s === "schedule in arrangement" ||
		s === "pending for collection" ||
		s === "pending for drop off"
	)
		return "assigning";
	if (
		s === "collected" ||
		s === "parcel has been collected" ||
		s === "parcel drop off at point" ||
		s === "drop off" ||
		s === "delivering(in transit)" ||
		s === "delivering (in transit)"
	)
		return "picked_up";
	if (s === "successfully delivered") return "completed";
	if (s === "cancel" || s === "cancel by admin") return "canceled";
	if (s === "expired (unpaid)") return "expired";
	if (s === "returned") return "rejected";
	return undefined;
}

/**
 * Why an EasyParcel call failed, as a stable machine class. Unlike Delyva,
 * most failures carry a REAL machine code (Appendix I), so classification
 * leans on codes first and only falls back to the one message-shaped verdict
 * the API has (pay's "Insufficient Credit" inside a Success envelope).
 */
export type EasyparcelFailure =
	| "auth" // 3/4/5 bad key, 8 invalid account, 9 unverified account
	| "invalid_address" // 1004 postcode, 1005 state code
	| "credit" // prepaid wallet can't cover the pay step
	| "unknown";

export function classifyEasyparcelFailure(
	err: EasyparcelResponseError,
): EasyparcelFailure {
	if (["3", "4", "5", "8", "9"].includes(err.errorCode)) return "auth";
	if (["1004", "1005"].includes(err.errorCode)) return "invalid_address";
	if (/insufficient credit/i.test(err.errorRemark)) return "credit";
	return "unknown";
}
