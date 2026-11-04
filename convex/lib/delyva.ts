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
	/** Delyva's service class — INSTANT / SDD / NDD, with a `-DROP` suffix
	 * when the SELLER takes the parcel to a branch (`delyvaHandoff`). Kept
	 * verbatim: it is stored on the booking and judged, never rewritten. */
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

// ---------------------------------------------------------------------------
// Service class → what the SELLER has to do (z8r3fe11x3)
// ---------------------------------------------------------------------------

/** How a parcel leaves the seller for one Delyva service. */
export type DelyvaHandoff = "pickup" | "dropoff";

/** Delyva's logo CDN — `serviceCompany.logo` on the quote is a path under it.
 * Courier brand assets are never bundled in the repo: they are the courier's
 * to change, and the CDN is where Delyva's own app reads them from. */
export const DELYVA_CDN_BASE_URL = "https://cdn.delyva.app/";

/**
 * Who moves the parcel to the courier, read from the service class. Delyva's
 * developer guide suffixes a service with `-DROP` when the SELLER takes the
 * parcel to a branch (`NDD-DROP`); the bare class (`NDD`, `SDD`, `INSTANT`)
 * means the courier collects from the pickup address. DapoGo's first live
 * booking (J&T `JNTMY-PN-B200`, 3 Nov 2026) sat on "Order created" for a day
 * because nothing told the seller which kind she had bought.
 *
 * `undefined` for a missing class — the caller decides what to claim (the
 * picker shows the pickup pill and warns, a booked card claims neither), it
 * is never guessed here. Case-insensitive, because the value is Delyva's and
 * verbatim.
 */
export function delyvaHandoff(
	serviceType: string | undefined,
): DelyvaHandoff | undefined {
	const type = serviceType?.trim();
	if (!type) return undefined;
	return /-DROP$/i.test(type) ? "dropoff" : "pickup";
}

/** The service class without its handoff suffix — `NDD-DROP` → `NDD`, so a
 * drop-off service still reads as next-day wherever speed is judged. */
export function delyvaBaseServiceType(
	serviceType: string | undefined,
): string | undefined {
	const type = serviceType?.trim();
	if (!type) return undefined;
	return type.replace(/-DROP$/i, "").toUpperCase();
}

/** Delyva's speed vocabulary in plain words, judged on the BASE class so a
 * drop-off variant keeps its speed. Unknown classes say nothing — a wrong
 * "Same-day" is worse than no line. */
export function delyvaSpeedLabel(
	serviceType: string | undefined,
): "Same-day" | "Next-day" | undefined {
	const base = delyvaBaseServiceType(serviceType);
	if (base === "INSTANT" || base === "SDD") return "Same-day";
	if (base === "NDD") return "Next-day";
	return undefined;
}

/** The absolute logo URL for a quote row, or undefined when the quote carried
 * no path. A leading slash on the path is tolerated — the CDN root is ours. */
export function delyvaLogoUrl(logoPath: string | undefined): string | undefined {
	const path = logoPath?.trim().replace(/^\/+/, "");
	if (!path) return undefined;
	return `${DELYVA_CDN_BASE_URL}${path}`;
}

// ---------------------------------------------------------------------------
// The courier's own label — GET /order/{id}/label (z8r3fe11x3)
// ---------------------------------------------------------------------------

/**
 * Whether the label can be fetched for a booked job, and if not, why — the
 * dispatch card's Print shipping label disables with the reason rather than
 * failing on tap. Delyva mints the label once the order is PROCESSED (there
 * is a provider order id) and it is only useful until the courier has the
 * parcel: after collection the label is on the parcel already, and a
 * terminal job has nothing to label.
 */
export type DelyvaLabelAvailability =
	| { ok: true }
	| { ok: false; reason: "not_booked" | "collected" | "ended" };

export function delyvaLabelAvailability(job: {
	status: DeliveryJobStatus;
	providerOrderId?: string;
}): DelyvaLabelAvailability {
	if (job.status === "picked_up") return { ok: false, reason: "collected" };
	if (job.status !== "assigning" && job.status !== "ongoing")
		return { ok: false, reason: "ended" };
	if (!job.providerOrderId) return { ok: false, reason: "not_booked" };
	return { ok: true };
}

/** What `GET /order/{id}/label` handed back, normalised to the two shapes the
 * card can act on: bytes to save, or a URL to open. */
export type DelyvaLabel =
	| { kind: "pdf"; pdf: ArrayBuffer }
	| { kind: "url"; url: string };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

function looksLikePdf(bytes: ArrayBuffer): boolean {
	const head = new Uint8Array(bytes.slice(0, 4));
	return PDF_MAGIC.every((b, i) => head[i] === b);
}

