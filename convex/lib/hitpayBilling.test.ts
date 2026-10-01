import { describe, expect, test } from "vitest";
import {
	AUTO_CHARGE_MAX_ATTEMPTS,
	AUTO_CHARGE_RETRY_DELAYS_MS,
	AUTO_RENEW_METHODS,
	adminAutoChargeState,
	autoChargeAllowed,
	autoRenewMethodLabel,
	buildAutoRenewSessionParams,
	buildCreditPackPaymentRequestParams,
	buildInvoicePaymentRequestParams,
	extractRecurringEvent,
	gatewayPaymentMethodLabel,
	gatewayPaymentMethodTag,
	isGatewayPaymentTag,
	nextChargeRetryAt,
	readSessionChargeCount,
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
			// No dedicated webhook salt configured → falls back to the API salt.
			webhookSalt: SALT,
			mode: "sandbox",
		});
		expect(
			resolveBillingGatewayCredentials({
				HITPAY_BILLING_API_KEY: "live_key_no_test_prefix",
				HITPAY_BILLING_SALT: SALT,
			})?.mode,
		).toBe("production");
	});

	test("a dedicated webhook salt is kept SEPARATE from the API salt", () => {
		// Dashboard-registered V2 endpoints sign with their own secret; the
		// API-key salt signs the per-request v1 completion webhooks. Proved on
		// live traffic — a real method_attached verified against neither HMAC
		// form of the API salt.
		const creds = resolveBillingGatewayCredentials({
			HITPAY_BILLING_API_KEY: "test_abc123",
			HITPAY_BILLING_SALT: SALT,
			HITPAY_BILLING_WEBHOOK_SALT: "endpoint-secret-xyz",
		});
		expect(creds?.salt).toBe(SALT);
		expect(creds?.webhookSalt).toBe("endpoint-secret-xyz");
		// Blank is treated as unset, never as an empty secret.
		expect(
			resolveBillingGatewayCredentials({
				HITPAY_BILLING_API_KEY: "test_abc123",
				HITPAY_BILLING_SALT: SALT,
				HITPAY_BILLING_WEBHOOK_SALT: "   ",
			})?.webhookSalt,
		).toBe(SALT);
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
		description: "Kedaipal subscription — pay & save your method for auto-renewal",
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

	test("paymentMethods undefined omits the param — the account's own tokenisable set decides", () => {
		const params = buildAutoRenewSessionParams({
			...inputs,
			paymentMethods: undefined,
		});
		expect(params.getAll("payment_methods[]")).toEqual([]);
		expect(params.toString()).not.toContain("payment_methods");
		expect(params.get("save_payment_method")).toBe("true");
	});

	test("times_to_be_charged is NEVER sent — save_payment_method sessions reject it", () => {
		// Sandbox-verified 11 Sep 2026: "You cant set times_to_be_charged for
		// save_card is true". The docs' default-of-1 worry doesn't apply to the
		// tokenised path, and neither does the 100-charge ceiling.
		expect(buildAutoRenewSessionParams(inputs).get("times_to_be_charged")).toBeNull();
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

describe("buildCreditPackPaymentRequestParams (Credits T2)", () => {
	const inputs = {
		purchaseNumber: "CRD-202610-AB12",
		packLabel: "50-credit pack",
		storeName: "Kek Mahsuri",
		amountSen: 4500,
		currency: "MYR" as const,
		redirectUrl: "https://kedaipal.com/app/settings?tab=billing&topup=return",
		webhookUrl: "https://x.convex.site/webhook/hitpay",
		customerEmail: "owner@kek.example",
	};

	test("the invoice link's twin: amount, reference, webhook, comms off", () => {
		const params = buildCreditPackPaymentRequestParams(inputs);
		expect(params.get("amount")).toBe("45.00");
		expect(params.get("currency")).toBe("MYR");
		expect(params.get("reference_number")).toBe("CRD-202610-AB12");
		expect(params.get("purpose")).toBe(
			"Kedaipal 50-credit pack CRD-202610-AB12 — Kek Mahsuri",
		);
		expect(params.get("redirect_url")).toBe(inputs.redirectUrl);
		expect(params.get("webhook")).toBe(inputs.webhookUrl);
		expect(params.get("email")).toBe("owner@kek.example");
		expect(params.get("send_sms")).toBe("false");
		expect(params.get("send_email")).toBe("false");
	});

	test("unlike an invoice link, it EXPIRES — in the minutes grammar sandbox verified", () => {
		expect(buildCreditPackPaymentRequestParams(inputs).get("expires_after")).toBe(
			"1440 mins",
		);
	});

	test("the shared base left the invoice link byte-identical", () => {
		const params = buildInvoicePaymentRequestParams({
			invoiceNumber: "INV-202609-AB12",
			storeName: "Kek Mahsuri",
			amountSen: 10400,
			currency: "MYR",
			redirectUrl: "https://kedaipal.com/app/settings?tab=billing&paid=return",
			webhookUrl: "https://x.convex.site/webhook/hitpay",
			customerEmail: "owner@kek.example",
		});
		expect(params.toString()).toBe(
			new URLSearchParams({
				amount: "104.00",
				currency: "MYR",
				purpose: "Kedaipal subscription INV-202609-AB12 — Kek Mahsuri",
				reference_number: "INV-202609-AB12",
				redirect_url: "https://kedaipal.com/app/settings?tab=billing&paid=return",
				webhook: "https://x.convex.site/webhook/hitpay",
				send_sms: "false",
				send_email: "false",
				email: "owner@kek.example",
			}).toString(),
		);
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

	// ——— Payloads below are VERBATIM from live sandbox traffic (11 Sep 2026),
	// trimmed of irrelevant keys. The docs' flat shape is kept in the tests
	// after these so both forms stay supported.
	const REAL_ATTACH = {
		event: "recurring_billing.method_attached",
		affected_method_id: "a2b80bb6-6ba2-4b7f-b4aa-d9657d4dfa82",
		recurring_billing: {
			id: "a2b80b9d-5203-432c-b3c3-8b5efdf802fc",
			business_recurring_plans_id: null,
			customer_email: "seller@example.com",
			name: "Kedaipal Pro — IndoMart",
			reference: "kd75c1h8xf1gvnk8jfdazehn0x8a4tgs",
			cycle: "save_card",
			currency: "myr",
			amount: 149,
			times_charged: null,
			status: "active",
			save_payment_method: 1,
			payment_methods: ["touch_n_go"],
			payment_provider_charge_method: "touch_n_go",
			default_method: {
				id: "a2b80bb6-6ba2-4b7f-b4aa-d9657d4dfa82",
				payment_provider: "touch_n_go",
				payment_provider_charge_method: "touch_n_go",
				subscription_id: "a2b80b9d-5203-432c-b3c3-8b5efdf802fc",
				status: "completed",
			},
			methods: [],
		},
	};

	test("REAL attach envelope: nested object + the authorised rail (the 'shows Card' bug)", () => {
		// This exact payload used to yield null (id is nested, so nothing
		// resolved) — and before that, a default of "card" for a TnG wallet.
		expect(
			extractRecurringEvent(REAL_ATTACH, {
				eventObject: "recurring_billing",
				eventType: "method_attached",
			}),
		).toEqual({
			kind: "method_attached",
			billingId: "a2b80b9d-5203-432c-b3c3-8b5efdf802fc",
			methodCode: "touch_n_go",
			methodLabel: undefined,
		});
	});

	test("REAL attach parses on the `event` field alone — headers are only a fallback", () => {
		expect(
			extractRecurringEvent(REAL_ATTACH, {
				eventObject: null,
				eventType: null,
			}),
		).toMatchObject({ kind: "method_attached", methodCode: "touch_n_go" });
	});

	test("REAL subscription_updated envelope → billing_status", () => {
		expect(
			extractRecurringEvent(
				{
					event: "recurring_billing.subscription_updated",
					changed_fields: ["status"],
					recurring_billing: {
						id: "a2b80b9d-5203-432c-b3c3-8b5efdf802fc",
						cycle: "save_card",
						status: "active",
					},
				},
				{ eventObject: "recurring_billing", eventType: "subscription_updated" },
			),
		).toEqual({
			kind: "billing_status",
			billingId: "a2b80b9d-5203-432c-b3c3-8b5efdf802fc",
			status: "active",
		});
	});

	test("REAL detach envelope clears the method", () => {
		expect(
			extractRecurringEvent(
				{
					event: "recurring_billing.method_detached",
					recurring_billing: {
						id: "a2b80b9d-5203-432c-b3c3-8b5efdf802fc",
						cycle: "save_card",
						status: "active",
					},
				},
				{ eventObject: "recurring_billing", eventType: "method_detached" },
			),
		).toEqual({
			kind: "method_detached",
			billingId: "a2b80b9d-5203-432c-b3c3-8b5efdf802fc",
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

	test("ENVELOPED charge.created parses like its recurring siblings", () => {
		// No live charge capture exists yet (the sync response settles first),
		// but every captured V2 event was enveloped — reading only the docs'
		// flat sample would ack real charge events into the void.
		expect(
			extractRecurringEvent(
				{
					event: "charge.created",
					charge: {
						id: "pay_env_1",
						status: "succeeded",
						amount: 149,
						currency: "myr",
						recurring_billing_id: "rb_1",
						payment_provider: { charge: { method: "touch_n_go" } },
					},
				},
				{ eventObject: "charge", eventType: "created" },
			),
		).toEqual({
			kind: "charge",
			paymentId: "pay_env_1",
			recurringBillingId: "rb_1",
			status: "succeeded",
			amountSen: 14900,
			currency: "MYR",
			methodCode: "touch_n_go",
		});
	});

	test("an enveloped charge resolves the billing id from a nested object too", () => {
		expect(
			extractRecurringEvent(
				{
					event: "charge.created",
					charge: {
						id: "pay_env_2",
						status: "succeeded",
						amount: 59,
						currency: "sgd",
						recurring_billing: { id: "rb_nested" },
					},
				},
				{ eventObject: null, eventType: null },
			),
		).toMatchObject({ recurringBillingId: "rb_nested", amountSen: 5900 });
	});

	test("unrecognised payloads → null (acked + dropped by the route)", () => {
		expect(extractRecurringEvent({ hello: "world" }, noHeaders)).toBeNull();
		expect(extractRecurringEvent("not an object", noHeaders)).toBeNull();
		expect(extractRecurringEvent(null, noHeaders)).toBeNull();
	});
});

describe("readSessionChargeCount", () => {
	/** A save-card session as HitPay's sandbox GET returned it (30 Sep 2026),
	 * customer fields left out. Its three auto-charges settled RM79 + RM149 +
	 * RM79 — so `total_charge` is a COUNT, not the RM307 sum — while the
	 * documented `times_charged` sits there null. */
	const CAPTURED_SAVE_CARD_SESSION = {
		id: "a2bca31a-a34e-4a9f-8be8-2fd4e4fda71e",
		status: "active",
		cycle: "save_card",
		cycle_repeat: null,
		amount: 79,
		price: 79,
		currency: "myr",
		payment_provider_charge_method: "touch_n_go",
		times_charged: null,
		times_to_be_charged: null,
		total_charge: 3,
		created_at: "2026-09-13T22:45:39",
		updated_at: "2026-09-13T22:45:45",
		webhook_last_attempt: null,
		webhook_retry_count: 0,
	};

	test("a save-card session counts in total_charge — its times_charged is null", () => {
		expect(readSessionChargeCount(CAPTURED_SAVE_CARD_SESSION)).toBe(3);
	});

	test("a session that never charged reads 0 — a real answer, not 'unknown'", () => {
		expect(
			readSessionChargeCount({ ...CAPTURED_SAVE_CARD_SESSION, total_charge: 0 }),
		).toBe(0);
	});

	test("the documented times_charged is the fallback when total_charge is absent", () => {
		expect(readSessionChargeCount({ status: "active", times_charged: 2 })).toBe(2);
	});

	test("a whole-number string is a count", () => {
		expect(readSessionChargeCount({ total_charge: " 4 " })).toBe(4);
	});

	test("no usable count → undefined, never zero: the caller must not charge blind", () => {
		expect(readSessionChargeCount({ status: "active" })).toBeUndefined();
		expect(
			readSessionChargeCount({ times_charged: null, total_charge: null }),
		).toBeUndefined();
		expect(readSessionChargeCount({ total_charge: -1 })).toBeUndefined();
		expect(readSessionChargeCount({ total_charge: 1.5 })).toBeUndefined();
		expect(readSessionChargeCount({ total_charge: "3 charges" })).toBeUndefined();
	});
});

describe("autoChargeAllowed — the one rule every charge scheduler asks", () => {
	const stranded = {
		invoiceId: "inv_old",
		invoiceNumber: "INV-OLD",
		amountSen: 14900,
		currency: "MYR",
		paymentId: "reconciled:rb_1:1",
		at: 1,
	};

	test("no saved method → nothing to charge", () => {
		expect(autoChargeAllowed(undefined)).toBe(false);
	});

	test("a saved method charges — unless a stranded charge is waiting on a human", () => {
		expect(autoChargeAllowed({})).toBe(true);
		expect(autoChargeAllowed({ strandedCharge: stranded })).toBe(false);
	});

	test("the admin projection carries the stranded charge and the unresolved stamp", () => {
		const state = adminAutoChargeState({
			method: "card",
			failedAttempts: 1,
			lastChargeAttemptAt: 42,
			strandedCharge: stranded,
		});
		expect(state).toEqual({
			method: "card",
			failedAttempts: 1,
			nextRetryAt: undefined,
			lastChargeError: undefined,
			unresolvedAttemptAt: 42,
			// No invoice id: the admin reads the NUMBER; the id is server business.
			stranded: {
				invoiceNumber: "INV-OLD",
				amountSen: 14900,
				currency: "MYR",
				paymentId: "reconciled:rb_1:1",
				at: 1,
			},
		});
		expect(adminAutoChargeState({ method: "card" }).failedAttempts).toBe(0);
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

	test("a receipt names the rail, never the raw tag; unknown reads 'Online payment'", () => {
		expect(gatewayPaymentMethodLabel("hitpay_card")).toBe("Card");
		expect(gatewayPaymentMethodLabel("hitpay_touch_n_go")).toBe("Touch 'n Go");
		expect(gatewayPaymentMethodLabel("hitpay_duitnow")).toBe("DuitNow");
		expect(gatewayPaymentMethodLabel("hitpay_paynow_online")).toBe("PayNow");
		expect(gatewayPaymentMethodLabel("hitpay")).toBe("Online payment");
		expect(gatewayPaymentMethodLabel("hitpay_new_wallet")).toBe("Online payment");
	});

	test("only tags the gateway wrote count as gateway tags — an admin's words don't", () => {
		expect(isGatewayPaymentTag("hitpay")).toBe(true);
		expect(isGatewayPaymentTag("hitpay_card")).toBe(true);
		expect(isGatewayPaymentTag("duitnow")).toBe(false);
		expect(isGatewayPaymentTag("bank_transfer")).toBe(false);
		expect(isGatewayPaymentTag("hitpayment by cheque")).toBe(false);
	});
});
