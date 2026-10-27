// EasyParcel Open API (2026-09) wire helpers — every fixture below is the
// documented sample from easyparcel.github.io/OpenAPI, trimmed only where a
// key is irrelevant to the assertion.
import { describe, expect, it } from "vitest";
import {
	accessTokenNeedsRefresh,
	apiWeight,
	basicAuthHeader,
	buildAuthorizeUrl,
	buildCancelBody,
	buildQuotationBody,
	buildSubmitBody,
	buildTokenRequestBody,
	classifyEasyparcelFailure,
	EasyparcelApiError,
	easyparcelAmountToMinor,
	normalizeEasyparcelStatus,
	PARCEL_BOXES,
	parseAccountResponse,
	parseCancelResponse,
	parseDetailsResponse,
	parseQuotationResponse,
	parseSubmitResponse,
	parseTokenResponse,
	parseWalletResponse,
	parseWebhookShipmentNumber,
	SG_SUBDIVISION_CODE,
	splitPhone,
	stateNameForSubdivision,
	subdivisionCode,
	TOKEN_REFRESH_SKEW_MS,
	tokenEnvironment,
} from "./easyparcel";

const NOW = Date.parse("2026-10-27T04:00:00.000Z");

describe("OAuth", () => {
	it("the authorize URL carries client id, redirect and state", () => {
		const url = new URL(
			buildAuthorizeUrl({
				clientId: "cid-1",
				redirectUri: "https://x.convex.site/oauth/easyparcel/callback",
				state: "nonce123",
			}),
		);
		expect(url.origin + url.pathname).toBe(
			"https://api.easyparcel.com/oauth/login",
		);
		expect(url.searchParams.get("client_id")).toBe("cid-1");
		expect(url.searchParams.get("redirect_uri")).toBe(
			"https://x.convex.site/oauth/easyparcel/callback",
		);
		expect(url.searchParams.get("state")).toBe("nonce123");
	});

	it("client auth is HTTP Basic over id:secret", () => {
		expect(basicAuthHeader("id", "secret")).toBe(`Basic ${btoa("id:secret")}`);
	});

	it("token bodies differ only by grant", () => {
		const code = new URLSearchParams(
			buildTokenRequestBody({
				kind: "authorization_code",
				code: "c0de",
				redirectUri: "https://r",
			}),
		);
		expect(code.get("grant_type")).toBe("authorization_code");
		expect(code.get("code")).toBe("c0de");
		expect(code.get("redirect_uri")).toBe("https://r");
		const refresh = new URLSearchParams(
			buildTokenRequestBody({
				kind: "refresh_token",
				refreshToken: "r3fresh",
				redirectUri: "https://r",
			}),
		);
		expect(refresh.get("grant_type")).toBe("refresh_token");
		expect(refresh.get("refresh_token")).toBe("r3fresh");
		expect(refresh.has("code")).toBe(false);
	});

	it("expiry comes from the durations, never the (inconsistent) timestamps", () => {
		// The documented sample: 36000s access, 1y refresh — with expires_at
		// values that disagree with those durations.
		const tokens = parseTokenResponse(
			JSON.stringify({
				token_type: "Bearer",
				expires_in: 36000,
				expires_at: "2024-12-12T13:03:23.013Z",
				access_token: "acc",
				refresh_token: "ref",
				refresh_token_expires_in: 31557600,
				refresh_token_expires_at: "2025-12-12T09:03:23.013Z",
			}),
			NOW,
		);
		expect(tokens).toEqual({
			accessToken: "acc",
			refreshToken: "ref",
			accessExpiresAt: NOW + 36000 * 1000,
			refreshExpiresAt: NOW + 31557600 * 1000,
		});
	});

	it("a response with no access token throws — never a silent half-connect", () => {
		expect(() =>
			parseTokenResponse(JSON.stringify({ error: "invalid_grant" }), NOW),
		).toThrow(/invalid_grant/);
	});

	it("refreshes ahead of expiry by the skew", () => {
		expect(accessTokenNeedsRefresh(NOW + TOKEN_REFRESH_SKEW_MS + 1, NOW)).toBe(
			false,
		);
		expect(accessTokenNeedsRefresh(NOW + TOKEN_REFRESH_SKEW_MS, NOW)).toBe(true);
		expect(accessTokenNeedsRefresh(NOW - 1, NOW)).toBe(true);
	});

	it("reads an environment claim from a JWT, and says nothing otherwise", () => {
		const jwt = (payload: object) =>
			`h.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.s`;
		expect(tokenEnvironment(jwt({ environment: "Sandbox" }))).toBe("sandbox");
		expect(tokenEnvironment(jwt({ env: "live" }))).toBe("live");
		expect(tokenEnvironment(jwt({ is_demo: true }))).toBe("sandbox");
		expect(tokenEnvironment(jwt({ sub: "123" }))).toBeUndefined();
		// Opaque tokens are the honest unknown — never read as live.
		expect(tokenEnvironment("opaque-token-abc")).toBeUndefined();
	});
});

