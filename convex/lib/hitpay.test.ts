import { describe, expect, test, vi } from "vitest";
import { encryptSecret } from "./credentialCrypto";
import {
	buildPaymentRequestParams,
	computeHitpayHmac,
	decimalStringToSen,
	decryptHitpayCredentials,
	describeGatewayMethods,
	hitpayCheckoutConfigured,
	inferHitpayMode,
	mapHitpayPaymentType,
	resolveHitpayCredentials,
	senToDecimalString,
	verifyHitpayWebhook,
} from "./hitpay";

describe("inferHitpayMode / resolveHitpayCredentials", () => {
	test("test_ prefix → sandbox, anything else → production", () => {
		expect(inferHitpayMode("test_abc123")).toBe("sandbox");
		expect(inferHitpayMode("a59e0a2967ba10ef")).toBe("production");
	});

	test("requires both halves of the credential, trimmed", () => {
		expect(resolveHitpayCredentials(undefined)).toBeNull();
		expect(resolveHitpayCredentials({ apiKey: "test_k" })).toBeNull();
		expect(resolveHitpayCredentials({ salt: "s" })).toBeNull();
		expect(resolveHitpayCredentials({ apiKey: "  ", salt: "s" })).toBeNull();
		expect(
			resolveHitpayCredentials({ apiKey: " test_k ", salt: " s " }),
		).toEqual({ apiKey: "test_k", salt: "s", mode: "sandbox" });
	});

	test("checkout configured needs enabled AND full credentials", () => {
		expect(hitpayCheckoutConfigured(undefined)).toBe(false);
		expect(
			hitpayCheckoutConfigured({ enabled: true, apiKey: "test_k" }),
		).toBe(false);
		expect(
			hitpayCheckoutConfigured({ enabled: false, apiKey: "test_k", salt: "s" }),
		).toBe(false);
		expect(
			hitpayCheckoutConfigured({ enabled: true, apiKey: "test_k", salt: "s" }),
		).toBe(true);
	});
});

describe("amount conversion", () => {
	test("sen → decimal string", () => {
		expect(senToDecimalString(1250)).toBe("12.50");
		expect(senToDecimalString(30)).toBe("0.30");
		expect(senToDecimalString(100)).toBe("1.00");
		expect(senToDecimalString(999999)).toBe("9999.99");
	});

	test("decimal string → sen, strict", () => {
		expect(decimalStringToSen("12.50")).toBe(1250);
		expect(decimalStringToSen("12.5")).toBe(1250);
		expect(decimalStringToSen("12")).toBe(1200);
		expect(decimalStringToSen("0.30")).toBe(30);
		expect(decimalStringToSen(" 5.00 ")).toBe(500);
		expect(decimalStringToSen("")).toBeNull();
		expect(decimalStringToSen("-5")).toBeNull();
		expect(decimalStringToSen("5.999")).toBeNull();
		expect(decimalStringToSen("abc")).toBeNull();
		expect(decimalStringToSen("1,250.00")).toBeNull();
	});

	test("round-trips every realistic sen amount shape", () => {
		for (const sen of [30, 100, 999, 1250, 12345, 1000000]) {
			expect(decimalStringToSen(senToDecimalString(sen))).toBe(sen);
		}
	});
});

describe("mapHitpayPaymentType", () => {
	test("maps MY rails onto the order method union", () => {
		expect(mapHitpayPaymentType("duitnow")).toBe("duitnow");
		expect(mapHitpayPaymentType("touch_n_go")).toBe("tng");
		expect(mapHitpayPaymentType("fpx")).toBe("fpx");
		expect(mapHitpayPaymentType("card")).toBe("card");
		expect(mapHitpayPaymentType("TOUCH_N_GO")).toBe("tng");
	});

	test("maps SG rails onto the order method union (86eyph341)", () => {
		// Before SG-lite these fell through to "other", so a PayNow-settled SG
		// order told the Insights donut and the Method filter nothing.
		expect(mapHitpayPaymentType("paynow_online")).toBe("paynow");
		expect(mapHitpayPaymentType("paynow")).toBe("paynow");
		expect(mapHitpayPaymentType("PAYNOW_ONLINE")).toBe("paynow");
	});

	test("GrabPay maps in both markets — the stamp follows the money", () => {
		// MY's picker deliberately doesn't OFFER GrabPay, but HitPay MY can
		// settle one; the tag is not gated on the seller's country list.
		expect(mapHitpayPaymentType("grabpay")).toBe("grabpay");
		expect(mapHitpayPaymentType("grabpay_direct")).toBe("grabpay");
	});

	test("unknown wallets degrade to other; absent stays undefined", () => {
		expect(mapHitpayPaymentType("shopee_pay")).toBe("other");
		expect(mapHitpayPaymentType("boost")).toBe("other");
		expect(mapHitpayPaymentType("some_new_wallet")).toBe("other");
		expect(mapHitpayPaymentType(undefined)).toBeUndefined();
	});
});

