import { v } from "convex/values";

// One customisable key survives the one-message-per-order cut (86eyd63r8):
// `confirm`, the write-in reply for a buyer who messages their ORD- reference
// on an order the confirmation template never reached (legacy / failed-push).
// The status keys' sends are deleted and `unknownFallback` was never actually
// read (its render site hardcodes the defaults) — an override stored for any
// of them could no longer render, so the wire stops accepting them. Old rows
// keep their stored extras harmlessly (schema stays wide; the catalog just
// never looks those keys up), and they drop off on the seller's next save.
const localeOverridesValidator = v.object({
	confirm: v.optional(v.string()),
});

const messageTemplatesValidator = v.object({
	en: v.optional(localeOverridesValidator),
	ms: v.optional(localeOverridesValidator),
	zh: v.optional(localeOverridesValidator),
});

// Per-retailer SHORT status labels (tracking timeline / dashboard). Six optional
// strings per locale, mirroring `statusLabels` on the schema. Sanitized +
// length-capped in `sanitizeStatusLabels`.
const statusLabelOverridesValidator = v.object({
	pending: v.optional(v.string()),
	confirmed: v.optional(v.string()),
	packed: v.optional(v.string()),
	shipped: v.optional(v.string()),
	delivered: v.optional(v.string()),
	cancelled: v.optional(v.string()),
});

const statusLabelsValidator = v.object({
	en: v.optional(statusLabelOverridesValidator),
	ms: v.optional(statusLabelOverridesValidator),
	zh: v.optional(statusLabelOverridesValidator),
});

// Phase 2 custom stages. `id`/`sortOrder` optional on the wire — the server
// generates missing ids and renumbers sortOrder to the array (display) order,
// like sanitizePaymentMethods. Cap / monotonic-anchor / label rules enforced in
// sanitizeOrderStages via assertValidOrderStages.
const orderStagesValidator = v.array(
	v.object({
		id: v.optional(v.string()),
		anchor: v.union(
			v.literal("confirmed"),
			v.literal("packed"),
			v.literal("shipped"),
			v.literal("delivered"),
		),
		label: v.object({
			en: v.string(),
			ms: v.optional(v.string()),
			zh: v.optional(v.string()),
		}),
		description: v.optional(
			v.object({
				en: v.optional(v.string()),
				ms: v.optional(v.string()),
				zh: v.optional(v.string()),
			}),
		),
		// Accepted-and-ignored: older clients may still post the retired
		// per-stage notify flag (86eyd63r8). Rejecting it would fail their save
		// for no reason; sanitizeOrderStages simply drops it.
		notify: v.optional(v.boolean()),
		sortOrder: v.optional(v.number()),
	}),
);

// Loose wire shape (id/sortOrder optional) before sanitize normalizes it.
type OrderStageInput = {
	id?: string;
	anchor: StageAnchor;
	label: { en: string; ms?: string; zh?: string };
	description?: { en?: string; ms?: string; zh?: string };
	notify?: boolean;
	sortOrder?: number;
};

/**
 * Normalize a proposed stage list: trim labels/descriptions (dropping blank
 * locale fields), generate stable ids for new stages, renumber `sortOrder` to
 * the array (display) order, then enforce the config rules (cap, band,
 * monotonic anchors, label caps) via `assertValidOrderStages`. Empty array →
 * undefined, which makes the retailer fall back to synthesized default stages.
 * Throws a plain Error on a rule violation; the mutation wraps it in ConvexError.
 */
function sanitizeOrderStages(
	input: OrderStageInput[] | undefined,
): OrderStage[] | undefined {
	if (!input || input.length === 0) return undefined;
	const out: OrderStage[] = input.map((s, i) => {
		const en = (s.label?.en ?? "").trim();
		const ms = (s.label?.ms ?? "").trim();
		const zh = (s.label?.zh ?? "").trim();
		const descEn = (s.description?.en ?? "").trim();
		const descMs = (s.description?.ms ?? "").trim();
		const descZh = (s.description?.zh ?? "").trim();
		const description =
			descEn || descMs || descZh
				? {
						...(descEn ? { en: descEn } : {}),
						...(descMs ? { ms: descMs } : {}),
						...(descZh ? { zh: descZh } : {}),
					}
				: undefined;
		// Reuse a client-supplied stable id; mint one for a brand-new stage. Never
		// collides with synthesized "default:<anchor>" ids.
		const id = (s.id ?? "").trim() || crypto.randomUUID();
		return {
			id,
			anchor: s.anchor,
			label: { en, ...(ms ? { ms } : {}), ...(zh ? { zh } : {}) },
			...(description ? { description } : {}),
			sortOrder: i,
		};
	});
	assertValidOrderStages(out);
	return out;
}

const paymentInstructionsValidator = v.object({
	bankName: v.optional(v.string()),
	bankAccountName: v.optional(v.string()),
	bankAccountNumber: v.optional(v.string()),
	qrImageStorageId: v.optional(v.string()),
	note: v.optional(v.string()),
});

// Multi-method payment validator (matches schema.retailers.paymentMethods).
// `sortOrder` is optional on the wire — `sanitizePaymentMethods` re-numbers to
// the array order, so the client can just send methods in display order.
const paymentMethodsValidator = v.array(
	v.object({
		type: v.union(v.literal("bank"), v.literal("qr")),
		label: v.string(),
		bankName: v.optional(v.string()),
		bankAccountName: v.optional(v.string()),
		bankAccountNumber: v.optional(v.string()),
		qrImageStorageId: v.optional(v.string()),
		note: v.optional(v.string()),
		sortOrder: v.optional(v.number()),
	}),
);

const PAYMENT_FIELD_MAX = 120;
const PAYMENT_NOTE_MAX = 500;

type PaymentInstructionsShape = {
	bankName?: string;
	bankAccountName?: string;
	bankAccountNumber?: string;
	qrImageStorageId?: string;
	note?: string;
};

function sanitizePaymentInstructions(
	input: PaymentInstructionsShape,
): PaymentInstructionsShape | undefined {
	const out: PaymentInstructionsShape = {};
	const trimField = (key: keyof PaymentInstructionsShape, max: number) => {
		const raw = input[key];
		if (raw === undefined) return;
		const trimmed = raw.trim();
		if (trimmed.length === 0) return; // empty → reset
		if (trimmed.length > max) {
			throw new ConvexError(`Payment field "${key}" exceeds ${max} characters`);
		}
		out[key] = trimmed;
	};
	trimField("bankName", PAYMENT_FIELD_MAX);
	trimField("bankAccountName", PAYMENT_FIELD_MAX);
	trimField("bankAccountNumber", PAYMENT_FIELD_MAX);
	trimField("qrImageStorageId", PAYMENT_FIELD_MAX);
	trimField("note", PAYMENT_NOTE_MAX);
	return Object.keys(out).length > 0 ? out : undefined;
}
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { ConvexError } from "convex/values";
import { reserveFoundingRank } from "./foundingMembers";
import {
	sanitizeAwbConfig,
	type StoredAwbConfig,
} from "./lib/awbConfig";
import { DEFAULT_LOCALE, type Locale } from "./lib/locale";
import { MAX_NOTICE_DAYS } from "./lib/fulfilmentDate";
import { sanitizeMinOrderValue } from "./lib/minOrderRules";
import {
	DELETION_PHASES,
	type DeletionPhase,
	deletionPhaseValidator,
	runDeletionPhase,
} from "./lib/accountDeletion";
import {
	type OpeningHours,
	sanitizeOpeningHours,
} from "./lib/openingHours";
import { rateLimiter } from "./lib/rateLimiter";
import { capsForPlan, DAY_MS, TRIAL_DAYS } from "./lib/plans";
import {
	type AccessState,
	assertPlanFeature,
	assertSubscriptionActive,
	loadSubscription,
	resolveAccess,
} from "./subscriptions";
import {
	type DeliveryConfig,
	deliveryModeAllowed,
	riderBookingAllowed,
	sanitizeDeliveryConfig,
} from "./lib/delivery";
import { isEncrypted } from "./lib/credentialCrypto";
import {
	ackableKeys,
	type CountrySetupItem,
	resolveCountrySetup,
} from "./lib/countrySetup";
import { hasLalamoveCredentials, inferLalamoveEnv } from "./lib/lalamove";
import {
	type HitpayConfig,
	inferHitpayMode,
	resolveHitpayCredentials,
} from "./lib/hitpay";
import {
	orderConfirmTemplateName,
	sellerNewOrderTemplateName,
} from "./lib/whatsapp";
import { TEMPLATE_MAX_LENGTH } from "./lib/whatsappCopy";
import { ordersThisMonth } from "./subscriptionUsage";
import {
	assertSupportedCurrency,
	DEFAULT_CURRENCY,
	type SupportedCurrency,
} from "./lib/currency";
import {
	type Country,
	COUNTRY_CURRENCY,
	DEFAULT_COUNTRY,
} from "./lib/country";
import {
	adminUserIds,
	logAdminAction,
	type RetailerAccess,
	requireAdmin,
	requireRetailerAccess,
} from "./lib/auth";
import { STORE_DESCRIPTION_MAX } from "./lib/storeProfile";
import {
	assertValidEmail,
	assertValidMobileForCountry,
	assertValidSlug,
	assertValidStoreName,
	normalizeWaPhone,
} from "./lib/slug";
import {
	AUP_VERSION,
	PRIVACY_VERSION,
	TERMS_VERSION,
} from "./lib/legal";
import {
	collectQrStorageIds,
	type PaymentMethod,
	resolvePaymentMethods,
	sanitizePaymentMethods,
} from "./lib/payment";
import {
	assertValidOrderStages,
	ORDER_STATUS_KEYS,
	type OrderStage,
	type StageAnchor,
	STATUS_LABEL_MAX_LENGTH,
	type StatusLabelMap,
	type StatusLabels,
} from "./lib/orderStatus";

// Store opening hours (86eyp5rav). Wire validator for updateSettings; the
// shape is validated/normalized by sanitizeOpeningHours in the handler
// (7 entries, 0 ≤ open < close ≤ 1439, ≥1 open day; an all-24h week
// normalizes to unset). `v.null()` = clear back to open-24/7.
const openingHoursValidator = v.array(
	v.object({
		open: v.number(),
		close: v.number(),
		closed: v.optional(v.boolean()),
	}),
);

// Despatch-label template (86eyp63mp). Wire validator for updateSettings; the
// shape is validated/normalized by sanitizeAwbConfig in the handler (an
// all-default object stores as unset). `v.null()` = reset to the defaults.
const awbConfigValidator = v.object({
	paperSize: v.optional(v.union(v.literal("a6"), v.literal("a4-4up"))),
	showLogo: v.optional(v.boolean()),
	showItems: v.optional(v.boolean()),
	showCod: v.optional(v.boolean()),
	showWeight: v.optional(v.boolean()),
	showNote: v.optional(v.boolean()),
	footerText: v.optional(v.string()),
});

// Delivery-charge config + business address (86extzdr8). Wire validators for
// updateSettings; the shape is validated/normalized by sanitizeDeliveryConfig
// and sanitizeBusinessAddress in the handler. `v.null()` = clear.
const deliveryConfigValidator = v.union(
	v.object({
		mode: v.literal("flat"),
		fee: v.number(),
		freeAbove: v.optional(v.number()),
	}),
	v.object({
		mode: v.literal("radius"),
		bands: v.array(v.object({ maxKm: v.number(), fee: v.number() })),
		outOfRange: v.union(v.literal("block"), v.literal("arrange")),
	}),
	v.object({
		mode: v.literal("weight"),
		zones: v.array(
			v.object({
				name: v.string(),
				states: v.array(v.string()),
				bands: v.array(v.object({ maxKg: v.number(), fee: v.number() })),
				freeAbove: v.optional(v.number()),
			}),
		),
		onOutOfBands: v.union(v.literal("block"), v.literal("arrange")),
		onUnpriceable: v.union(v.literal("block"), v.literal("arrange")),
	}),
	v.object({
		mode: v.literal("lalamove"),
		onUnquotable: v.union(v.literal("arrange"), v.literal("block")),
	}),
);

// Lalamove booking config (86eyb5hrf). `null` clears; enabling requires a
// pinned business address + resolvable credentials (BYO fields or platform
// env) and is Pro-gated. Secrets never leave the server — reads expose only
// a summary (see DeliveryBookingSummary).
const deliveryBookingValidator = v.object({
	enabled: v.boolean(),
	vehicleType: v.union(v.literal("MOTORCYCLE"), v.literal("CAR")),
	apiKey: v.optional(v.string()),
	apiSecret: v.optional(v.string()),
	// undefined = keep the stored preference (same posture as the key fields).
	promptBookOnPacked: v.optional(v.boolean()),
	// undefined = keep the stored direction (86eyg0n8e — see schema comment).
	deliveryDirection: v.optional(
		v.union(v.literal("standard"), v.literal("collection")),
	),
});

type DeliveryBooking = {
	enabled: boolean;
	vehicleType: "MOTORCYCLE" | "CAR";
	promptBookOnPacked?: boolean;
	deliveryDirection?: "standard" | "collection";
	apiKey?: string;
	apiSecret?: string;
	/** Stamped at save from the plaintext key (86eyn25gk) — the stored key may
	 * be ciphertext, which a query can't slice a hint from. */
	apiKeyHint?: string;
	/** Sandbox vs production, stamped at save from the plaintext key
	 * (86eypncfy) for the same reason as the hint — ciphertext has no prefix
	 * to read. */
	env?: "sandbox" | "production";
};

