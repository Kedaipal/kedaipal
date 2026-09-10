import { describe, expect, test } from "vitest";
import {
	AUTO_CHARGE_MAX_ATTEMPTS,
	AUTO_CHARGE_RETRY_DELAYS_MS,
	AUTO_RENEW_METHODS,
	AUTO_RENEW_TIMES_TO_BE_CHARGED,
	autoRenewMethodLabel,
	buildAutoRenewSessionParams,
	buildInvoicePaymentRequestParams,
	extractRecurringEvent,
	gatewayPaymentMethodTag,
	nextChargeRetryAt,
	resolveBillingGatewayCredentials,
	verifyEventSignature,
} from "./hitpayBilling";

const SALT = "billing-salt-abc123";

describe("resolveBillingGatewayCredentials", () => {
	test("both halves present → credentials with inferred mode", () => {
		const creds = resolveBillingGatewayCredentials({
			HITPAY_BILLING_API_KEY: "test_abc123",
			HITPAY_BILLING_SALT: SALT,
		});
		expect(creds).toEqual({
			apiKey: "test_abc123",
			salt: SALT,
			mode: "sandbox",
		});
		expect(
			resolveBillingGatewayCredentials({
				HITPAY_BILLING_API_KEY: "live_key_no_test_prefix",
				HITPAY_BILLING_SALT: SALT,
			})?.mode,
		).toBe("production");
	});

	test("half a credential (or blanks) → null, never a partial", () => {
		expect(
			resolveBillingGatewayCredentials({ HITPAY_BILLING_API_KEY: "test_x" }),
		).toBeNull();
		expect(
			resolveBillingGatewayCredentials({ HITPAY_BILLING_SALT: SALT }),
		).toBeNull();
		expect(
			resolveBillingGatewayCredentials({
				HITPAY_BILLING_API_KEY: "  ",
				HITPAY_BILLING_SALT: SALT,
			}),
		).toBeNull();
		expect(resolveBillingGatewayCredentials({})).toBeNull();
	});
});

describe("buildAutoRenewSessionParams", () => {
	const inputs = {
		planLabel: "Pro",
		storeName: "Kek Mahsuri",
		customerEmail: "seller@example.com",
		customerName: "Mahsuri",
		amountSen: 14900,
		currency: "MYR" as const,
		redirectUrl: "https://kedaipal.com/app/settings?tab=billing&autorenew=return",
		reference: "sub_123",
		paymentMethods: AUTO_RENEW_METHODS.MYR,
	};

	test("save_payment_method session with the MYR tokenisable rails only", () => {
		const params = buildAutoRenewSessionParams(inputs);
		expect(params.get("save_payment_method")).toBe("true");
		expect(params.get("amount")).toBe("149.00");
		expect(params.get("currency")).toBe("MYR");
		expect(params.get("customer_email")).toBe("seller@example.com");
		expect(params.get("reference")).toBe("sub_123");
		expect(params.getAll("payment_methods[]")).toEqual(["card", "touch_n_go"]);
		// FPX / DuitNow are push-only and must never appear on a tokenised session.
		expect(params.getAll("payment_methods[]")).not.toContain("fpx");
		expect(params.getAll("payment_methods[]")).not.toContain("duitnow");
	});

	test("times_to_be_charged is set explicitly — HitPay's default of 1 would kill the second renewal", () => {
		const params = buildAutoRenewSessionParams(inputs);
		expect(params.get("times_to_be_charged")).toBe(
			String(AUTO_RENEW_TIMES_TO_BE_CHARGED),
		);
		expect(AUTO_RENEW_TIMES_TO_BE_CHARGED).toBe(100); // documented max
	});

	test("HitPay's own receipt emails stay off (one voice per event)", () => {
		expect(buildAutoRenewSessionParams(inputs).get("send_email")).toBe("false");
	});

	test("SGD offers card only (PayNow can't be tokenised)", () => {
		expect(AUTO_RENEW_METHODS.SGD).toEqual(["card"]);
	});
});

describe("buildInvoicePaymentRequestParams", () => {
	const inputs = {
		invoiceNumber: "INV-202609-AB12",
		storeName: "Kek Mahsuri",
		amountSen: 10400,
		currency: "MYR",
		redirectUrl: "https://kedaipal.com/app/settings?tab=billing&paid=return",
		webhookUrl: "https://x.convex.site/webhook/hitpay",
	};

	test("carries amount/reference/webhook and suppresses HitPay's own comms", () => {
		const params = buildInvoicePaymentRequestParams(inputs);
		expect(params.get("amount")).toBe("104.00");
		expect(params.get("currency")).toBe("MYR");
		expect(params.get("reference_number")).toBe("INV-202609-AB12");
		expect(params.get("webhook")).toBe("https://x.convex.site/webhook/hitpay");
		expect(params.get("send_sms")).toBe("false");
		expect(params.get("send_email")).toBe("false");
	});

	test("NO expiry — the link lives in emails for the whole grace window", () => {
		// Buyer-order links expire in 60 mins (lazy mint); an invoice link that
		// died like that would strand every seller who opens the email tomorrow.
		expect(
			buildInvoicePaymentRequestParams(inputs).get("expires_after"),
		).toBeNull();
	});

	test("empty webhookUrl omits the param rather than sending a blank", () => {
		const params = buildInvoicePaymentRequestParams({
			...inputs,
			webhookUrl: "",
		});
		expect(params.get("webhook")).toBeNull();
	});
});

