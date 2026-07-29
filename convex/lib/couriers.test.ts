import { describe, expect, it } from "vitest";
import {
	COURIER_NAME_MAX,
	COURIERS,
	findCourier,
	isSafeTrackingUrl,
	resolveShipmentFields,
	TRACKING_NO_MAX,
} from "./couriers";

describe("COURIERS registry", () => {
	it("has unique labels", () => {
		const labels = COURIERS.map((c) => c.label);
		expect(new Set(labels).size).toBe(labels.length);
	});

	it("builds encoded deep links for known couriers", () => {
		expect(findCourier("J&T Express")?.buildTrackingUrl?.("JT123 456")).toBe(
			"https://www.jtexpress.my/tracking/JT123%20456",
		);
		expect(findCourier("Ninja Van")?.buildTrackingUrl?.("NVMY1")).toBe(
			"https://www.ninjavan.co/en-my/tracking?id=NVMY1",
		);
	});

	it("cold-chain couriers are name-only (no URL builder)", () => {
		for (const label of [
			"Celsius Express",
			"DD Express (cold chain)",
			"Ninja Cold",
		]) {
			const entry = findCourier(label);
			expect(entry).toBeDefined();
			expect(entry?.buildTrackingUrl).toBeUndefined();
		}
	});
});

describe("resolveShipmentFields", () => {
	it("derives the URL from a known courier + tracking number", () => {
		expect(
			resolveShipmentFields({ courierName: "J&T Express", trackingNo: "JT1" }),
		).toEqual({
			courierName: "J&T Express",
			trackingNo: "JT1",
			carrierTrackingUrl: "https://www.jtexpress.my/tracking/JT1",
		});
	});

	it("leaves the URL unset for an unknown courier", () => {
		expect(
			resolveShipmentFields({ courierName: "DD Express (cold chain)", trackingNo: "DD9" }),
		).toEqual({
			courierName: "DD Express (cold chain)",
			trackingNo: "DD9",
			carrierTrackingUrl: undefined,
		});
	});

	it("an explicitly pasted URL wins over derivation", () => {
		expect(
			resolveShipmentFields({
				courierName: "J&T Express",
				trackingNo: "JT1",
				carrierTrackingUrl: "https://example.com/track/JT1",
			}).carrierTrackingUrl,
		).toBe("https://example.com/track/JT1");
	});

	it("no URL without a tracking number", () => {
		expect(
			resolveShipmentFields({ courierName: "J&T Express" }).carrierTrackingUrl,
		).toBeUndefined();
	});

	it("trims whitespace and treats blank as cleared", () => {
		expect(
			resolveShipmentFields({
				courierName: "  ",
				trackingNo: " JT1 ",
				carrierTrackingUrl: "",
			}),
		).toEqual({
			courierName: undefined,
			trackingNo: "JT1",
			carrierTrackingUrl: undefined,
		});
	});

	it("refuses a pasted non-http(s) URL (buyer-facing href — PR #151 review)", () => {
		for (const hostile of [
			"javascript:alert(1)",
			"JavaScript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"file:///etc/passwd",
			"vbscript:msgbox(1)",
		]) {
			expect(
				resolveShipmentFields({
					courierName: "Best Express",
					trackingNo: "BE1",
					carrierTrackingUrl: hostile,
				}).carrierTrackingUrl,
			).toBeUndefined();
		}
	});

	it("a refused paste can still fall through to the derived link", () => {
		expect(
			resolveShipmentFields({
				courierName: "J&T Express",
				trackingNo: "JT1",
				carrierTrackingUrl: "javascript:alert(1)",
			}).carrierTrackingUrl,
		).toBe("https://www.jtexpress.my/tracking/JT1");
	});

	it("assumes https for a scheme-less paste rather than dropping it", () => {
		expect(
			resolveShipmentFields({
				courierName: "Best Express",
				carrierTrackingUrl: "tracking.example.com/x?id=1",
			}).carrierTrackingUrl,
		).toBe("https://tracking.example.com/x?id=1");
		// Protocol-relative just needs the scheme.
		expect(
			resolveShipmentFields({
				courierName: "Best Express",
				carrierTrackingUrl: "//tracking.example.com/x",
			}).carrierTrackingUrl,
		).toBe("https://tracking.example.com/x");
		// A bare path has no host — not a tracking link.
		expect(
			resolveShipmentFields({
				courierName: "Best Express",
				carrierTrackingUrl: "/track/123",
			}).carrierTrackingUrl,
		).toBeUndefined();
	});

	it("keeps http and https pastes verbatim", () => {
		for (const ok of [
			"https://track.example/1",
			"http://track.example/1",
			"HTTPS://track.example/1",
		]) {
			expect(
				resolveShipmentFields({
					courierName: "Best Express",
					carrierTrackingUrl: ok,
				}).carrierTrackingUrl,
			).toBe(ok);
		}
	});

	it("clips over-long input to the caps", () => {
		const out = resolveShipmentFields({
			courierName: "x".repeat(200),
			trackingNo: "y".repeat(200),
		});
		expect(out.courierName).toHaveLength(COURIER_NAME_MAX);
		expect(out.trackingNo).toHaveLength(TRACKING_NO_MAX);
	});
});

describe("isSafeTrackingUrl — render-site guard for pre-sanitize rows", () => {
	it("passes only http(s)", () => {
		expect(isSafeTrackingUrl("https://track.example/1")).toBe(true);
		expect(isSafeTrackingUrl("http://track.example/1")).toBe(true);
		expect(isSafeTrackingUrl("HtTpS://track.example/1")).toBe(true);
	});

	it("blocks hostile schemes and empty values", () => {
		expect(isSafeTrackingUrl("javascript:alert(1)")).toBe(false);
		expect(isSafeTrackingUrl("data:text/html,x")).toBe(false);
		expect(isSafeTrackingUrl("track.example/1")).toBe(false);
		expect(isSafeTrackingUrl(undefined)).toBe(false);
		expect(isSafeTrackingUrl("")).toBe(false);
	});
});