/** Owner-read summary of the booking config — the API secret NEVER crosses
 * to the client. BYO-only: `hasCredentials` is simply "is the seller's own
 * key pair stored" (there is no platform fallback). */
export type DeliveryBookingSummary = {
	enabled: boolean;
	vehicleType: "MOTORCYCLE" | "CAR";
	hasCredentials: boolean;
	promptBookOnPacked: boolean;
	/** Collection service (86eyg0n8e): riders collect FROM the buyer and drop
	 * off AT the seller. Undefined-on-the-row reads as "standard" here. */
	deliveryDirection: "standard" | "collection";
	/** Last 4 chars of the seller's own key ("…a1b2") so the settings UI can
	 * show which key is stored without exposing it. */
	apiKeyHint?: string;
	/** Which Lalamove environment the stored keys talk to (86eypncfy).
	 * Undefined = a pre-backfill row we can't judge; the UI says "unknown"
	 * rather than assuming production, because assuming wrong is exactly the
	 * failure this field exists to stop. */
	env?: "sandbox" | "production";
};

function summarizeDeliveryBooking(
	booking: DeliveryBooking | undefined,
): DeliveryBookingSummary | undefined {
	if (!booking) return undefined;
	return {
		enabled: booking.enabled,
		vehicleType: booking.vehicleType,
		hasCredentials: hasLalamoveCredentials(booking),
		promptBookOnPacked: booking.promptBookOnPacked === true,
		deliveryDirection: booking.deliveryDirection ?? "standard",
		// Stored hint first (86eyn25gk — the key may be ciphertext); slicing is
		// only valid on a legacy still-plaintext row.
		apiKeyHint:
			booking.apiKeyHint ??
			(booking.apiKey && !isEncrypted(booking.apiKey)
				? booking.apiKey.slice(-4)
				: undefined),
		// Same rule for the environment: the stored stamp wins, and inferring is
		// only sound on a still-plaintext row (a ciphertext prefix would read
		// "production" and quietly clear a sandbox warning — the one mistake
		// this field must never make).
		env:
			booking.env ??
			(booking.apiKey && !isEncrypted(booking.apiKey)
				? inferLalamoveEnv(booking.apiKey)
				: undefined),
	};
}

// HitPay connection (86eyb6z3a). `null` clears; enabling requires resolvable
// credentials and is Pro-gated. Secrets never leave the server — reads expose
// only a summary (see HitpaySummary). `connectedAt` is server-stamped, so the
// wire validator deliberately omits it.
const hitpayValidator = v.object({
	enabled: v.boolean(),
	// undefined = keep the stored value; empty string = clear (logoStorageId
	// posture, mirrored from deliveryBooking's key semantics).
	apiKey: v.optional(v.string()),
	salt: v.optional(v.string()),
});

/** Owner-read summary of the HitPay connection — the API key + webhook salt
 * NEVER cross to the client. BYO-only: `hasCredentials` is "is the seller's
 * own key pair stored". `mode` is inferred from the key prefix so the settings
 * card can badge a sandbox connection. */
export type HitpaySummary = {
	enabled: boolean;
	hasCredentials: boolean;
	mode?: "sandbox" | "production";
	/** Last 4 chars of the stored API key ("…a1b2") for the settings UI. */
	apiKeyHint?: string;
	connectedAt?: number;
	/** The ACCOUNT's enabled rails (probed at connect, refreshed by mints) —
	 * the settings chips render from this, never from a hardcoded set.
	 * `methodsCheckedAt` set with NO list = the probe ran and the key was
	 * rejected (drives the "check your key" warning). */
	paymentMethods?: string[];
	methodsCheckedAt?: number;
};

function summarizeHitpay(
	config: HitpayConfig | undefined,
): HitpaySummary | undefined {
	if (!config) return undefined;
	const credentials = resolveHitpayCredentials(config);
	// Stored mode/hint first (86eyn25gk — the key may be ciphertext, whose
	// prefix would always read "production"); deriving is only valid on a
	// legacy still-plaintext row.
	const plaintextKey =
		config.apiKey && !isEncrypted(config.apiKey) ? config.apiKey : undefined;
	return {
		enabled: config.enabled,
		hasCredentials: credentials !== null,
		mode: config.mode ?? (plaintextKey ? inferHitpayMode(plaintextKey) : undefined),
		apiKeyHint: config.apiKeyHint ?? plaintextKey?.slice(-4),
		connectedAt: config.connectedAt,
		paymentMethods: config.paymentMethods,
		methodsCheckedAt: config.methodsCheckedAt,
	};
}

const businessAddressValidator = v.object({
	label: v.string(),
	latitude: v.number(),
	longitude: v.number(),
	placeId: v.optional(v.string()),
});

type BusinessAddress = {
	label: string;
	latitude: number;
	longitude: number;
	placeId?: string;
	/** The country this address was captured in — STAMPED by the server, never
	 * accepted from the client (deliberately absent from
	 * `businessAddressValidator`, the `apiKeyHint`/`env` posture). See the
	 * schema comment for why coordinates can't answer this. */
	country?: Country;
};

const BUSINESS_ADDRESS_LABEL_MAX = 300;

/** Validate the settings-captured business address (the radius-mode origin).
 * Coordinates are required — the address exists to measure distance from, so
 * a coord-less capture is meaningless (the UI only saves autocomplete picks). */
function sanitizeBusinessAddress(
	raw: BusinessAddress,
	capturedIn: Country,
): BusinessAddress {
	const label = raw.label.trim();
	if (label.length === 0) throw new ConvexError("Business address is empty");
	if (label.length > BUSINESS_ADDRESS_LABEL_MAX) {
		throw new ConvexError(
			`Business address must be at most ${BUSINESS_ADDRESS_LABEL_MAX} characters`,
		);
	}
	if (!Number.isFinite(raw.latitude) || raw.latitude < -90 || raw.latitude > 90) {
		throw new ConvexError("latitude must be between -90 and 90");
	}
	if (
		!Number.isFinite(raw.longitude) ||
		raw.longitude < -180 ||
		raw.longitude > 180
	) {
		throw new ConvexError("longitude must be between -180 and 180");
	}
	const placeId = raw.placeId?.trim();
	return {
		label,
		latitude: raw.latitude,
		longitude: raw.longitude,
		placeId: placeId && placeId.length > 0 ? placeId : undefined,
		// Stamped from the store's country at the moment of capture. The Places
		// proxy locks predictions to that country (convex/google.ts
		// `includedRegionCodes`), so this is a fact about where the pick came
		// from, not an inference about where it points.
		country: capturedIn,
	};
}

const SLUG_HISTORY_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// Trim outer whitespace (newlines INSIDE are preserved for multi-line blurbs),
// treat blank as "clear", and reject over-cap input. Returns undefined when the
// field should be unset so an empty description never renders an empty block.
function sanitizeStoreDescription(input: string): string | undefined {
	const trimmed = input.trim();
	if (trimmed.length === 0) return undefined; // empty → clear
	if (trimmed.length > STORE_DESCRIPTION_MAX) {
		throw new ConvexError(
			`Store description exceeds ${STORE_DESCRIPTION_MAX} characters`,
		);
	}
	return trimmed;
}

export type { Locale } from "./lib/locale";
export { DEFAULT_LOCALE } from "./lib/locale";

type LocaleOverrides = {
	confirm?: string;
};

type MessageTemplatesShape = {
	en?: LocaleOverrides;
	ms?: LocaleOverrides;
	zh?: LocaleOverrides;
};