describe("addresses + phones", () => {
	it("MY state names map to the documented ISO codes", () => {
		expect(subdivisionCode("MY", "Pulau Pinang")).toBe("MY-07");
		expect(subdivisionCode("MY", "Selangor")).toBe("MY-10");
		expect(subdivisionCode("MY", "WP Kuala Lumpur")).toBe("MY-14");
		expect(subdivisionCode("MY", undefined)).toBeUndefined();
		expect(stateNameForSubdivision("MY-10")).toBe("Selangor");
		expect(stateNameForSubdivision("XX-99")).toBeUndefined();
	});

	it("SG always sends the one constant subdivision", () => {
		expect(subdivisionCode("SG", undefined)).toBe(SG_SUBDIVISION_CODE);
		expect(subdivisionCode("SG", "Singapore")).toBe(SG_SUBDIVISION_CODE);
	});

	it("a phone splits into alpha-2 + national number (the documented pair)", () => {
		expect(splitPhone("601126760658")).toEqual({
			countryCode: "MY",
			nationalNumber: "1126760658",
		});
		expect(splitPhone("+65 9123 4567")).toEqual({
			countryCode: "SG",
			nationalNumber: "91234567",
		});
		expect(splitPhone("447700900123")).toBeNull();
	});

	it("declared weight rounds UP — never lighter than the real parcel", () => {
		expect(apiWeight(1.234)).toBe(1.24);
		expect(apiWeight(2)).toBe(2);
		expect(apiWeight(0)).toBe(0.01);
	});
});