describe("verifyEventSignature (V2 raw-body HMAC)", () => {
	async function sign(body: string, salt: string): Promise<string> {
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(salt),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
		return [...new Uint8Array(sig)]
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	test("round-trips a valid signature and rejects tampering", async () => {
		const body = JSON.stringify({ id: "pay_1", status: "succeeded" });
		const sig = await sign(body, SALT);
		expect(await verifyEventSignature(body, sig, SALT)).toBe(true);
		expect(await verifyEventSignature(`${body} `, sig, SALT)).toBe(false);
		expect(await verifyEventSignature(body, sig, "other-salt")).toBe(false);
	});

	test("missing signature or salt → false, never a throw", async () => {
		expect(await verifyEventSignature("{}", null, SALT)).toBe(false);
		expect(await verifyEventSignature("{}", "abc", "")).toBe(false);
	});
});

describe("extractRecurringEvent", () => {
	const noHeaders = { eventObject: null, eventType: null };

	test("documented charge payload (channel: recurrent) → charge event", () => {
		const event = extractRecurringEvent(
			{
				id: "a1113980-3725-4cad-b6eb-208e18525e00",
				business_id: "b1",
				channel: "recurrent",
				status: "succeeded",
				amount: 149,
				currency: "myr",
				recurring_billing_id: "rb_1",
				payment_provider: {
					code: "stripe_sg",
					charge: {
						method: "card",
						details: { brand: "Visa", last4: "4242" },
					},
				},
			},
			noHeaders,
		);
		expect(event).toEqual({
			kind: "charge",
			paymentId: "a1113980-3725-4cad-b6eb-208e18525e00",
			recurringBillingId: "rb_1",
			status: "succeeded",
			amountSen: 14900,
			currency: "MYR",
			methodCode: "card",
		});
	});

	test("method_attached (billing object + attach header) carries method + label", () => {
		const event = extractRecurringEvent(
			{
				id: "rb_1",
				cycle: "save_card",
				status: "active",
				payment_method: "touch_n_go",
			},
			{
				eventObject: "recurring_billing",
				eventType: "method_attached",
			},
		);
		expect(event).toEqual({
			kind: "method_attached",
			billingId: "rb_1",
			methodCode: "touch_n_go",
			methodLabel: undefined,
		});
	});

	test("method_detached resolves the billing id", () => {
		const event = extractRecurringEvent(
			{ id: "rb_1", cycle: "save_card", status: "active" },
			{ eventObject: "recurring_billing", eventType: "method_detached" },
		);
		expect(event).toEqual({ kind: "method_detached", billingId: "rb_1" });
	});

	test("subscription_updated → billing_status with the payload status", () => {
		const event = extractRecurringEvent(
			{ id: "rb_1", cycle: "save_card", status: "canceled" },
			{
				eventObject: "recurring_billing",
				eventType: "subscription_updated",
			},
		);
		expect(event).toEqual({
			kind: "billing_status",
			billingId: "rb_1",
			status: "canceled",
		});
	});

	test("unrecognised payloads → null (acked + dropped by the route)", () => {
		expect(extractRecurringEvent({ hello: "world" }, noHeaders)).toBeNull();
		expect(extractRecurringEvent("not an object", noHeaders)).toBeNull();
		expect(extractRecurringEvent(null, noHeaders)).toBeNull();
	});
});

describe("dunning schedule", () => {
	test("attempt 1 fails → retry in 2 days; attempt 2 → 3 more; attempt 3 → done", () => {
		const now = 1_000_000;
		expect(nextChargeRetryAt(1, now)).toBe(now + AUTO_CHARGE_RETRY_DELAYS_MS[0]);
		expect(nextChargeRetryAt(2, now)).toBe(now + AUTO_CHARGE_RETRY_DELAYS_MS[1]);
		expect(nextChargeRetryAt(3, now)).toBeNull();
		expect(AUTO_CHARGE_MAX_ATTEMPTS).toBe(3);
	});

	test("the whole dunning window fits inside the 14-day invoice grace", () => {
		const total = AUTO_CHARGE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
		expect(total).toBeLessThan(14 * 24 * 60 * 60 * 1000);
	});
});

describe("labels + method tags", () => {
	test("known codes get seller-facing names; unknown degrade, never undefined", () => {
		expect(autoRenewMethodLabel("card")).toBe("Card");
		expect(autoRenewMethodLabel("touch_n_go")).toBe("Touch 'n Go");
		expect(autoRenewMethodLabel("mystery_wallet")).toBe("Saved payment method");
		expect(autoRenewMethodLabel(undefined)).toBe("Saved payment method");
	});

	test("invoice paymentMethod tag: hitpay_<code>, bare hitpay when unknown", () => {
		expect(gatewayPaymentMethodTag("card")).toBe("hitpay_card");
		expect(gatewayPaymentMethodTag("Touch_N_Go")).toBe("hitpay_touch_n_go");
		expect(gatewayPaymentMethodTag(undefined)).toBe("hitpay");
		expect(gatewayPaymentMethodTag("  ")).toBe("hitpay");
	});
});