function sanitizeOverrides(
	input: LocaleOverrides | undefined,
): LocaleOverrides | undefined {
	if (!input) return undefined;
	const out: LocaleOverrides = {};
	for (const key of ["confirm"] as const) {
		const raw = input[key];
		if (raw === undefined) continue;
		const trimmed = raw.trim();
		if (trimmed.length === 0) continue; // empty → reset to default
		if (trimmed.length > TEMPLATE_MAX_LENGTH) {
			throw new ConvexError(
				`Template "${key}" exceeds ${TEMPLATE_MAX_LENGTH} characters`,
			);
		}
		out[key] = trimmed;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeMessageTemplates(
	input: MessageTemplatesShape,
): MessageTemplatesShape | undefined {
	const en = sanitizeOverrides(input.en);
	const ms = sanitizeOverrides(input.ms);
	const zh = sanitizeOverrides(input.zh);
	const out: MessageTemplatesShape = {};
	if (en) out.en = en;
	if (ms) out.ms = ms;
	if (zh) out.zh = zh;
	return Object.keys(out).length > 0 ? out : undefined;
}

// Trim each status label, treat empty/whitespace as unset (so a seller can't
// blank a stage to ""), and enforce the per-label char cap server-side — not
// just in CSS — so an over-long / emoji-stuffed label can't break the pills.
function sanitizeStatusLabelOverrides(
	input: StatusLabelMap | undefined,
): StatusLabelMap | undefined {
	if (!input) return undefined;
	const out: StatusLabelMap = {};
	for (const key of ORDER_STATUS_KEYS) {
		const raw = input[key];
		if (raw === undefined) continue;
		const trimmed = raw.trim();
		if (trimmed.length === 0) continue; // empty → reset to default
		if (trimmed.length > STATUS_LABEL_MAX_LENGTH) {
			throw new ConvexError(
				`Status label "${key}" exceeds ${STATUS_LABEL_MAX_LENGTH} characters`,
			);
		}
		out[key] = trimmed;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeStatusLabels(input: StatusLabels): StatusLabels | undefined {
	const en = sanitizeStatusLabelOverrides(input.en);
	const ms = sanitizeStatusLabelOverrides(input.ms);
	const zh = sanitizeStatusLabelOverrides(input.zh);
	const out: StatusLabels = {};
	if (en) out.en = en;
	if (ms) out.ms = ms;
	if (zh) out.zh = zh;
	return Object.keys(out).length > 0 ? out : undefined;
}

type RetailerPublic = {
	_id: Id<"retailers">;
	slug: string;
	storeName: string;
	// Public storefront blurb under the store name. Public-safe — surfaced on
	// both the owner read and the by-slug storefront payload.
	storeDescription?: string;
	// "What does your store sell?" — the default kind for NEW products in the
	// wizard (86eyj70z1 decision 5). Owner-facing config, harmless if public.
	storeType?: "physical" | "service" | "booking";
	waPhone?: string;
	notifyEmail?: string;
	// Seller WhatsApp order alerts (86eyhw9zy) — OWNER-only alert config: the
	// receiving mobile (store's country) + the opt-in flag, plus two derived bits the settings
	// card needs: `waOrderAlertsAvailable` (an approved seller template is
	// configured on this deployment — card hidden otherwise) and
	// `notifyWaPhoneOptedOut` (the saved number holds a global STOP opt-out, so
	// the gateway would suppress every alert — the card must say so instead of
	// letting the toggle silently do nothing). Never on the by-slug payload.
	notifyWaPhone?: string;
	orderWaAlerts?: boolean;
	waOrderAlertsAvailable?: boolean;
	notifyWaPhoneOptedOut?: boolean;
	checkoutPhone?: string;
	// Whether the storefront confirmation-push path is active (86eyf1rck —
	// approved WA template configured): checkout then promises "confirmation
	// lands in your WhatsApp" instead of the wa.me handoff. Public-safe (a
	// deployment-level flag, not seller data); only the by-slug payload sets it.
	confirmPushEnabled?: boolean;
	// Collection-service store (86eyg0n8e): the rider collects FROM the buyer's
	// address and brings the order TO the seller (Bearcamp gear-wash). Flips
	// checkout copy ("Collection address — where should we collect from?") and
	// the wa.me line. Public-safe — a one-bit service-model fact, no location
	// data; derived from deliveryBooking.deliveryDirection, which itself never
	// crosses to the public payload. Only the by-slug payload sets it.
	deliveryCollectsFromCustomer?: boolean;
	logoStorageId?: string;
	logoUrl?: string;
	// Wide cover/banner. Public-safe — the storefront header hero and the PRIMARY
	// OG/JSON-LD image (logo → first product image fall back). Surfaced on both the
	// owner read and the by-slug storefront payload. See docs/store-cover-banner.md.
	coverImageStorageId?: string;
	coverImageUrl?: string;
	currency: SupportedCurrency;
	// Store country (SG-lite). Resolved — undefined rows read as "MY". Public-
	// safe (which country a storefront operates in is not seller data): checkout
	// keys the phone plate/validator arm and the address variant off it.
	country: Country;
	locale: Locale;
	messageTemplates?: MessageTemplatesShape;
	// Per-retailer SHORT status labels (tracking timeline / dashboard). Omitted
	// keys fall back to defaults at render time via convex/lib/orderStatus.ts.
	statusLabels?: StatusLabels;
	// Phase 2 custom stages (ordered). Undefined => the resolver synthesizes the
	// default stages from statusLabels. Surfaced for the settings stage editor.
	orderStages?: OrderStage[];
	// Resolved payment methods (legacy-aware) with each QR storage id turned into
	// a viewable URL — what the settings UI renders + edits. Omitted from the
	// public storefront payload (only `getMyRetailer` populates it).
	paymentMethods?: Array<PaymentMethod & { qrImageUrl?: string }>;
	// Whether the retailer is offering self-collect on the storefront. Storefront
	// hides the self-collect option entirely when false (regardless of pickup
	// location count). Undefined treated as false.
	offerSelfCollect?: boolean;
	// Whether the retailer is offering delivery on the storefront. Mirror of
	// offerSelfCollect, but undefined is treated as TRUE (legacy retailers always
	// had delivery). Storefront and settings invariant guarantee ≥1 working
	// method, so the buyer always sees a way to receive their order.
	offerDelivery?: boolean;
	// Delivery-charge config (86extzdr8) + the radius-mode origin address.
	// OWNER-only (settings UI): the business address is often the seller's home,
	// so neither field is ever in the public storefront payload — buyers get the
	// resolved fee from the `delivery.quote` query instead.
	deliveryConfig?: DeliveryConfig;
	businessAddress?: BusinessAddress;
	// Lalamove booking summary (86eyb5hrf) — OWNER-only like the two fields
	// above, and secret-free (see DeliveryBookingSummary).
	deliveryBooking?: DeliveryBookingSummary;
	// HitPay connection summary (86eyb6z3a) — OWNER-only and secret-free like
	// deliveryBooking. Buyers learn "gateway available" per-order through
	// orders.getPaymentMethods, never from a retailer payload.
	hitpay?: HitpaySummary;
	// Minimum days' notice before a fulfilment date — drives the storefront date
	// picker's earliest selectable day. Undefined → 0 (same-day allowed).
	minFulfilmentNoticeDays?: number;
	// Store opening hours (86eyp5rav). Public-safe — buyers see them on the
	// storefront header, and checkout clamps the fulfilment date/time to them.
	// Undefined = open 24/7. Surfaced on both the owner read and the by-slug
	// payload. See convex/lib/openingHours.ts.
	openingHours?: OpeningHours;
	// Despatch-label template (86eyp63mp) — OWNER-only: it says nothing a buyer
	// needs, and the footer line is the seller's own returns copy. Undefined =
	// every default. See convex/lib/awbConfig.ts.
	awbConfig?: StoredAwbConfig;
	// Store-wide minimum order value (minor units, 86ey9unyx). Public-safe —
	// buyers must see the bar to reach it (checkout blocks below it). Undefined
	// = no minimum. See convex/lib/minOrderRules.ts.
	minOrderValue?: number;
	// Whether the retailer has opened the Pickup settings tab at least once.
	// Drives checklist step-4 dismissal — set to true on first tab visit by
	// `markPickupSetupSeen`.
	pickupSetupSeen?: boolean;
	// Accepted legal-doc versions, surfaced so the dashboard can detect a
	// version bump and prompt re-acceptance. Acceptance timestamps and IP are
	// intentionally not exposed to the client.
	termsVersion?: string;
	privacyVersion?: string;
	aupVersion?: string;
	// Whether the optional "WhatsApp Business greeting message" onboarding step
	// has been marked done/skipped. Drives the setup checklist on the dashboard.
	onboardingGreetingSetup?: boolean;
	// Activation funnel timestamps (epoch-ms), OWNER-only. Drive the dashboard
	// checklist's activation states: `linkSharedAt` flips the "Share your link"
	// step to done; `activatedAt` (first confirmed order) collapses the checklist
	// and shows the first-order celebration. See docs/activation-checklist.md.
	activatedAt?: number;
	linkSharedAt?: number;
	// Subscription/entitlement summary — drives the nav tier pill + soft-lock UI.
	// Populated only by the OWNER read (`getMyRetailer`); deliberately omitted from
	// the public storefront payload (`getRetailerBySlug`) so subscription state
	// never leaks to shoppers. Fail-safe: a retailer missing a subscription row
	// resolves to comped full access (see resolveAccess). See docs/manual-subscription.md.
	subscription?: AccessState;
	// Orders counted this MYT calendar month — the meter behind the SOFT
	// orderCap nudge ("X of 100 plan orders used"). OWNER-only, like
	// `subscription`. See convex/subscriptionUsage.ts.
	ordersThisMonth?: number;
	// Claim links (86eyq0epn): the store's remembered default payment window —
	// seeds the send controls' chips and is updated on every send. OWNER-only
	// (seller config). Unset falls back to DEFAULT_CLAIM_WINDOW_MINUTES.
	claimLinkWindowMinutes?: number;
	// Claim links (86eyq0epn × 86eyq0eq9): the marketing origin the seller last
	// tagged a claim with — seeds the send dialog's origin chips. OWNER-only.
	claimLinkSource?: string;
	// Denormalized Founding Member flags (badge / ribbon) — public-safe.
	isFoundingMember?: boolean;
	foundingMemberRank?: number;
	// Outbound WhatsApp kill-switch state (OWNER-only, like `subscription`), read
	// from `retailerSendingLimits`. When paused, the gateway blocks this seller's
	// NON-transactional WhatsApp sends (order confirmations/status still flow); the
	// dashboard surfaces a banner so the seller isn't left wondering. See
	// docs/waba-protection.md.
	sendingPaused?: boolean;
	sendingPauseReason?: string;
	// True when the caller is a Kedaipal admin operating this store via act-as
	// (not the owner). Drives the persistent "Acting as {store}" dashboard banner.
	// Only ever set by the admin act-as read path. See docs/admin-console.md.
	actingAsAdmin?: boolean;
};

async function loadRetailerForUser(
	ctx: QueryCtx,
	userId: string,
): Promise<RetailerPublic | null> {
	const row = await ctx.db
		.query("retailers")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();
	if (!row) return null;
	// A Kedaipal admin viewing their OWN store gets the highest tier unlocked in
	// the payload (features/active), so no Pro wall or soft-lock renders. `userId`
	// is the caller's identity AND the owner (by_user lookup), so this is strictly
	// admin-on-own-store. The act-as read (`getRetailerForAdmin`) does NOT pass
	// this — white-glove must see the seller's real tier. See docs/admin-console.md.
	const adminFullAccess = adminUserIds().includes(userId);
	return buildRetailerPublic(ctx, row, { adminFullAccess });
}

/** Map a retailer row to the OWNER/admin dashboard payload (payment methods with
 * QR urls, logo url, subscription + sending state). Shared by the by-identity
 * read (`getMyRetailer`) and the admin act-as read path. */
async function buildRetailerPublic(
	ctx: QueryCtx,
	row: Doc<"retailers">,
	opts?: { adminFullAccess?: boolean },
): Promise<RetailerPublic> {
	const resolvedMethods = resolvePaymentMethods(row);
	const paymentMethods: Array<PaymentMethod & { qrImageUrl?: string }> = [];
	for (const m of resolvedMethods) {
		let qrImageUrl: string | undefined;
		if (m.type === "qr" && m.qrImageStorageId) {
			const url = await ctx.storage.getUrl(m.qrImageStorageId);
			qrImageUrl = url ?? undefined;
		}
		paymentMethods.push({ ...m, qrImageUrl });
	}
	let logoUrl: string | undefined;
	if (row.logoStorageId) {
		const url = await ctx.storage.getUrl(row.logoStorageId);
		logoUrl = url ?? undefined;
	}
	let coverImageUrl: string | undefined;
	if (row.coverImageStorageId) {
		const url = await ctx.storage.getUrl(row.coverImageStorageId);
		coverImageUrl = url ?? undefined;
	}
	const sub = await loadSubscription(ctx, row._id);
	if (!sub) {
		console.warn(
			`[retailers] no subscription row for retailer ${row._id} — failing open (comped full access)`,
		);
	}
	const sendingLimits = await ctx.db
		.query("retailerSendingLimits")
		.withIndex("by_retailer", (q) => q.eq("retailerId", row._id))
		.first();
	const usedOrders = await ordersThisMonth(ctx, row._id);
	// Seller WA alerts (86eyhw9zy): surface whether the saved number holds an
	// active global STOP opt-out — the WABA gateway would suppress every alert,
	// so the settings card warns instead of the toggle silently doing nothing.
	let notifyWaPhoneOptedOut = false;
	const alertPhone = row.notifyWaPhone;
	if (alertPhone) {
		const optOut = await ctx.db
			.query("optOuts")
			.withIndex("by_phone", (q) =>
				q.eq("waPhone", normalizeWaPhone(alertPhone)),
			)
			.order("desc")
			.first();
		notifyWaPhoneOptedOut = !!optOut && optOut.reactivatedAt === undefined;
	}
	return {
		_id: row._id,
		slug: row.slug,
		storeName: row.storeName,
		storeDescription: row.storeDescription,
		storeType: row.storeType,
		waPhone: row.waPhone,
		notifyEmail: row.notifyEmail,
		notifyWaPhone: row.notifyWaPhone,
		orderWaAlerts: row.orderWaAlerts,
		waOrderAlertsAvailable: sellerNewOrderTemplateName() !== undefined,
		notifyWaPhoneOptedOut,
		logoStorageId: row.logoStorageId,
		logoUrl,
		coverImageStorageId: row.coverImageStorageId,
		coverImageUrl,
		currency: (row.currency as SupportedCurrency) ?? DEFAULT_CURRENCY,
		country: row.country ?? DEFAULT_COUNTRY,
		locale: row.locale ?? DEFAULT_LOCALE,
		messageTemplates: row.messageTemplates as MessageTemplatesShape | undefined,
		statusLabels: row.statusLabels as StatusLabels | undefined,
		orderStages: row.orderStages as OrderStage[] | undefined,
		paymentMethods,
		offerSelfCollect: row.offerSelfCollect,
		offerDelivery: row.offerDelivery,
		deliveryConfig: row.deliveryConfig as DeliveryConfig | undefined,
		businessAddress: row.businessAddress,
		deliveryBooking: summarizeDeliveryBooking(row.deliveryBooking),
		hitpay: summarizeHitpay(row.hitpay as HitpayConfig | undefined),
		minFulfilmentNoticeDays: row.minFulfilmentNoticeDays,
		openingHours: row.openingHours,
		awbConfig: row.awbConfig,
		minOrderValue: row.minOrderValue,
		pickupSetupSeen: row.pickupSetupSeen,
		termsVersion: row.termsVersion,
		privacyVersion: row.privacyVersion,
		aupVersion: row.aupVersion,
		onboardingGreetingSetup: row.onboardingGreetingSetup,
		activatedAt: row.activatedAt,
		linkSharedAt: row.linkSharedAt,
		subscription: resolveAccess(sub, {
			adminFullAccess: opts?.adminFullAccess,
		}),
		ordersThisMonth: usedOrders,
		claimLinkWindowMinutes: row.claimLinkWindowMinutes,
		claimLinkSource: row.claimLinkSource,
		isFoundingMember: row.isFoundingMember,
		foundingMemberRank: row.foundingMemberRank,
		sendingPaused: !!sendingLimits?.pausedAt,
		sendingPauseReason: sendingLimits?.pauseReason,
	};
}

async function requireUserId(ctx: QueryCtx): Promise<string> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	return identity.subject;
}

/**
 * Returns the signed-in user's retailer, or null if they have not completed
 * onboarding yet. Used by `/app` and `/onboarding` route guards.
 */
/** The signed-in user's own store row (not the public payload). `null` when
 * unauthenticated or storeless — callers decide what that means for them. */
async function resolveOwnRetailer(
	ctx: QueryCtx,
): Promise<Doc<"retailers"> | null> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return null;
	return ctx.db
		.query("retailers")
		.withIndex("by_user", (q) => q.eq("userId", identity.subject))
		.first();
}

export const getMyRetailer = query({
	args: {},
	handler: async (ctx): Promise<RetailerPublic | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		return loadRetailerForUser(ctx, identity.subject);
	},
});

/**
 * Minimal plan read for the public `/pricing` page's plan-aware tier CTA — just
 * the three enum bits it needs, without `getMyRetailer`'s heavy payload (signed
 * logo/cover/QR storage URLs, usage row, opt-out lookup) held open as a live
 * subscription on a marketing route. Identity-gated; `null` for an
 * unauthenticated caller or a user with no store. Fail-open comped mirrors
 * `resolveAccess`. See `src/lib/pricing-cta.ts`.
 */
export const getMyPlan = query({
	args: {},
	handler: async (
		ctx,
	): Promise<Pick<AccessState, "plan" | "status" | "comped"> | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return null;
		const access = resolveAccess(await loadSubscription(ctx, retailer._id));
		return { plan: access.plan, status: access.status, comped: access.comped };
	},
});

/**
 * Admin act-as read: returns THAT store's dashboard payload (with
 * `actingAsAdmin: true` so the "Acting as {store}" banner renders) instead of the
 * caller's own — the single read powering white-glove onboarding. Admin-only and
 * server-enforced (`requireAdmin` throws for a normal seller). Kept separate from
 * `getMyRetailer` so the owner path stays a zero-arg, unchanged query; the
 * dashboard's `useDashboardRetailer` hook picks this one when `?actAs=` is set.
 * See docs/admin-console.md.
 */
export const getRetailerForAdmin = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<RetailerPublic | null> => {
		await requireAdmin(ctx);
		const row = await ctx.db.get(retailerId);
		if (!row) return null;
		return { ...(await buildRetailerPublic(ctx, row)), actingAsAdmin: true };
	},
});

/**
 * Public lookup of a retailer by slug. Also checks `slugHistory` to produce
 * a 301 redirect target if the slug was recently renamed.
 */