describe("describeGatewayMethods", () => {
	test("names only the rails the account actually has", () => {
		expect(describeGatewayMethods(["duitnow", "touch_n_go"])).toBe(
			"DuitNow or Touch 'n Go",
		);
		expect(describeGatewayMethods(["fpx"])).toBe("FPX");
		expect(describeGatewayMethods(["touch_n_go", "duitnow", "fpx", "card"])).toBe(
			"Touch 'n Go, DuitNow, FPX or card",
		);
	});

	test("dedupes aliases, skips unknown codes, caps the sentence", () => {
		expect(describeGatewayMethods(["grabpay", "grabpay_direct"])).toBe(
			"GrabPay",
		);
		expect(describeGatewayMethods(["some_new_rail"])).toBeNull();
		expect(describeGatewayMethods(undefined)).toBeNull();
		expect(describeGatewayMethods([])).toBeNull();
		expect(
			describeGatewayMethods([
				"touch_n_go",
				"duitnow",
				"fpx",
				"card",
				"grabpay",
			]),
		).toBe("Touch 'n Go, DuitNow, FPX and more");
	});
});

describe("buildPaymentRequestParams", () => {
	const inputs = {
		amountSen: 4550,
		currency: "myr",
		shortId: "ORD-AB12",
		storeName: "Kek Nadia",
		redirectUrl: "https://kedaipal.com/track/tok123",
		webhookUrl: "https://example.convex.site/webhook/hitpay",
		buyerName: "Aina",
		buyerPhone: "60123456789",
	};

	test("maps order facts to HitPay's form fields", () => {
		const p = buildPaymentRequestParams(inputs);
		expect(p.get("amount")).toBe("45.50");
		expect(p.get("currency")).toBe("MYR");
		expect(p.get("purpose")).toBe("Order ORD-AB12 — Kek Nadia");
		expect(p.get("reference_number")).toBe("ORD-AB12");
		expect(p.get("redirect_url")).toBe(inputs.redirectUrl);
		expect(p.get("webhook")).toBe(inputs.webhookUrl);
		expect(p.get("name")).toBe("Aina");
		expect(p.get("phone")).toBe("60123456789");
		expect(p.get("expires_after")).toBe("60 mins");
	});

	test("suppresses HitPay's own SMS/email notifications (SMS defaults ON upstream)", () => {
		const p = buildPaymentRequestParams(inputs);
		expect(p.get("send_sms")).toBe("false");
		expect(p.get("send_email")).toBe("false");
		expect(p.get("email")).toBeNull();
	});

	test("omits absent buyer fields instead of sending empties", () => {
		const p = buildPaymentRequestParams({
			...inputs,
			buyerName: undefined,
			buyerPhone: undefined,
		});
		expect(p.get("name")).toBeNull();
		expect(p.get("phone")).toBeNull();
	});
});

describe("v1 webhook hmac", () => {
	const salt = "j3O9-test-salt";
	const fields = {
		payment_id: "pay_123",
		payment_request_id: "req_456",
		phone: "",
		amount: "12.50",
		currency: "MYR",
		status: "completed",
		reference_number: "ORD-AB12",
	};

	async function signed(): Promise<Record<string, string>> {
		return { ...fields, hmac: await computeHitpayHmac(fields, salt) };
	}

	test("round-trip: computed hmac verifies", async () => {
		expect(await verifyHitpayWebhook(await signed(), salt)).toBe(true);
	});

	test("hmac source is key-sorted and excludes the hmac field itself", async () => {
		// Same fields presented in a different insertion order must produce the
		// same signature — the sort is what makes verification deterministic.
		const shuffled: Record<string, string> = {
			status: fields.status,
			amount: fields.amount,
			payment_id: fields.payment_id,
			reference_number: fields.reference_number,
			currency: fields.currency,
			phone: fields.phone,
			payment_request_id: fields.payment_request_id,
		};
		expect(await computeHitpayHmac(shuffled, salt)).toBe(
			await computeHitpayHmac(fields, salt),
		);
		// And a payload that already carries an hmac field signs identically —
		// the field is excluded from its own source.
		expect(await computeHitpayHmac(await signed(), salt)).toBe(
			await computeHitpayHmac(fields, salt),
		);
	});

	test("tampered amount fails verification", async () => {
		const payload = await signed();
		payload.amount = "1.00";
		expect(await verifyHitpayWebhook(payload, salt)).toBe(false);
	});

	test("wrong salt / missing hmac / empty salt all fail closed", async () => {
		const payload = await signed();
		expect(await verifyHitpayWebhook(payload, "other-salt")).toBe(false);
		expect(await verifyHitpayWebhook(fields, salt)).toBe(false);
		expect(await verifyHitpayWebhook(payload, "")).toBe(false);
	});
});

describe("decryptHitpayCredentials (86eyn25gk)", () => {
	test("re-infers mode from the PLAINTEXT key — ciphertext would always read production", async () => {
		vi.stubEnv(
			"CREDENTIALS_ENCRYPTION_KEY",
			btoa("0123456789abcdef0123456789abcdef"),
		);
		try {
			const stored = resolveHitpayCredentials({
				apiKey: await encryptSecret("test_abc123"),
				salt: await encryptSecret("s1"),
			});
			// Pre-decrypt, the sync resolver can only see ciphertext: presence is
			// right, mode is not — which is exactly why actions must decrypt.
			expect(stored).not.toBeNull();
			expect(stored?.mode).toBe("production");
			const live = await decryptHitpayCredentials(stored!);
			expect(live).toEqual({
				apiKey: "test_abc123",
				salt: "s1",
				mode: "sandbox",
			});
		} finally {
			vi.unstubAllEnvs();
		}
	});

	test("legacy plaintext rows pass through unchanged", async () => {
		const live = await decryptHitpayCredentials({
			apiKey: "test_plain",
			salt: "s2",
			mode: "sandbox",
		});
		expect(live).toEqual({ apiKey: "test_plain", salt: "s2", mode: "sandbox" });
	});
});
