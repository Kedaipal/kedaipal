// Pure Delyva client mechanics (86eyjpv6z) — payload building, response
// parsing, status normalization, webhook HMAC, failure classification. No
// Convex imports; the fixtures mirror payloads captured live against a demo
// account on 27 Aug 2026.
import { describe, expect, test } from "vitest";
import {
	buildCreateOrderBody,
	buildDelyvaHeaders,
	buildInstantQuoteBody,
	classifyDelyvaFailure,
	countActiveDelyvaServices,
	computeDelyvaWebhookSignature,
	decryptDelyvaCredentials,
	delyvaAmountToSen,
	DELYVA_WEBHOOK_EVENTS,
	isFailedDeliveryAttempt,
	normalizeDelyvaStatus,
	parseDelyvaErrorMessage,
	parseDelyvaWebhookEvent,
	parseCompanyResponse,
	parseInstantQuoteResponse,
	parseOrderResponse,
	resolveDelyvaCredentials,
	roundKg,
	verifyDelyvaWebhook,
} from "./delyva";

describe("resolveDelyvaCredentials", () => {
	test("resolves a full credential", () => {
		expect(
			resolveDelyvaCredentials({
				apiKey: " dx123 ",
				apiSecret: "sec",
				customerId: 128399,
			}),
		).toEqual({ apiKey: "dx123", apiSecret: "sec", customerId: 128399 });
	});
	test("null without a key or without a customerId", () => {
		expect(resolveDelyvaCredentials(undefined)).toBeNull();
		expect(resolveDelyvaCredentials({ apiKey: "  " })).toBeNull();
		expect(resolveDelyvaCredentials({ apiKey: "dx123" })).toBeNull();
		expect(resolveDelyvaCredentials({ customerId: 1 })).toBeNull();
	});
	test("apiSecret is optional (quote calls only need the key)", () => {
		const creds = resolveDelyvaCredentials({ apiKey: "dx1", customerId: 2 });
		expect(creds).not.toBeNull();
		expect(creds?.apiSecret).toBeUndefined();
	});
});

describe("decryptDelyvaCredentials", () => {
	test("plaintext passes through when the env key is unset", async () => {
		const live = await decryptDelyvaCredentials({
			apiKey: "dx-plain",
			apiSecret: "sec-plain",
			customerId: 7,
		});
		expect(live).toEqual({
			apiKey: "dx-plain",
			apiSecret: "sec-plain",
			customerId: 7,
		});
	});
});

describe("buildDelyvaHeaders", () => {
	test("carries the access token", () => {
		expect(buildDelyvaHeaders("dx-abc")).toEqual({
			"Content-Type": "application/json",
			"X-Delyvax-Access-Token": "dx-abc",
		});
	});
});

describe("delyvaAmountToSen", () => {
	test("integer and decimal major units", () => {
		expect(delyvaAmountToSen(5)).toBe(500);
		expect(delyvaAmountToSen(18.5)).toBe(1850);
		expect(delyvaAmountToSen("6.25")).toBe(625);
		expect(delyvaAmountToSen("0")).toBe(0);
	});
	test("throws on garbage — a mis-parsed fee must never land", () => {
		expect(() => delyvaAmountToSen("RM6")).toThrow();
		expect(() => delyvaAmountToSen("-5")).toThrow();
		expect(() => delyvaAmountToSen("1.234")).toThrow();
		expect(() => delyvaAmountToSen(Number.NaN)).toThrow();
	});
});

describe("roundKg", () => {
	test("gram precision, no float dust", () => {
		expect(roundKg(2.4999999999)).toBe(2.5);
		expect(roundKg(0.0004)).toBe(0);
		expect(roundKg(1.2345)).toBe(1.235);
	});
});

describe("buildInstantQuoteBody", () => {
	test("shape matches the probed API contract", () => {
		const body = buildInstantQuoteBody({
			customerId: 128399,
			origin: {
				address1: "12 Jalan Ampang",
				city: "Kuala Lumpur",
				state: "Kuala Lumpur",
				postcode: "50450",
				country: "MY",
			},
			destination: {
				address1: "88 Jalan Tun Jugah",
				city: "Kuching",
				state: "Sarawak",
				postcode: "93350",
				country: "MY",
			},
			weightKg: 2.5,
			itemType: "CHILLED",
		});
		expect(body).toMatchObject({
			customerId: 128399,
			itemType: "CHILLED",
			weight: { unit: "kg", value: 2.5 },
		});
	});
});

