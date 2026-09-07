// DelyvaX Public API — pure client helpers (headers, payload building,
// response parsing, status normalization, webhook HMAC). NO fetch and NO
// Convex imports so every piece unit-tests in isolation; the actions in
// convex/delyva.ts own the network + db. See docs/delivery-delyva.md
// (ClickUp 86eyjpv6z).
//
// API shape (docs.api.delyva.com + the maintained delyva/wp-delyvax plugin,
// probed live against a demo account on 27 Aug 2026):
//  - One host for every account: https://api.delyva.app/v1.0 — there is no
//    sandbox URL and no key prefix; a "demo" account (demo.delyva.app) is
//    just another account.
//  - Auth: a single API key in `X-Delyvax-Access-Token`. The webhook HMAC
//    secret is the account's `user.apiSecret`, fetched via GET /user — the
//    seller never types it.
//  - Quote: POST /service/instantQuote returns a LIST of courier services
//    (unlike Lalamove's single vehicle quote); prices are indicative — the
//    order create re-prices, so there is no quotation id to hold.
//  - Book: POST /order (draft, idempotency-key supported) → POST
//    /order/process with the chosen serviceCode. `source: "kedaipal"`
//    carries the Delyva-funded 1% commission attribution — REQUIRED on
//    every create (commercials w/ Herrey, Aug 2026).
//  - Webhooks: subscribed via POST /webhook per event; deliveries carry
//    `X-Delyvax-Event` + `X-Delyvax-Hmac-SHA256` (base64 HMAC-SHA256 of the
//    raw body with user.apiSecret).

import { decryptSecret } from "./credentialCrypto";
import type { DeliveryJobStatus } from "./deliveryJobs";

export const DELYVA_BASE_URL = "https://api.delyva.app/v1.0";

/** Parcel types we surface (Delyva's enum is wider — FOOD, DOCUMENT, etc.;
 * these three cover the frozen-seller ICP and the settings card's choices). */
export type DelyvaItemType = "PARCEL" | "CHILLED" | "FROZEN";

export const DELYVA_ITEM_TYPES: readonly DelyvaItemType[] = [
	"PARCEL",
	"CHILLED",
	"FROZEN",
];

export type DelyvaCredentials = {
	apiKey: string;
	/** Webhook HMAC secret (user.apiSecret). Optional: quote/order calls only
	 * need the key. */
	apiSecret?: string;
	/** Delyva's integer customer id — required by quote/order payloads. */
	customerId: number;
};

/**
 * The per-retailer credential resolver — BYO-ONLY, same posture as
 * Lalamove/HitPay: the seller's own account or nothing. Incomplete → null
 * (feature unavailable; callers fail closed). `customerId` is stamped by the
 * connect action, so its absence means the connect probe never succeeded.
 */
export function resolveDelyvaCredentials(
	config:
		| { apiKey?: string; apiSecret?: string; customerId?: number }
		| undefined,
): DelyvaCredentials | null {
	const apiKey = config?.apiKey?.trim();
	if (!apiKey || config?.customerId === undefined) return null;
	return {
		apiKey,
		apiSecret: config.apiSecret?.trim() || undefined,
		customerId: config.customerId,
	};
}

/** Decrypt-at-use (the 86eyn25gk posture): stored values are ciphertext;
 * called by the network client right before every request. */
export async function decryptDelyvaCredentials(
	credentials: DelyvaCredentials,
): Promise<DelyvaCredentials> {
	return {
		apiKey: await decryptSecret(credentials.apiKey),
		apiSecret: credentials.apiSecret
			? await decryptSecret(credentials.apiSecret)
			: undefined,
		customerId: credentials.customerId,
	};
}

/** Header set for one API call — plaintext key required (decrypt first). */
export function buildDelyvaHeaders(apiKey: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		"X-Delyvax-Access-Token": apiKey,
	};
}

/**
 * Delyva money → integer sen. Their prices arrive as JSON numbers in MYR
 * major units (probed live: `{"amount": 6}`, `{"amount": 18.5}`) — string
 * math on the decimal rendering avoids float dust, and anything that doesn't
 * look like money throws: a mis-parsed fee must never freeze onto a job.
 */
