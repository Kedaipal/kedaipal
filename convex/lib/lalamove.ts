// Lalamove Open API v3 — pure client helpers (signing, payload building,
// response parsing, status normalization). NO fetch and NO Convex imports so
// every piece unit-tests in isolation; the actions in convex/lalamove.ts own
// the network + db. See docs/delivery-lalamove.md (ClickUp 86eyb5hrf).
//
// API shape (developers.lalamove.com):
//  - Base URLs per env; request/response payloads wrapped in `{ data: ... }`.
//  - Auth: `Authorization: hmac <KEY>:<TIMESTAMP>:<SIGNATURE>` where SIGNATURE
//    = hex(HMAC-SHA256("<TIMESTAMP>\r\n<METHOD>\r\n<PATH>\r\n\r\n<BODY>", SECRET)),
//    TIMESTAMP in Unix MILLISECONDS (UTC), PATH including the /v3 prefix.
//  - Quotations are honoured for exactly 5 minutes; dispatch always re-quotes.
//  - Money arrives as a decimal STRING in major units (MY: "13.5" ringgit,
//    1dp precision) — converted to integer sen at this boundary, like every
//    other money field in the repo.

export type LalamoveEnv = "sandbox" | "production";

/** How long a checkout deliveryQuotes row stays honourable at orders.create.
 * Lalamove honours the QUOTATION 5 min (dispatch re-quotes anyway) — this
 * bound is about OUR price display going stale in an abandoned tab. Lives
 * here (pure module) so orders.ts and lalamove.ts share it without a cycle. */
export const CHECKOUT_QUOTE_MAX_AGE_MS = 30 * 60 * 1000;

export const LALAMOVE_BASE_URL: Record<LalamoveEnv, string> = {
	sandbox: "https://rest.sandbox.lalamove.com",
	production: "https://rest.lalamove.com",
};

/** All Kedaipal sellers are MY — market is a constant until a second country. */
export const LALAMOVE_MARKET = "MY";

/** Vehicle types we surface (the MY catalog has more; these cover the ICP). */
export type LalamoveVehicleType = "MOTORCYCLE" | "CAR";

export type LalamoveCredentials = {
	apiKey: string;
	apiSecret: string;
	env: LalamoveEnv;
};

/**
 * The per-retailer credential resolver — BYO-ONLY (decision revised 21 Jul,
 * Arif: Kedaipal never books on its own account, mirroring the retailer-owned
 * payment-gateway posture). The seller's key pair on the retailer row is the
 * ONLY source; absent/incomplete → null (feature unavailable — callers fail
 * closed / checkout falls back to no-fee behaviour). The environment is
 * derived from Lalamove's own key prefix (`pk_test_…` → sandbox, anything
 * else → production), so a key can never be pointed at the wrong API host.
 */
export function resolveLalamoveCredentials(
	booking: { apiKey?: string; apiSecret?: string } | undefined,
): LalamoveCredentials | null {
	const apiKey = booking?.apiKey?.trim();
	const apiSecret = booking?.apiSecret?.trim();
	if (!apiKey || !apiSecret) return null;
	return { apiKey, apiSecret, env: inferLalamoveEnv(apiKey) };
}

/** Sandbox vs production straight from the key prefix — Lalamove issues
 * `pk_test_…` for sandbox and `pk_prod_…` for production. */
export function inferLalamoveEnv(apiKey: string): LalamoveEnv {
	return apiKey.startsWith("pk_test_") ? "sandbox" : "production";
}

