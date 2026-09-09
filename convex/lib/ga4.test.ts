import { describe, expect, test } from "vitest";
import {
	buildMpPayload,
	extractGaClientId,
	isValidGaClientId,
	syntheticGaClientId,
} from "./ga4";

describe("isValidGaClientId", () => {
	test("accepts the GA wire format: two dot-separated integers", () => {
		expect(isValidGaClientId("123456789.987654321")).toBe(true);
		expect(isValidGaClientId("1.2")).toBe(true);
	});

	test("rejects everything else", () => {
		expect(isValidGaClientId("")).toBe(false);
		expect(isValidGaClientId("GA1.1.123.456")).toBe(false);
		expect(isValidGaClientId("123.")).toBe(false);
		expect(isValidGaClientId(".456")).toBe(false);
		expect(isValidGaClientId("abc.def")).toBe(false);
		expect(isValidGaClientId("123")).toBe(false);
		expect(isValidGaClientId("1.2.3")).toBe(false);
		// Injection-shaped garbage must never pass through to the wire.
		expect(isValidGaClientId("1.2 OR 1=1")).toBe(false);
	});
});

describe("extractGaClientId", () => {
	test("pulls the client id out of a standard _ga cookie", () => {
		expect(extractGaClientId("_ga=GA1.1.123456789.987654321")).toBe(
			"123456789.987654321",
		);
	});

	test("finds _ga among other cookies regardless of position", () => {
		expect(
			extractGaClientId(
				"theme=dark; _ga=GA1.2.111.222; _ga_ABC123=GS1.1.x.y",
			),
		).toBe("111.222");
	});

	test("ignores property-scoped _ga_<ID> cookies (session cookies, not the client id)", () => {
		expect(extractGaClientId("_ga_ABC123=GS1.1.555.666")).toBeUndefined();
	});

	test("returns undefined for absent, blank, or malformed cookie", () => {
		expect(extractGaClientId(undefined)).toBeUndefined();
		expect(extractGaClientId("")).toBeUndefined();
		expect(extractGaClientId("theme=dark")).toBeUndefined();
		expect(extractGaClientId("_ga=garbage")).toBeUndefined();
		expect(extractGaClientId("_ga=GA1.1.abc.def")).toBeUndefined();
	});
});

describe("syntheticGaClientId", () => {
	test("is deterministic for the same seed", () => {
		expect(syntheticGaClientId("retailer_abc")).toBe(
			syntheticGaClientId("retailer_abc"),
		);
	});

	test("differs across seeds and is wire-format valid", () => {
		const a = syntheticGaClientId("retailer_abc");
		const b = syntheticGaClientId("retailer_xyz");
		expect(a).not.toBe(b);
		expect(isValidGaClientId(a)).toBe(true);
		expect(isValidGaClientId(b)).toBe(true);
	});
});

describe("buildMpPayload", () => {
	test("wraps one event with the client id and engagement time", () => {
		const payload = buildMpPayload({
			clientId: "123.456",
			event: "first_order",
			src: "tiktok",
		});
		expect(payload).toEqual({
			client_id: "123.456",
			events: [
				{
					name: "first_order",
					params: { engagement_time_msec: 1, src: "tiktok" },
				},
			],
		});
	});

	test("omits src when the retailer signed up untagged", () => {
		const payload = buildMpPayload({
			clientId: "123.456",
			event: "first_order",
		});
		expect(payload.events[0].params).toEqual({ engagement_time_msec: 1 });
	});

	test("merges extra params (subscribe_paid revenue shape)", () => {
		const payload = buildMpPayload({
			clientId: "1.2",
			event: "subscribe_paid",
			src: "referral-ganu",
			params: {
				plan: "pro",
				cycle: "monthly",
				first_time: true,
				value: 149,
				currency: "MYR",
			},
		});
		expect(payload.events[0]).toEqual({
			name: "subscribe_paid",
			params: {
				engagement_time_msec: 1,
				src: "referral-ganu",
				plan: "pro",
				cycle: "monthly",
				first_time: true,
				value: 149,
				currency: "MYR",
			},
		});
	});
});
