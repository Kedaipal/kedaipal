// Pure Delyva client mechanics (86eyjpv6z) — payload building, response
// parsing, status normalization, webhook HMAC, failure classification. No
// Convex imports; the fixtures mirror payloads captured live against a demo
// account on 27 Aug 2026.
import { describe, expect, test } from "vitest";
import {
	parseDelyvaWalletBalance,
	buildCreateOrderBody,
	delyvaBaseServiceType,
	delyvaHandoff,
	delyvaLabelAvailability,
	delyvaLogoUrl,
	delyvaSpeedLabel,
	parseDelyvaLabelResponse,
	buildDelyvaHeaders,
	buildInstantQuoteBody,
	classifyDelyvaFailure,
	countActiveDelyvaServices,
	computeDelyvaWebhookSignature,
	decryptDelyvaCredentials,
	delyvaAmountToSen,
	DELYVA_WEBHOOK_EVENTS,
	isFailedDeliveryAttempt,
	isCollectedStatus,
	normalizeDelyvaStatus,
	parseDelyvaErrorMessage,
	parseDelyvaWebhookEvent,
	parseCompanyResponse,
	parseInstantQuoteResponse,
	parseOrderResponse,
	resolveDelyvaCredentials,
	roundKg,
	verifyDelyvaWebhook,
	DELYVA_STALE_AFTER_MS,
	DELYVA_WEBHOOK_EVENTS_REQUIRED,
	delyvaFailureReason,
	inTransitNotice,
	isDelyvaJobStale,
	isDueForSweepPull,
	isReturnedStatus,
	parseDelyvaOrderPull,
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

	test("an overseas buyer's number leading the note survives the 400-char cut (z8r3fdh274)", () => {
		// Dispatch puts it FIRST when the courier was handed the store's number
		// instead; a long address note must only ever lose its own tail.
		const lead = "Buyer WhatsApp: +447700900123";
		const body = buildCreateOrderBody({
			...args,
			destination: { ...args.destination, phone: "60123456789" },
			note: `${lead} · ${"x".repeat(500)}`,
		}) as { note: string };
		expect(body.note).toHaveLength(400);
		expect(body.note.startsWith(lead)).toBe(true);
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
	test("covers created + both tracking channels, plus the two full-order events (z8r3fe11y8)", () => {
		expect(DELYVA_WEBHOOK_EVENTS).toEqual([
			"order.created",
			"order_tracking.update",
			"order_tracking.change",
			"order.updated",
			"order.failed",
		]);
	});
	test("only the three documented events are required for a connect to count as subscribed", () => {
		expect([...DELYVA_WEBHOOK_EVENTS_REQUIRED].sort()).toEqual(
			["order.created", "order_tracking.change", "order_tracking.update"].sort(),
		);
		expect(DELYVA_WEBHOOK_EVENTS_REQUIRED.has("order.updated")).toBe(false);
		expect(DELYVA_WEBHOOK_EVENTS_REQUIRED.has("order.failed")).toBe(false);
	});
});

describe("failure and return codes (z8r3fe11y8 — Delyva's published status table)", () => {
	test("a test row per code: what each one normalises to", () => {
		// Failures that END the booking before the parcel left.
		expect(normalizeDelyvaStatus(99)).toBe("rejected");
		expect(normalizeDelyvaStatus(654)).toBe("rejected");
		expect(normalizeDelyvaStatus(655)).toBe("rejected");
		// Mid-flight notices: the parcel is with the courier.
		expect(normalizeDelyvaStatus(651)).toBe("picked_up");
		expect(normalizeDelyvaStatus(661)).toBe("picked_up");
		// The trip ended with the parcel back at the seller.
		expect(normalizeDelyvaStatus(663)).toBe("completed");
		expect(normalizeDelyvaStatus(701)).toBe("completed");
		// Informational steps from the same table, so lastEventAt moves on them.
		expect(normalizeDelyvaStatus(450)).toBe("ongoing");
		expect(normalizeDelyvaStatus(555)).toBe("picked_up");
		expect(normalizeDelyvaStatus(556)).toBe("picked_up");
		expect(normalizeDelyvaStatus(625)).toBe("picked_up");
		// Pre-booking states stay unmapped.
		expect(normalizeDelyvaStatus(0)).toBeUndefined();
		expect(normalizeDelyvaStatus(10)).toBeUndefined();
		expect(normalizeDelyvaStatus(11)).toBeUndefined();
	});
	test("returned is 663 and 701, nothing else", () => {
		expect(isReturnedStatus(701)).toBe(true);
		expect(isReturnedStatus(663)).toBe(true);
		for (const code of [99, 475, 500, 650, 651, 654, 655, 661, 700, 900, 1000])
			expect(isReturnedStatus(code)).toBe(false);
		expect(isReturnedStatus(undefined)).toBe(false);
	});
	test("collected stays right for every new code: never for a failure, always once the parcel moved", () => {
		for (const code of [99, 654, 655]) expect(isCollectedStatus(code)).toBe(false);
		for (const code of [651, 661, 663, 701]) expect(isCollectedStatus(code)).toBe(true);
	});
	test("the mid-flight notices", () => {
		expect(inTransitNotice(650)).toMatch(/retry or return/);
		expect(inTransitNotice(651)).toBe("Lost or damaged, claim with Delyva");
		expect(inTransitNotice(661)).toBe("Returning to sender");
		expect(inTransitNotice(600)).toBeUndefined();
		expect(inTransitNotice(701)).toBeUndefined();
	});
	test("one author for the reason: Delyva's words where they describe the event, ours where they don't", () => {
		expect(delyvaFailureReason(99, undefined)).toBe("Delyva could not create the order");
		expect(delyvaFailureReason(99, "Service unavailable for this route")).toBe(
			"Delyva could not create the order — Service unavailable for this route",
		);
		expect(delyvaFailureReason(654, undefined)).toBe("Courier cancelled the pickup");
		expect(delyvaFailureReason(654, "Failed - Driver cancel")).toBe("Failed - Driver cancel");
		expect(delyvaFailureReason(655, undefined)).toBe("The courier reported the booking as failed");
		expect(delyvaFailureReason(655, "  ")).toBe("The courier reported the booking as failed");
		expect(delyvaFailureReason(475, undefined)).toBe("The courier couldn't collect the parcel");
		expect(delyvaFailureReason(900, undefined)).toBe("Cancelled by Delyva");
		expect(delyvaFailureReason(651, "Lost")).toBe("Lost or damaged, claim with Delyva");
		expect(delyvaFailureReason(661, "x")).toBe("Returning to sender");
		expect(delyvaFailureReason(701, "Item Returned")).toBe("Returned to you");
		expect(delyvaFailureReason(663, undefined)).toMatch(/Failed to return/);
		// Ordinary progress clears a reason.
		expect(delyvaFailureReason(600, "In transit")).toBeUndefined();
		expect(delyvaFailureReason(700, "Delivered")).toBeUndefined();
	});
});

describe("the stale predicate (z8r3fe11y8)", () => {
	const DAY = 24 * 60 * 60 * 1000;
	const now = Date.parse("2026-11-05T00:00:00.000Z");
	const base = {
		status: "assigning" as const,
		providerOrderId: "DLV-1",
		createdAt: now - 25 * 60 * 60 * 1000,
	};
	test("booked a day ago with no event at all", () => {
		expect(isDelyvaJobStale(base, now)).toBe(true);
	});
	test("…or with the last event a day ago", () => {
		expect(isDelyvaJobStale({ ...base, lastEventAt: now - DAY - 1 }, now)).toBe(true);
		expect(isDelyvaJobStale({ ...base, status: "ongoing", lastEventAt: now - DAY - 1 }, now)).toBe(true);
	});
	test("not while a recent event exists, not before a day has passed", () => {
		expect(isDelyvaJobStale({ ...base, lastEventAt: now - 60_000 }, now)).toBe(false);
		expect(isDelyvaJobStale({ ...base, createdAt: now - 60_000 }, now)).toBe(false);
	});
	test("never for a reservation Delyva hasn't confirmed, or a job past its first scan", () => {
		expect(isDelyvaJobStale({ ...base, providerOrderId: undefined }, now)).toBe(false);
		expect(isDelyvaJobStale({ ...base, status: "picked_up" }, now)).toBe(false);
		expect(isDelyvaJobStale({ ...base, status: "completed" }, now)).toBe(false);
		expect(isDelyvaJobStale({ ...base, status: "rejected" }, now)).toBe(false);
	});
	test("the sweep pulls a stale job every hour until it is flagged, then once a day (PR #461 review)", () => {
		expect(isDueForSweepPull(base, now)).toBe(true);
		expect(isDueForSweepPull({ ...base, lastPulledAt: now - 60_000 }, now)).toBe(true);
		const flagged = { ...base, staleSince: now - 2 * DAY };
		expect(isDueForSweepPull(flagged, now)).toBe(true); // never pulled since
		expect(isDueForSweepPull({ ...flagged, lastPulledAt: now - 60 * 60 * 1000 }, now)).toBe(false);
		expect(isDueForSweepPull({ ...flagged, lastPulledAt: now - DAY }, now)).toBe(true);
		// Never for a job that isn't stale at all.
		expect(isDueForSweepPull({ ...base, lastEventAt: now - 60_000 }, now)).toBe(false);
	});
	test("the window is one day", () => {
		expect(DELYVA_STALE_AFTER_MS).toBe(DAY);
	});
});

describe("the full-order payload (order.updated / order.failed / a pull)", () => {
	const fullOrder = {
		id: "delyva-9",
		consignmentNo: "MY0099",
		statusCode: 99,
		status: "failed",
		customerId: 128399,
		failedReason: "Service not available",
		cancelledReason: null,
		updatedAt: "2026-11-05T01:00:00.000Z",
		waypoint: [],
	};
	test("parses as an event keyed on `id`, with the reason from failedReason and never the bare status word", () => {
		const event = parseDelyvaWebhookEvent(JSON.stringify(fullOrder));
		expect(event?.delyvaOrderId).toBe("delyva-9");
		expect(event?.statusCode).toBe(99);
		expect(event?.consignmentNo).toBe("MY0099");
		expect(event?.customerId).toBe(128399);
		expect(event?.statusText).toBe("Service not available");
		expect(event?.eventAt).toBe(Date.parse("2026-11-05T01:00:00.000Z"));
	});
	test("a full order with both reasons null carries no statusText — \"failed\" would read as a reason", () => {
		const event = parseDelyvaWebhookEvent(
			JSON.stringify({ ...fullOrder, failedReason: null, status: "failed" }),
		);
		expect(event?.statusText).toBeUndefined();
	});
	test("cancelledReason is the fallback", () => {
		const event = parseDelyvaWebhookEvent(
			JSON.stringify({ ...fullOrder, statusCode: 900, failedReason: "", cancelledReason: "Out of coverage" }),
		);
		expect(event?.statusText).toBe("Out of coverage");
	});
	test("a tracking row still prefers its own statusText over status", () => {
		const event = parseDelyvaWebhookEvent(
			JSON.stringify({ orderId: "delyva-2", statusCode: 654, statusText: "Failed - Driver cancel", status: "failed" }),
		);
		expect(event?.statusText).toBe("Failed - Driver cancel");
	});
	test("the pull unwraps Delyva's `{ data }` envelope (and a nested `order`)", () => {
		expect(parseDelyvaOrderPull({ data: fullOrder })?.delyvaOrderId).toBe("delyva-9");
		expect(parseDelyvaOrderPull({ order: fullOrder })?.statusCode).toBe(99);
		expect(parseDelyvaOrderPull(fullOrder)?.statusCode).toBe(99);
		expect(parseDelyvaOrderPull({ data: {} })).toBeNull();
		expect(parseDelyvaOrderPull(null)).toBeNull();
		expect(parseDelyvaOrderPull("nope")).toBeNull();
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

describe("parseDelyvaWalletBalance — the wallet on Delyva's customer profile", () => {
	test("reads the decimal string Delyva sends, in sen", () => {
		expect(parseDelyvaWalletBalance({ data: { walletBalance: "500.00" } })).toBe(
			50000,
		);
		expect(parseDelyvaWalletBalance({ data: { walletBalance: "12.5" } })).toBe(
			1250,
		);
		expect(parseDelyvaWalletBalance({ walletBalance: 7 })).toBe(700);
	});

	test("an overdrawn wallet reads negative; anything else is no answer", () => {
		expect(parseDelyvaWalletBalance({ data: { walletBalance: "-3.20" } })).toBe(
			-320,
		);
		expect(parseDelyvaWalletBalance({ data: {} })).toBeNull();
		expect(parseDelyvaWalletBalance({ data: { walletBalance: "RM5" } })).toBeNull();
		expect(parseDelyvaWalletBalance(null)).toBeNull();
	});
});


describe("isCollectedStatus — the tracking link's one gate (z8r3fe0t4e)", () => {
	test("every collected-or-later code is collected", () => {
		for (const code of [500, 600, 650, 700, 1000]) {
			expect(isCollectedStatus(code), String(code)).toBe(true);
		}
	});

	test("booked, accepted, collecting, failed collection and cancelled are not", () => {
		for (const code of [100, 110, 200, 400, 475, 900]) {
			expect(isCollectedStatus(code), String(code)).toBe(false);
		}
		expect(isCollectedStatus(undefined)).toBe(false);
	});

	test("an unknown code never counts as collected — a link needs a scan", () => {
		expect(isCollectedStatus(654)).toBe(false);
		expect(isCollectedStatus(999)).toBe(false);
	});
});

describe("pickup vs drop-off — the service class says who moves the parcel (z8r3fe11x3)", () => {
	test("a -DROP service parses with its serviceType and logoPath verbatim", () => {
		const services = parseInstantQuoteResponse({
			data: {
				services: [
					{
						price: { amount: 5, currency: "MYR" },
						service: {
							name: "J&T Express",
							code: "JNTMY-PN-B200",
							serviceType: "NDD-DROP",
							serviceCompany: {
								name: "J&T Express",
								logo: "servicecompany/jnt.png",
							},
						},
						itemType: ["PARCEL"],
					},
				],
			},
		});
		expect(services[0]).toMatchObject({
			code: "JNTMY-PN-B200",
			serviceType: "NDD-DROP",
			logoPath: "servicecompany/jnt.png",
			companyName: "J&T Express",
		});
	});

	test("the handoff is read from the suffix, case-insensitively", () => {
		expect(delyvaHandoff("NDD")).toBe("pickup");
		expect(delyvaHandoff("SDD")).toBe("pickup");
		expect(delyvaHandoff("INSTANT")).toBe("pickup");
		expect(delyvaHandoff("NDD-DROP")).toBe("dropoff");
		expect(delyvaHandoff("sdd-drop")).toBe("dropoff");
		expect(delyvaHandoff("SOMETHING-NEW")).toBe("pickup");
	});

	test("a missing class is UNDEFINED — never guessed here", () => {
		expect(delyvaHandoff(undefined)).toBeUndefined();
		expect(delyvaHandoff("")).toBeUndefined();
		expect(delyvaHandoff("  ")).toBeUndefined();
	});

	test("speed is judged on the base class, so NDD-DROP still reads Next-day", () => {
		expect(delyvaBaseServiceType("NDD-DROP")).toBe("NDD");
		expect(delyvaBaseServiceType("ndd")).toBe("NDD");
		expect(delyvaSpeedLabel("NDD-DROP")).toBe("Next-day");
		expect(delyvaSpeedLabel("NDD")).toBe("Next-day");
		expect(delyvaSpeedLabel("SDD-DROP")).toBe("Same-day");
		expect(delyvaSpeedLabel("INSTANT")).toBe("Same-day");
		expect(delyvaSpeedLabel("ECONOMY")).toBeUndefined();
		expect(delyvaSpeedLabel(undefined)).toBeUndefined();
	});

	test("the logo URL is the CDN root plus the quote's path, or nothing", () => {
		expect(delyvaLogoUrl("servicecompany/562.png")).toBe(
			"https://cdn.delyva.app/servicecompany/562.png",
		);
		expect(delyvaLogoUrl("/servicecompany/562.png")).toBe(
			"https://cdn.delyva.app/servicecompany/562.png",
		);
		expect(delyvaLogoUrl(undefined)).toBeUndefined();
		expect(delyvaLogoUrl("")).toBeUndefined();
	});
});

describe("the courier's label — GET /order/{id}/label (z8r3fe11x3)", () => {
	test("available only once Delyva confirmed the booking and before the first scan", () => {
		expect(
			delyvaLabelAvailability({ status: "assigning", providerOrderId: "DLV-1" }),
		).toEqual({ ok: true });
		expect(
			delyvaLabelAvailability({ status: "ongoing", providerOrderId: "DLV-1" }),
		).toEqual({ ok: true });
		expect(delyvaLabelAvailability({ status: "assigning" })).toEqual({
			ok: false,
			reason: "not_booked",
		});
		expect(
			delyvaLabelAvailability({ status: "picked_up", providerOrderId: "DLV-1" }),
		).toEqual({ ok: false, reason: "collected" });
		for (const status of ["completed", "canceled", "expired", "rejected"] as const) {
			expect(
				delyvaLabelAvailability({ status, providerOrderId: "DLV-1" }),
				status,
			).toEqual({ ok: false, reason: "ended" });
		}
	});

	const pdfBytes = () => new TextEncoder().encode("%PDF-1.4 label").buffer;
	const jsonBytes = (value: unknown) =>
		new TextEncoder().encode(JSON.stringify(value)).buffer;

	test("a PDF body is returned as bytes — by content type, or by its magic when the type is generic", () => {
		const typed = parseDelyvaLabelResponse({
			contentType: "application/pdf",
			body: pdfBytes(),
		});
		expect(typed.kind).toBe("pdf");
		const untyped = parseDelyvaLabelResponse({
			contentType: "application/octet-stream",
			body: pdfBytes(),
		});
		expect(untyped.kind).toBe("pdf");
		if (untyped.kind === "pdf")
			expect(new TextDecoder().decode(untyped.pdf)).toContain("%PDF");
	});

	test("a JSON envelope's URL is returned to open, whichever field and wrapper Delyva uses", () => {
		for (const body of [
			{ data: { url: "https://cdn.delyva.app/labels/1.pdf" } },
			{ url: "https://cdn.delyva.app/labels/1.pdf" },
			{ data: { labelUrl: "https://cdn.delyva.app/labels/1.pdf" } },
			{ data: "https://cdn.delyva.app/labels/1.pdf" },
			{ data: { link: " https://cdn.delyva.app/labels/1.pdf " } },
		]) {
			expect(
				parseDelyvaLabelResponse({
					contentType: "application/json; charset=utf-8",
					body: jsonBytes(body),
				}),
			).toEqual({ kind: "url", url: "https://cdn.delyva.app/labels/1.pdf" });
		}
	});

	test("anything else throws, so the card shows a failure instead of an empty tab", () => {
		expect(() =>
			parseDelyvaLabelResponse({
				contentType: "application/json",
				body: jsonBytes({ data: { id: "DLV-1" } }),
			}),
		).toThrow(/no label URL/);
		// A non-http "url" is not a link we'd open.
		expect(() =>
			parseDelyvaLabelResponse({
				contentType: "application/json",
				body: jsonBytes({ url: "javascript:alert(1)" }),
			}),
		).toThrow(/no label URL/);
		expect(() =>
			parseDelyvaLabelResponse({
				contentType: "text/html",
				body: new TextEncoder().encode("<html>login</html>").buffer,
			}),
		).toThrow(/not a PDF or JSON/);
		expect(() =>
			parseDelyvaLabelResponse({
				contentType: null,
				body: new ArrayBuffer(0),
			}),
		).toThrow(/empty/);
	});
});