export const getRetailerBySlug = query({
	args: { slug: v.string() },
	handler: async (
		ctx,
		{ slug },
	): Promise<
		| { status: "ok"; retailer: RetailerPublic }
		| { status: "redirect"; to: string }
		| { status: "notFound" }
	> => {
		const normalized = slug.trim().toLowerCase();
		if (normalized.length === 0) return { status: "notFound" };

		const active = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", normalized))
			.first();
		if (active) {
			let logoUrl: string | undefined;
			if (active.logoStorageId) {
				const url = await ctx.storage.getUrl(active.logoStorageId);
				logoUrl = url ?? undefined;
			}
			let coverImageUrl: string | undefined;
			if (active.coverImageStorageId) {
				const url = await ctx.storage.getUrl(active.coverImageStorageId);
				coverImageUrl = url ?? undefined;
			}
			return {
				status: "ok",
				retailer: {
					_id: active._id,
					slug: active.slug,
					storeName: active.storeName,
					storeDescription: active.storeDescription,
					waPhone: active.waPhone,
					checkoutPhone: process.env.WHATSAPP_CHECKOUT_PHONE ?? active.waPhone,
					confirmPushEnabled: orderConfirmTemplateName() !== undefined,
					// Service-model bit only — the booking config itself stays
					// owner-only (see the RetailerPublic comment).
					deliveryCollectsFromCustomer:
						(active.deliveryBooking as DeliveryBooking | undefined)
							?.deliveryDirection === "collection",
					logoStorageId: active.logoStorageId,
					logoUrl,
					coverImageStorageId: active.coverImageStorageId,
					coverImageUrl,
					currency:
						(active.currency as SupportedCurrency) ?? DEFAULT_CURRENCY,
					country: active.country ?? DEFAULT_COUNTRY,
					locale: active.locale ?? DEFAULT_LOCALE,
					messageTemplates: active.messageTemplates as
						| MessageTemplatesShape
						| undefined,
					offerSelfCollect: active.offerSelfCollect,
					offerDelivery: active.offerDelivery,
					minFulfilmentNoticeDays: active.minFulfilmentNoticeDays,
					openingHours: active.openingHours,
					minOrderValue: active.minOrderValue,
					// Founding badge is public-safe; subscription state is NOT included.
					isFoundingMember: active.isFoundingMember,
					foundingMemberRank: active.foundingMemberRank,
					// paymentInstructions intentionally omitted from the public
					// storefront payload — only revealed in the WhatsApp confirm
					// reply after the shopper commits to an order.
				},
			};
		}

		const historyRow = await ctx.db
			.query("slugHistory")
			.withIndex("by_old_slug", (q) => q.eq("oldSlug", normalized))
			.first();
		if (historyRow && historyRow.expiresAt > Date.now()) {
			const target = await ctx.db.get(historyRow.retailerId);
			if (target) return { status: "redirect", to: target.slug };
		}

		return { status: "notFound" };
	},
});

/**
 * Check slug availability for live form feedback. Returns the same shape as
 * `getRetailerBySlug` but from the perspective of "can the current user claim
 * this slug?" — so owner-reclaim paths return `available`.
 */
export const checkSlugAvailability = query({
	args: { slug: v.string() },
	handler: async (
		ctx,
		{ slug },
	): Promise<
		{ status: "available" } | { status: "taken" } | { status: "invalid"; reason: string }
	> => {
		let normalized: string;
		try {
			normalized = assertValidSlug(slug);
		} catch (err) {
			return { status: "invalid", reason: (err as Error).message };
		}

		const identity = await ctx.auth.getUserIdentity();
		const currentUserId = identity?.subject ?? null;

		const active = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", normalized))
			.first();
		if (active) {
			if (currentUserId && active.userId === currentUserId) {
				return { status: "available" };
			}
			return { status: "taken" };
		}

		const historyRow = await ctx.db
			.query("slugHistory")
			.withIndex("by_old_slug", (q) => q.eq("oldSlug", normalized))
			.first();
		if (historyRow && historyRow.expiresAt > Date.now()) {
			if (currentUserId) {
				const historyOwner = await ctx.db.get(historyRow.retailerId);
				if (historyOwner && historyOwner.userId === currentUserId) {
					return { status: "available" };
				}
			}
			return { status: "taken" };
		}

		return { status: "available" };
	},
});

/**
 * Admin pre-check for "onboard a client": is a store already registered to this
 * email? We're strictly 1 login : 1 store and Clerk enforces one account per
 * email, so a duplicate email means the invite link would dead-end (the client
 * would land back in their existing store). Surfacing it up front saves a wasted
 * invite. We check our own `notifyEmail` (the right question — "already owns a
 * store" — not merely "exists in Clerk"); it's stored normalized so equality is
 * exact. notifyEmail is editable, so this is a strong heuristic, not a hard
 * guarantee — the real 1:1 gate still lives in `createRetailer`. Admin-only to
 * avoid leaking whether an email is registered. See docs/vendor-identity.md.
 */
export const checkEmailHasStore = query({
	args: { email: v.string() },
	handler: async (
		ctx,
		{ email },
	): Promise<{ exists: boolean; storeName?: string; slug?: string }> => {
		await requireAdmin(ctx);
		let normalized: string;
		try {
			normalized = assertValidEmail(email);
		} catch {
			// Not a valid email yet (still typing) — nothing to warn about.
			return { exists: false };
		}
		const existing = await ctx.db
			.query("retailers")
			.withIndex("by_notify_email", (q) => q.eq("notifyEmail", normalized))
			.first();
		if (!existing) return { exists: false };
		return { exists: true, storeName: existing.storeName, slug: existing.slug };
	},
});

/**
 * Create the signed-in user's retailer. Enforces strict 1:1 user↔retailer.
 *
 * Race-safe: Convex mutations are serializable, so the read-then-insert pattern
 * cannot lose to a concurrent writer.
 */
/**
 * Create the retailer's subscription in the SAME transaction as the retailer
 * insert. Both paths start on the SAME 14-day `trialing` (Pro caps) — a founding
 * member is just a trial + `foundingIntent` + a reserved rank. The PAID Pro plan
 * only begins when Arif marks the founding invoice paid (markPaid → `active`); we
 * never pre-activate Pro at onboard.
 */
async function createSubscriptionForRetailer(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	intent: "public" | "founding",
	now: number,
): Promise<void> {
	const caps = capsForPlan("pro"); // trial + founding both grant Pro-level access
	if (intent === "founding") {
		// Founding-10: the PAID Pro subscription only starts when Arif confirms the
		// founding invoice paid (markPaid → status "active" + fresh period). Until then
		// the founding member rides the SAME 14-day trial as everyone else — and if the
		// trial lapses before they pay, they're locked like any other unpaid trial. We
		// must NOT pre-activate Pro at onboard: that would be free service before money
		// lands. The founding-ness here is just two flags layered on the normal trial:
		//   1. `foundingIntent` — so the invoice Arif issues auto-applies the discount.
		//   2. a reserved founding rank — so Arif can't over-commit past 10 and the
		//      "Founding #N" badge/spot show from day one (the rank is held, not yet paid).
		await ctx.db.insert("subscriptions", {
			retailerId,
			plan: "pro",
			billingCycle: "monthly",
			status: "trialing",
			trialEndsAt: now + TRIAL_DAYS * DAY_MS,
			foundingIntent: true,
			orderCap: caps.orderCap,
			userCap: caps.userCap,
			broadcastQuota: caps.broadcastQuota,
			createdAt: now,
			updatedAt: now,
		});
		// Reserve the founding slot now (at onboard), not at payment — over-commit guard
		// + immediate badge. The paid cycle is confirmed later at mark-paid. Welcome them.
		const rank = await reserveFoundingRank(ctx, retailerId);
		if (rank !== null) {
			await ctx.scheduler.runAfter(0, internal.whatsapp.notifyFoundingWelcome, {
				retailerId,
				rank,
			});
		}
		return;
	}
	// Public funnel: 14-day no-card trial granting Pro-level access. Tier is
	// chosen at conversion, not signup; `plan` holds the trialed tier (pro).
	await ctx.db.insert("subscriptions", {
		retailerId,
		plan: "pro",
		billingCycle: "monthly",
		status: "trialing",
		trialEndsAt: now + TRIAL_DAYS * DAY_MS,
		orderCap: caps.orderCap,
		userCap: caps.userCap,
		broadcastQuota: caps.broadcastQuota,
		createdAt: now,
		updatedAt: now,
	});
}

export const createRetailer = mutation({
	args: {
		storeName: v.string(),
		slug: v.string(),
		waPhone: v.optional(v.string()),
		// Store country (SG-lite). Optional — omitted/MY stores stay undefined on
		// the row (the zero-migration posture); SG is stored explicitly and sets
		// the store's currency to SGD at birth, BEFORE any product exists (products
		// freeze their currency at create, so a wrong default here would strand
		// the whole catalog — see docs/sg-lite.md).
		country: v.optional(v.union(v.literal("MY"), v.literal("SG"))),
		// Signup path. Both start a 14-day trial; "founding" additionally flags the
		// store (`foundingIntent`) and reserves a Founding-10 rank, but the paid Pro
		// plan still only starts at admin mark-paid. The real rank gate is mark-paid +
		// the 10-slot cap, so this is not a privileged arg in v1. See docs/manual-subscription.md.
		intent: v.optional(v.union(v.literal("public"), v.literal("founding"))),
	},
	handler: async (ctx, args): Promise<{ slug: string }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const userId = identity.subject;
		let storeName: string;
		let slug: string;
		let waPhone: string | undefined;
		// The SAME-CALL country judges the phone — the row doesn't exist yet, so
		// there is nothing stored to read (SG-lite, 86eynw2dy).
		const country = args.country ?? DEFAULT_COUNTRY;
		try { storeName = assertValidStoreName(args.storeName); } catch (err) { throw new ConvexError((err as Error).message); }
		try { slug = assertValidSlug(args.slug); } catch (err) { throw new ConvexError((err as Error).message); }
		if (args.waPhone && args.waPhone.trim().length > 0) {
			try { waPhone = assertValidMobileForCountry(args.waPhone, country); } catch (err) { throw new ConvexError((err as Error).message); }
		}

		// Prefill notifyEmail from Clerk identity if available. Swallow validation
		// errors so a malformed Clerk email never blocks onboarding — the retailer
		// can fix it via settings later.
		let notifyEmail: string | undefined;
		const identityEmail =
			typeof identity.email === "string" ? identity.email : undefined;
		if (identityEmail && identityEmail.trim().length > 0) {
			try {
				notifyEmail = assertValidEmail(identityEmail);
			} catch {
				notifyEmail = undefined;
			}
		}

		const existing = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (existing) {
			throw new ConvexError("You already have a store. Each account can own one retailer.");
		}

		const collision = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		if (collision) throw new ConvexError("That slug is taken");

		// Slug history collision (someone else's rename, still within TTL)
		const historyRow = await ctx.db
			.query("slugHistory")
			.withIndex("by_old_slug", (q) => q.eq("oldSlug", slug))
			.first();
		if (historyRow && historyRow.expiresAt > Date.now()) {
			throw new ConvexError("That slug is temporarily reserved");
		}
		if (historyRow) {
			// Expired but not yet purged — remove inline.
			await ctx.db.delete(historyRow._id);
		}

		const now = Date.now();
		// Consent is implied: the onboarding UI gates submission on a required,
		// not-pre-checked "I agree" checkbox. Stamp the server-side current
		// versions (never client-supplied) for tamper resistance.
		const retailerId = await ctx.db.insert("retailers", {
			userId,
			slug,
			storeName,
			waPhone,
			notifyEmail,
			// Currency is born from the country (SG → SGD) so the first product a
			// seller creates already carries the right currency — products freeze
			// theirs at create and orders refuse a currency mismatch.
			currency: COUNTRY_CURRENCY[country],
			...(args.country !== undefined ? { country: args.country } : {}),
			channel: "whatsapp",
			// Default self-collect ON so new retailers discover the pickup feature
			// in the onboarding checklist. They can toggle it off from Settings →
			// Pickup; that visit also dismisses checklist step 4 (via
			// markPickupSetupSeen).
			offerSelfCollect: true,
			// Delivery on by default too. Both methods start enabled so a new
			// retailer can sell immediately; the Fulfilment settings tab lets them
			// switch to pickup-only (guarded so they can't disable both).
			offerDelivery: true,
			termsAcceptedAt: now,
			termsVersion: TERMS_VERSION,
			privacyAcceptedAt: now,
			privacyVersion: PRIVACY_VERSION,
			aupAcceptedAt: now,
			aupVersion: AUP_VERSION,
			createdAt: now,
			updatedAt: now,
		});

		// Create the subscription (+ founding invoice) in the same transaction, so
		// a retailer always has a subscription row. See createSubscriptionForRetailer.
		await createSubscriptionForRetailer(
			ctx,
			retailerId,
			args.intent ?? "public",
			now,
		);

		return { slug };
	},
});

/**
 * Update retailer profile fields (store name, WhatsApp number).
 * Slug renames go through `renameSlug` which has its own history bookkeeping.
 */
