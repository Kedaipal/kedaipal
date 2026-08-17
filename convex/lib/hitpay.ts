/**
 * HitPay buyer-payments integration — pure module (86eyb6z3a).
 *
 * The seller connects their OWN HitPay account (BYO credentials, the
 * `deliveryBooking` Lalamove posture): `retailers.hitpay.{apiKey,salt}` is the
 * sole credential source — Kedaipal has no merchant account in the money path
 * and never touches order funds. Payment requests are minted LAZILY when the
 * buyer taps "Pay now" on the order page (never at order create), so a request
 * always carries the CURRENT total and held orders (mockup / delivery-fee
 * pending) can't be paid early. The completion webhook + the redirect-return
 * reconcile both funnel into one internal receive mutation.
 *
 * Kept free of Convex imports so server, client, and tests share one source of
 * truth (the minOrderRules pattern).
 *
 * Verified against a real sandbox account (7 Aug 2026):
 *  - sandbox keys are `test_`-prefixed → mode is inferred from the key, the
 *    Lalamove `pk_test_` trick (a bare production-looking key sent to the
 *    production host simply 401s, surfaced at connect time);
 *  - MYR requests work in sandbox; MY methods (duitnow / touch_n_go) resolve
 *    from the account's enabled methods when `payment_methods` is omitted;
 *  - the redirect back to `redirect_url` appends `?status=…&reference=<request id>`;
 *  - the v1 completion webhook is form-encoded with an `hmac` field: sort the
 *    non-hmac fields by key, concatenate `key+value`, HMAC-SHA256 with the
 *    API-key salt (the value shown beside the API key in the dashboard).
 */

import { decryptSecret } from "./credentialCrypto";
import type { OrderPaymentMethod } from "./paymentMethod";

export type HitpayMode = "sandbox" | "production";

export const HITPAY_API_BASE: Record<HitpayMode, string> = {
	sandbox: "https://api.sandbox.hit-pay.com/v1",
	production: "https://api.hit-pay.com/v1",
};

/** Stored connection shape on `retailers.hitpay` (server-only fields).
 * `apiKey`/`salt` are encrypted at rest (86eyn25gk, `enc.v1.` prefix) once
 * `CREDENTIALS_ENCRYPTION_KEY` is set; legacy rows may still hold plaintext
 * until the one-shot backfill runs. */
export type HitpayConfig = {
	enabled: boolean;
	apiKey?: string;
	salt?: string;
	/** Last 4 chars of the PLAINTEXT key, stamped at save — queries can't
	 * derive it once the stored value is ciphertext. */
	apiKeyHint?: string;
	/** Sandbox/production, stamped at save from the plaintext key prefix —
	 * same reason as apiKeyHint. */
	mode?: HitpayMode;
	connectedAt?: number;
	/** The account's enabled rails as HitPay resolves them for this key —
	 * probed at connect, refreshed on every checkout mint (see schema note). */
	paymentMethods?: string[];
	methodsCheckedAt?: number;
};

export type HitpayCredentials = {
	apiKey: string;
	salt: string;
	mode: HitpayMode;
};

/** Sandbox keys are `test_`-prefixed (verified against a live sandbox key).
 * Anything else is treated as production — a wrong guess just 401s against
 * the production host and surfaces as "check your key" at connect time. */
export function inferHitpayMode(apiKey: string): HitpayMode {
	return apiKey.startsWith("test_") ? "sandbox" : "production";
}

/** Both halves of the credential or nothing — half a credential can neither
 * create requests nor verify webhooks. Mirrors resolveLalamoveCredentials.
 *
 * PRESENCE checks only in queries/mutations: the stored values may be
 * ciphertext (86eyn25gk), so `apiKey`/`salt`/`mode` here are NOT usable
 * against HitPay — actions must go through `decryptHitpayCredentials`, which
 * re-infers `mode` from the plaintext (a ciphertext never starts with
 * `test_`, so trusting this mode would point sandbox keys at production). */
export function resolveHitpayCredentials(
	config: Pick<HitpayConfig, "apiKey" | "salt"> | undefined,
): HitpayCredentials | null {
	const apiKey = config?.apiKey?.trim();
	const salt = config?.salt?.trim();
	if (!apiKey || !salt) return null;
	return { apiKey, salt, mode: inferHitpayMode(apiKey) };
}