/** Pull a label URL out of a JSON body, tolerating the wrappers Delyva uses
 * elsewhere (`{data: …}`) and the field names seen across their API
 * (`url`, `labelUrl`, `label`, `link`, `file`). Only http(s) counts. */
function labelUrlFromJson(json: unknown): string | undefined {
	const record = ((json as { data?: unknown })?.data ?? json) as
		| Record<string, unknown>
		| string
		| null
		| undefined;
	const candidates =
		typeof record === "string"
			? [record]
			: record && typeof record === "object"
				? [record.url, record.labelUrl, record.label, record.link, record.file]
				: [];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && /^https?:\/\//i.test(candidate.trim()))
			return candidate.trim();
	}
	return undefined;
}

/**
 * Normalise a label response. The endpoint's live shape is unconfirmed (the
 * T0 spike on the DapoGo order is operator work — a production call with a
 * live seller's key), so both plausible shapes are handled: a PDF body
 * (content type, or the `%PDF` magic when the type is generic) and a JSON
 * envelope carrying a URL to the file. Anything else throws, so the card
 * shows a failure rather than opening an empty tab.
 */
export function parseDelyvaLabelResponse(args: {
	contentType: string | null;
	body: ArrayBuffer;
}): DelyvaLabel {
	const type = (args.contentType ?? "").toLowerCase();
	if (type.includes("application/pdf") || looksLikePdf(args.body)) {
		return { kind: "pdf", pdf: args.body };
	}
	const text = new TextDecoder().decode(args.body).trim();
	if (!text) throw new Error("Delyva label response was empty");
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(
			`Delyva label response was not a PDF or JSON (${type || "no content type"})`,
		);
	}
	const url = labelUrlFromJson(json);
	if (!url) throw new Error("Delyva label response carried no label URL");
	return { kind: "url", url };
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
 * The wallet balance on Delyva's customer profile (`GET /customer` and
 * `GET /customer/{id}`, both read with the seller's own API key) → integer
 * sen, or null when the field is missing or isn't money. Found 31 Oct 2026:
 * `walletBalance: "500.00"` (a decimal STRING, MYR major units) beside
 * Delyva's own low line, `minBalanceVal`. This is what made Delyva a wallet we
 * can ASK — before it, the balance only surfaced in a refusal. Negative
 * balances are allowed (an overdrawn account reads as empty, not as garbage).
 */
export function parseDelyvaWalletBalance(json: unknown): number | null {
	const record = ((json as { data?: unknown })?.data ?? json) as
		| Record<string, unknown>
		| null
		| undefined;
	const raw = record?.walletBalance;
	if (typeof raw !== "string" && typeof raw !== "number") return null;
	const s = String(raw).trim();
	const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
	if (!match) return null;
	const sen =
		Number(match[2]) * 100 + Number((match[3] ?? "0").padEnd(2, "0"));
	return match[1] ? -sen : sen;
}

/**
 * Delyva statusCode → our normalized job status. The table is Delyva's own
 * (the "Order status codes" table in docs.api.delyva.com's published
 * collection, read 5 Nov 2026, z8r3fe11y8), cross-checked against their
 * maintained WooCommerce plugin for the codes it handles:
 *
 *   0 / 10 / 11  draft / payment pending / abandoned    → undefined (pre-booking)
 *   99       create order failed, account not charged → rejected  (failure)
 *   100/110  order created / ready (label printed)    → assigning
 *   200      pending collection / assigned to driver  → ongoing
 *   400      pickup start                             → ongoing
 *   450      arrived for pick-up                      → ongoing
 *   475      pick-up failed                           → rejected  (failure)
 *   500      pickup success / collected               → picked_up
 *   555/556  hub check-in / check-out                 → picked_up
 *   600      delivery start (out for delivery)        → picked_up
 *   625      arrived for delivery                     → picked_up
 *   650      failed to deliver                        → picked_up (kept —
 *            the parcel is still WITH the courier: retry/return follows;
 *            surfaced via failureReason, never a terminal state)
 *   651      failed delivery — lost / damaged         → picked_up (notice)
 *   654      failed — driver cancelled                → rejected  (failure)
 *   655      failed (generic / reason)                → rejected  (failure)
 *   661      returning to sender                      → picked_up (notice)
 *   663      failed to return                         → completed (RETURNED)
 *   700/1000 delivered / completed                    → completed
 *   701      item returned                            → completed (RETURNED)
 *   900      cancelled                                → canceled
 *
 * 663 and 701 are `completed` because the trip is over and the job must free
 * the order's booking slot — but the ORDER is not delivered: callers read
 * `isReturnedStatus` and leave the order where it is. Before z8r3fe11y8 the
 * six failure/return codes were unmapped, so a lost parcel, a cancelled
 * pickup and a returned parcel all left the job (and the seller) at
 * "Booked" forever. Unknown codes → undefined (the vocabulary can grow;
 * never throw).
 */