export const updateSettings = mutation({
	args: {
		// Admin act-as: when set, an allow-listed admin edits THIS store's settings
		// (white-glove onboarding). Omitted → the caller edits their own store. See
		// docs/admin-console.md.
		retailerId: v.optional(v.id("retailers")),
		storeName: v.optional(v.string()),
		// Empty/blank clears the description. Undefined means "no change".
		storeDescription: v.optional(v.string()),
		waPhone: v.optional(v.string()),
		notifyEmail: v.optional(v.string()),
		// Seller WhatsApp order alerts (86eyhw9zy). notifyWaPhone: blank clears
		// (and switches the alerts off with it); undefined = no change; validated
		// as a mobile in the store's country and normalized to the inbound
		// "60…"/"65…" form. orderWaAlerts: enabling is Pro-gated + requires a
		// number; disabling always allowed.
		notifyWaPhone: v.optional(v.string()),
		orderWaAlerts: v.optional(v.boolean()),
		currency: v.optional(v.string()),
		// Store country (SG-lite, 86eynw27f). No cascade onto currency — that
		// stays its own setting; the settings UI hints when the two disagree
		// instead of silently rewriting prices' denomination.
		country: v.optional(v.union(v.literal("MY"), v.literal("SG"))),
		locale: v.optional(
			v.union(v.literal("en"), v.literal("ms"), v.literal("zh")),
		),
		// "What does your store sell?" — default kind for NEW products only
		// (86eyj70z1 decision 5). `null` clears back to unset; undefined = no
		// change. Un-gated: it's a default, not a feature.
		storeType: v.optional(
			v.union(
				v.literal("physical"),
				v.literal("service"),
				v.literal("booking"),
				v.null(),
			),
		),
		messageTemplates: v.optional(messageTemplatesValidator),
		statusLabels: v.optional(statusLabelsValidator),
		orderStages: v.optional(orderStagesValidator),
		paymentInstructions: v.optional(paymentInstructionsValidator),
		// Multi-method payment config. When provided, supersedes (and clears) the
		// legacy single `paymentInstructions` object on this retailer.
		paymentMethods: v.optional(paymentMethodsValidator),
		// Empty string clears the logo. Undefined means "no change".
		logoStorageId: v.optional(v.string()),
		// Wide cover/banner. Empty string clears; undefined = no change. Replaced/
		// cleared blobs are garbage-collected in the handler.
		coverImageStorageId: v.optional(v.string()),
		offerSelfCollect: v.optional(v.boolean()),
		offerDelivery: v.optional(v.boolean()),
		// Delivery-charge config (86extzdr8). `null` clears (back to free
		// delivery — always allowed, downgrade never traps); undefined = no
		// change. Setting radius mode is Pro-gated + requires a business address.
		deliveryConfig: v.optional(v.union(deliveryConfigValidator, v.null())),
		// Business address (radius-mode origin). `null` clears — rejected while
		// a radius config still depends on it; undefined = no change.
		businessAddress: v.optional(v.union(businessAddressValidator, v.null())),
		// Lalamove booking (86eyb5hrf). `null` clears (un-gated — downgrade never
		// traps); enabling requires business address + resolvable credentials and
		// is Pro-gated. Undefined = no change.
		deliveryBooking: v.optional(v.union(deliveryBookingValidator, v.null())),
		// HitPay connection (86eyb6z3a). `null` clears (un-gated); enabling
		// requires resolvable credentials and is Pro-gated. Undefined = no change.
		hitpay: v.optional(v.union(hitpayValidator, v.null())),
		// Minimum days' notice before a fulfilment date. Clamped to [0, 30].
		minFulfilmentNoticeDays: v.optional(v.number()),
		// Store opening hours (86eyp5rav). `null` clears (back to open 24/7 —
		// always allowed); undefined = no change. Validated + normalized by
		// sanitizeOpeningHours (an all-24h week also stores as unset).
		openingHours: v.optional(v.union(openingHoursValidator, v.null())),
		// Despatch-label template (86eyp63mp). `null` resets to the defaults
		// (always allowed); undefined = no change. All-tier — printing a label
		// for a parcel you're already shipping is correctness, not an upsell.
		awbConfig: v.optional(v.union(awbConfigValidator, v.null())),
		// Store-wide minimum order value (minor units). 0 clears (no minimum);
		// undefined = no change. See convex/lib/minOrderRules.ts.
		minOrderValue: v.optional(v.number()),
	},
	handler: async (
		ctx,
		args,
	): Promise<{
		ok: true;
		productsCurrencySynced: number;
	}> => {
		// Resolve the target store: an explicit `retailerId` is the admin act-as
		// path (owner-or-admin); otherwise it's the caller's own store.
		let retailer: Doc<"retailers">;
		let access: RetailerAccess;
		if (args.retailerId) {
			access = await requireRetailerAccess(ctx, args.retailerId);
			retailer = access.retailer;
		} else {
			const userId = await requireUserId(ctx);
			const own = await ctx.db
				.query("retailers")
				.withIndex("by_user", (q) => q.eq("userId", userId))
				.first();
			if (!own) throw new ConvexError("No store to update");
			retailer = own;
			access = { retailer: own, actingAsAdmin: false, userId };
		}
		// Soft-lock: a past_due seller can't edit store settings (growth-write).
		// An admin onboarding the store (act-as) bypasses it — white-glove happens
		// before the seller has paid. See docs/manual-subscription.md.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, retailer._id);

		const patch: Partial<{
			storeName: string;
			storeDescription: string | undefined;
			storeType: "physical" | "service" | "booking" | undefined;
			waPhone: string | undefined;
			notifyEmail: string | undefined;
			notifyWaPhone: string | undefined;
			orderWaAlerts: boolean;
			logoStorageId: string | undefined;
			coverImageStorageId: string | undefined;
			currency: SupportedCurrency;
			country: Country;
			countryChangedAt: number;
			countryChangedFrom: Country;
			countrySetupAcked: string[] | undefined;
			locale: Locale;
			messageTemplates: MessageTemplatesShape | undefined;
			statusLabels: StatusLabels | undefined;
			orderStages: OrderStage[] | undefined;
			paymentInstructions: PaymentInstructionsShape | undefined;
			paymentMethods: PaymentMethod[] | undefined;
			offerSelfCollect: boolean;
			offerDelivery: boolean;
			deliveryConfig: DeliveryConfig | undefined;
			businessAddress: BusinessAddress | undefined;
			deliveryBooking: DeliveryBooking | undefined;
			hitpay: HitpayConfig | undefined;
			minFulfilmentNoticeDays: number;
			openingHours: OpeningHours | undefined;
			awbConfig: StoredAwbConfig | undefined;
			minOrderValue: number | undefined;
			updatedAt: number;
		}> = { updatedAt: Date.now() };

		// Which validator arm judges the seller's own numbers: a same-call country
		// change wins over the stored row, so "switch to SG + save the SG number"
		// in one call validates coherently instead of bouncing off the old arm.
		const effectiveCountry = args.country ?? retailer.country ?? DEFAULT_COUNTRY;

		if (args.storeName !== undefined) {
			try { patch.storeName = assertValidStoreName(args.storeName); } catch (err) { throw new ConvexError((err as Error).message); }
		}
		if (args.storeDescription !== undefined) {
			patch.storeDescription = sanitizeStoreDescription(args.storeDescription);
		}
		if (args.storeType !== undefined) {
			// null clears; changing it re-types NOTHING — it only pre-selects the
			// wizard's kind card for the seller's NEXT product.
			patch.storeType = args.storeType === null ? undefined : args.storeType;
		}
		if (args.waPhone !== undefined) {
			if (args.waPhone.trim().length > 0) {
				try { patch.waPhone = assertValidMobileForCountry(args.waPhone, effectiveCountry); } catch (err) { throw new ConvexError((err as Error).message); }
			} else {
				patch.waPhone = undefined;
			}
		}
		if (args.notifyEmail !== undefined) {
			if (args.notifyEmail.trim().length > 0) {
				try { patch.notifyEmail = assertValidEmail(args.notifyEmail); } catch (err) { throw new ConvexError((err as Error).message); }
			} else {
				patch.notifyEmail = undefined;
			}
		}
		if (args.notifyWaPhone !== undefined) {
			if (args.notifyWaPhone.trim().length > 0) {
				let alertPhone: string;
				try {
					alertPhone = assertValidMobileForCountry(
						args.notifyWaPhone,
						effectiveCountry,
					);
				} catch (err) {
					throw new ConvexError((err as Error).message);
				}
				// The shared WABA can't message itself — catch the pasted-the-wrong-
				// number mistake instead of letting every alert silently die.
				const checkoutPhone = process.env.WHATSAPP_CHECKOUT_PHONE;
				if (checkoutPhone && normalizeWaPhone(checkoutPhone) === alertPhone) {
					throw new ConvexError(
						"That's Kedaipal's own WhatsApp number — enter the number that should receive your order alerts.",
					);
				}
				patch.notifyWaPhone = alertPhone;
			} else {
				patch.notifyWaPhone = undefined;
				// Clearing the number switches the alerts off with it — an enabled
				// toggle with nowhere to send would be a silent no-op.
				if (retailer.orderWaAlerts && args.orderWaAlerts === undefined) {
					patch.orderWaAlerts = false;
				}
			}
		}
		if (args.orderWaAlerts !== undefined) {
			if (args.orderWaAlerts) {
				// Enabling is the Pro surface (each alert is a billable Meta send);
				// admin act-as bypasses for white-glove, mirroring the soft-lock.
				// Disabling below stays un-gated — downgrade never traps.
				if (!access.actingAsAdmin) {
					await assertPlanFeature(ctx, retailer._id, "waOrderAlerts");
				}
				const effectivePhone =
					args.notifyWaPhone !== undefined
						? patch.notifyWaPhone
						: retailer.notifyWaPhone;
				if (!effectivePhone) {
					throw new ConvexError(
						"Add the WhatsApp number that should receive order alerts first.",
					);
				}
				patch.orderWaAlerts = true;
			} else {
				patch.orderWaAlerts = false;
			}
		}
		if (args.currency !== undefined) {
			try { patch.currency = assertSupportedCurrency(args.currency); } catch (err) { throw new ConvexError((err as Error).message); }
		}
		if (args.country !== undefined) {
			// The switch ALWAYS succeeds, and destroys nothing (86eyqgujv).
			//
			// #204/#210 refused a switch that would carry an MY-only delivery
			// mode, an enabled Lalamove booking, or a +60 phone number into
			// Singapore, and the settings UI escaped each refusal by CLEARING
			// the value in the same call. Both halves were wrong:
			//
			//  · Refusing deadlocks the one case that matters most. Google Places
			//    predictions are locked server-side to the store's CURRENT
			//    country (convex/google.ts `includedRegionCodes`), so a seller
			//    told "fix your address first" cannot — the picker will only
			//    offer them addresses in the country they are trying to leave.
			//  · Clearing is a data wipe. A weight-zone rate card is an hour of
			//    the seller's work and does not come back when they switch home.
			//
			// Carrying the values is safe because the READ paths were made safe
			// first: an unservable address resolves to a held or blocked quote
			// and never a price (pinned in convex/lib/delivery.test.ts), the
			// dispatch card hides itself on a country we can't book in, and a
			// wrong-country return address is dropped from the parcel label. So
			// nothing broken can act — it can only sit there until the seller
			// replaces it, which convex/lib/countrySetup.ts asks them to do.
			//
			// What IS recorded: when the store moved and from where. That is the
			// only trigger for the checklist, so a store that never switches
			// never pays for any of this.
			if (args.country !== (retailer.country ?? DEFAULT_COUNTRY)) {
				patch.countryChangedAt = Date.now();
				patch.countryChangedFrom = retailer.country ?? DEFAULT_COUNTRY;
				// A new move re-opens every question the seller previously
				// confirmed — their bank details were checked against the OLD
				// destination.
				patch.countrySetupAcked = undefined;
			}
			patch.country = args.country;
		}
		if (args.locale !== undefined) {
			patch.locale = args.locale;
		}
		if (args.messageTemplates !== undefined) {
			patch.messageTemplates = sanitizeMessageTemplates(args.messageTemplates);
		}
		if (args.statusLabels !== undefined) {
			patch.statusLabels = sanitizeStatusLabels(args.statusLabels);
		}
		if (args.orderStages !== undefined) {
			try {
				patch.orderStages = sanitizeOrderStages(args.orderStages);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}
		if (args.paymentInstructions !== undefined) {
			patch.paymentInstructions = sanitizePaymentInstructions(
				args.paymentInstructions,
			);
		}
		if (args.paymentMethods !== undefined) {
			// Re-number sortOrder to the array (display) order, then sanitize.
			const sanitized = sanitizePaymentMethods(
				args.paymentMethods.map((m, i) => ({ ...m, sortOrder: i })),
			);
			// Garbage-collect orphaned QR blobs: any QR image previously stored
			// (in the array OR the legacy object) that the new set no longer
			// references — covers replace, "Remove QR", and method deletion.
			// Best-effort; a missing/already-deleted blob must not abort the save.
			const nextQr = new Set(
				(sanitized ?? [])
					.filter((m) => m.type === "qr" && m.qrImageStorageId)
					.map((m) => m.qrImageStorageId as string),
			);
			for (const prevId of collectQrStorageIds(retailer)) {
				if (nextQr.has(prevId)) continue;
				try {
					await ctx.storage.delete(prevId as Id<"_storage">);
				} catch {
					// already gone — ignore
				}
			}
			patch.paymentMethods = sanitized;
			// Saving via the multi-method UI migrates this retailer off the legacy
			// single object — clear it so reads don't double-count.
			patch.paymentInstructions = undefined;
		}
		// Logo / cover image share one rule: empty string clears, undefined = no
		// change. On replace OR clear, garbage-collect the previous blob so swaps
		// don't leak storage (mirrors the QR GC above). Best-effort — a missing/
		// already-deleted blob must not abort the save.
		if (args.logoStorageId !== undefined) {
			const trimmed = args.logoStorageId.trim();
			const next = trimmed.length > 0 ? trimmed : undefined;
			if (retailer.logoStorageId && retailer.logoStorageId !== next) {
				try {
					await ctx.storage.delete(retailer.logoStorageId as Id<"_storage">);
				} catch {
					// already gone — ignore
				}
			}
			patch.logoStorageId = next;
		}
		if (args.coverImageStorageId !== undefined) {
			const trimmed = args.coverImageStorageId.trim();
			const next = trimmed.length > 0 ? trimmed : undefined;
			if (retailer.coverImageStorageId && retailer.coverImageStorageId !== next) {
				try {
					await ctx.storage.delete(
						retailer.coverImageStorageId as Id<"_storage">,
					);
				} catch {
					// already gone — ignore
				}
			}
			patch.coverImageStorageId = next;
		}
		if (args.offerSelfCollect !== undefined) {
			patch.offerSelfCollect = args.offerSelfCollect;
		}
		if (args.offerDelivery !== undefined) {
			patch.offerDelivery = args.offerDelivery;
		}
		// Business address first so a same-call "address + radius config" save
		// resolves the config's origin requirement against the incoming value.
		if (args.businessAddress !== undefined) {
			if (args.businessAddress === null) {
				patch.businessAddress = undefined;
			} else {
				// Stamped with the EFFECTIVE country so "switch to Singapore and
				// pick the new address" lands in one save, correctly stamped SG.
				patch.businessAddress = sanitizeBusinessAddress(
					args.businessAddress,
					(args.country !== undefined ? args.country : retailer.country) ??
						DEFAULT_COUNTRY,
				);
			}
		}
		if (args.deliveryConfig !== undefined) {
			if (args.deliveryConfig === null) {
				// Clearing (back to free delivery) is always allowed — a downgraded
				// seller must be able to stop charging (chargeablePickup posture).
				patch.deliveryConfig = undefined;
			} else {
				let clean: DeliveryConfig;
				try {
					clean = sanitizeDeliveryConfig(args.deliveryConfig);
				} catch (err) {
					throw new ConvexError((err as Error).message);
				}
				// Country allowlist FIRST (SG-lite, 86eynw29u) — before the
				// mode-specific requirements below, so an SG seller picking
				// Lalamove is told the mode itself is unavailable rather than
				// being sent off to configure booking credentials for nothing.
				// Judged against the effective country so "flip to SG + switch
				// to flat" lands in one save.
				const effectiveCountry =
					(args.country !== undefined ? args.country : retailer.country) ??
					DEFAULT_COUNTRY;
				if (!deliveryModeAllowed(effectiveCountry, clean.mode)) {
					throw new ConvexError(
						"Distance, weight-zone and Lalamove pricing are Malaysia-only for now — Singapore stores can use Free or a Flat fee.",
					);
				}
				if (clean.mode === "radius") {
					// Radius pricing measures FROM the business address — without one
					// every order would silently ship free (the fail-open), so refuse
					// the config instead of storing a dead one.
					const effectiveAddress =
						args.businessAddress !== undefined
							? patch.businessAddress
							: retailer.businessAddress;
					if (!effectiveAddress) {
						throw new ConvexError(
							"Set your business address first — distance pricing measures from it.",
						);
					}
					// Pro gate on SETTING radius pricing (flat is all-tier). Admin
					// act-as bypasses for white-glove setup, mirroring the soft-lock.
					if (!access.actingAsAdmin) {
						await assertPlanFeature(ctx, retailer._id, "radiusDelivery");
					}
				}
				// Weight/zone pricing (86eyeea1n) deliberately carries NO plan gate
				// and NO businessAddress requirement — it prices from the buyer's
				// state + cart weight alone, costs Kedaipal nothing per order, and
				// is the correctness fix for outstation parcel sellers (all-tier,
				// decided with Arif 11 Aug). sanitizeDeliveryConfig above already
				// guarantees ≥1 zone with ≥1 state + ≥1 band, so a stored weight
				// config can never be dead weight.
				if (clean.mode === "lalamove") {
					// Live-quote pricing rides the booking config (credentials +
					// vehicle + origin) — require booking enabled in the effective
					// state so a dead pricing mode (every order fee-pending) can't
					// be stored. Same Pro gate as enabling booking itself.
					const effectiveBooking =
						args.deliveryBooking !== undefined
							? args.deliveryBooking
							: (retailer.deliveryBooking as DeliveryBooking | undefined);
					if (!effectiveBooking?.enabled) {
						throw new ConvexError(
							"Turn on Lalamove delivery booking first — live quotes use its credentials and vehicle type.",
						);
					}
					if (!access.actingAsAdmin) {
						await assertPlanFeature(ctx, retailer._id, "delivery");
					}
				}
				patch.deliveryConfig = clean;
			}
		}
		if (args.deliveryBooking !== undefined) {
			if (args.deliveryBooking === null) {
				// Clearing is always allowed — but never leave a live-quote pricing
				// mode pointing at a booking config that no longer exists.
				const effectiveConfig =
					args.deliveryConfig !== undefined
						? patch.deliveryConfig
						: (retailer.deliveryConfig as DeliveryConfig | undefined);
				if (effectiveConfig?.mode === "lalamove") {
					throw new ConvexError(
						"Live Lalamove pricing uses this booking setup — switch the delivery charge to another mode first.",
					);
				}
				patch.deliveryBooking = undefined;
			} else {
				// Key semantics mirror logoStorageId: `undefined` = keep the stored
				// value (so toggling enable/vehicle never silently wipes keys),
				// empty string = clear.
				const prev = retailer.deliveryBooking as DeliveryBooking | undefined;
				const clean: DeliveryBooking = {
					enabled: args.deliveryBooking.enabled,
					vehicleType: args.deliveryBooking.vehicleType,
					promptBookOnPacked:
						args.deliveryBooking.promptBookOnPacked ??
						prev?.promptBookOnPacked ??
						undefined,
					// "standard" normalizes to unset so the default has one spelling
					// (the sanitizeFee 0→unset posture); undefined keeps the stored
					// direction — a pricing-mode switch away and back can't reset a
					// collection store to standard.
					deliveryDirection:
						args.deliveryBooking.deliveryDirection === undefined
							? prev?.deliveryDirection
							: args.deliveryBooking.deliveryDirection === "collection"
								? "collection"
								: undefined,
					apiKey:
						args.deliveryBooking.apiKey === undefined
							? prev?.apiKey
							: args.deliveryBooking.apiKey.trim() || undefined,
					apiSecret:
						args.deliveryBooking.apiSecret === undefined
							? prev?.apiSecret
							: args.deliveryBooking.apiSecret.trim() || undefined,
					// The last-4 hint is derivable only from PLAINTEXT (86eyn25gk):
					// stamp it when a key is typed, keep the stored one otherwise
					// (falling back to slicing a legacy still-plaintext row), drop it
					// with the key.
					apiKeyHint:
						args.deliveryBooking.apiKey === undefined
							? (prev?.apiKeyHint ??
								(prev?.apiKey && !isEncrypted(prev.apiKey)
									? prev.apiKey.slice(-4)
									: undefined))
							: args.deliveryBooking.apiKey.trim().slice(-4) || undefined,
					// Same stamp-on-type/keep-otherwise rule as the hint, on the
					// value that decides which Lalamove world this store books in
					// (86eypncfy). Clearing the key clears the stamp — an unset
					// credential has no environment to report.
					env:
						args.deliveryBooking.apiKey === undefined
							? (prev?.env ??
								(prev?.apiKey && !isEncrypted(prev.apiKey)
									? inferLalamoveEnv(prev.apiKey)
									: undefined))
							: args.deliveryBooking.apiKey.trim()
								? inferLalamoveEnv(args.deliveryBooking.apiKey.trim())
								: undefined,
				};
				// A key without its secret (or vice versa) can never authenticate —
				// refuse half a credential up front so the failure is at save time
				// with a clear message, not at the first booking attempt.
				if (!!clean.apiKey !== !!clean.apiSecret) {
					throw new ConvexError(
						"Enter both the Lalamove API key and API secret (or clear both).",
					);
				}
				if (clean.enabled) {
					// Country allowlist FIRST, mirroring the deliveryConfig branch
					// above — otherwise the rule only bound a store while it was
					// SWITCHING country. The stored-booking check inside the
					// `args.country` branch catches "carry Lalamove into Singapore";
					// this catches "turn Lalamove on while already in Singapore",
					// which had no guard at all (86eyqgujv). Judged against the
					// effective country so a same-call switch is honoured.
					const effectiveCountry =
						(args.country !== undefined ? args.country : retailer.country) ??
						DEFAULT_COUNTRY;
					if (!riderBookingAllowed(effectiveCountry)) {
						throw new ConvexError(
							"Lalamove rider booking isn't available for your store's country yet — arrange your own courier and record the tracking number on the order.",
						);
					}
					const effectiveAddress =
						args.businessAddress !== undefined
							? patch.businessAddress
							: retailer.businessAddress;
					if (!effectiveAddress) {
						throw new ConvexError(
							"Add your business address first — it's the pickup point riders are sent to.",
						);
					}
					// BYO-only: the seller's own key pair is required — Kedaipal has
					// no Lalamove account and never books on a seller's behalf.
					if (!hasLalamoveCredentials(clean)) {
						throw new ConvexError(
							"Add your Lalamove API key and secret to enable delivery booking.",
						);
					}
					// Pro gate on ENABLING (disabling/clearing stays un-gated; admin
					// act-as bypasses for white-glove setup).
					if (!access.actingAsAdmin) {
						await assertPlanFeature(ctx, retailer._id, "delivery");
					}
				} else {
					// Disabling booking while live-quote pricing is on would leave a
					// dead pricing mode — same guard as clearing.
					const effectiveConfig =
						args.deliveryConfig !== undefined
							? patch.deliveryConfig
							: (retailer.deliveryConfig as DeliveryConfig | undefined);
					if (effectiveConfig?.mode === "lalamove") {
						throw new ConvexError(
							"Live Lalamove pricing uses this booking setup — switch the delivery charge to another mode first.",
						);
					}
				}
				patch.deliveryBooking = clean;
			}
		}
		if (args.hitpay !== undefined) {
			if (args.hitpay === null) {
				// Disconnecting is always allowed (downgrade never traps). An order
				// with a still-open checkout link degrades gracefully: without the
				// salt the webhook can't verify, so a late payment surfaces in
				// HitPay's own dashboard and the seller marks it received by hand —
				// see docs/hitpay-gateway.md.
				patch.hitpay = undefined;
			} else {
				// Key semantics mirror deliveryBooking: `undefined` = keep the
				// stored value (toggling enabled never silently wipes keys), empty
				// string = clear.
				const prev = retailer.hitpay as HitpayConfig | undefined;
				const nextApiKey =
					args.hitpay.apiKey === undefined
						? prev?.apiKey
						: args.hitpay.apiKey.trim() || undefined;
				// A changed key is a different account — its probed method list is
				// someone else's truth. Drop it and let the probe repopulate; a
				// pause/resume (key untouched) keeps it. Note: once the stored key
				// is ciphertext (86eyn25gk), re-typing the SAME key also reads as
				// "changed" (plaintext vs ciphertext) — the probe refires and the
				// list repopulates in seconds, matching the rotate-keys flow.
				const keyChanged = nextApiKey !== prev?.apiKey;
				const clean: HitpayConfig = {
					enabled: args.hitpay.enabled,
					apiKey: nextApiKey,
					salt:
						args.hitpay.salt === undefined
							? prev?.salt
							: args.hitpay.salt.trim() || undefined,
					// Hint + mode are derivable only from PLAINTEXT (86eyn25gk) —
					// stamp on type, keep stored otherwise (legacy plaintext rows
					// still derive), drop with the key.
					apiKeyHint:
						args.hitpay.apiKey === undefined
							? (prev?.apiKeyHint ??
								(prev?.apiKey && !isEncrypted(prev.apiKey)
									? prev.apiKey.slice(-4)
									: undefined))
							: nextApiKey?.slice(-4),
					mode:
						args.hitpay.apiKey === undefined
							? (prev?.mode ??
								(prev?.apiKey && !isEncrypted(prev.apiKey)
									? inferHitpayMode(prev.apiKey)
									: undefined))
							: nextApiKey
								? inferHitpayMode(nextApiKey)
								: undefined,
					connectedAt: prev?.connectedAt,
					paymentMethods: keyChanged ? undefined : prev?.paymentMethods,
					methodsCheckedAt: keyChanged ? undefined : prev?.methodsCheckedAt,
				};
				// Half a credential can neither create checkouts nor verify
				// webhooks — refuse it at save time with a clear message.
				if (!!clean.apiKey !== !!clean.salt) {
					throw new ConvexError(
						"Enter both the HitPay API key and the salt (or clear both) — they sit side by side on HitPay's API Keys page.",
					);
				}
				const credentials = resolveHitpayCredentials(clean);
				if (clean.enabled) {
					// BYO-only: the seller's own key pair is required — Kedaipal has
					// no HitPay account in the money path.
					if (!credentials) {
						throw new ConvexError(
							"Paste your HitPay API key and salt to turn on online payments.",
						);
					}
					// Pro gate on ENABLING (disabling/clearing stays un-gated; admin
					// act-as bypasses for white-glove setup).
					if (!access.actingAsAdmin) {
						await assertPlanFeature(ctx, retailer._id, "onlinePayments");
					}
				}
				// First save that stores a full credential stamps the connection
				// time; clearing the credential clears the stamp with it.
				clean.connectedAt = credentials
					? (prev?.connectedAt ?? Date.now())
					: undefined;
				patch.hitpay = clean;
				// Probe the account (validates the key + learns its enabled payment
				// methods) whenever a credential is stored and the truth is missing
				// or belongs to a replaced key. Post-commit via the scheduler, so
				// the action reads the row this save writes.
				if (credentials && clean.methodsCheckedAt === undefined) {
					await ctx.scheduler.runAfter(
						0,
						internal.hitpay.refreshAccountMethods,
						{ retailerId: retailer._id },
					);
				}
			}
		}
		// Refuse clearing the business address out from under a live radius
		// config or an enabled Lalamove booking (either the existing state or
		// one being set in this same call) — never an enabled-but-unquotable
		// store.
		if (args.businessAddress === null) {
			const effectiveConfig =
				args.deliveryConfig !== undefined
					? patch.deliveryConfig
					: (retailer.deliveryConfig as DeliveryConfig | undefined);
			if (effectiveConfig?.mode === "radius") {
				throw new ConvexError(
					"Distance-based delivery pricing uses this address — switch the delivery charge off (or to a flat fee) first.",
				);
			}
			const effectiveBooking =
				args.deliveryBooking !== undefined
					? patch.deliveryBooking
					: (retailer.deliveryBooking as DeliveryBooking | undefined);
			if (effectiveBooking?.enabled) {
				throw new ConvexError(
					"Lalamove booking sends riders to this address — turn off delivery booking first.",
				);
			}
		}
		if (args.minFulfilmentNoticeDays !== undefined) {
			const n = args.minFulfilmentNoticeDays;
			if (!Number.isInteger(n) || n < 0 || n > MAX_NOTICE_DAYS) {
				throw new ConvexError(
					`Minimum notice must be a whole number between 0 and ${MAX_NOTICE_DAYS} days`,
				);
			}
			patch.minFulfilmentNoticeDays = n;
		}
		if (args.minOrderValue !== undefined) {
			// 0 sanitizes to undefined → the patch removes the field (rule cleared).
			patch.minOrderValue = sanitizeMinOrderValue(args.minOrderValue);
		}
		if (args.openingHours !== undefined) {
			// null and an all-24h week both sanitize to undefined → the patch
			// removes the field (open 24/7 has one spelling).
			try {
				patch.openingHours = sanitizeOpeningHours(args.openingHours);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}

		if (args.awbConfig !== undefined) {
			// null and an all-default object both sanitize to undefined → the
			// patch removes the field (the defaults have one spelling).
			try {
				patch.awbConfig = sanitizeAwbConfig(args.awbConfig);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}

		// Fulfilment invariant: a storefront must always keep at least one WORKING
		// way to receive orders. "Working" ≠ "toggled on": delivery works when
		// offerDelivery (effective) is on; self-collect works only when
		// offerSelfCollect (effective) is on AND ≥1 active pickup location exists.
		// Enforced here (the source of truth) and mirrored as a disabled toggle in
		// the Fulfilment settings UI. Effective reads use the legacy defaults:
		// delivery undefined → true, self-collect undefined → false.
		if (args.offerDelivery !== undefined || args.offerSelfCollect !== undefined) {
			const nextOfferDelivery =
				args.offerDelivery ?? retailer.offerDelivery ?? true;
			const nextOfferSelfCollect =
				args.offerSelfCollect ?? retailer.offerSelfCollect ?? false;
			let selfCollectWorking = false;
			if (nextOfferSelfCollect) {
				const firstActive = await ctx.db
					.query("pickupLocations")
					.withIndex("by_retailer_active", (q) =>
						q.eq("retailerId", retailer._id).eq("isActive", true),
					)
					.first();
				selfCollectWorking = firstActive !== null;
			}
			if (!nextOfferDelivery && !selfCollectWorking) {
				// Tailor the message to what the seller was trying to do so the UI
				// can surface an actionable reason.
				if (args.offerDelivery === false && nextOfferSelfCollect) {
					throw new ConvexError(
						"Add an active pickup location before switching to pickup-only — otherwise your storefront has no way to receive orders.",
					);
				}
				throw new ConvexError(
					"Keep at least one way for buyers to receive orders — turn the other fulfilment method on before disabling this one.",
				);
			}
		}

		// Currency change re-stamps every product with the new code (86eynw27f):
		// products freeze their currency at create and `orders.create` refuses an
		// order-vs-product mismatch, so leaving the catalog on the old code would
		// brick checkout store-wide — the trap the old "existing products keep
		// their original currency" posture set for the first SG store. Amounts are
		// deliberately untouched (RM 12 becomes S$ 12; repricing is the seller's
		// own pass — the settings card says exactly that). Bounded: the product
		// cap holds every store at ≤200 rows, and archived rows sync too so a
		// later restore can't resurrect a mismatched currency.
		let productsCurrencySynced = 0;
		if (
			patch.currency !== undefined &&
			patch.currency !==
				((retailer.currency as SupportedCurrency) ?? DEFAULT_CURRENCY)
		) {
			const products = await ctx.db
				.query("products")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.collect();
			for (const product of products) {
				if (product.currency === patch.currency) continue;
				await ctx.db.patch(product._id, { currency: patch.currency });
				productsCurrencySynced += 1;
			}
		}

		// Pickup points carry their OWN contact (`managerWaPhone`, validated
		// against the store country on every write), so a country switch would
		// leave them holding numbers the same form now refuses — surfacing only
		// on the seller's next edit of that location, the worst place to learn
		// about it. Cleared here rather than BLOCKING the switch the way the
		// store's own numbers do, and the asymmetry is deliberate: `waPhone` is
		// the store's buyer-facing identity, one field, worth stopping for;
		// these are internal operational contacts on N rows (never in the public
		// pickup payload), and refusing a country switch until a seller hand-
		// edits every location would be a chore with no buyer impact. Bounded —
		// pickup points are a short, seller-curated list. Inactive rows are
		// cleared too, so reactivating one later can't resurrect a stale number.
		if (patch.country !== undefined) {
			// A country switch is the ONE moment we know for certain which
			// country the store's existing addresses were captured in: whatever
			// it was until this line ran. Stamp that onto every row that has no
			// stamp yet, and from here on "this address is in the wrong country"
			// is a stored fact rather than a guess (86eyqgujv).
			//
			// Deliberately no backfill for stores that never switch: their
			// addresses match by construction, so an un-stamped row there is
			// correct and must not be flagged. A backfill would also have to
			// guess for the stores that ALREADY switched before this shipped —
			// and would guess wrong in exactly the direction that hides the bug.
			const previousCountry = retailer.country ?? DEFAULT_COUNTRY;
			const carriedAddress = retailer.businessAddress as
				| BusinessAddress
				| undefined;
			if (
				patch.businessAddress === undefined &&
				carriedAddress &&
				carriedAddress.country === undefined
			) {
				patch.businessAddress = {
					...carriedAddress,
					country: previousCountry,
				};
			}
			const locations = await ctx.db
				.query("pickupLocations")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.collect();
			// The manager's number is KEPT, not cleared (86eyqgujv). #210 wiped
			// any that didn't match the new country — reported in the toast, but
			// never chosen, and gone for good on a store with five points and
			// five staff numbers. It is an internal ops contact that breaks
			// nothing by being foreign, so it becomes a checklist row instead.
			for (const location of locations) {
				if (location.country === undefined) {
					await ctx.db.patch(location._id, { country: previousCountry });
				}
			}
		}

		await ctx.db.patch(retailer._id, patch);
		// Encrypt-at-rest (86eyn25gk): a save that stored a plaintext credential
		// schedules the encrypt action (mutations never touch crypto.subtle).
		// Args carry only the id — scheduled args persist in system tables.
		const storedPlaintextCredential = [
			patch.deliveryBooking?.apiKey,
			patch.deliveryBooking?.apiSecret,
			(patch.hitpay as HitpayConfig | undefined)?.apiKey,
			(patch.hitpay as HitpayConfig | undefined)?.salt,
		].some((value) => value !== undefined && !isEncrypted(value));
		if (storedPlaintextCredential) {
			await ctx.scheduler.runAfter(
				0,
				internal.credentials.encryptRetailerCredentials,
				{ retailerId: retailer._id },
			);
		}
		await logAdminAction(ctx, access, "retailers.updateSettings", retailer._id);
		return { ok: true, productsCurrencySynced };
	},
});

/**
 * Re-stamp the signed-in retailer's legal consent to the current document
 * versions. Called by the dashboard re-acceptance banner after a version bump.
 * Like createRetailer, versions are taken server-side (never client-supplied).
 */
export const recordConsentAcceptance = mutation({
	args: {},
	handler: async (ctx): Promise<{ ok: true }> => {
		const userId = await requireUserId(ctx);
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!retailer) throw new ConvexError("No store to update");

		const now = Date.now();
		await ctx.db.patch(retailer._id, {
			termsAcceptedAt: now,
			termsVersion: TERMS_VERSION,
			privacyAcceptedAt: now,
			privacyVersion: PRIVACY_VERSION,
			aupAcceptedAt: now,
			aupVersion: AUP_VERSION,
			updatedAt: now,
		});
		return { ok: true };
	},
});

/**
 * Idempotent: mark the signed-in retailer as having visited the Pickup
 * settings tab at least once. Drives the dashboard checklist's step-4
 * dismissal so a seller who deliberately skips self-collect isn't nagged.
 * No-op if already true.
 */
/**
 * The post-switch setup checklist (86eyqgujv) — what a store still needs to
 * fix after moving country, most costly first.
 *
 * `null` for every store that has never switched, and that is checked BEFORE
 * any other read: `countryChangedAt` is unset on all of them, so this query
 * costs one row lookup and never touches pickupLocations. The checklist is a
 * path almost no store walks and must not tax the ones that don't.
 *
 * Owner-or-admin, and act-as resolves the SELLER's store — an admin doing
 * white-glove setup is looking at the seller's checklist, not their own.
 */
export const countrySetup = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		args,
	): Promise<{
		country: Country;
		changedFrom: Country | undefined;
		changedAt: number;
		items: CountrySetupItem[];
	} | null> => {
		const retailer = args.retailerId
			? (await requireRetailerAccess(ctx, args.retailerId)).retailer
			: await resolveOwnRetailer(ctx);
		if (!retailer) return null;
		if (retailer.countryChangedAt === undefined) return null;

		const locations = await ctx.db
			.query("pickupLocations")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.collect();
		const items = resolveCountrySetup({
			country: retailer.country,
			countryChangedAt: retailer.countryChangedAt,
			acked: retailer.countrySetupAcked,
			businessAddress: retailer.businessAddress,
			pickupLocations: locations.map((l) => ({
				country: l.country,
				managerWaPhone: l.managerWaPhone,
				isActive: l.isActive,
			})),
			deliveryConfigMode: (retailer.deliveryConfig as DeliveryConfig | undefined)
				?.mode,
			deliveryBookingEnabled:
				(retailer.deliveryBooking as DeliveryBooking | undefined)?.enabled ===
				true,
			waPhone: retailer.waPhone,
			notifyWaPhone: retailer.notifyWaPhone,
			hasPaymentMethods: (retailer.paymentMethods?.length ?? 0) > 0,
			hasHitpay: (retailer.hitpay as HitpayConfig | undefined) !== undefined,
			// Seller-authored copy can quote ringgit anywhere in its free text;
			// nothing in the row tells us whether it does.
			hasCustomCopy:
				retailer.messageTemplates !== undefined ||
				retailer.paymentInstructions !== undefined,
		});
		return {
			country: retailer.country ?? DEFAULT_COUNTRY,
			changedFrom: retailer.countryChangedFrom,
			changedAt: retailer.countryChangedAt,
			items,
		};
	},
});

