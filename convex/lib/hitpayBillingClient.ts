/**
 * The ONE HTTP client for KEDAIPAL'S OWN HitPay account (86eyb6z4r; extracted
 * for Credits T2, z8r3fdf8ht). Subscription Pay-now links and auto-renewal
 * (convex/subscriptionPayments.ts) and credit-pack checkouts
 * (convex/creditPurchases.ts) read the credentials, the headers and the
 * payment-request calls from here, so "how we talk to our own account" exists
 * once and a second copy can't drift from the first.
 *
 * Credentials come from the deployment env only (lib/hitpayBilling.ts has the
 * why). Every call is best-effort by contract: it never throws — it returns
 * what happened and logs the rest, because each caller has a fallback (the
 * manual rail, a later reconcile, HitPay's own expiry).
 */

import { decimalStringToSen, HITPAY_API_BASE } from "./hitpay";
import {
	type BillingGatewayCredentials,
	resolveBillingGatewayCredentials,
} from "./hitpayBilling";

/** Kedaipal's own HitPay credentials, or null when the deployment has none —
 * every online billing surface then stays hidden (fail-open-to-manual). */
export function billingCredentials(): BillingGatewayCredentials | null {
	return resolveBillingGatewayCredentials({
		HITPAY_BILLING_API_KEY: process.env.HITPAY_BILLING_API_KEY,
		HITPAY_BILLING_SALT: process.env.HITPAY_BILLING_SALT,
		HITPAY_BILLING_WEBHOOK_SALT: process.env.HITPAY_BILLING_WEBHOOK_SALT,
	});
}

/** Headers for a form-encoded POST against the account. */
export function billingFormHeaders(
	credentials: BillingGatewayCredentials,
): HeadersInit {
	return {
		"X-BUSINESS-API-KEY": credentials.apiKey,
		"Content-Type": "application/x-www-form-urlencoded",
		"X-Requested-With": "XMLHttpRequest",
	};
}

/** Headers for a GET / DELETE — no body, so no content type. */
export function billingAuthHeaders(
	credentials: BillingGatewayCredentials,
): HeadersInit {
	return {
		"X-BUSINESS-API-KEY": credentials.apiKey,
		"X-Requested-With": "XMLHttpRequest",
	};
}

export type CreatePaymentRequestResult =
	| { kind: "ok"; id: string; url: string }
	| { kind: "failed" };

/**
 * POST /payment-requests. `logContext` names what the request was for in every
 * failure log line.
 *
 * A request the account can't actually take money on counts as FAILED: HitPay
 * answers 201 with an EMPTY `payment_methods` when no rail is enabled for the
 * currency, and its checkout page then renders a dead "Awaiting customer
 * present card" state (sandbox-observed 11 Sep 2026 on an SGD request). No
 * button beats a dead button — and because HitPay did create it, it is deleted
 * here: a request no caller stores is one no later cleanup can ever reach. An
 * ABSENT field is "no information", treated as usable (the BYO probe's rule).
 */
export async function createPaymentRequest(
	credentials: BillingGatewayCredentials,
	params: URLSearchParams,
	logContext: Record<string, unknown>,
): Promise<CreatePaymentRequestResult> {
	let response: Response;
	try {
		response = await fetch(
			`${HITPAY_API_BASE[credentials.mode]}/payment-requests`,
			{
				method: "POST",
				headers: billingFormHeaders(credentials),
				body: params.toString(),
			},
		);
	} catch (err) {
		console.error("[billing] payment request create failed (network)", {
			...logContext,
			err: err instanceof Error ? err.message : String(err),
		});
		return { kind: "failed" };
	}
	if (!response.ok) {
		console.error("[billing] payment request create rejected", {
			...logContext,
			status: response.status,
			body: (await response.text()).slice(0, 300),
		});
		return { kind: "failed" };
	}
	const request = (await response.json()) as {
		id?: string;
		url?: string;
		payment_methods?: string[];
	};
	if (!request.id || !request.url) {
		console.error(
			"[billing] payment request create: malformed response",
			logContext,
		);
		return { kind: "failed" };
	}
	if (
		request.payment_methods !== undefined &&
		request.payment_methods.length === 0
	) {
		console.error(
			"[billing] payment request has NO usable payment methods for this currency — not used; enable a method on the HitPay account",
			logContext,
		);
		await deletePaymentRequest(credentials, request.id);
		return { kind: "failed" };
	}
	return { kind: "ok", id: request.id, url: request.url };
}

/**
 * DELETE /payment-requests/{id} — kill a link so it stops taking money
 * (voided / settled out-of-band / expired / orphaned). Best-effort: a DELETE
 * on an already-completed request fails, and that's fine — a payment that
 * slipped through is caught by the settle's late-payment audit.
 */
export async function deletePaymentRequest(
	credentials: BillingGatewayCredentials,
	requestId: string,
): Promise<void> {
	try {
		const response = await fetch(
			`${HITPAY_API_BASE[credentials.mode]}/payment-requests/${requestId}`,
			{ method: "DELETE", headers: billingAuthHeaders(credentials) },
		);
		if (!response.ok) {
			console.warn("[billing] payment request delete rejected", {
				requestId,
				status: response.status,
			});
		}
	} catch (err) {
		console.warn("[billing] payment request delete failed", {
			requestId,
			err: err instanceof Error ? err.message : String(err),
		});
	}
}

export type PaymentRequestLookup =
	| {
			kind: "paid";
			paymentId: string;
			amountSen: number;
			currency: string;
			/** HitPay's `payment_type` ("card", "touch_n_go", "duitnow"…). */
			methodCode: string | undefined;
	  }
	| { kind: "unpaid" }
	/** Couldn't ask — network, a non-2xx, or an amount we can't parse. Never
	 * to be read as "unpaid": a caller about to give up on a purchase must not
	 * mistake "HitPay didn't answer" for "the seller didn't pay". */
	| { kind: "unknown" };

/**
 * GET /payment-requests/{id} → the request's succeeded payment, if any. The
 * return reconciles use it (never trust the redirect — the buyer gateway's
 * lost-webhook lesson, PR #172), and a stale top-up asks it once more before
 * it gives up.
 */
export async function lookupPaymentRequest(
	credentials: BillingGatewayCredentials,
	requestId: string,
): Promise<PaymentRequestLookup> {
	let response: Response;
	try {
		response = await fetch(
			`${HITPAY_API_BASE[credentials.mode]}/payment-requests/${requestId}`,
			{ headers: billingAuthHeaders(credentials) },
		);
	} catch {
		return { kind: "unknown" };
	}
	if (!response.ok) return { kind: "unknown" };
	const request = (await response.json()) as {
		payments?: Array<{
			id: string;
			status: string;
			amount: string;
			currency: string;
			payment_type?: string;
		}>;
	};
	const payment = request.payments?.find((p) => p.status === "succeeded");
	if (!payment) return { kind: "unpaid" };
	const amountSen = decimalStringToSen(payment.amount);
	if (amountSen === null) return { kind: "unknown" };
	return {
		kind: "paid",
		paymentId: payment.id,
		amountSen,
		currency: payment.currency,
		methodCode: payment.payment_type,
	};
}