export function normalizeDelyvaStatus(
	statusCode: number | undefined,
): DeliveryJobStatus | undefined {
	if (statusCode === undefined) return undefined;
	if (statusCode === 100 || statusCode === 110) return "assigning";
	if (statusCode === 200 || statusCode === 400 || statusCode === 450)
		return "ongoing";
	if (statusCode === 99 || statusCode === 475 || statusCode === 654 || statusCode === 655)
		return "rejected";
	if (
		statusCode === 500 ||
		statusCode === 555 ||
		statusCode === 556 ||
		statusCode === 600 ||
		statusCode === 625 ||
		statusCode === 650 ||
		statusCode === 651 ||
		statusCode === 661
	)
		return "picked_up";
	if (
		statusCode === 700 ||
		statusCode === 1000 ||
		statusCode === 663 ||
		statusCode === 701
	)
		return "completed";
	if (statusCode === 900) return "canceled";
	return undefined;
}

/**
 * The trip ended with the parcel back at (or lost on the way back to) the
 * SELLER, not the buyer (z8r3fe11y8): 701 item returned, 663 failed to
 * return. The job completes — the slot is free for a rebook — and the order
 * is left alone: shipped stays shipped until the seller says what happens
 * next (Mark order as returned, Book again, or cancel).
 */
export function isReturnedStatus(statusCode: number | undefined): boolean {
	return statusCode === 663 || statusCode === 701;
}

/**
 * Mid-flight notices (z8r3fe11y8): the parcel is with the courier and the
 * job stays `picked_up`, but the seller must hear about it — a failed
 * delivery attempt (650), a parcel reported lost or damaged (651), a parcel
 * on its way back (661). `undefined` for every other code.
 */
export function inTransitNotice(statusCode: number): string | undefined {
	if (statusCode === 650)
		return "Delivery attempt failed — the courier will retry or return the parcel";
	if (statusCode === 651) return "Lost or damaged, claim with Delyva";
	if (statusCode === 661) return "Returning to sender";
	return undefined;
}

/**
 * The failureReason for a code that ends or interrupts a booking — ONE
 * author, so the webhook path, the pull path and the email all tell the
 * same story. Delyva's own words (`statusText`) win where they describe the
 * event; the fixed lines are for codes whose statusText is a bare status
 * word or absent. 99 keeps its own sentence even with a statusText, because
 * the one Delyva sends on a create failure ("failed") says nothing.
 */
export function delyvaFailureReason(
	statusCode: number,
	statusText: string | undefined,
): string | undefined {
	const given = statusText?.trim() || undefined;
	switch (statusCode) {
		case 99:
			return given
				? `Delyva could not create the order — ${given}`
				: "Delyva could not create the order";
		case 475:
			return given ?? "The courier couldn't collect the parcel";
		case 654:
			return given ?? "Courier cancelled the pickup";
		case 655:
			return given ?? "The courier reported the booking as failed";
		case 900:
			return given ?? "Cancelled by Delyva";
		case 650:
			return given ?? inTransitNotice(650);
		case 651:
		case 661:
			return inTransitNotice(statusCode);
		case 701:
			return "Returned to you";
		case 663:
			return "Failed to return — ask Delyva where the parcel is";
		default:
			return undefined;
	}
}

/** A failed delivery ATTEMPT (courier retries or returns) — the first of the
 * mid-flight notices (`inTransitNotice`), kept by name because the collected
 * rule below reads it: 650 is collected, whatever its normalised status. */
export function isFailedDeliveryAttempt(statusCode: number): boolean {
	return statusCode === 650;
}

/** How long a booked job may sit without a scan before it is flagged
 * (z8r3fe11y8): parcel couriers collect within a day, so a booking with no
 * event for 24 h is one worth checking, not one still in the queue. */
export const DELYVA_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * "Booked, and nothing has happened for a day" — the ONE predicate the hourly
 * sweep selects on and the pull re-checks after applying Delyva's answer.
 * True only for a booking Delyva confirmed (a reservation without a
 * providerOrderId expires on its own), still waiting for the first scan
 * (`assigning` / `ongoing`), older than the window, with no event inside it.
 */
export function isDelyvaJobStale(
	job: {
		status: DeliveryJobStatus;
		providerOrderId?: string;
		createdAt: number;
		lastEventAt?: number;
	},
	now: number,
): boolean {
	if (!job.providerOrderId) return false;
	if (job.status !== "assigning" && job.status !== "ongoing") return false;
	if (now - job.createdAt < DELYVA_STALE_AFTER_MS) return false;
	return (
		job.lastEventAt === undefined ||
		now - job.lastEventAt >= DELYVA_STALE_AFTER_MS
	);
}