/** Trimmed from a live PARCEL quote against the demo account. */
const QUOTE_FIXTURE = {
	errors: [],
	data: {
		services: [
			{
				price: { amount: 5, currency: "MYR" },
				service: {
					id: 1737,
					name: "Instant Delivery",
					code: "DX-INST",
					serviceType: "INSTANT",
					serviceCompany: {
						companyCode: "TEST-DELIVERY",
						name: "Expres Delivery",
						logo: "servicecompany/293_1628606761662_12.png",
					},
				},
				itemType: ["PARCEL", "PACKAGE", "FOOD"],
			},
			{
				price: { amount: 6, currency: "MYR" },
				service: {
					id: 2985,
					name: "DHL eCommerce",
					code: "DHLEC-MY",
					serviceType: "NDD",
					serviceCompany: { name: "DHL Ecommerce", logo: "servicecompany/562.png" },
				},
				itemType: ["PARCEL"],
			},
		],
	},
};

describe("parseInstantQuoteResponse", () => {
	test("parses the live fixture", () => {
		const services = parseInstantQuoteResponse(QUOTE_FIXTURE);
		expect(services).toHaveLength(2);
		expect(services[0]).toEqual({
			code: "DX-INST",
			name: "Instant Delivery",
			companyName: "Expres Delivery",
			logoPath: "servicecompany/293_1628606761662_12.png",
			price: 500,
			currency: "MYR",
			serviceType: "INSTANT",
			itemTypes: ["PARCEL", "PACKAGE", "FOOD"],
		});
		expect(services[1].price).toBe(600);
	});
	test("an empty service list is a valid answer (CHILLED on the demo account)", () => {
		expect(
			parseInstantQuoteResponse({ errors: [], data: { services: [] } }),
		).toEqual([]);
	});
	test("throws on shape surprises", () => {
		expect(() => parseInstantQuoteResponse({})).toThrow();
		expect(() => parseInstantQuoteResponse({ data: {} })).toThrow();
	});
	test("skips a malformed row instead of sinking the quote", () => {
		const services = parseInstantQuoteResponse({
			data: {
				services: [
					{ price: { amount: "??" }, service: { code: "X", name: "X" } },
					QUOTE_FIXTURE.data.services[1],
				],
			},
		});
		expect(services).toHaveLength(1);
		expect(services[0].code).toBe("DHLEC-MY");
	});
});

describe("buildCreateOrderBody", () => {
	const args = {
		customerId: 128399,
		origin: {
			address1: "12 Jalan Ampang",
			city: "Kuala Lumpur",
			state: "Kuala Lumpur",
			postcode: "50450",
			country: "MY",
			name: "Kedai Beku",
			phone: "60123456789",
			email: "seller@example.com",
		},
		destination: {
			address1: "7 Jalan Bukit Bintang",
			city: "Kuala Lumpur",
			state: "Kuala Lumpur",
			postcode: "55100",
			country: "MY",
			name: "Aisha",
			phone: "60198765432",
		},
		inventory: [
			{ name: "Frozen kuih", quantity: 2, priceSen: 2500, weightKg: 0.75 },
		],
		weightKg: 1.5,
		itemType: "CHILLED" as const,
		currency: "MYR",
		referenceNo: "ORD-1234",
	};

	test("shape matches the probed contract — contact-nested address, inventory on BOTH waypoints", () => {
		const body = buildCreateOrderBody(args) as {
			process: boolean;
			source: string;
			referenceNo: string;
			itemType: string;
			origin: { contact: Record<string, unknown>; inventory: unknown[] };
			destination: { contact: Record<string, unknown>; inventory: unknown[] };
		};
		expect(body.process).toBe(false);
		// The commission attribution — the 1% does not track without it.
		expect(body.source).toBe("kedaipal");
		expect(body.referenceNo).toBe("ORD-1234");
		expect(body.origin.contact).toMatchObject({
			name: "Kedai Beku",
			address1: "12 Jalan Ampang",
			postcode: "50450",
		});
		expect(body.origin.inventory).toHaveLength(1);
		expect(body.destination.inventory).toHaveLength(1);
		expect(body.destination.inventory[0]).toMatchObject({
			name: "Frozen kuih",
			type: "CHILLED",
			quantity: 2,
			price: { amount: 25, currency: "MYR" },
			weight: { unit: "kg", value: 0.75 },
		});
	});
	test("note is truncated, email omitted when absent", () => {
		const body = buildCreateOrderBody({
			...args,
			note: "x".repeat(500),
		}) as { note: string; destination: { contact: Record<string, unknown> } };
		expect(body.note).toHaveLength(400);
		expect(body.destination.contact.email).toBeUndefined();
	});
});