describe("quotations", () => {
	it("builds the documented request, box and subdivision included", () => {
		const body = buildQuotationBody({
			sender: { postcode: "079903", country: "SG" },
			receiver: { postcode: "460123", country: "SG" },
			weightKg: 1.5,
			dims: PARCEL_BOXES.small,
			parcelValue: 45,
		});
		expect(body).toEqual({
			api_rate_on: true,
			shipment: [
				{
					sender: {
						postcode: "079903",
						subdivision_code: SG_SUBDIVISION_CODE,
						country: "SG",
					},
					receiver: {
						postcode: "460123",
						subdivision_code: SG_SUBDIVISION_CODE,
						country: "SG",
					},
					parcel_value: 45,
					weight: 1.5,
					length: 20,
					width: 15,
					height: 10,
				},
			],
		});
	});

	const quotation = (service_id: string, amount: number, extra = {}) => ({
		courier: {
			service_id,
			service_name: `${service_id} service`,
			courier_id: "EP-CR0AP",
			courier_name: "Aramex",
			courier_logo: "https://cdn/aramex.jpg",
			delivery_duration: null,
			is_pickup: true,
			is_dropoff: false,
			...extra,
		},
		pricing: { currency: "SGD", total_amount: amount + 1, seller_payable_amount: amount },
	});

	it("parses the documented envelope, prices what the SELLER pays, cheapest first", () => {
		const rates = parseQuotationResponse(
			JSON.stringify({
				status_code: 200,
				message: "1 request success, 0 request error.",
				data: [
					{
						status: "success",
						quotations: [
							quotation("EP-CS096", 12.31),
							quotation("EP-CS0XX", 5.5, { is_pickup: false, is_dropoff: true }),
						],
					},
				],
			}),
		);
		expect(rates.map((r) => r.serviceId)).toEqual(["EP-CS0XX", "EP-CS096"]);
		expect(rates[0]).toMatchObject({
			priceMinor: 550,
			currency: "SGD",
			isPickup: false,
			isDropoff: true,
		});
		expect(rates[1].priceMinor).toBe(1231);
	});

	it("an empty quotation list is an answer, not an error", () => {
		expect(
			parseQuotationResponse(
				JSON.stringify({
					status_code: 200,
					data: [{ status: "success", quotations: [] }],
				}),
			),
		).toEqual([]);
	});

	it("an item-level error throws EasyParcel's own words (HTTP 200 regardless)", () => {
		try {
			parseQuotationResponse(
				JSON.stringify({
					status_code: 200,
					data: [{ status: "error", errors: ["The receiver postcode field is required"] }],
				}),
			);
			expect.unreachable();
		} catch (err) {
			expect(err).toBeInstanceOf(EasyparcelApiError);
			expect((err as EasyparcelApiError).detail).toContain("receiver postcode");
			expect(classifyEasyparcelFailure(err as EasyparcelApiError)).toBe(
				"invalid_address",
			);
		}
	});

	it("a malformed price row is skipped, never sinks the quote", () => {
		const rates = parseQuotationResponse(
			JSON.stringify({
				status_code: 200,
				data: [
					{
						status: "success",
						quotations: [
							quotation("OK-1", 4),
							{ courier: { service_id: "BAD" }, pricing: { seller_payable_amount: "RM 9" } },
						],
					},
				],
			}),
		);
		expect(rates.map((r) => r.serviceId)).toEqual(["OK-1"]);
	});
});

