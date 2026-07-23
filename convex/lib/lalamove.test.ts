// Pure Lalamove client helpers — signing, credential resolution, money
// conversion, response parsing, status normalization. See lalamove.ts.
import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
	buildLalamoveHeaders,
	buildPlaceOrderBody,
	buildQuotationBody,
	extractWebhookOrderId,
	isActiveJobStatus,
	lalamoveAmountToSen,
	lalamoveSigningString,
	normalizeLalamoveStatus,
	parseLalamoveEventTime,
	parseOrderResponse,
	parseQuotationResponse,
	inferLalamoveEnv,
	resolveLalamoveCredentials,
	signLalamoveRequest,
	toLalamoveMyPhone,
	toLalamovePhone,
} from "./lalamove";

describe("request signing", () => {
	test("signing string is TIMESTAMP\\r\\nMETHOD\\r\\nPATH\\r\\n\\r\\nBODY", () => {
		expect(
			lalamoveSigningString({
				timestamp: 1700000000000,
				method: "post",
				path: "/v3/quotations",
				body: '{"data":{}}',
			}),
		).toBe('1700000000000\r\nPOST\r\n/v3/quotations\r\n\r\n{"data":{}}');
	});

	test("HMAC matches an independent node:crypto reference", async () => {
		const secret = "sk_test_secret";
		const args = {
			secret,
			timestamp: 1700000000000,
			method: "POST",
			path: "/v3/quotations",
			body: '{"data":{"serviceType":"MOTORCYCLE"}}',
		};
		const expected = createHmac("sha256", secret)
			.update(lalamoveSigningString(args))
			.digest("hex");
		expect(await signLalamoveRequest(args)).toBe(expected);
	});

	test("buildLalamoveHeaders assembles the hmac Authorization + market", async () => {
		const headers = await buildLalamoveHeaders({
			credentials: { apiKey: "pk_test_k", apiSecret: "sk_test_s" },
			method: "POST",
			path: "/v3/orders",
			body: "{}",
			timestamp: 1234,
			requestId: "rid-1",
		});
		expect(headers.Authorization).toMatch(/^hmac pk_test_k:1234:[0-9a-f]{64}$/);
		expect(headers.Market).toBe("MY");
		expect(headers["Request-ID"]).toBe("rid-1");
		expect(headers["Content-Type"]).toBe("application/json");
	});
});

describe("resolveLalamoveCredentials", () => {
	test("the seller's key pair resolves; env comes from the key prefix", () => {
		expect(
			resolveLalamoveCredentials({ apiKey: "pk_test_abc", apiSecret: "sk_x" }),
		).toEqual({ apiKey: "pk_test_abc", apiSecret: "sk_x", env: "sandbox" });
		expect(
			resolveLalamoveCredentials({ apiKey: "pk_prod_abc", apiSecret: "sk_x" }),
		).toEqual({ apiKey: "pk_prod_abc", apiSecret: "sk_x", env: "production" });
	});

	test("half a credential or nothing → null (BYO-only, fail closed)", () => {
		// updateSettings refuses storing half a credential, so this state is a
		// defensive branch — documented behaviour: never sign with a mismatched
		// pair, and there is NO platform fallback to fall through to.
		expect(resolveLalamoveCredentials({ apiKey: "pk_test_only" })).toBeNull();
		expect(resolveLalamoveCredentials({ apiSecret: "sk_only" })).toBeNull();
		expect(resolveLalamoveCredentials(undefined)).toBeNull();
		expect(resolveLalamoveCredentials({})).toBeNull();
	});

	test("inferLalamoveEnv: pk_test_ → sandbox, anything else → production", () => {
		expect(inferLalamoveEnv("pk_test_e7b0")).toBe("sandbox");
		expect(inferLalamoveEnv("pk_prod_e7b0")).toBe("production");
		// Unknown prefixes default to production — safer to fail a booking
		// against prod auth than to silently run a real key against sandbox.
		expect(inferLalamoveEnv("pk_something")).toBe("production");
	});
});