describe("parseOrderResponse", () => {
	test("draft create response (live fixture shape)", () => {
		const parsed = parseOrderResponse({
			data: {
				id: "c522339e-c9e5-4e9b-be03-f0d3b73cf2b4",
				price: { amount: 0, currency: "MYR" },
				consignmentNo: null,
				statusCode: 0,
				status: "draft",
			},
		});
		expect(parsed.delyvaOrderId).toBe("c522339e-c9e5-4e9b-be03-f0d3b73cf2b4");
		expect(parsed.price).toBe(0);
		expect(parsed.consignmentNo).toBeUndefined();
		expect(parsed.statusCode).toBe(0);
	});
	test("processed response with consignment + price", () => {
		const parsed = parseOrderResponse({
			data: {
				id: "abc",
				price: { amount: 18.5, currency: "MYR" },
				consignmentNo: "MY0012345678",
				statusCode: 100,
			},
		});
		expect(parsed).toEqual({
			delyvaOrderId: "abc",
			consignmentNo: "MY0012345678",
			price: 1850,
			statusCode: 100,
		});
	});
	test("tolerates an order-nested wrapper and an orderId key", () => {
		expect(
			parseOrderResponse({ data: { order: { orderId: "xyz" } } }).delyvaOrderId,
		).toBe("xyz");
	});
	test("throws when no order id can be found", () => {
		expect(() => parseOrderResponse({})).toThrow();
		expect(() => parseOrderResponse({ data: { price: 5 } })).toThrow();
	});
	test("unparseable price degrades to undefined, never a garbage fee", () => {
		expect(
			parseOrderResponse({ data: { id: "a", price: { amount: "??" } } }).price,
		).toBeUndefined();
	});
});

describe("normalizeDelyvaStatus", () => {
	test("the full plugin-verified code table", () => {
		expect(normalizeDelyvaStatus(100)).toBe("assigning");
		expect(normalizeDelyvaStatus(110)).toBe("assigning");
		expect(normalizeDelyvaStatus(200)).toBe("ongoing");
		expect(normalizeDelyvaStatus(400)).toBe("ongoing");
		expect(normalizeDelyvaStatus(475)).toBe("rejected");
		expect(normalizeDelyvaStatus(500)).toBe("picked_up");
		expect(normalizeDelyvaStatus(600)).toBe("picked_up");
		expect(normalizeDelyvaStatus(650)).toBe("picked_up");
		expect(normalizeDelyvaStatus(700)).toBe("completed");
		expect(normalizeDelyvaStatus(1000)).toBe("completed");
		expect(normalizeDelyvaStatus(900)).toBe("canceled");
	});
	test("unknown codes degrade to undefined, never throw", () => {
		expect(normalizeDelyvaStatus(0)).toBeUndefined();
		expect(normalizeDelyvaStatus(9999)).toBeUndefined();
		expect(normalizeDelyvaStatus(undefined)).toBeUndefined();
	});
	test("650 is the failed-attempt special case", () => {
		expect(isFailedDeliveryAttempt(650)).toBe(true);
		expect(isFailedDeliveryAttempt(475)).toBe(false);
	});
});

describe("parseDelyvaWebhookEvent", () => {
	test("order.created shape ({id, consignmentNo, statusCode})", () => {
		const event = parseDelyvaWebhookEvent(
			JSON.stringify({
				id: "delyva-1",
				consignmentNo: "MY001",
				statusCode: 100,
				customerId: 128399,
			}),
		);
		expect(event).toEqual({
			delyvaOrderId: "delyva-1",
			statusCode: 100,
			consignmentNo: "MY001",
			customerId: 128399,
			eventAt: undefined,
			statusText: undefined,
		});
	});
	test("tracking shape ({orderId, …}) with string coercions + date", () => {
		const event = parseDelyvaWebhookEvent(
			JSON.stringify({
				orderId: "delyva-2",
				consignmentNo: "MY002",
				statusCode: "500",
				customerId: "128399",
				date: "2026-08-27T10:00:00.000Z",
				status: "collected",
			}),
		);
		expect(event?.delyvaOrderId).toBe("delyva-2");
		expect(event?.statusCode).toBe(500);
		expect(event?.customerId).toBe(128399);
		expect(event?.eventAt).toBe(Date.parse("2026-08-27T10:00:00.000Z"));
		expect(event?.statusText).toBe("collected");
	});
	test("orderId wins over id when both are present (tracking events echo both)", () => {
		expect(
			parseDelyvaWebhookEvent(
				JSON.stringify({ id: "tracking-row-id", orderId: "the-order" }),
			)?.delyvaOrderId,
		).toBe("the-order");
	});
	test("null for non-order bodies and broken JSON", () => {
		expect(parseDelyvaWebhookEvent("{}")).toBeNull();
		expect(parseDelyvaWebhookEvent("not json")).toBeNull();
		expect(parseDelyvaWebhookEvent(JSON.stringify({ ping: true }))).toBeNull();
		expect(parseDelyvaWebhookEvent(JSON.stringify(null))).toBeNull();
	});
});