/**
 * Confirm the checklist rows we cannot verify ourselves — "I've checked my
 * bank details / my HitPay account / my message copy."
 *
 * Only UNVERIFIABLE keys are accepted, computed server-side from the current
 * state rather than taken from the caller. That is the whole integrity of the
 * checklist: a stamped wrong-country address is a fact, and no acknowledgement
 * may retire it. Without this filter the "dismiss" button would quietly become
 * a way to hide a real fault, which is how checklists become noise sellers
 * learn to click past.
 */
export const ackCountrySetup = mutation({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, args): Promise<{ acked: number }> => {
		// `access` is kept, not destructured away: an admin acting as a seller
		// can retire that seller's payments-at-risk rows, and there is no un-ack
		// short of another country switch — so the write has to be traceable, and
		// "the seller confirmed their bank details" must not be indistinguishable
		// from "an admin clicked through during white-glove setup" (PR #221
		// review). `logAdminAction` no-ops on an owner write, so the own-store
		// path below needs no equivalent.
		const access = args.retailerId
			? await requireRetailerAccess(ctx, args.retailerId)
			: null;
		const retailer = access ? access.retailer : await resolveOwnRetailer(ctx);
		if (!retailer || retailer.countryChangedAt === undefined) {
			return { acked: 0 };
		}
		const locations = await ctx.db
			.query("pickupLocations")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.collect();
		const items = resolveCountrySetup({
			country: retailer.country,
			countryChangedAt: retailer.countryChangedAt,
			acked: undefined,
			businessAddress: retailer.businessAddress,
			pickupLocations: locations.map((l) => ({
				country: l.country,
				managerWaPhone: l.managerWaPhone,
				isActive: l.isActive,
			})),
			deliveryConfigMode: (retailer.deliveryConfig as DeliveryConfig | undefined)
				?.mode,
			deliveryBookingEnabled:
				(retailer.deliveryBooking as DeliveryBooking | undefined)?.enabled ===
				true,
			waPhone: retailer.waPhone,
			notifyWaPhone: retailer.notifyWaPhone,
			hasPaymentMethods: (retailer.paymentMethods?.length ?? 0) > 0,
			hasHitpay: (retailer.hitpay as HitpayConfig | undefined) !== undefined,
			hasCustomCopy:
				retailer.messageTemplates !== undefined ||
				retailer.paymentInstructions !== undefined,
		});
		const keys = ackableKeys(items);
		if (keys.length === 0) return { acked: 0 };
		const merged = Array.from(
			new Set([...(retailer.countrySetupAcked ?? []), ...keys]),
		);
		await ctx.db.patch(retailer._id, {
			countrySetupAcked: merged,
			updatedAt: Date.now(),
		});
		if (access) {
			await logAdminAction(
				ctx,
				access,
				"retailers.ackCountrySetup",
				retailer._id,
			);
		}
		return { acked: keys.length };
	},
});

