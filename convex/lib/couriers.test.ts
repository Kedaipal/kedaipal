import { describe, expect, it } from "vitest";
import {
	COURIER_NAME_MAX,
	COURIERS,
	findCourier,
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

	it("clips over-long input to the caps", () => {
		const out = resolveShipmentFields({
			courierName: "x".repeat(200),
			trackingNo: "y".repeat(200),
		});
		expect(out.courierName).toHaveLength(COURIER_NAME_MAX);
		expect(out.trackingNo).toHaveLength(TRACKING_NO_MAX);
	});
});