describe("webhook HMAC", () => {
	test("round-trips base64 HMAC-SHA256", async () => {
		const body = '{"orderId":"x","statusCode":500}';
		const signature = await computeDelyvaWebhookSignature(body, "secret-1");
		expect(
			await verifyDelyvaWebhook({
				rawBody: body,
				apiSecret: "secret-1",
				signatureHeader: signature,
			}),
		).toBe(true);
	});
	test("rejects a wrong secret, a tampered body, and a missing header", async () => {
		const body = '{"orderId":"x"}';
		const signature = await computeDelyvaWebhookSignature(body, "secret-1");
		expect(
			await verifyDelyvaWebhook({
				rawBody: body,
				apiSecret: "secret-2",
				signatureHeader: signature,
			}),
		).toBe(false);
		expect(
			await verifyDelyvaWebhook({
				rawBody: '{"orderId":"y"}',
				apiSecret: "secret-1",
				signatureHeader: signature,
			}),
		).toBe(false);
		expect(
			await verifyDelyvaWebhook({
				rawBody: body,
				apiSecret: "secret-1",
				signatureHeader: null,
			}),
		).toBe(false);
	});
});

describe("failure classification", () => {
	test("the live insufficient-credit refusal classifies as credit", () => {
		const body = JSON.stringify({
			error: {
				message:
					"Payment failed, You don't have enough credit balance. Bal: 0, Price: 5.00",
			},
		});
		expect(classifyDelyvaFailure(body)).toBe("credit");
		expect(parseDelyvaErrorMessage(body)).toContain("enough credit balance");
	});
	test("activation and no-service phrasings", () => {
		expect(
			classifyDelyvaFailure(
				JSON.stringify({ error: { message: "Pickup address not activated" } }),
			),
		).toBe("not_activated");
		expect(
			classifyDelyvaFailure(
				JSON.stringify({ error: { message: "No service available" } }),
			),
		).toBe("no_service");
	});
	test("unknown beats a wrong story", () => {
		expect(classifyDelyvaFailure("<html>gateway error</html>")).toBe("unknown");
		expect(
			classifyDelyvaFailure(JSON.stringify({ error: { message: "weird" } })),
		).toBe("unknown");
	});
	test("errors[] array variant parses too", () => {
		expect(
			parseDelyvaErrorMessage(
				JSON.stringify({ errors: [{ message: "first problem" }] }),
			),
		).toBe("first problem");
	});
});

describe("webhook subscription events", () => {
	test("covers created + both tracking channels", () => {
		expect(DELYVA_WEBHOOK_EVENTS).toEqual([
			"order.created",
			"order_tracking.update",
			"order_tracking.change",
		]);
	});
});

describe("countActiveDelyvaServices", () => {
	// An empty quote has two causes and only one is the seller's to fix; this
	// is how they're told apart (Zaki's SG account, 3 Sep).
	test("counts only the switched-on services", () => {
		expect(
			countActiveDelyvaServices({
				data: [
					{ code: "NDDX", status: 1 },
					{ code: "G-T1", status: 0 },
					{ code: "SDD", status: 1 },
				],
			}),
		).toBe(2);
	});

	test("returns 0 for an account with nothing connected", () => {
		expect(countActiveDelyvaServices({ data: [] })).toBe(0);
	});

	test("returns 0 when every service is switched off", () => {
		expect(countActiveDelyvaServices({ data: [{ status: 0 }] })).toBe(0);
	});

	// "We couldn't tell" must never render as an accusation.
	test("returns null for a malformed response", () => {
		expect(countActiveDelyvaServices({})).toBeNull();
		expect(countActiveDelyvaServices({ data: "nope" })).toBeNull();
		expect(countActiveDelyvaServices(null)).toBeNull();
	});
})

describe("parseCompanyResponse — the sandbox tenant counts as test too", () => {
	// Delyva's own developer guide sends integrators to trydx.delyva.app
	// ("try express"). Badging that LIVE would be the 86eypncfy failure: a
	// simulated booking that looks real until no courier turns up.
	test("flags the trydx sandbox by company code", () => {
		expect(parseCompanyResponse({ data: { code: "trydx" } }).isDemo).toBe(true);
	});

	test("…and by website, if the company was renamed", () => {
		expect(
			parseCompanyResponse({
				data: { code: "try-express", websiteUrl: "https://trydx.delyva.app" },
			}).isDemo,
		).toBe(true);
	});

	test("a real market tenant stays live", () => {
		expect(
			parseCompanyResponse({
				data: { code: "sg", websiteUrl: "https://sg.delyva.app" },
			}).isDemo,
		).toBe(false);
	});
})