describe("lalamoveAmountToSen", () => {
	test("converts MY decimal strings without float dust", () => {
		expect(lalamoveAmountToSen("13.5")).toBe(1350);
		expect(lalamoveAmountToSen("8")).toBe(800);
		expect(lalamoveAmountToSen("10.25")).toBe(1025);
		expect(lalamoveAmountToSen(7)).toBe(700);
		expect(lalamoveAmountToSen("0")).toBe(0);
	});

	test("rejects anything that isn't money", () => {
		expect(() => lalamoveAmountToSen("abc")).toThrow(/Unparseable/);
		expect(() => lalamoveAmountToSen("-5")).toThrow(/Unparseable/);
		expect(() => lalamoveAmountToSen("1.234")).toThrow(/Unparseable/);
		expect(() => lalamoveAmountToSen("")).toThrow(/Unparseable/);
	});
});

describe("payload builders", () => {
	test("quotation body wraps in data with string coordinates, rounded to 6dp", () => {
		const body = buildQuotationBody({
			serviceType: "MOTORCYCLE",
			stops: [
				{
					coordinates: { latitude: 3.139, longitude: 101.6869 },
					address: "Origin",
				},
				{
					// High-precision Google double + float noise — must round to
					// ≤6 decimals so Lalamove's 15-fraction-digit regex accepts it.
					coordinates: {
						latitude: 3.0999999999999996,
						longitude: 101.71528123456789,
					},
					address: "Destination",
				},
			],
		});
		expect(body.data.serviceType).toBe("MOTORCYCLE");
		expect(body.data.stops).toEqual([
			{ coordinates: { lat: "3.139", lng: "101.6869" }, address: "Origin" },
			{ coordinates: { lat: "3.1", lng: "101.715281" }, address: "Destination" },
		]);
	});

	test("place-order body converts phones to E.164 and threads metadata", () => {
		const body = buildPlaceOrderBody({
			quotationId: "q1",
			sender: { stopId: "s1", name: "Store", phone: "60123456789" },
			recipient: { stopId: "s2", name: "Aisha", phone: "60198765432" },
			orderRef: "ORD-1234",
		});
		const data = body.data as {
			sender: { phone: string };
			recipients: Array<{ phone: string }>;
			metadata: { orderRef: string };
		};
		expect(data.sender.phone).toBe("+60123456789");
		expect(data.recipients[0].phone).toBe("+60198765432");
		expect(data.metadata.orderRef).toBe("ORD-1234");
	});

	test("toLalamovePhone strips non-digits and prefixes +", () => {
		expect(toLalamovePhone("60123456789")).toBe("+60123456789");
		expect(toLalamovePhone("+60 12-345 6789")).toBe("+60123456789");
	});
});

describe("response parsing", () => {
	test("quotation response → id, sen total, stop ids", () => {
		const parsed = parseQuotationResponse({
			data: {
				quotationId: "quot-1",
				priceBreakdown: { total: "13.5", currency: "MYR" },
				stops: [{ stopId: "a" }, { stopId: "b" }],
				distance: { value: "4715", unit: "m" },
				expiresAt: "2026-07-21T04:05:00.00Z",
			},
		});
		expect(parsed).toEqual({
			quotationId: "quot-1",
			priceTotal: 1350,
			currency: "MYR",
			stopIds: ["a", "b"],
			distanceMeters: 4715,
			expiresAt: "2026-07-21T04:05:00.00Z",
		});
	});

	test("quotation response missing pieces throws (never a garbage fee)", () => {
		expect(() => parseQuotationResponse({})).toThrow(/missing data/);
		expect(() =>
			parseQuotationResponse({ data: { quotationId: "q" } }),
		).toThrow(/priceBreakdown/);
		expect(() =>
			parseQuotationResponse({
				data: {
					quotationId: "q",
					priceBreakdown: { total: "5" },
					stops: [{ stopId: "a" }],
				},
			}),
		).toThrow(/stops/);
	});

	test("order response → provider id, sen cost, shareLink", () => {
		const parsed = parseOrderResponse({
			data: {
				orderId: "3243",
				priceBreakdown: { total: "14.0" },
				shareLink: "https://share.lalamove.com/?MY123",
				status: "ASSIGNING_DRIVER",
			},
		});
		expect(parsed.providerOrderId).toBe("3243");
		expect(parsed.priceTotal).toBe(1400);
		expect(parsed.shareLink).toBe("https://share.lalamove.com/?MY123");
		expect(parsed.status).toBe("ASSIGNING_DRIVER");
	});
});