/** Decrypt-at-use (86eyn25gk): the ONLY credential shape safe to send to
 * HitPay. Call inside actions/httpActions right before the fetch — plaintext
 * legacy rows pass through unchanged. */
export async function decryptHitpayCredentials(
	credentials: HitpayCredentials,
): Promise<HitpayCredentials> {
	const apiKey = await decryptSecret(credentials.apiKey);
	const salt = await decryptSecret(credentials.salt);
	return { apiKey, salt, mode: inferHitpayMode(apiKey) };
}

/** Whether the store's buyers should see "Pay now" at all: the seller turned
 * the feature on AND a full credential is stored. */
export function hitpayCheckoutConfigured(
	config: HitpayConfig | undefined,
): boolean {
	return config?.enabled === true && resolveHitpayCredentials(config) !== null;
}

/** HitPay's documented minimum request amount (0.30 in major units). */
export const HITPAY_MIN_AMOUNT_SEN = 30;

/** Requests are minted with a fixed expiry so an abandoned link dies on its
 * own, and reused while fresh so two open tabs can't hold two live requests
 * for the same amount. Reuse window < expiry leaves a small tail where a
 * buyer could load a nearly-expired page — HitPay refuses payment on an
 * expired request, so the failure mode is their "link expired" screen, not a
 * stray charge. */
// "60 mins", not "1 hour" — the API 422s on the singular-unit form
// (verified against the live sandbox: "The expires after format is invalid").
export const HITPAY_REQUEST_EXPIRES_AFTER = "60 mins";
export const HITPAY_REQUEST_REUSE_MS = 55 * 60 * 1000;

/** Minor units (sen) → HitPay's decimal string ("1250" sen → "12.50"). */
export function senToDecimalString(sen: number): string {
	return (Math.round(sen) / 100).toFixed(2);
}

/** HitPay's decimal amount string → minor units, or null when malformed.
 * String arithmetic (not parseFloat) so "0.29" can never round oddly. */
export function decimalStringToSen(value: string): number | null {
	const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
	if (!m) return null;
	const whole = Number.parseInt(m[1], 10);
	const frac = m[2] ? Number.parseInt(m[2].padEnd(2, "0"), 10) : 0;
	if (!Number.isSafeInteger(whole)) return null;
	return whole * 100 + frac;
}

/**
 * Map HitPay's `payment_type` onto the order's settled-method tag so gateway
 * orders feed the inbox Method filter + the Insights donut with real values
 * instead of "Online / other". Unknown codes (new wallets HitPay adds later)
 * degrade to "other" — never undefined, since a gateway settlement IS a known
 * settlement event.
 */
export function mapHitpayPaymentType(
	paymentType: string | undefined,
): OrderPaymentMethod | undefined {
	if (!paymentType) return undefined;
	switch (paymentType.toLowerCase()) {
		case "duitnow":
			return "duitnow";
		case "touch_n_go":
			return "tng";
		case "fpx":
			return "fpx";
		case "card":
		case "cards":
			return "card";
		default:
			// paynow_online (sandbox SG), grabpay, shopee_pay, boost, atome, …
			return "other";
	}
}

/** Buyer-friendly names for HitPay's method codes — used to NAME rails in
 * buyer-facing copy, strictly from the account's probed list (never a
 * hardcoded promise). Codes we can't name are simply not named; they still
 * work end-to-end (the checkout page itself is HitPay's). */
const METHOD_DISPLAY_NAMES: Record<string, string> = {
	touch_n_go: "Touch 'n Go",
	duitnow: "DuitNow",
	fpx: "FPX",
	card: "card",
	grabpay: "GrabPay",
	grabpay_direct: "GrabPay",
	shopee_pay: "ShopeePay",
	boost: "Boost",
	atome: "Atome",
	paynow_online: "PayNow",
};

/**
 * "Touch 'n Go, DuitNow or FPX"-style phrase from the account's enabled
 * method codes; null when nothing nameable is known (callers fall back to a
 * generic "bank or eWallet app" line). Caps at four names so the sentence
 * stays a sentence.
 */