describe("submit — books AND charges in one call", () => {
	const party = {
		name: "Kedai SG",
		phone: "6591234567",
		unit: "#05-11",
		address1: "10 Anson Road",
		city: "Singapore",
		postcode: "079903",
		country: "SG" as const,
	};

	it("builds a single shipment: unit folded into line 1, every paid add-on OFF", () => {
		const body = buildSubmitBody({
			serviceId: "EP-CS096",
			collectionDate: "2026-10-27",
			weightKg: 1.5,
			dims: PARCEL_BOXES.medium,
			items: [{ content: "Keropok Lekor", weightKg: 0.5, value: 15, quantity: 3 }],
			currency: "SGD",
			sender: party,
			receiver: { ...party, name: "Mei Ling", unit: undefined, address1: "Blk 123 Bedok North" },
			reference: "ORD-AB12",
		}) as { shipment: Array<Record<string, any>> };
		const s = body.shipment[0];
		expect(s.service_id).toBe("EP-CS096");
		expect(s.reference).toBe("ORD-AB12");
		expect([s.length, s.width, s.height]).toEqual([30, 25, 15]);
		expect(s.sender.address_1).toBe("#05-11 10 Anson Road");
		expect(s.sender.phone_number_country_code).toBe("SG");
		expect(s.sender.phone_number).toBe("91234567");
		expect(s.receiver.address_1).toBe("Blk 123 Bedok North");
		expect(s.item[0]).toMatchObject({
			content: "Keropok Lekor",
			weight: 0.5,
			currency_code: "SGD",
			value: 15,
			quantity: 3,
			length: 30,
		});
		expect(s.feature).toEqual({
			sms_tracking: false,
			email_tracking: false,
			whatsapp_tracking: false,
		});
	});

	it("parses the shipment: number, AWB, A6 label, tracking, what was paid", () => {
		const booked = parseSubmitResponse(
			JSON.stringify({
				status_code: 200,
				data: [
					{
						order_details: { order_number: "EI-2602-4P2SK", account_id: 8583757 },
						shipments: [
							{
								status: "success",
								shipment_number: "ES-2602-VC4KV",
								courier: "DHL eCommerce",
								awb_number: "7028021894371796",
								awb_url: "https://app.easyparcel.com/label/X?format=A4",
								awb_urls_by_format: {
									A4: "https://app.easyparcel.com/label/X?format=A4",
									A5: "",
									A6: "https://app.easyparcel.com/label/X?format=A6",
								},
								tracking_url: "https://app.easyparcel.com/tools/easytrack/details?awb=7028",
								pricing_breakdown: { currency_code: "MYR", total_paid_amount: "13.42" },
							},
						],
					},
				],
			}),
		);
		expect(booked).toEqual({
			shipmentNumber: "ES-2602-VC4KV",
			orderNumber: "EI-2602-4P2SK",
			courierName: "DHL eCommerce",
			awb: "7028021894371796",
			labelUrl: "https://app.easyparcel.com/label/X?format=A6",
			trackingUrl: "https://app.easyparcel.com/tools/easytrack/details?awb=7028",
			paidMinor: 1342,
			currency: "MYR",
		});
	});

	it("an AWB not issued yet reads as absent, never as an empty string", () => {
		const booked = parseSubmitResponse(
			JSON.stringify({
				status_code: 200,
				data: [
					{
						shipments: [
							{
								status: "success",
								shipment_number: "ES-2602-4VW9E",
								awb_number: null,
								awb_url: "",
								awb_urls_by_format: { A4: "", A5: "", A6: "" },
								tracking_url: null,
								pricing_breakdown: { total_paid_amount: "10.25" },
							},
						],
					},
				],
			}),
		);
		expect(booked.awb).toBeUndefined();
		expect(booked.labelUrl).toBeUndefined();
		expect(booked.trackingUrl).toBeUndefined();
	});

	it("a shipment refused inside a 200 throws with its errors", () => {
		expect(() =>
			parseSubmitResponse(
				JSON.stringify({
					status_code: 200,
					data: [{ shipments: [{ status: "error", errors: ["Insufficient credit balance"] }] }],
				}),
			),
		).toThrow(/Insufficient credit/);
	});
});