export const markPickupSetupSeen = mutation({
	args: {},
	handler: async (ctx): Promise<{ updated: boolean }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { updated: false };
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return { updated: false };
		if (retailer.pickupSetupSeen === true) return { updated: false };
		await ctx.db.patch(retailer._id, {
			pickupSetupSeen: true,
			updatedAt: Date.now(),
		});
		return { updated: true };
	},
});

/**
 * Mark the optional "WhatsApp Business greeting message" onboarding step as
 * done. Called by the dashboard setup checklist for both "Mark as done" and
 * "Skip for now" — either way the step is persisted as complete so it collapses
 * across sessions and the checklist can reach all-done. No-op aside from the
 * flag: the greeting itself is configured by the seller in the WhatsApp app.
 */
export const markGreetingSetupDone = mutation({
	args: {},
	handler: async (ctx): Promise<{ ok: true }> => {
		const userId = await requireUserId(ctx);
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!retailer) throw new ConvexError("No store to update");

		await ctx.db.patch(retailer._id, {
			onboardingGreetingSetup: true,
			updatedAt: Date.now(),
		});
		return { ok: true };
	},
});

/**
 * Stamp `linkSharedAt` the first time the seller shares their storefront link
 * from the dashboard checklist (copy link or open QR). A soft activation proxy —
 * we can't detect a real share, so this never blocks anything; it only flips the
 * checklist's "Share your store link" step to done and advances the activation
 * funnel. One-time set-if-unset, mirroring markPickupSetupSeen.
 */