export function delyvaAmountToSen(raw: string | number): number {
	const s = String(raw).trim();
	if (!/^\d+(\.\d{1,2})?$/.test(s)) {
		throw new Error(`Unparseable Delyva amount: ${JSON.stringify(raw)}`);
	}
	const [whole, frac = ""] = s.split(".");
	return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** A waypoint address in Delyva's shape. `address1` is required by their
 * validator; the rest sharpen zone pricing and the courier's label. */
export type DelyvaAddress = {
	address1: string;
	address2?: string;
	city: string;
	state: string;
	postcode: string;
	country: string;
};

/** Contact attached to a waypoint at order create. */
export type DelyvaContact = {
	name: string;
	/** E.164-ish digits ("60123456789") — Delyva accepts bare MSISDNs. */
	phone: string;
	email?: string;
};

/** POST /service/instantQuote body. Weight rides in kg (3dp = gram precision). */
export function buildInstantQuoteBody(args: {
	customerId: number;
	origin: DelyvaAddress;
	destination: DelyvaAddress;
	weightKg: number;
	itemType: DelyvaItemType;
}): Record<string, unknown> {
	return {
		customerId: args.customerId,
		origin: args.origin,
		destination: args.destination,
		weight: { unit: "kg", value: roundKg(args.weightKg) },
		itemType: args.itemType,
	};
}

/** Kilograms at gram precision — Delyva's validator dislikes float dust
 * (2.4999999999 style values) as much as Lalamove's disliked 16-dp coords. */
export function roundKg(kg: number): number {
	return Math.round(kg * 1000) / 1000;
}

export type DelyvaService = {
	/** Machine id for order create/process ("DHLEC-MY"). */
	code: string;
	/** Service display name ("DHL eCommerce"). */
	name: string;
	/** The courier company behind it ("DHL Ecommerce"). */
	companyName: string;
	/** CDN-relative logo path (serve via https://cdn.delyva.app/<path>). */
	logoPath?: string;
	/** Total price in sen. */
	price: number;
	currency: string;
	/** Delyva's service class — INSTANT / SDD / NDD etc. Opaque to us beyond
	 * display; kept verbatim. */
	serviceType?: string;
	/** Item types this service accepts, when the response says. */
	itemTypes?: string[];
};

/**
 * Parse POST /service/instantQuote. An EMPTY list is a valid, meaningful
 * answer ("no courier takes this parcel to this address") — only a shape
 * surprise throws. Services arrive in provider order; callers sort by price.
 */
/**
 * How many couriers this Delyva ACCOUNT has switched on, from `GET /service`.
 *
 * A quote that comes back with no services has two very different causes, and
 * the seller can only fix one of them: either no courier serves this
 * particular parcel/route, or the account has no couriers connected at all —
 * the state every fresh DelyvaNow account starts in, and what a seller hits
 * when their market's providers were never enabled for them (Zaki's SG
 * account, 3 Sep: an empty Service Providers panel and therefore an empty
 * quote for every address he tried). Blaming the address in that state sends
 * them hunting the wrong variable.
 *
 * `status: 1` is active; anything else is switched off. A malformed response
 * yields `null` — "we couldn't tell", which the caller renders as the
 * cautious generic copy rather than a wrong accusation.
 */
export function countActiveDelyvaServices(json: unknown): number | null {
	const data = (json as { data?: unknown })?.data;
	if (!Array.isArray(data)) return null;
	return data.filter(
		(entry) => (entry as { status?: unknown } | null)?.status === 1,
	).length;
}

export function parseInstantQuoteResponse(json: unknown): DelyvaService[] {
	const data = (json as { data?: { services?: unknown } })?.data;
	if (!data || typeof data !== "object") {
		throw new Error("Delyva quote response missing data");
	}
	const services = (data as { services?: unknown }).services;
	if (!Array.isArray(services)) {
		throw new Error("Delyva quote response missing services");
	}
	const parsed: DelyvaService[] = [];
	for (const entry of services) {
		const service = (entry as { service?: Record<string, unknown> })?.service;
		const price = (entry as { price?: { amount?: unknown; currency?: unknown } })
			?.price;
		if (!service || typeof service !== "object") continue;
		const code = service.code;
		const name = service.name;
		if (typeof code !== "string" || !code) continue;
		if (typeof name !== "string" || !name) continue;
		if (price?.amount === undefined) continue;
		let amount: number;
		try {
			amount = delyvaAmountToSen(price.amount as string | number);
		} catch {
			continue; // one unpriceable row must not sink the whole quote
		}
		const company = (service as { serviceCompany?: Record<string, unknown> })
			.serviceCompany;
		const itemTypesRaw = (entry as { itemType?: unknown }).itemType;
		parsed.push({
			code,
			name,
			companyName:
				company && typeof company.name === "string" && company.name
					? company.name
					: name,
			logoPath:
				company && typeof company.logo === "string" && company.logo
					? company.logo
					: undefined,
			price: amount,
			currency:
				typeof price.currency === "string" && price.currency
					? price.currency
					: "MYR",
			serviceType:
				typeof service.serviceType === "string" && service.serviceType
					? service.serviceType
					: undefined,
			itemTypes: Array.isArray(itemTypesRaw)
				? itemTypesRaw.filter((t): t is string => typeof t === "string")
				: undefined,
		});
	}
	return parsed;
}

/** One parcel line for a waypoint's inventory declaration. */
export type DelyvaInventoryLine = {
	name: string;
	quantity: number;
	/** Unit price in sen (converted to MYR major units on the wire). */
	priceSen: number;
	weightKg: number;
};

/** Waypoint shape verified live (27 Aug, demo account): the address rides
 * INSIDE `contact` (a top-level address1 is rejected with
 * `"origin.contact.address1" is required`), and `inventory` is required on
 * BOTH waypoints with ≥1 line each. */
function buildWaypoint(
	contact: DelyvaAddress & DelyvaContact,
	inventory: DelyvaInventoryLine[],
	itemType: DelyvaItemType,
	currency: string,
): Record<string, unknown> {
	return {
		contact: {
			name: contact.name,
			phone: contact.phone,
			...(contact.email ? { email: contact.email } : {}),
			address1: contact.address1,
			...(contact.address2 ? { address2: contact.address2 } : {}),
			city: contact.city,
			state: contact.state,
			postcode: contact.postcode,
			country: contact.country,
		},
		inventory: inventory.map((line) => ({
			name: line.name.slice(0, 100),
			type: itemType,
			quantity: line.quantity,
			price: { amount: line.priceSen / 100, currency },
			weight: { unit: "kg", value: roundKg(line.weightKg) },
		})),
	};
}

/** POST /order body — creates a DRAFT (process: false); the confirm step
 * runs POST /order/process with the picked serviceCode. `source` carries the
 * commission attribution and must never be dropped. Shape probed live against
 * the demo account (27 Aug 2026). */
export function buildCreateOrderBody(args: {
	customerId: number;
	origin: DelyvaAddress & DelyvaContact;
	destination: DelyvaAddress & DelyvaContact;
	inventory: DelyvaInventoryLine[];
	weightKg: number;
	itemType: DelyvaItemType;
	currency: string;
	/** Our ORD-XXXX — the courier-visible reference + our own cross-check. */
	referenceNo: string;
	/** Free-text note for the courier (buyer notes, handling). */
	note?: string;
}): Record<string, unknown> {
	return {
		customerId: args.customerId,
		process: false,
		source: "kedaipal",
		referenceNo: args.referenceNo,
		...(args.note ? { note: args.note.slice(0, 400) } : {}),
		itemType: args.itemType,
		// Delyva requires the inventory declared on BOTH waypoints (pickup
		// lines are stamped action "P", drop-off "D" server-side).
		origin: buildWaypoint(
			args.origin,
			args.inventory,
			args.itemType,
			args.currency,
		),
		destination: buildWaypoint(
			args.destination,
			args.inventory,
			args.itemType,
			args.currency,
		),
		weight: { unit: "kg", value: roundKg(args.weightKg) },
	};
}

export type ParsedDelyvaOrder = {
	/** Delyva's internal order id — webhook correlation key. */
	delyvaOrderId: string;
	/** Consignment number (AWB), once issued. Often absent on the draft
	 * create and delivered later by the order.created webhook. */
	consignmentNo?: string;
	/** Booked price in sen, when the response carries one. */
	price?: number;
	statusCode?: number;
};

/** Parse POST /order, POST /order/process and GET /order/{id} responses.
 * Delyva wraps everything in `{ data: … }`; process responses have been seen
 * both as the order object and as `{ data: { order: {...} } }` — tolerate
 * both. Throws only when no order id can be found. */
export function parseOrderResponse(json: unknown): ParsedDelyvaOrder {
	const data =
		(json as { data?: Record<string, unknown> })?.data ??
		(json as Record<string, unknown>);
	const order =
		data && typeof data === "object" && "order" in data
			? ((data as { order?: Record<string, unknown> }).order ?? data)
			: data;
	if (!order || typeof order !== "object") {
		throw new Error("Delyva order response missing data");
	}
	const record = order as Record<string, unknown>;
	const id = record.id ?? record.orderId;
	if (typeof id !== "string" || !id) {
		throw new Error("Delyva order response missing order id");
	}
	let price: number | undefined;
	const priceRaw = record.price;
	const amount =
		priceRaw && typeof priceRaw === "object"
			? (priceRaw as { amount?: unknown }).amount
			: priceRaw;
	if (typeof amount === "number" || typeof amount === "string") {
		try {
			price = delyvaAmountToSen(amount);
		} catch {
			price = undefined;
		}
	}
	return {
		delyvaOrderId: id,
		consignmentNo:
			typeof record.consignmentNo === "string" && record.consignmentNo
				? record.consignmentNo
				: undefined,
		price,
		statusCode:
			typeof record.statusCode === "number" ? record.statusCode : undefined,
	};
}

export type DelyvaCompany = {
	/** Delyva's company code — `"demo"` for their shared demo environment. */
	code?: string;
	name?: string;
	websiteUrl?: string;
	/** True when this company IS the demo environment: play-money credit, no
	 * courier ever dispatched. Delyva issues no key prefix and runs one API
	 * host, so this is the only signal that distinguishes a test account. */
	isDemo: boolean;
};

/** Parse `GET /company/{id}`. Note the payload is NOT `{data: …}`-wrapped
 * (verified live 2 Sep 2026) — unlike most of their API — so tolerate both. */
export function parseCompanyResponse(json: unknown): DelyvaCompany {
	const raw =
		(json as { data?: Record<string, unknown> })?.data ??
		(json as Record<string, unknown>);
	const record = (raw ?? {}) as Record<string, unknown>;
	const code = typeof record.code === "string" ? record.code : undefined;
	const name = typeof record.name === "string" ? record.name : undefined;
	const websiteUrl =
		typeof record.websiteUrl === "string" ? record.websiteUrl : undefined;
	// Two independent tells per tenant, either one is enough: a rename of the
	// company shouldn't silently turn a test account into a "live" one.
	//
	// `demo` is the one the seller-facing guide points at; `trydx` ("try
	// express") is the SANDBOX tenant Delyva's own developer guide sends
	// integrators to, found 3 Sep. Missing it would have been the 86eypncfy
	// bug exactly: a sandbox booking is indistinguishable from a real one
	// right up until no courier ever arrives, and we'd have badged it LIVE —
	// a false all-clear is worse than no badge at all.
	const host = (websiteUrl ?? "").toLowerCase();
	const slug = code?.toLowerCase();
	const isDemo =
		slug === "demo" ||
		slug === "trydx" ||
		host.includes("demo.delyva.app") ||
		host.includes("trydx.delyva.app");
	return { code, name, websiteUrl, isDemo };
}

/**
 * Delyva's numeric status vocabulary → our normalized job status. Codes from
 * their own maintained WooCommerce plugin (Statuses mapping, verified against
 * the webhook docs):
 *
 *   100/110  order created / ready to collect        → assigning
 *   200      courier accepted                        → ongoing
 *   400      start collecting (pickup pending)       → ongoing
 *   475      failed collection                       → rejected  (failure)
 *   500      collected (pickup complete)             → picked_up
 *   600      start delivery (out for delivery)       → picked_up
 *   650      failed delivery                         → picked_up (kept —
 *            the parcel is still WITH the courier: retry/return follows;
 *            surfaced via failureReason, never a terminal state)
 *   700/1000 completed                               → completed
 *   900      cancelled                               → canceled
 *
 * Unknown codes → undefined (webhook vocab can grow; never throw).
 */
export function normalizeDelyvaStatus(
	statusCode: number | undefined,
): DeliveryJobStatus | undefined {
	if (statusCode === undefined) return undefined;
	if (statusCode === 100 || statusCode === 110) return "assigning";
	if (statusCode === 200 || statusCode === 400) return "ongoing";
	if (statusCode === 475) return "rejected";
	if (statusCode === 500 || statusCode === 600 || statusCode === 650)
		return "picked_up";
	if (statusCode === 700 || statusCode === 1000) return "completed";
	if (statusCode === 900) return "canceled";
	return undefined;
}

/** The one mid-flight failure that must NOT change job status: a failed
 * delivery attempt (courier retries or returns) — callers stamp
 * failureReason + notify, and the job stays picked_up. */
export function isFailedDeliveryAttempt(statusCode: number): boolean {
	return statusCode === 650;
}

export type DelyvaWebhookEvent = {
	/** Delyva's order id — the correlation key (data.id on order.created,
	 * data.orderId on tracking events). */
	delyvaOrderId: string;
	statusCode?: number;
	consignmentNo?: string;
	/** Delyva customer id echoed in the payload — cross-check against the
	 * job retailer's stored customerId. */
	customerId?: number;
	/** Best event time for the out-of-order guard, when the payload carries
	 * one (ISO `date`/`updatedAt` fields observed on tracking events). */
	eventAt?: number;
	/** Free-text status description, for failureReason surfacing. */
	statusText?: string;
};

/**
 * Parse one webhook delivery's JSON body. Two payload families share the
 * shape rules of Delyva's own plugin:
 *  - order.created:            { id, consignmentNo, statusCode, customerId }
 *  - order_tracking.update /
 *    order_tracking.change:    { orderId, consignmentNo, statusCode, … }
 * Returns null when neither id is present (not an order event we act on).
 */
export function parseDelyvaWebhookEvent(
	body: string,
): DelyvaWebhookEvent | null {
	let data: Record<string, unknown>;
	try {
		const parsed = JSON.parse(body) as unknown;
		if (!parsed || typeof parsed !== "object") return null;
		data = parsed as Record<string, unknown>;
	} catch {
		return null;
	}
	const id =
		typeof data.orderId === "string" && data.orderId
			? data.orderId
			: typeof data.id === "string" && data.id
				? data.id
				: undefined;
	if (!id) return null;
	let eventAt: number | undefined;
	for (const key of ["date", "updatedAt", "createdAt"]) {
		const value = data[key];
		if (typeof value === "string") {
			const t = Date.parse(value);
			if (Number.isFinite(t)) {
				eventAt = t;
				break;
			}
		}
	}
	return {
		delyvaOrderId: id,
		statusCode:
			typeof data.statusCode === "number"
				? data.statusCode
				: typeof data.statusCode === "string" &&
						/^\d+$/.test(data.statusCode)
					? Number(data.statusCode)
					: undefined,
		consignmentNo:
			typeof data.consignmentNo === "string" && data.consignmentNo
				? data.consignmentNo
				: undefined,
		customerId:
			typeof data.customerId === "number"
				? data.customerId
				: typeof data.customerId === "string" && /^\d+$/.test(data.customerId)
					? Number(data.customerId)
					: undefined,
		eventAt,
		statusText:
			typeof data.status === "string" && data.status ? data.status : undefined,
	};
}

const encoder = new TextEncoder();

/** Base64 HMAC-SHA256 of the raw body with the account's apiSecret — the
 * value Delyva sends in `X-Delyvax-Hmac-SHA256`. Exported for tests and for
 * the route's verifier. */
export async function computeDelyvaWebhookSignature(
	rawBody: string,
	apiSecret: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(apiSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
	let binary = "";
	for (const byte of new Uint8Array(sig)) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** Constant-time-ish comparison of the header signature against ours. */
export async function verifyDelyvaWebhook(args: {
	rawBody: string;
	apiSecret: string;
	signatureHeader: string | null;
}): Promise<boolean> {
	if (!args.signatureHeader) return false;
	const expected = await computeDelyvaWebhookSignature(
		args.rawBody,
		args.apiSecret,
	);
	const given = args.signatureHeader.trim();
	if (expected.length !== given.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) {
		diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
	}
	return diff === 0;
}

/** Webhook events we subscribe on connect. `order.created` carries the
 * consignment number (AWB); the tracking pair drives status. */
export const DELYVA_WEBHOOK_EVENTS = [
	"order.created",
	"order_tracking.update",
	"order_tracking.change",
] as const;

/**
 * Why a BOOKING attempt failed, as a stable machine class (the Lalamove
 * 86eypncfy posture: never substring-sniff a body that parses). Delyva
 * errors arrive as `{ error: { message } }` / `{ errors: [...] }` without
 * stable machine ids, so classification leans on the message — but only
 * for phrases probed from their API, and "unknown" beats a wrong story.
 */
export type DelyvaBookingFailure =
	| "credit"
	| "not_activated"
	| "no_service"
	| "unknown";

/** Pull the human-readable error message out of a failed response body. */
export function parseDelyvaErrorMessage(body: string): string | undefined {
	try {
		const parsed = JSON.parse(body) as {
			error?: { message?: unknown };
			errors?: Array<{ message?: unknown }>;
			message?: unknown;
		};
		const candidate =
			parsed?.error?.message ?? parsed?.errors?.[0]?.message ?? parsed?.message;
		return typeof candidate === "string" && candidate ? candidate : undefined;
	} catch {
		return undefined;
	}
}

export function classifyDelyvaFailure(body: string): DelyvaBookingFailure {
	const message = parseDelyvaErrorMessage(body)?.toLowerCase() ?? "";
	if (
		message.includes("insufficient") ||
		message.includes("credit") ||
		message.includes("balance") ||
		message.includes("top up") ||
		message.includes("topup")
	)
		return "credit";
	if (message.includes("activat")) return "not_activated";
	if (message.includes("no service") || message.includes("not available"))
		return "no_service";
	return "unknown";
}