describe("details, cancel, wallet, account", () => {
	it("details reads status code + AWB from shipment_details", () => {
		expect(
			parseDetailsResponse(
				JSON.stringify({
					status_code: 200,
					data: [
						{
							shipment_number: "ES-2601-K8S32",
							shipment_details: {
								shipment_status_code: 3,
								shipment_status: "Collected",
								awb_number: "AWB1",
								awb_url: "https://l",
								tracking_url: "https://t",
							},
						},
					],
				}),
			),
		).toEqual({
			shipmentNumber: "ES-2601-K8S32",
			statusCode: 3,
			statusText: "Collected",
			awb: "AWB1",
			labelUrl: "https://l",
			trackingUrl: "https://t",
		});
	});

	it("a 404 carried inside the envelope throws", () => {
		expect(() =>
			parseDetailsResponse(
				JSON.stringify({ status_code: 404, message: "No Order with shipment_number X found", data: [] }),
			),
		).toThrow(/No Order/);
	});

	it("cancel: success, and EasyParcel's refusal sentence passed through", () => {
		expect(buildCancelBody("ES-1", "r")).toEqual({
			cancel_list: [{ shipment_number: "ES-1", remark: "r" }],
		});
		expect(
			parseCancelResponse(
				JSON.stringify({
					status_code: 200,
					data: [{ status: "success", message: "Shipment Cancelled", shipment_number: "ES-1" }],
				}),
			),
		).toEqual({ ok: true });
		expect(
			parseCancelResponse(
				JSON.stringify({
					status_code: 200,
					data: [
						{
							status: "error",
							message: "The shipment cancellation period is over (7 days from collection date: 2025-05-19)",
						},
					],
				}),
			),
		).toEqual({
			ok: false,
			message: "The shipment cancellation period is over (7 days from collection date: 2025-05-19)",
		});
	});

	it("wallet: the main balance in minor units", () => {
		expect(
			parseWalletResponse(
				JSON.stringify({
					status_code: 200,
					data: { wallet: [{ balance: 250.5, currency: "SGD" }], free_credit_wallet: [] },
				}),
			),
		).toEqual({ balanceMinor: 25050, currency: "SGD" });
	});

	it("account: name, type and the pickup address as a prefill", () => {
		expect(
			parseAccountResponse(
				JSON.stringify({
					status_code: 200,
					data: {
						account: { name: "Test wk", account_type: "Personal" },
						address: {
							pickup_address: {
								address1: "No. 25, Jalan SS15/8A",
								address2: null,
								postcode: "47500",
								city: "Subang Jaya",
								province_code: "MY-10",
								country_code: "MY",
							},
						},
					},
				}),
			),
		).toEqual({
			name: "Test wk",
			accountType: "Personal",
			pickupAddress: {
				address1: "No. 25, Jalan SS15/8A",
				address2: undefined,
				city: "Subang Jaya",
				state: "Selangor",
				postcode: "47500",
				country: "MY",
			},
		});
	});

	it("auth failures classify as reconnect territory, credit as credit", () => {
		expect(classifyEasyparcelFailure(new EasyparcelApiError("auth", 401, "Invalid Access Token"))).toBe("auth");
		expect(classifyEasyparcelFailure(new EasyparcelApiError("rate_limited", 429, ""))).toBe("rate_limited");
		expect(classifyEasyparcelFailure(new EasyparcelApiError("item", 200, "Insufficient credit"))).toBe("credit");
		expect(classifyEasyparcelFailure(new EasyparcelApiError("item", 200, "Something odd"))).toBe("unknown");
	});

	it("money: numbers and decimal strings alike; garbage throws", () => {
		expect(easyparcelAmountToMinor(12.31)).toBe(1231);
		expect(easyparcelAmountToMinor("23.67")).toBe(2367);
		expect(easyparcelAmountToMinor(9999999123.88)).toBe(999999912388);
		expect(() => easyparcelAmountToMinor("MYR10.00")).toThrow();
		expect(() => easyparcelAmountToMinor(null)).toThrow();
	});
});

describe("status codes", () => {
	it("maps the documented table onto job statuses", () => {
		expect(normalizeEasyparcelStatus(7)).toBe("assigning");
		expect(normalizeEasyparcelStatus(2)).toBe("assigning");
		expect(normalizeEasyparcelStatus(3)).toBe("picked_up");
		expect(normalizeEasyparcelStatus(11)).toBe("picked_up");
		expect(normalizeEasyparcelStatus(4)).toBe("picked_up");
		expect(normalizeEasyparcelStatus(5)).toBe("completed");
		expect(normalizeEasyparcelStatus(0)).toBe("canceled");
		expect(normalizeEasyparcelStatus(6)).toBe("rejected");
	});

	it("On Hold and unknown codes move nothing", () => {
		expect(normalizeEasyparcelStatus(8)).toBeUndefined();
		expect(normalizeEasyparcelStatus(99)).toBeUndefined();
		expect(normalizeEasyparcelStatus(undefined)).toBeUndefined();
	});
});

describe("webhook body", () => {
	it("takes ONLY a well-formed shipment number from it", () => {
		expect(
			parseWebhookShipmentNumber(
				JSON.stringify({ topic: "shipment.status.update", shipment_number: "ES-2602-4VW9E", shipment_status_code: 5 }),
			),
		).toBe("ES-2602-4VW9E");
		expect(parseWebhookShipmentNumber(JSON.stringify({ shipment_number: "../../etc" }))).toBeNull();
		expect(parseWebhookShipmentNumber("not json")).toBeNull();
		expect(parseWebhookShipmentNumber(JSON.stringify({ topic: "x" }))).toBeNull();
	});
});
