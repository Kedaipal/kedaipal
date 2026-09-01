/**
 * HitPay for KEDAIPAL'S OWN account — subscription billing (86eyb6z4r).
 *
 * Deliberately a SEPARATE module from lib/hitpay.ts: that one is the seller's
 * BYO merchant account moving BUYER money (credentials on `retailers.hitpay`),
 * this one is Kedaipal Pte Ltd's account collecting SUBSCRIPTION money
 * (credentials in the deployment env — a platform secret must never live in a
 * table any retailer query can read, see billing.paymentInstructions).
 *
 * Two rails, both against the same account:
 *  - AUTO-RENEWAL: a recurring-billing session with `save_payment_method=true`
 *    tokenises the seller's card / Touch 'n Go wallet once; each renewal is a
 *    merchant-initiated POST /charge/recurring-billing/{id} for the INVOICE
 *    total (never a cached plan amount — founding discounts + plan changes
 *    make a fixed HitPay plan wrong). The charge response is synchronous
 *    (`status: "succeeded"`), which is the primary settle/failure signal;
 *    HitPay ships no charge-failure webhook.
 *  - PAY-NOW: a one-off payment request per invoice (same POST
 *    /payment-requests as the buyer gateway) so the manual-rail seller pays in
 *    two taps instead of bank-transfer + WhatsApp. No expiry — the link lives
 *    in emails.
 *
 * Webhooks: the account's dashboard-registered V2 events (charge.created,
 * recurring_billing.method_attached/…) arrive as JSON with an
 * `Hitpay-Signature` header — HMAC-SHA256 over the RAW BODY with the account
 * salt. That is a DIFFERENT scheme from the v1 form-encoded `hmac` field the
 * buyer gateway verifies; /webhook/hitpay branches on the header. Pure module
 * (no Convex imports) — the minOrderRules pattern.
 */

import type { BillingCurrency } from "./plans";
import {
	type HitpayMode,
	inferHitpayMode,
	senToDecimalString,
	timingSafeEqual,
} from "./hitpay";

export type BillingGatewayCredentials = {
	apiKey: string;
	salt: string;
	mode: HitpayMode;
};

/**
 * Kedaipal's own HitPay credentials, from the deployment env. Both halves or
 * nothing (half a credential can neither mint nor verify). Absent ⇒ every
 * gateway affordance quietly stays off and manual billing works exactly as
 * before — the fail-open-to-manual posture.
 *
 * Env (Convex deployment, never the repo): HITPAY_BILLING_API_KEY +
 * HITPAY_BILLING_SALT. Sandbox keys are `test_`-prefixed; mode is inferred
 * from the key exactly like the seller BYO path.
 */
export function resolveBillingGatewayCredentials(env: {
	HITPAY_BILLING_API_KEY?: string;
	HITPAY_BILLING_SALT?: string;
}): BillingGatewayCredentials | null {
	const apiKey = env.HITPAY_BILLING_API_KEY?.trim();
	const salt = env.HITPAY_BILLING_SALT?.trim();
	if (!apiKey || !salt) return null;
	return { apiKey, salt, mode: inferHitpayMode(apiKey) };
}

/**
 * Methods offered on the auto-renewal authorisation page, per billing
 * currency. Only TOKENISABLE rails belong here — FPX and DuitNow are push-only
 * and can never appear (the ticket's hard constraint). MYR gets Touch 'n Go
 * beside card (the cheapest rail, ≈2.9% vs ≈7.7%); SGD is card-only (PayNow
 * can't be tokenised). Whether the live account actually offers `touch_n_go`
 * cross-border is account config — HitPay's page shows what's real, and the
 * create call degrades to card-only on a 422 (see subscriptionPayments.ts).
 */
export const AUTO_RENEW_METHODS: Record<BillingCurrency, string[]> = {
	MYR: ["card", "touch_n_go"],
	SGD: ["card"],
};

/** Seller-facing names for the method codes an attach event can carry. Codes
 * we can't name degrade to a generic label — never undefined, since an
 * attached method IS a known state. */
const AUTO_RENEW_METHOD_LABELS: Record<string, string> = {
	card: "Card",
	touch_n_go: "Touch 'n Go",
	grabpay_direct: "GrabPay",
	shopee_pay: "ShopeePay",
	giro: "GIRO",
};

export function autoRenewMethodLabel(code: string | undefined): string {
	if (!code) return "Saved payment method";
	return AUTO_RENEW_METHOD_LABELS[code.toLowerCase()] ?? "Saved payment method";
}

/** `paymentMethod` tag stamped on an invoice settled through the gateway —
 * "hitpay_card" / "hitpay_touch_n_go", or bare "hitpay" when the rail is
 * unknown (the v1 completion webhook carries none). */
export function gatewayPaymentMethodTag(methodCode: string | undefined): string {
	const code = methodCode?.trim().toLowerCase();
	return code ? `hitpay_${code}` : "hitpay";
}