export function describeGatewayMethods(
	codes: string[] | undefined,
): string | null {
	if (!codes || codes.length === 0) return null;
	const names = [
		...new Set(
			codes
				.map((c) => METHOD_DISPLAY_NAMES[c.toLowerCase()])
				.filter((n): n is string => n !== undefined),
		),
	];
	if (names.length === 0) return null;
	if (names.length === 1) return names[0];
	if (names.length > 4) return `${names.slice(0, 3).join(", ")} and more`;
	return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** Inputs for a payment-request create call — everything order-derived so the
 * builder stays a pure, testable mapping. */
export type PaymentRequestInputs = {
	amountSen: number;
	currency: string;
	shortId: string;
	storeName: string;
	/** Absolute URL the buyer returns to (HitPay appends ?status&reference). */
	redirectUrl: string;
	/** Absolute URL for the v1 completion webhook. */
	webhookUrl: string;
	buyerName?: string;
	buyerPhone?: string;
};

const HITPAY_PURPOSE_MAX = 255;

/**
 * Form body for POST /v1/payment-requests. `send_sms` DEFAULTS TO TRUE on
 * HitPay's side — it must be explicitly off or buyers get a surprise HitPay
 * SMS beside our WhatsApp confirmation. Email intentionally omitted: we never
 * collect buyer emails, and passing a fabricated one would route HitPay's
 * receipt/refund comms into a void.
 */
export function buildPaymentRequestParams(
	inputs: PaymentRequestInputs,
): URLSearchParams {
	const params = new URLSearchParams();
	params.set("amount", senToDecimalString(inputs.amountSen));
	params.set("currency", inputs.currency.toUpperCase());
	params.set(
		"purpose",
		`Order ${inputs.shortId} — ${inputs.storeName}`.slice(0, HITPAY_PURPOSE_MAX),
	);
	params.set("reference_number", inputs.shortId);
	params.set("redirect_url", inputs.redirectUrl);
	params.set("webhook", inputs.webhookUrl);
	params.set("send_sms", "false");
	params.set("send_email", "false");
	params.set("expires_after", HITPAY_REQUEST_EXPIRES_AFTER);
	if (inputs.buyerName) params.set("name", inputs.buyerName);
	if (inputs.buyerPhone) params.set("phone", inputs.buyerPhone);
	return params;
}

/** Response subset we rely on from create / status calls. */
export type HitpayPaymentRequest = {
	id: string;
	url: string;
	status: string;
	amount: string;
	currency: string;
	/** The ACCOUNT's enabled methods, resolved by HitPay when the request
	 * omits `payment_methods` — our source of truth for the honest chips. */
	payment_methods?: string[];
	payments?: Array<{
		id: string;
		status: string;
		payment_type?: string;
		amount: string;
		currency: string;
	}>;
};

/**
 * v1 webhook HMAC: exclude `hmac`, sort remaining keys ascending, concatenate
 * `key+value` pairs, HMAC-SHA256 hex with the API-key salt. Web Crypto (edge
 * runtime — same reasoning as whatsappSignature.ts, which verifies a
 * different scheme: raw-body HMAC vs this field-concat one).
 */
export async function computeHitpayHmac(
	fields: Record<string, string>,
	salt: string,
): Promise<string> {
	const source = Object.keys(fields)
		.filter((k) => k !== "hmac")
		.sort()
		.map((k) => `${k}${fields[k]}`)
		.join("");
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(salt),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(source),
	);
	return [...new Uint8Array(signature)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Verify a v1 webhook's `hmac` field. Returns false (never throws) on any
 * missing input so the route can simply reject. */
export async function verifyHitpayWebhook(
	fields: Record<string, string>,
	salt: string,
): Promise<boolean> {
	const provided = fields.hmac;
	if (!provided || !salt) return false;
	const expected = await computeHitpayHmac(fields, salt);
	return timingSafeEqual(provided.toLowerCase(), expected);
}

/** Constant-time compare (same shape as whatsappSignature.ts — hex digests
 * are fixed-length, so length short-circuit leaks nothing). */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}