/**
 * Has the courier physically got the parcel? The one author of "the courier's
 * tracking page is live now" (z8r3fe0t4e). Delyva issues the consignment
 * number at booking (100/200), but J&T — and every parcel courier — indexes a
 * waybill only at its first scan, so a tracking link written at booking is a
 * dead "information not found" page for the ~24 h until collection (seen live
 * on DapoGo's first booking, 3 Nov 2026). Judged by the NORMALISED status,
 * never by `code >= 500`: a failure code above 500 that means "never
 * collected" (a courier-cancelled pickup) must not promise a page that isn't
 * there. 650 (failed delivery attempt) is collected — the parcel is with the
 * courier; 900 (cancelled) is not.
 */
export function isCollectedStatus(statusCode: number | undefined): boolean {
	if (statusCode === undefined) return false;
	if (isFailedDeliveryAttempt(statusCode)) return true;
	const status = normalizeDelyvaStatus(statusCode);
	return status === "picked_up" || status === "completed";
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
 * Parse one webhook delivery's JSON body. Three payload families share the
 * shape rules of Delyva's own plugin:
 *  - order.created:            { id, consignmentNo, statusCode, customerId }
 *  - order_tracking.update /
 *    order_tracking.change:    { orderId, consignmentNo, statusCode, … }
 *  - order.updated / order.failed (z8r3fe11y8): the FULL order object —
 *    { id, statusCode, status, consignmentNo, failedReason, cancelledReason,
 *    updatedAt, waypoint, … } — the same shape `GET /order/{id}` returns,
 *    so the Refresh pull is parsed by the object parser below too.
 * Returns null when neither id is present (not an order event we act on).
 */
export function parseDelyvaWebhookEvent(
	body: string,
): DelyvaWebhookEvent | null {
	let data: unknown;
	try {
		data = JSON.parse(body) as unknown;
	} catch {
		return null;
	}
	return parseDelyvaEventObject(data);
}

/**
 * The pulled order (`GET /order/{id}`) as the SAME event shape the webhook
 * route hands to `applyWebhookEvent`, so a missed webhook heals through the
 * one code path. Unwraps the `{ data }` envelope (and a `{ order }` one,
 * which some responses nest). Null when no order id is present.
 */
export function parseDelyvaOrderPull(json: unknown): DelyvaWebhookEvent | null {
	if (!json || typeof json !== "object") return null;
	const outer = json as { data?: unknown; order?: unknown };
	const inner =
		outer.data && typeof outer.data === "object"
			? outer.data
			: outer.order && typeof outer.order === "object"
				? outer.order
				: json;
	return parseDelyvaEventObject(inner);
}

/** Is this the full order object rather than a tracking row? The order
 * carries the two reason fields (null when unset — Delyva never omits a
 * field) and its waypoints; a tracking row has neither. */
function isFullOrderShape(data: Record<string, unknown>): boolean {
	return (
		"failedReason" in data || "cancelledReason" in data || "waypoint" in data
	);
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

export function parseDelyvaEventObject(
	parsed: unknown,
): DelyvaWebhookEvent | null {
	if (!parsed || typeof parsed !== "object") return null;
	const data = parsed as Record<string, unknown>;
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
		// A tracking row's `statusText` ("In transit for pick-up") or its
		// `status` is Delyva's description of THIS event. On the full order
		// object `status` is a bare state word ("failed", "ready") that would
		// read as a reason, so only the two reason fields count there.
		statusText: isFullOrderShape(data)
			? (nonEmptyString(data.failedReason) ??
				nonEmptyString(data.cancelledReason))
			: (nonEmptyString(data.statusText) ?? nonEmptyString(data.status)),
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

/**
 * Webhook events we subscribe on connect. `order.created` carries the
 * consignment number (AWB); the tracking pair drives status. `order.updated`
 * and `order.failed` (z8r3fe11y8) deliver the full order object — the second
 * is how a create failure (statusCode 99) reaches us at all, since a draft
 * that never processed emits no tracking rows. Only the first three are
 * named in Delyva's published collection; the two newer names are subscribed
 * best-effort (`subscribeWebhooks`), so a tenant that doesn't know them can
 * never fail a connect.
 */
export const DELYVA_WEBHOOK_EVENTS = [
	"order.created",
	"order_tracking.update",
	"order_tracking.change",
	"order.updated",
	"order.failed",
] as const;

/** The events a connect must land, or the account is not subscribed. */
export const DELYVA_WEBHOOK_EVENTS_REQUIRED: ReadonlySet<string> = new Set([
	"order.created",
	"order_tracking.update",
	"order_tracking.change",
]);

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