/**
 * HitPay caps a save-payment-method session's charges via
 * `times_to_be_charged` (1–100, DEFAULT 1 — the default would kill the second
 * renewal). 100 is the documented max ≈ 8 years of monthly charges; when a
 * session runs out the charge fails and normal dunning walks the seller
 * through re-authorising. Verified against the API reference, re-verify in
 * sandbox (the docs are ambiguous about whether save_card mode consumes it).
 */
export const AUTO_RENEW_TIMES_TO_BE_CHARGED = 100;

/**
 * Kedaipal-owned retry schedule after a failed auto-charge (HitPay's own
 * 7-day retry belongs to its scheduled-plan mode, which we don't use).
 * Attempt 1 fires at period end; each entry is the wait AFTER failure N.
 * Total window (0d, +2d, +5d) sits inside the 14-day invoice grace, so
 * dunning always resolves — paid, or on the manual rail — before the overdue
 * lock. TnG wallets run dry more than cards (auto-reload died 13 May 2026),
 * so the gaps assume "seller tops up on payday", not "retry hourly".
 */
export const AUTO_CHARGE_RETRY_DELAYS_MS = [
	2 * 24 * 60 * 60 * 1000,
	3 * 24 * 60 * 60 * 1000,
];

/** Total attempts = 1 initial + the retries above. */
export const AUTO_CHARGE_MAX_ATTEMPTS = AUTO_CHARGE_RETRY_DELAYS_MS.length + 1;

/** When the next retry should fire after failure number `failedAttempts`
 * (1-based), or null when dunning is exhausted and the seller is on the
 * manual rail (invoice + Pay-now link + overdue lock at due date). */
export function nextChargeRetryAt(
	failedAttempts: number,
	now: number,
): number | null {
	const delay = AUTO_CHARGE_RETRY_DELAYS_MS[failedAttempts - 1];
	return delay === undefined ? null : now + delay;
}

/**
 * An attempt stamped this recently with NO recorded outcome means the action
 * may have died between charging and settling — reconcile against HitPay's
 * `times_charged` before charging again. Longer than any plausible action
 * retry latency, shorter than the daily cron cadence.
 */
export const CHARGE_OUTCOME_UNKNOWN_WINDOW_MS = 24 * 60 * 60 * 1000;

// --- Request builders -------------------------------------------------------

const PURPOSE_MAX = 255;

export type AutoRenewSessionInputs = {
	planLabel: string; // "Pro · Monthly" — shown on HitPay's page
	storeName: string;
	customerEmail: string; // REQUIRED by HitPay
	customerName?: string;
	/** Display-only on the authorisation page (the seller's current price);
	 * actual charges always pass the invoice total. */
	amountSen: number;
	currency: BillingCurrency;
	redirectUrl: string;
	/** Our correlation handle — the subscription id. */
	reference: string;
	paymentMethods: string[];
};

/** Form body for POST /v1/recurring-billing with save_payment_method=true. */
export function buildAutoRenewSessionParams(
	inputs: AutoRenewSessionInputs,
): URLSearchParams {
	const params = new URLSearchParams();
	params.set(
		"name",
		`Kedaipal ${inputs.planLabel} — ${inputs.storeName}`.slice(0, PURPOSE_MAX),
	);
	params.set("description", "Kedaipal subscription auto-renewal");
	params.set("save_payment_method", "true");
	params.set("customer_email", inputs.customerEmail);
	if (inputs.customerName) params.set("customer_name", inputs.customerName);
	params.set("amount", senToDecimalString(inputs.amountSen));
	params.set("currency", inputs.currency.toUpperCase());
	for (const method of inputs.paymentMethods) {
		params.append("payment_methods[]", method);
	}
	params.set("times_to_be_charged", String(AUTO_RENEW_TIMES_TO_BE_CHARGED));
	params.set("redirect_url", inputs.redirectUrl);
	params.set("reference", inputs.reference);
	// HitPay's own receipts stay off — Kedaipal sends the charge receipt
	// (notifyPaymentReceived), one voice per event.
	params.set("send_email", "false");
	return params;
}

export type InvoicePaymentRequestInputs = {
	invoiceNumber: string;
	storeName: string;
	amountSen: number;
	currency: string;
	redirectUrl: string;
	/** Absolute URL for the v1 completion webhook ("" omits it). */
	webhookUrl: string;
	customerEmail?: string;
};

/**
 * Form body for the invoice Pay-now request. Differences from the buyer-order
 * builder (lib/hitpay.ts) are deliberate:
 *  - NO `expires_after`: this link lives in issue/reminder emails and must
 *    stay payable for the whole grace window (it dies via DELETE on
 *    void/manual-settle instead);
 *  - sellers DO have an email (unlike buyers), so HitPay can send its receipt
 *    to a real inbox — still off by default to keep one voice per event.
 */
export function buildInvoicePaymentRequestParams(
	inputs: InvoicePaymentRequestInputs,
): URLSearchParams {
	const params = new URLSearchParams();
	params.set("amount", senToDecimalString(inputs.amountSen));
	params.set("currency", inputs.currency.toUpperCase());
	params.set(
		"purpose",
		`Kedaipal subscription ${inputs.invoiceNumber} — ${inputs.storeName}`.slice(
			0,
			PURPOSE_MAX,
		),
	);
	params.set("reference_number", inputs.invoiceNumber);
	params.set("redirect_url", inputs.redirectUrl);
	if (inputs.webhookUrl) params.set("webhook", inputs.webhookUrl);
	params.set("send_sms", "false");
	params.set("send_email", "false");
	if (inputs.customerEmail) params.set("email", inputs.customerEmail);
	return params;
}