const encoder = new TextEncoder();

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
	return [...new Uint8Array(sig)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** The exact string Lalamove signs — exported for the webhook verifier and
 * for test vectors. `body` is "" for GET/DELETE. */
export function lalamoveSigningString(args: {
	timestamp: number;
	method: string;
	path: string;
	body: string;
}): string {
	return `${args.timestamp}\r\n${args.method.toUpperCase()}\r\n${args.path}\r\n\r\n${args.body}`;
}

export async function signLalamoveRequest(args: {
	secret: string;
	timestamp: number;
	method: string;
	path: string;
	body: string;
}): Promise<string> {
	return hmacSha256Hex(args.secret, lalamoveSigningString(args));
}

/**
 * Build the full header set for one API call. `requestId` dedupes on
 * Lalamove's side — pass something stable per logical attempt.
 */
export async function buildLalamoveHeaders(args: {
	credentials: Pick<LalamoveCredentials, "apiKey" | "apiSecret">;
	method: string;
	path: string;
	body: string;
	timestamp: number;
	requestId: string;
}): Promise<Record<string, string>> {
	const signature = await signLalamoveRequest({
		secret: args.credentials.apiSecret,
		timestamp: args.timestamp,
		method: args.method,
		path: args.path,
		body: args.body,
	});
	return {
		Authorization: `hmac ${args.credentials.apiKey}:${args.timestamp}:${signature}`,
		Market: LALAMOVE_MARKET,
		"Request-ID": args.requestId,
		"Content-Type": "application/json",
	};
}

/**
 * Lalamove money → integer sen. MY prices arrive as major-unit decimal
 * strings ("13.5"); string math (not parseFloat × 100) avoids float dust.
 * Throws on anything that doesn't look like money — a mis-parsed fee must
 * never freeze onto an order.
 */
export function lalamoveAmountToSen(raw: string | number): number {
	const s = String(raw).trim();
	if (!/^\d+(\.\d{1,2})?$/.test(s)) {
		throw new Error(`Unparseable Lalamove amount: ${JSON.stringify(raw)}`);
	}
	const [whole, frac = ""] = s.split(".");
	return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** Lalamove wants string coordinates ({lat: "3.139", lng: "101.687"}). Rounded
 * to 6 decimals (~11 cm — far finer than any rider needs): Google returns
 * high-precision doubles and a raw String() can emit 16+ decimal places (also
 * via float round-trip noise, e.g. 3.0999999999999996), which trips Lalamove's
 * coordinate regex (max 15 fractional digits) and 422s the whole quote. */
export function toLalamoveCoordinates(c: {
	latitude: number;
	longitude: number;
}): { lat: string; lng: string } {
	const round6 = (n: number) => String(Math.round(n * 1e6) / 1e6);
	return { lat: round6(c.latitude), lng: round6(c.longitude) };
}

/** Our WhatsApp phones are stored as bare digits ("60123456789"); Lalamove
 * wants E.164. Malaysian numbers only — everything in the repo already is. */
export function toLalamovePhone(waPhone: string): string {
	const digits = waPhone.replace(/\D/g, "");
	return `+${digits}`;
}

/**
 * Normalize a stored WhatsApp number to a Lalamove-MY-acceptable E.164 phone,
 * or null when it isn't Malaysian. Lalamove validates the AREA CODE per
 * market — a +65 (SG) buyer on a JB store is a real case and returns null
 * here, so dispatch can fall back to the seller's own number as the rider
 * contact instead of a 422 at booking time. MY mobiles are 60 + 9–11 digits.
 */
export function toLalamoveMyPhone(waPhone: string | undefined): string | null {
	if (!waPhone) return null;
	const digits = waPhone.replace(/\D/g, "");
	if (!digits.startsWith("60")) return null;
	if (digits.length < 11 || digits.length > 13) return null;
	return `+${digits}`;
}

export type LalamoveStop = {
	coordinates: { latitude: number; longitude: number };
	/** Free-text address shown to the rider. */
	address: string;
};

/** POST /v3/quotations body. Two stops: seller origin → buyer address. */
export function buildQuotationBody(args: {
	serviceType: LalamoveVehicleType | string;
	stops: LalamoveStop[];
	language?: string;
	/** Epoch-ms pickup time for SCHEDULED pricing (pre-orders): quotes the
	 * rate for that moment instead of right-now. Omit for immediate. */
	scheduleAt?: number;
}): { data: Record<string, unknown> } {
	return {
		data: {
			serviceType: args.serviceType,
			language: args.language ?? "en_MY",
			...(args.scheduleAt !== undefined
				? { scheduleAt: new Date(args.scheduleAt).toISOString() }
				: {}),
			stops: args.stops.map((s) => ({
				coordinates: toLalamoveCoordinates(s.coordinates),
				address: s.address,
			})),
		},
	};
}

export type ParsedQuotation = {
	quotationId: string;
	/** Total price in sen. */
	priceTotal: number;
	currency: string;
	/** Stop ids in request order — [0] sender, [1] recipient for our 2-stop flow. */
	stopIds: string[];
	/** Provider's route distance in metres, when present (audit only). */
	distanceMeters?: number;
	expiresAt?: string;
};

/** Parse POST /v3/quotations response (throws on shape surprises — callers
 * surface a "couldn't get a quote" state, never a garbage fee). */
export function parseQuotationResponse(json: unknown): ParsedQuotation {
	const data = (json as { data?: Record<string, unknown> })?.data;
	if (!data || typeof data !== "object") {
		throw new Error("Lalamove quotation response missing data");
	}
	const quotationId = data.quotationId;
	const priceBreakdown = data.priceBreakdown as
		| { total?: string | number; currency?: string }
		| undefined;
	const stops = data.stops as Array<{ stopId?: string }> | undefined;
	if (typeof quotationId !== "string" || !quotationId) {
		throw new Error("Lalamove quotation response missing quotationId");
	}
	if (!priceBreakdown || priceBreakdown.total === undefined) {
		throw new Error("Lalamove quotation response missing priceBreakdown.total");
	}
	if (!Array.isArray(stops) || stops.length < 2) {
		throw new Error("Lalamove quotation response missing stops");
	}
	const stopIds = stops.map((s, i) => {
		if (typeof s?.stopId !== "string" || !s.stopId) {
			throw new Error(`Lalamove quotation stop ${i} missing stopId`);
		}
		return s.stopId;
	});
	const distance = data.distance as
		| { value?: string | number; unit?: string }
		| undefined;
	let distanceMeters: number | undefined;
	if (distance?.value !== undefined) {
		const value = Number(distance.value);
		if (Number.isFinite(value)) {
			distanceMeters =
				distance.unit === "km" ? Math.round(value * 1000) : Math.round(value);
		}
	}
	return {
		quotationId,
		priceTotal: lalamoveAmountToSen(priceBreakdown.total),
		currency:
			typeof priceBreakdown.currency === "string"
				? priceBreakdown.currency
				: "MYR",
		stopIds,
		distanceMeters,
		expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : undefined,
	};
}

/** POST /v3/orders body — places an order against a live quotation. */
export function buildPlaceOrderBody(args: {
	quotationId: string;
	sender: { stopId: string; name: string; phone: string };
	recipient: {
		stopId: string;
		name: string;
		phone: string;
		remarks?: string;
	};
	/** Our ORD-XXXX — echoed back in webhooks via metadata for cross-checking. */
	orderRef?: string;
}): { data: Record<string, unknown> } {
	return {
		data: {
			quotationId: args.quotationId,
			sender: {
				stopId: args.sender.stopId,
				name: args.sender.name,
				phone: toLalamovePhone(args.sender.phone),
			},
			recipients: [
				{
					stopId: args.recipient.stopId,
					name: args.recipient.name,
					phone: toLalamovePhone(args.recipient.phone),
					...(args.recipient.remarks
						? { remarks: args.recipient.remarks.slice(0, 500) }
						: {}),
				},
			],
			...(args.orderRef ? { metadata: { orderRef: args.orderRef } } : {}),
			// Ask the rider for a drop-off photo/signature. Free, and the proof
			// protects the seller in "never arrived" disputes; harmless where a
			// market/vehicle doesn't support POD (field is simply ignored).
			isPODEnabled: true,
		},
	};
}

export type PodImage = {
	stopId?: string;
	imageUrl: string;
	status: "DELIVERED" | "SIGNED";
	deliveredAt?: string;
};

/**
 * Extract proof-of-delivery images from a GET /v3/orders/{id} response.
 * POD lives per-stop: `stops[].POD { status, image, deliveredAt }`. Only
 * DELIVERED/SIGNED stops with a non-empty image URL count — PENDING means
 * the rider hasn't dropped off yet, FAILED has no proof to show.
 */
export function parsePodImages(json: unknown): PodImage[] {
	const data = (json as { data?: unknown })?.data ?? json;
	const stops = (data as { stops?: unknown })?.stops;
	if (!Array.isArray(stops)) return [];
	const images: PodImage[] = [];
	for (const stop of stops) {
		const pod = (stop as { POD?: Record<string, unknown> })?.POD;
		if (!pod) continue;
		const status = typeof pod.status === "string" ? pod.status : "";
		if (status !== "DELIVERED" && status !== "SIGNED") continue;
		const imageUrl = typeof pod.image === "string" ? pod.image.trim() : "";
		if (!imageUrl) continue;
		images.push({
			stopId:
				typeof (stop as { stopId?: unknown }).stopId === "string"
					? ((stop as { stopId: string }).stopId ?? undefined)
					: undefined,
			imageUrl,
			status,
			deliveredAt:
				typeof pod.deliveredAt === "string" ? pod.deliveredAt : undefined,
		});
	}
	return images;
}

export type ParsedProviderOrder = {
	providerOrderId: string;
	/** Actual booking cost in sen (what the paying wallet is charged). */
	priceTotal: number;
	shareLink?: string;
	status?: string;
	driverId?: string;
};

/** Parse POST /v3/orders and GET /v3/orders/{id} responses. */
export function parseOrderResponse(json: unknown): ParsedProviderOrder {
	const data = (json as { data?: Record<string, unknown> })?.data;
	if (!data || typeof data !== "object") {
		throw new Error("Lalamove order response missing data");
	}
	const providerOrderId = data.orderId;
	if (typeof providerOrderId !== "string" || !providerOrderId) {
		throw new Error("Lalamove order response missing orderId");
	}
	const priceBreakdown = data.priceBreakdown as
		| { total?: string | number }
		| undefined;
	if (!priceBreakdown || priceBreakdown.total === undefined) {
		throw new Error("Lalamove order response missing priceBreakdown.total");
	}
	return {
		providerOrderId,
		priceTotal: lalamoveAmountToSen(priceBreakdown.total),
		shareLink: typeof data.shareLink === "string" ? data.shareLink : undefined,
		status: typeof data.status === "string" ? data.status : undefined,
		driverId: typeof data.driverId === "string" ? data.driverId : undefined,
	};
}

/** GET /v3/orders/{id}/drivers/{driverId} response. */
export function parseDriverResponse(json: unknown): {
	name: string;
	phone: string;
	plateNumber: string;
} {
	const data = (json as { data?: Record<string, unknown> })?.data;
	if (!data || typeof data !== "object") {
		throw new Error("Lalamove driver response missing data");
	}
	return {
		name: typeof data.name === "string" ? data.name : "Driver",
		phone: typeof data.phone === "string" ? data.phone : "",
		plateNumber:
			typeof data.plateNumber === "string" ? data.plateNumber : "",
	};
}

/** Our normalized job status (deliveryJobs.status). */
export type DeliveryJobStatus =
	| "assigning"
	| "ongoing"
	| "picked_up"
	| "completed"
	| "canceled"
	| "expired"
	| "rejected";

const STATUS_MAP: Record<string, DeliveryJobStatus> = {
	ASSIGNING_DRIVER: "assigning",
	ON_GOING: "ongoing",
	PICKED_UP: "picked_up",
	COMPLETED: "completed",
	CANCELED: "canceled",
	EXPIRED: "expired",
	REJECTED: "rejected",
};

/** Provider status → ours; undefined for statuses we don't know (webhook
 * fields are documented as subject to change — never throw on unknowns). */
export function normalizeLalamoveStatus(
	raw: string | undefined,
): DeliveryJobStatus | undefined {
	return raw ? STATUS_MAP[raw] : undefined;
}

export const TERMINAL_JOB_STATUSES: ReadonlySet<DeliveryJobStatus> = new Set([
	"completed",
	"canceled",
	"expired",
	"rejected",
]);

/** A job in one of these states still occupies the order's "one active job"
 * slot; anything terminal frees it for a rebook. */
export function isActiveJobStatus(status: DeliveryJobStatus): boolean {
	return !TERMINAL_JOB_STATUSES.has(status);
}

/** Provider order id out of a webhook event's `data` — undefined for
 * non-order events (wallet balance) or unrecognized shapes. */
export function extractWebhookOrderId(data: unknown): string | undefined {
	const id = (data as { order?: { orderId?: unknown } })?.order?.orderId;
	return typeof id === "string" && id ? id : undefined;
}

/**
 * Best event time for the out-of-order guard: `data.updatedAt` (ISO, present
 * on v3 events) when parseable, else the envelope's signing timestamp
 * (normalized — Lalamove uses ms for request signing but be tolerant of
 * seconds so a unit surprise degrades to "slightly wrong ordering", never NaN).
 */
export function parseLalamoveEventTime(
	data: unknown,
	envelopeTimestamp: number,
): number {
	const updatedAt = (data as { updatedAt?: unknown })?.updatedAt;
	if (typeof updatedAt === "string") {
		const t = Date.parse(updatedAt);
		if (Number.isFinite(t)) return t;
	}
	return envelopeTimestamp < 1e12
		? Math.round(envelopeTimestamp * 1000)
		: envelopeTimestamp;
}