describe("status + webhook helpers", () => {
	test("normalizes the 7 documented statuses, undefined for unknowns", () => {
		expect(normalizeLalamoveStatus("ASSIGNING_DRIVER")).toBe("assigning");
		expect(normalizeLalamoveStatus("ON_GOING")).toBe("ongoing");
		expect(normalizeLalamoveStatus("PICKED_UP")).toBe("picked_up");
		expect(normalizeLalamoveStatus("COMPLETED")).toBe("completed");
		expect(normalizeLalamoveStatus("CANCELED")).toBe("canceled");
		expect(normalizeLalamoveStatus("EXPIRED")).toBe("expired");
		expect(normalizeLalamoveStatus("REJECTED")).toBe("rejected");
		expect(normalizeLalamoveStatus("SOMETHING_NEW")).toBeUndefined();
		expect(normalizeLalamoveStatus(undefined)).toBeUndefined();
	});

	test("active vs terminal job statuses (one-active-job slot)", () => {
		expect(isActiveJobStatus("assigning")).toBe(true);
		expect(isActiveJobStatus("picked_up")).toBe(true);
		expect(isActiveJobStatus("completed")).toBe(false);
		expect(isActiveJobStatus("expired")).toBe(false);
	});

	test("extractWebhookOrderId reads data.order.orderId, undefined otherwise", () => {
		expect(extractWebhookOrderId({ order: { orderId: "123" } })).toBe("123");
		expect(extractWebhookOrderId({ balance: "12.0" })).toBeUndefined();
		expect(extractWebhookOrderId(null)).toBeUndefined();
	});

	test("event time prefers data.updatedAt, tolerates second-unit envelopes", () => {
		expect(
			parseLalamoveEventTime(
				{ updatedAt: "2026-07-21T04:00:00.000Z" },
				1700000000,
			),
		).toBe(Date.parse("2026-07-21T04:00:00.000Z"));
		// No updatedAt: ms passthrough, seconds get scaled.
		expect(parseLalamoveEventTime({}, 1784384000000)).toBe(1784384000000);
		expect(parseLalamoveEventTime({}, 1784384000)).toBe(1784384000000);
	});
});

describe("toLalamoveMyPhone", () => {
	test("accepts MY numbers in stored-digit and formatted shapes", () => {
		expect(toLalamoveMyPhone("60123456789")).toBe("+60123456789");
		expect(toLalamoveMyPhone("+60 12-345 6789")).toBe("+60123456789");
		expect(toLalamoveMyPhone("601112345678")).toBe("+601112345678");
	});

	test("rejects non-MY area codes (the +65 buyer that 422'd in testing)", () => {
		expect(toLalamoveMyPhone("6581815321")).toBeNull();
		expect(toLalamoveMyPhone("+6581815321")).toBeNull();
		expect(toLalamoveMyPhone("14155551234")).toBeNull();
	});

	test("rejects junk: empty, undefined, too short/long", () => {
		expect(toLalamoveMyPhone(undefined)).toBeNull();
		expect(toLalamoveMyPhone("")).toBeNull();
		expect(toLalamoveMyPhone("60123")).toBeNull();
		expect(toLalamoveMyPhone("6012345678901234")).toBeNull();
		// "60" prefix but the number is actually a landline-length stub
		expect(toLalamoveMyPhone("603123")).toBeNull();
	});
});