// --- V2 event-webhook verification + parsing --------------------------------

/**
 * Verify a dashboard-registered event webhook: `Hitpay-Signature` is
 * HMAC-SHA256 hex over the RAW JSON body with the account salt. Returns false
 * (never throws) on any missing input.
 */
export async function verifyEventSignature(
	rawBody: string,
	signatureHeader: string | null,
	salt: string,
): Promise<boolean> {
	if (!signatureHeader || !salt) return false;
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
		encoder.encode(rawBody),
	);
	const expected = [...new Uint8Array(signature)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return timingSafeEqual(signatureHeader.trim().toLowerCase(), expected);
}

/** What the recurring branch of /webhook/hitpay acts on. Anything else is
 * acked and ignored. */
export type RecurringEvent =
	| {
			kind: "charge";
			paymentId: string;
			recurringBillingId: string | null;
			status: string;
			amountSen: number | null;
			currency: string | null;
			methodCode: string | undefined;
	  }
	| { kind: "method_attached"; billingId: string; methodCode: string | undefined; methodLabel: string | undefined }
	| { kind: "method_detached"; billingId: string }
	| { kind: "billing_status"; billingId: string; status: string };

function asString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** HitPay event amounts arrive as JSON numbers in MAJOR units (the webhook
 * sample shows `"amount": 20`); tolerate a decimal string too. */
function amountToSen(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.round(value * 100);
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) return Math.round(parsed * 100);
	}
	return null;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
	return typeof value === "object" && value !== null
		? (value as JsonRecord)
		: null;
}

/**
 * Classify a verified V2 event payload. Field names are TOLERANT lookups —
 * HitPay's event docs are thin, so we accept the documented spellings plus
 * obvious variants, and anything unrecognised returns null (logged + acked by
 * the route, never an error). The header pair (`Hitpay-Event-Object` /
 * `Hitpay-Event-Type`) refines classification when present.
 *
 * Confirmed against the docs' sample charge payload: `id`, `channel:
 * "recurrent"`, `status: "succeeded"`, `amount` (major units), `currency`,
 * `payment_provider.charge.method`. The recurring-billing id on a charge is
 * probed at `recurring_billing_id` / `recurring_plan_id` /
 * `business_recurring_plans_id` — when absent the route falls back to the
 * pending-charge correlation (see subscriptionPayments.ts).
 */
export function extractRecurringEvent(
	payload: unknown,
	headers: { eventObject: string | null; eventType: string | null },
): RecurringEvent | null {
	const body = record(payload);
	if (!body) return null;
	const object = headers.eventObject?.toLowerCase() ?? "";
	const type = headers.eventType?.toLowerCase() ?? "";

	const billingId =
		asString(body.recurring_billing_id) ??
		asString(body.recurring_plan_id) ??
		asString(body.business_recurring_plans_id);

	// method_attached / method_detached / subscription_updated — the payload is
	// the recurring-billing object itself (its `id` IS the billing id).
	const looksLikeBillingObject =
		asString(body.cycle) !== null || body.save_card !== undefined;
	if (object.includes("recurring") || looksLikeBillingObject) {
		const id = asString(body.id) ?? billingId;
		if (!id) return null;
		if (type.includes("detach")) return { kind: "method_detached", billingId: id };
		if (type.includes("attach")) {
			const provider = record(body.payment_provider);
			const charge = provider ? record(provider.charge) : null;
			const details = charge ? record(charge.details) : null;
			const methodCode =
				asString(body.payment_method) ??
				asString(charge?.method) ??
				undefined;
			const brand = details ? asString(details.brand) : null;
			const last4 = details ? asString(details.last4) : null;
			return {
				kind: "method_attached",
				billingId: id,
				methodCode: methodCode ?? undefined,
				methodLabel: brand && last4 ? `${brand} ·· ${last4}` : undefined,
			};
		}
		const status = asString(body.status);
		if (status) return { kind: "billing_status", billingId: id, status };
		return null;
	}

	// charge.created — the payload is a payment. `channel: "recurrent"` is the
	// documented marker; the object header saying "charge"/"payment" also counts.
	const channel = asString(body.channel);
	if (
		channel === "recurrent" ||
		object.includes("charge") ||
		object.includes("payment")
	) {
		const paymentId = asString(body.id);
		const status = asString(body.status);
		if (!paymentId || !status) return null;
		const provider = record(body.payment_provider);
		const charge = provider ? record(provider.charge) : null;
		return {
			kind: "charge",
			paymentId,
			recurringBillingId: billingId,
			status,
			amountSen: amountToSen(body.amount),
			currency: asString(body.currency)?.toUpperCase() ?? null,
			methodCode: asString(charge?.method) ?? undefined,
		};
	}
	return null;
}
