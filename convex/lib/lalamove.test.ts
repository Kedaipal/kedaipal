// Pure Lalamove client helpers — signing, credential resolution, money
// conversion, response parsing, status normalization. See lalamove.ts.
import { createHmac } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { encryptSecret } from "./credentialCrypto";
import { EARLIEST_FULFILMENT_LEAD_MINUTES } from "./fulfilmentDate";
import {
	MIN_SCHEDULE_LEAD_MS,
	resolveDispatchSchedule,
	resolveScheduleAt,
	buildLalamoveHeaders,
	buildPlaceOrderBody,
	buildQuotationBody,
	classifyQuoteFailure,
	extractWebhookOrderId,
	classifyBookingFailure,
	isActiveJobStatus,
	isOutOfServiceAreaError,
	isRiderManagedTransition,
	lalamoveAmountToSen,
	lalamoveSigningString,
	normalizeLalamoveStatus,
	parseLalamoveErrorCode,
	parseLalamoveEventTime,
	parseOrderResponse,
	parsePodImages,
	parseQuotationResponse,
	decryptLalamoveCredentials,
	inferLalamoveEnv,
	resolveLalamoveCredentials,
	riderDrivesOrderStatus,
	signLalamoveRequest,
	toLalamoveCoordinates,
	hasLalamoveCredentials,
	lalamoveMarketForCountry,
	toLalamoveContactPhone,
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
			credentials: {
				apiKey: "pk_test_k",
				apiSecret: "sk_test_s",
				market: "MY",
			},
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
			resolveLalamoveCredentials(
				{ apiKey: "pk_test_abc", apiSecret: "sk_x" },
				"MY",
			),
		).toEqual({
			apiKey: "pk_test_abc",
			apiSecret: "sk_x",
			env: "sandbox",
			market: "MY",
		});
		expect(
			resolveLalamoveCredentials(
				{ apiKey: "pk_prod_abc", apiSecret: "sk_x" },
				"MY",
			),
		).toEqual({
			apiKey: "pk_prod_abc",
			apiSecret: "sk_x",
			env: "production",
			market: "MY",
		});
	});

	test("half a credential or nothing → null (BYO-only, fail closed)", () => {
		// updateSettings refuses storing half a credential, so this state is a
		// defensive branch — documented behaviour: never sign with a mismatched
		// pair, and there is NO platform fallback to fall through to.
		expect(resolveLalamoveCredentials({ apiKey: "pk_test_only" }, "MY")).toBeNull();
		expect(resolveLalamoveCredentials({ apiSecret: "sk_only" }, "MY")).toBeNull();
		expect(resolveLalamoveCredentials(undefined, "MY")).toBeNull();
		expect(resolveLalamoveCredentials({}, "MY")).toBeNull();
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

	test("parses Lalamove's error id out of a failure body", () => {
		// The real 422 body, captured live from the MY sandbox (27 Jul 2026).
		expect(
			parseLalamoveErrorCode(
				'{"errors":[{"id":"ERR_OUT_OF_SERVICE_AREA","message":"Given latitude/longitude is out of service area."}]}\n',
			),
		).toBe("ERR_OUT_OF_SERVICE_AREA");
		expect(parseLalamoveErrorCode('{"errors":[]}')).toBeUndefined();
		expect(parseLalamoveErrorCode("<html>502 Bad Gateway</html>")).toBeUndefined();
		expect(parseLalamoveErrorCode("")).toBeUndefined();
	});

	test("out-of-service-area is distinguished from transient failures", () => {
		// Coverage refusals are PERMANENT for that address — the buyer must be
		// told to change it, never "try again shortly".
		expect(
			isOutOfServiceAreaError(
				'{"errors":[{"id":"ERR_OUT_OF_SERVICE_AREA","message":"Given latitude/longitude is out of service area."}]}',
			),
		).toBe(true);
		expect(
			isOutOfServiceAreaError('{"errors":[{"id":"ERR_INVALID_MARKET"}]}'),
		).toBe(true);
		// Everything else is retryable / a different problem entirely.
		expect(
			isOutOfServiceAreaError('{"errors":[{"id":"ERR_INVALID_SERVICE_TYPE"}]}'),
		).toBe(false);
		expect(
			isOutOfServiceAreaError('{"errors":[{"id":"ERR_INSUFFICIENT_BALANCE"}]}'),
		).toBe(false);
		expect(isOutOfServiceAreaError("gateway timeout")).toBe(false);
	});

	test("classifyQuoteFailure: three buyer stories, only one retryable", () => {
		const OOSA =
			'{"errors":[{"id":"ERR_OUT_OF_SERVICE_AREA","message":"Given latitude/longitude is out of service area."}]}';
		// Coverage refusal — permanent for the address, regardless of HTTP status.
		expect(classifyQuoteFailure(422, OOSA)).toBe("out_of_range");
		expect(classifyQuoteFailure(422, '{"errors":[{"id":"ERR_INVALID_MARKET"}]}')).toBe(
			"out_of_range",
		);
		// Seller-side breakage — revoked/typo'd key signs an invalid request.
		expect(classifyQuoteFailure(401, "unauthorized")).toBe("store_unavailable");
		expect(classifyQuoteFailure(403, "forbidden")).toBe("store_unavailable");
		// Everything else stays honestly transient.
		expect(classifyQuoteFailure(500, "internal error")).toBe("unavailable");
		expect(classifyQuoteFailure(429, "rate limited")).toBe("unavailable");
		expect(
			classifyQuoteFailure(422, '{"errors":[{"id":"ERR_INVALID_SERVICE_TYPE"}]}'),
		).toBe("unavailable");
		expect(classifyQuoteFailure(undefined, "socket hang up")).toBe("unavailable");
	});

	test("classifyBookingFailure keys off the error id, not the body text", () => {
		// The real refusal Wagyu Walid hit nine times (86eypncfy).
		expect(
			classifyBookingFailure('{"errors":[{"id":"ERR_INSUFFICIENT_BALANCE"}]}'),
		).toBe("wallet");
		expect(
			classifyBookingFailure('{"errors":[{"id":"ERR_INSUFFICIENT_CREDIT"}]}'),
		).toBe("wallet");
		expect(
			classifyBookingFailure('{"errors":[{"id":"ERR_INVALID_QUOTATION"}]}'),
		).toBe("quote_expired");
		expect(
			classifyBookingFailure('{"errors":[{"id":"ERR_INVALID_PHONE_NUMBER"}]}'),
		).toBe("bad_phone");
		expect(
			classifyBookingFailure('{"errors":[{"id":"ERR_OUT_OF_SERVICE_AREA"}]}'),
		).toBe("out_of_range");

		// THE REGRESSION THIS EXISTS FOR: the old code lowercased the whole body
		// and matched "balance"/"credit"/"insufficient" anywhere in it. Lalamove
		// ships a free-text `message` beside the id, so an unrelated failure
		// whose wording happens to contain one of those words was reported as a
		// wallet problem — and a seller told to top up spends real money that
		// fixes nothing. The id is the only thing we trust.
		expect(
			classifyBookingFailure(
				'{"errors":[{"id":"ERR_INVALID_SERVICE_TYPE","message":"Service not available on this credit account balance tier"}]}',
			),
		).toBe("unknown");
		// A recognised-but-uncopied id stops at "unknown" rather than falling
		// through to sniffing its message.
		expect(
			classifyBookingFailure(
				'{"errors":[{"id":"ERR_SOMETHING_NEW","message":"insufficient balance"}]}',
			),
		).toBe("unknown");

		// No parseable id (HTML error page, socket error) — text sniffing is the
		// last resort, and only on the unambiguous phrases.
		expect(classifyBookingFailure("Insufficient balance for this order")).toBe(
			"wallet",
		);
		expect(classifyBookingFailure("<html>502 Bad Gateway</html>")).toBe(
			"unknown",
		);
		expect(classifyBookingFailure("socket hang up")).toBe("unknown");
	});

	test("inferLalamoveEnv reads the key prefix, and only the prefix", () => {
		expect(inferLalamoveEnv("pk_test_abc123")).toBe("sandbox");
		expect(inferLalamoveEnv("pk_prod_abc123")).toBe("production");
		// Ciphertext must NEVER read as sandbox-or-not by accident — it resolves
		// to "production", which is exactly why `deliveryBooking.env` is stamped
		// from plaintext at save and never derived from a stored value
		// (86eypncfy).
		expect(inferLalamoveEnv("enc.v1.abc.def")).toBe("production");
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

	test("riderDrivesOrderStatus: active job + applied webhook event only", () => {
		// Webhook demonstrably alive → the rider drives the order status.
		expect(
			riderDrivesOrderStatus({ status: "assigning", lastEventAt: 1_753_500_000_000 }),
		).toBe(true);
		expect(
			riderDrivesOrderStatus({ status: "picked_up", lastEventAt: 1_753_500_000_000 }),
		).toBe(true);
		// No event ever applied = webhook-less seller — manual control is their
		// documented degraded path, never gated.
		expect(riderDrivesOrderStatus({ status: "assigning" })).toBe(false);
		// Terminal jobs free the order regardless of event history.
		expect(
			riderDrivesOrderStatus({ status: "completed", lastEventAt: 1_753_500_000_000 }),
		).toBe(false);
		expect(
			riderDrivesOrderStatus({ status: "canceled", lastEventAt: 1_753_500_000_000 }),
		).toBe(false);
	});

	test("isRiderManagedTransition: shipped/delivered anchors that change status", () => {
		expect(isRiderManagedTransition("shipped", "packed")).toBe(true);
		expect(isRiderManagedTransition("delivered", "shipped")).toBe(true);
		// Pre-pickup work stays the seller's — confirm/pack are never gated.
		expect(isRiderManagedTransition("confirmed", "pending")).toBe(false);
		expect(isRiderManagedTransition("packed", "confirmed")).toBe(false);
		// Custom stages WITHIN the shipped band don't change canonical status.
		expect(isRiderManagedTransition("shipped", "shipped")).toBe(false);
	});
});

describe("toLalamoveContactPhone", () => {
	// This function used to be MY-only, and its old test carried an explicit
	// warning: "a future 'accept 65 everywhere' sweep that touches this
	// function breaks real bookings". That warning still stands and is
	// honoured here — SG numbers are accepted in the SG MARKET, and remain
	// rejected in the MY one. Lalamove validates the area code per market, so
	// loosening it globally would 422 real Malaysian bookings.
	test("accepts MY numbers in stored-digit and formatted shapes", () => {
		expect(toLalamoveContactPhone("60123456789", "MY")).toBe("+60123456789");
		expect(toLalamoveContactPhone("+60 12-345 6789", "MY")).toBe(
			"+60123456789",
		);
		expect(toLalamoveContactPhone("601112345678", "MY")).toBe("+601112345678");
	});

	test("accepts SG numbers in the SG market", () => {
		expect(toLalamoveContactPhone("6581815321", "SG")).toBe("+6581815321");
		expect(toLalamoveContactPhone("+65 8181 5321", "SG")).toBe("+6581815321");
	});

	test("the +65 buyer still 422s a MALAYSIAN booking — unchanged", () => {
		// The case that was measured in testing. Returning null routes dispatch
		// to its fallback: the seller's own number as rider contact, the buyer's
		// in the remarks.
		expect(toLalamoveContactPhone("6581815321", "MY")).toBeNull();
		expect(toLalamoveContactPhone("+6581815321", "MY")).toBeNull();
		expect(toLalamoveContactPhone("14155551234", "MY")).toBeNull();
	});

	test("…and the mirror case: a +60 number is foreign in Singapore", () => {
		// The Johor cross-border buyer, in the other direction. It only became
		// reachable when SG got riders, and it must fail the same way.
		expect(toLalamoveContactPhone("60123456789", "SG")).toBeNull();
	});

	test("SG length is exact — 65 plus eight digits, no more", () => {
		expect(toLalamoveContactPhone("658181532", "SG")).toBeNull();
		expect(toLalamoveContactPhone("65818153210", "SG")).toBeNull();
	});

	test("rejects junk: empty, undefined, too short/long", () => {
		expect(toLalamoveContactPhone(undefined, "MY")).toBeNull();
		expect(toLalamoveContactPhone("", "MY")).toBeNull();
		expect(toLalamoveContactPhone("60123", "MY")).toBeNull();
		expect(toLalamoveContactPhone("6012345678901234", "MY")).toBeNull();
		// "60" prefix but the number is actually a landline-length stub
		expect(toLalamoveContactPhone("603123", "MY")).toBeNull();
	});
});

describe("lalamoveMarketForCountry", () => {
	test("maps the store's country to its market", () => {
		expect(lalamoveMarketForCountry("MY")).toBe("MY");
		expect(lalamoveMarketForCountry("SG")).toBe("SG");
	});

	test("an unknown or missing country falls back to MY, never to nothing", () => {
		// A request with no Market header is rejected outright, so the fallback
		// has to be a real market. MY is the one every existing store is in.
		expect(lalamoveMarketForCountry(undefined)).toBe("MY");
		expect(lalamoveMarketForCountry("ID")).toBe("MY");
	});
});

describe("toLalamoveCoordinates — precision guard", () => {
	test("rounds to 6 decimals so Google's 15+ digit doubles pass Lalamove's regex", () => {
		// The bug: String(3.1501234567890123) → 16 fractional digits → 422.
		expect(toLalamoveCoordinates({ latitude: 3.1501234567890123, longitude: 101.60671999999999 })).toEqual({
			lat: "3.150123",
			lng: "101.60672",
		});
	});
	test("float round-trip noise is normalized (3.0999999999999996 → 3.1)", () => {
		expect(toLalamoveCoordinates({ latitude: 3.0999999999999996, longitude: 101.7 })).toEqual({
			lat: "3.1",
			lng: "101.7",
		});
	});
	test("already-short coords pass through unchanged", () => {
		expect(toLalamoveCoordinates({ latitude: 3.1573, longitude: 101.7122 })).toEqual({
			lat: "3.1573",
			lng: "101.7122",
		});
	});
});

describe("proof of delivery", () => {
	test("place-order body always requests POD (isPODEnabled)", () => {
		const body = buildPlaceOrderBody({
			quotationId: "q1",
			sender: { stopId: "s1", name: "Store", phone: "60123456789" },
			recipient: { stopId: "s2", name: "Aisha", phone: "60198765432" },
		});
		expect((body.data as { isPODEnabled: boolean }).isPODEnabled).toBe(true);
	});

	test("parsePodImages: DELIVERED/SIGNED stops with images, others skipped", () => {
		const images = parsePodImages({
			data: {
				orderId: "LLM-1",
				stops: [
					// Sender stop — no POD object at all.
					{ stopId: "s1", address: "Store" },
					{
						stopId: "s2",
						POD: {
							status: "DELIVERED",
							image: "https://pod.lalamove.com/a.jpg",
							deliveredAt: "2026-07-24T02:00:00.000Z",
						},
					},
					{ stopId: "s3", POD: { status: "SIGNED", image: "https://pod.lalamove.com/b.jpg" } },
					// Not dropped off yet / failed / photo-less → all skipped.
					{ stopId: "s4", POD: { status: "PENDING", image: "https://pod.lalamove.com/c.jpg" } },
					{ stopId: "s5", POD: { status: "FAILED" } },
					{ stopId: "s6", POD: { status: "DELIVERED", image: "  " } },
				],
			},
		});
		expect(images).toEqual([
			{
				stopId: "s2",
				imageUrl: "https://pod.lalamove.com/a.jpg",
				status: "DELIVERED",
				deliveredAt: "2026-07-24T02:00:00.000Z",
			},
			{
				stopId: "s3",
				imageUrl: "https://pod.lalamove.com/b.jpg",
				status: "SIGNED",
				deliveredAt: undefined,
			},
		]);
	});

	test("parsePodImages: malformed/POD-less responses → empty, never throws", () => {
		expect(parsePodImages(null)).toEqual([]);
		expect(parsePodImages({})).toEqual([]);
		expect(parsePodImages({ data: { stops: "nope" } })).toEqual([]);
	});
});

describe("resolveScheduleAt (86eyg0n8e follow-up)", () => {
	const NOW = 1_785_000_000_000;
	const MIN = 60_000;

	test("a comfortably future moment schedules for exactly then", () => {
		expect(resolveScheduleAt(NOW + 90 * MIN, NOW)).toBe(NOW + 90 * MIN);
	});

	test("past and imminent moments book now — the buyer's ask is already due", () => {
		expect(resolveScheduleAt(NOW - 5 * MIN, NOW)).toBeUndefined();
		expect(resolveScheduleAt(NOW, NOW)).toBeUndefined();
		expect(resolveScheduleAt(NOW + 14 * MIN, NOW)).toBeUndefined();
	});

	test("exactly at the lead boundary schedules", () => {
		expect(resolveScheduleAt(NOW + 15 * MIN, NOW)).toBe(NOW + 15 * MIN);
	});

	test("the threshold tracks the checkout floor — one number, not two", () => {
		// Measured on the MY sandbox: Lalamove itself accepts +1 min and
		// refuses only past / >30 days. This threshold is OUR product choice,
		// and it must equal what the buyer was allowed to pick.
		expect(MIN_SCHEDULE_LEAD_MS).toBe(
			EARLIEST_FULFILMENT_LEAD_MINUTES * 60_000,
		);
	});

	test("beyond Lalamove's ~30-day window books now rather than erroring", () => {
		expect(
			resolveScheduleAt(NOW + 31 * 24 * 60 * MIN, NOW),
		).toBeUndefined();
	});

	test("no moment = the pre-existing immediate booking", () => {
		expect(resolveScheduleAt(undefined, NOW)).toBeUndefined();
	});
});

describe("decryptLalamoveCredentials (86eyn25gk)", () => {
	test("re-infers env from the PLAINTEXT key — ciphertext would always read production", async () => {
		vi.stubEnv(
			"CREDENTIALS_ENCRYPTION_KEY",
			btoa("0123456789abcdef0123456789abcdef"),
		);
		try {
			const stored = resolveLalamoveCredentials(
				{
					apiKey: await encryptSecret("pk_test_abc"),
					apiSecret: await encryptSecret("sk_test_abc"),
				},
				"MY",
			);
			expect(stored).not.toBeNull();
			expect(stored?.env).toBe("production");
			const live = await decryptLalamoveCredentials(stored!);
			expect(live).toEqual({
				apiKey: "pk_test_abc",
				apiSecret: "sk_test_abc",
				env: "sandbox",
				market: "MY",
			});
		} finally {
			vi.unstubAllEnvs();
		}
	});

	test("legacy plaintext rows pass through unchanged", async () => {
		const live = await decryptLalamoveCredentials({
			apiKey: "pk_test_x",
			apiSecret: "sk_x",
			env: "sandbox",
			market: "MY",
		});
		expect(live).toEqual({
			market: "MY",
			apiKey: "pk_test_x",
			apiSecret: "sk_x",
			env: "sandbox",
		});
	});
});

describe("resolveDispatchSchedule — seller pickup-time override (86eyp5qd1)", () => {
	const NOW = 1_785_000_000_000;
	const MIN = 60_000;
	const DAY = 24 * 60 * MIN;
	const BUYER = NOW + 5 * 60 * MIN; // buyer's fulfilment moment, 5h out

	test("no override delegates to the buyer's moment — byte-identical to the old path", () => {
		expect(resolveDispatchSchedule(undefined, BUYER, NOW)).toEqual({
			ok: true,
			scheduleAt: resolveScheduleAt(BUYER, NOW),
		});
		expect(resolveDispatchSchedule(undefined, undefined, NOW)).toEqual({
			ok: true,
			scheduleAt: undefined,
		});
	});

	test('"now" forces an immediate booking even when the buyer\'s moment is ahead', () => {
		expect(resolveDispatchSchedule("now", BUYER, NOW)).toEqual({
			ok: true,
			scheduleAt: undefined,
		});
	});

	test("a comfortably future pick schedules for exactly then", () => {
		expect(resolveDispatchSchedule(NOW + 90 * MIN, BUYER, NOW)).toEqual({
			ok: true,
			scheduleAt: NOW + 90 * MIN,
		});
	});

	test("an imminent pick degrades to book-now, same clamp the buyer path uses", () => {
		expect(resolveDispatchSchedule(NOW + 14 * MIN, BUYER, NOW)).toEqual({
			ok: true,
			scheduleAt: undefined,
		});
	});

	test("an explicit pick beyond the 30-day window is REFUSED, never silently booked now", () => {
		// Asymmetry with the buyer default (which degrades to now there): an
		// immediate rider is the opposite of what the seller just asked for.
		const result = resolveDispatchSchedule(NOW + 31 * DAY, BUYER, NOW);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toMatch(/30 days/);
	});

	test("exactly at the 30-day boundary still schedules", () => {
		expect(resolveDispatchSchedule(NOW + 30 * DAY, BUYER, NOW)).toEqual({
			ok: true,
			scheduleAt: NOW + 30 * DAY,
		});
	});
});

describe("the Market header follows the store, not the module (z8r3fdch3r)", () => {
	// The constant this replaces is what hid Lalamove from Singapore sellers:
	// Lalamove serves SG, our integration didn't. A request carrying the wrong
	// market prices and dispatches in the wrong country.
	test("an SG store's credentials sign SG requests", async () => {
		const headers = await buildLalamoveHeaders({
			credentials: {
				apiKey: "pk_test_k",
				apiSecret: "sk_test_s",
				market: "SG",
			},
			method: "POST",
			path: "/v3/quotations",
			body: "{}",
			timestamp: 1234,
			requestId: "rid-sg",
		});
		expect(headers.Market).toBe("SG");
	});

	test("the market rides on the credentials, resolved from the store", () => {
		const sg = resolveLalamoveCredentials(
			{ apiKey: "pk_test_abc", apiSecret: "sk_x" },
			"SG",
		);
		expect(sg?.market).toBe("SG");
		const my = resolveLalamoveCredentials(
			{ apiKey: "pk_test_abc", apiSecret: "sk_x" },
			"MY",
		);
		expect(my?.market).toBe("MY");
	});

	test("decryption preserves the market — it comes from the store, not the key", async () => {
		const live = await decryptLalamoveCredentials({
			apiKey: "pk_test_x",
			apiSecret: "sk_x",
			env: "sandbox",
			market: "SG",
		});
		expect(live.market).toBe("SG");
	});

	test("hasLalamoveCredentials answers 'connected?' without inventing a country", () => {
		expect(
			hasLalamoveCredentials({ apiKey: "pk_test_a", apiSecret: "sk_b" }),
		).toBe(true);
		expect(hasLalamoveCredentials({ apiKey: "pk_test_a" })).toBe(false);
		expect(hasLalamoveCredentials(undefined)).toBe(false);
	});
})