export const markLinkShared = mutation({
	args: {},
	handler: async (ctx): Promise<{ updated: boolean }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { updated: false };
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return { updated: false };
		if (retailer.linkSharedAt !== undefined) return { updated: false };
		await ctx.db.patch(retailer._id, {
			linkSharedAt: Date.now(),
			updatedAt: Date.now(),
		});
		return { updated: true };
	},
});

/**
 * Idempotent self-heal: if the signed-in user's retailer has no notifyEmail
 * yet, copy it from the Clerk identity email. Called once from the dashboard
 * on first load so retailers created before notifyEmail existed get
 * auto-populated without manual settings work.
 *
 * Returns whether a backfill happened so the caller can avoid re-firing.
 */
export const ensureNotifyEmailFromIdentity = mutation({
	args: {},
	handler: async (ctx): Promise<{ updated: boolean }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { updated: false };
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return { updated: false };
		if (retailer.notifyEmail && retailer.notifyEmail.trim().length > 0) {
			return { updated: false };
		}
		const identityEmail =
			typeof identity.email === "string" ? identity.email : undefined;
		if (!identityEmail || identityEmail.trim().length === 0) {
			return { updated: false };
		}
		let normalized: string;
		try {
			normalized = assertValidEmail(identityEmail);
		} catch {
			return { updated: false };
		}
		await ctx.db.patch(retailer._id, {
			notifyEmail: normalized,
			updatedAt: Date.now(),
		});
		return { updated: true };
	},
});

/**
 * Rename the signed-in user's slug. Old slug is parked in `slugHistory` for
 * 90 days so previously shared WhatsApp links 301-redirect to the new slug.
 * Owner-reclaim: if the new slug is one of this retailer's own historical
 * slugs, the history row is deleted so the link chain terminates cleanly.
 */
export const renameSlug = mutation({
	// Admin act-as: `retailerId` set → an admin renames THAT store's public URL
	// during white-glove; omitted → the caller renames their own. See docs/admin-console.md.
	args: { newSlug: v.string(), retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { newSlug, retailerId }): Promise<{ slug: string }> => {
		let slug: string;
		try { slug = assertValidSlug(newSlug); } catch (err) { throw new ConvexError((err as Error).message); }

		let retailer: Doc<"retailers">;
		let access: RetailerAccess;
		if (retailerId) {
			access = await requireRetailerAccess(ctx, retailerId);
			retailer = access.retailer;
		} else {
			const userId = await requireUserId(ctx);
			const own = await ctx.db
				.query("retailers")
				.withIndex("by_user", (q) => q.eq("userId", userId))
				.first();
			if (!own) throw new ConvexError("No store to rename");
			retailer = own;
			access = { retailer: own, actingAsAdmin: false, userId };
		}
		// Soft-lock: a past_due seller can't rename their public URL (growth-write,
		// same class as updateSettings). Admin act-as bypasses — white-glove
		// happens before the seller has paid. See docs/manual-subscription.md.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, retailer._id);

		if (retailer.slug === slug) return { slug }; // no-op

		const collision = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		if (collision && collision._id !== retailer._id) {
			throw new ConvexError("That slug is taken");
		}

		const historyRow = await ctx.db
			.query("slugHistory")
			.withIndex("by_old_slug", (q) => q.eq("oldSlug", slug))
			.first();
		if (historyRow) {
			const historyOwner = await ctx.db.get(historyRow.retailerId);
			if (!historyOwner || historyOwner._id !== retailer._id) {
				if (historyRow.expiresAt > Date.now()) {
					throw new ConvexError("That slug is temporarily reserved");
				}
				await ctx.db.delete(historyRow._id);
			} else {
				// Owner reclaim — remove stale history row.
				await ctx.db.delete(historyRow._id);
			}
		}

		const now = Date.now();
		await ctx.db.insert("slugHistory", {
			oldSlug: retailer.slug,
			retailerId: retailer._id,
			expiresAt: now + SLUG_HISTORY_TTL_MS,
		});
		await ctx.db.patch(retailer._id, { slug, updatedAt: now });

		await logAdminAction(ctx, access, "retailers.renameSlug", retailer._id);
		return { slug };
	},
});

/**
 * Generate a one-shot upload URL for the retailer's store logo.
 * The frontend POSTs the file here, then stores the returned `storageId`
 * via `updateSettings({ logoStorageId })`.
 */
export const generateLogoUploadUrl = mutation({
	args: {},
	handler: async (ctx): Promise<string> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		return ctx.storage.generateUploadUrl();
	},
});

/**
 * Generate a one-shot upload URL for the retailer's store cover/banner image.
 * The frontend POSTs the file here, then stores the returned `storageId`
 * via `updateSettings({ coverImageStorageId })`.
 */
export const generateCoverImageUploadUrl = mutation({
	args: {},
	handler: async (ctx): Promise<string> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		return ctx.storage.generateUploadUrl();
	},
});

/**
 * Generate a one-shot upload URL for a payment-method QR image. The frontend
 * POSTs the file here, then stores the returned `storageId` on a `qr` method and
 * saves the array via `updateSettings({ paymentMethods })`.
 */
export const generatePaymentQrUploadUrl = mutation({
	args: {},
	handler: async (ctx): Promise<string> => {
		const userId = await requireUserId(ctx);
		await rateLimiter.limit(ctx, "productWrite", { key: userId, throws: true });
		return ctx.storage.generateUploadUrl();
	},
});

/**
 * One-time backfill: migrate retailers from the legacy single
 * `paymentInstructions` object to the `paymentMethods` array, then clear the
 * legacy field. Idempotent — skips rows already on `paymentMethods` or with no
 * legacy data. Run in dev:  npx convex run retailers:backfillPaymentMethods
 */
export const backfillPaymentMethods = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ migrated: number; skipped: number }> => {
		const rows = await ctx.db.query("retailers").collect();
		let migrated = 0;
		let skipped = 0;
		for (const row of rows) {
			// Already migrated, or nothing to migrate.
			if (row.paymentMethods && row.paymentMethods.length > 0) {
				skipped++;
				continue;
			}
			const methods = resolvePaymentMethods(row); // legacy-derived here
			if (methods.length === 0) {
				skipped++;
				continue;
			}
			await ctx.db.patch(row._id, {
				paymentMethods: methods,
				paymentInstructions: undefined,
				updatedAt: Date.now(),
			});
			migrated++;
		}
		return { migrated, skipped };
	},
});

/**
 * Daily cron entry point. Deletes `slugHistory` rows whose TTL has elapsed.
 */
/**
 * Public query returning all active retailer slugs and their last-modified
 * timestamp — used to generate /sitemap.xml.
 */
export const listSlugsForSitemap = query({
	args: {},
	handler: async (ctx): Promise<Array<{ slug: string; updatedAt: number }>> => {
		const rows = await ctx.db.query("retailers").collect();
		return rows.map((r) => ({ slug: r.slug, updatedAt: r._creationTime }));
	},
});

export const internalPurgeExpiredSlugHistory = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const rows = await ctx.db.query("slugHistory").collect();
		let purged = 0;
		for (const row of rows) {
			if (row.expiresAt <= now) {
				await ctx.db.delete(row._id);
				purged += 1;
			}
		}
		return { purged };
	},
});

type DeleteUserResult =
	| { deleted: false }
	| {
			deleted: true;
			retailerId: Id<"retailers">;
			/** False ⇒ a continuation batch was scheduled — watch the logs. */
			done: boolean;
			/** Where the cascade is (the phase this invocation left off in). */
			phase: DeletionPhase;
			/** Documents processed by THIS invocation, not a running total. */
			processed: number;
	  };

/** Rows processed per invocation before handing off to a scheduled
 * continuation — sized so even the heaviest phase (orders: events + blobs per
 * row) stays far inside the single-mutation read/write limits. */
const DELETE_USER_BATCH = 25;

/**
 * Hard-delete a user and every tenant artifact they own, keyed by Clerk
 * subject (`userId`) — the PDPA erasure path (86eyetzbk). Paginated and
 * SELF-CHAINING: each invocation processes a bounded batch (~25 rows) and
 * schedules itself via `ctx.scheduler` until every phase completes, so a large
 * tenant can no longer exceed single-mutation transaction limits (the old
 * one-shot ACID version failed outright on big stores). Invoke it ONCE with
 * just `{ userId }` — `phase`/`cursor` are internal continuation state, never
 * passed by hand. Progress is logged per phase (counts + ids only, never
 * phone numbers or message bodies).
 *
 * Sweeps, in order (see DELETION_PHASES in convex/lib/accountDeletion.ts):
 * orders (+ events + buyer image / payment proof / mockup blobs via the shared
 * `orderBlobs` helper), products (shared `deleteProductCascade`: variants +
 * images + junctions), leftover junctions, categories (+ tile blobs),
 * deliveryJobs (+ POD blobs), deliveryQuotes, customers, pickupLocations
 * (manager name/phone), counterCheckoutSessions (buyer phone/pushname),
 * subscriptions, subscriptionUsage, foundingMembers, retailerSendingLimits,
 * outboundMessageLog (buyer phones), slugHistory, then optOuts attribution,
 * and finally the retailer's own blobs + row.
 *
 * RETAINED BY DECISION (not omissions): `invoices` rows + their frozen PDF
 * blobs (financial records of what Kedaipal charged the seller — no buyer
 * PII) and `adminAuditLog` rows (an audit trail must outlive the tenant it
 * audited). `optOuts` rows are the buyer's GLOBAL suppression instruction and
 * are never deleted — only their `triggeredByRetailerId` attribution is
 * cleared. Rationale lives in convex/lib/accountDeletion.ts + the doc below.
 *
 * The retailer row is deleted in the FINAL phase, so every continuation batch
 * can re-resolve the tenant by userId; each phase is idempotent, so re-running
 * a batch after a crash just resumes. Because the cascade now spans multiple
 * transactions it is no longer all-or-nothing — invoke it once the tenant is
 * inactive (a row created mid-cascade by a still-live storefront could survive
 * as an orphan).
 *
 * Internal-only: no shopper/retailer-facing path. Invoked manually from the
 * Convex dashboard today; wiring an automatic trigger (Clerk `user.deleted`
 * webhook) is ticket 86eydwct5's scope, not this function's.
 *
 * Idempotent — returns `{ deleted: false }` when the user has no retailer.
 * See docs/account-deletion.md.
 */
export const deleteUser = internalMutation({
	args: {
		userId: v.string(),
		// Continuation state for the self-chaining batches — internal only.
		phase: v.optional(deletionPhaseValidator),
		cursor: v.optional(v.union(v.string(), v.null())),
	},
	handler: async (ctx, args): Promise<DeleteUserResult> => {
		const { userId } = args;
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!retailer) return { deleted: false };

		let phase: DeletionPhase = args.phase ?? DELETION_PHASES[0];
		let cursor: string | null = args.cursor ?? null;
		let budget = DELETE_USER_BATCH;
		let processedTotal = 0;

		while (true) {
			const result = await runDeletionPhase(ctx, retailer, phase, budget, cursor);
			processedTotal += result.processed;
			budget -= result.processed;
			console.log(
				`deleteUser[${retailer._id}] phase=${phase} processed=${result.processed}${result.done ? " (phase complete)" : ""}`,
			);
			if (!result.done) {
				// More rows in this phase — hand the position to a continuation.
				await ctx.scheduler.runAfter(0, internal.retailers.deleteUser, {
					userId,
					phase,
					cursor: result.cursor ?? null,
				});
				return {
					deleted: true,
					retailerId: retailer._id,
					done: false,
					phase,
					processed: processedTotal,
				};
			}
			const next = DELETION_PHASES[DELETION_PHASES.indexOf(phase) + 1];
			if (next === undefined) break; // the final `retailer` phase just ran
			phase = next;
			cursor = null;
			if (budget <= 0) {
				await ctx.scheduler.runAfter(0, internal.retailers.deleteUser, {
					userId,
					phase,
				});
				return {
					deleted: true,
					retailerId: retailer._id,
					done: false,
					phase,
					processed: processedTotal,
				};
			}
		}

		console.log(`deleteUser[${retailer._id}] tenant fully erased`);
		return {
			deleted: true,
			retailerId: retailer._id,
			done: true,
			phase,
			processed: processedTotal,
		};
	},
});
