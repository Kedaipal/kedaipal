import { describe, expect, test } from "vitest";
import { type RetailerEmailVars, renderRetailerEmail } from "./emailCopy";

const base: RetailerEmailVars = {
	shortId: "ORD-AB12",
	itemCount: 2,
	totalFormatted: "MYR 20.00",
	customerName: "Ali",
	deliveryMethod: "self_collect",
	storeName: "Test Store",
	dashboardUrl: "https://kedaipal.com/app/orders/ORD-AB12",
};

describe("renderRetailerEmail — pickup kind + detail", () => {
	test("drop-off order shows a Drop-off method label + point + schedule note", () => {
		const { html, text } = renderRetailerEmail("en", "newOrder", {
			...base,
			pickupKind: "drop_off",
			pickupLabel: "Pasar Tani Seksyen 7",
			pickupAddress: "Seksyen 7, Shah Alam",
			pickupScheduleNote: "Every Sat 3-5pm",
			pickupMapsUrl: "https://maps.app.goo.gl/abc",
		});
		expect(html).toContain("Method: Drop-off");
		expect(html).toContain("Pasar Tani Seksyen 7");
		expect(html).toContain("Every Sat 3-5pm");
		expect(html).toContain("https://maps.app.goo.gl/abc");
		// Plain-text part carries the same detail.
		expect(text).toContain("Method: Drop-off");
		expect(text).toContain("🗓️ Every Sat 3-5pm");
	});

	test("self-collect order (no kind) labels as Self-collect", () => {
		const { html } = renderRetailerEmail("en", "newOrder", {
			...base,
			pickupKind: "self_collect",
			pickupLabel: "Main Store",
			pickupAddress: "12 Jln Tun Razak, KL",
		});
		expect(html).toContain("Method: Self-collect");
		expect(html).toContain("Main Store");
	});

	test("delivery order shows no pickup block", () => {
		const { html } = renderRetailerEmail("en", "newOrder", {
			...base,
			deliveryMethod: "delivery",
		});
		expect(html).toContain("Method: Delivery");
		expect(html).not.toContain("🗓️");
	});

	test("BM drop-off uses the Penyerahan label", () => {
		const { text } = renderRetailerEmail("ms", "newOrder", {
			...base,
			pickupKind: "drop_off",
			pickupLabel: "Pasar Tani",
			pickupAddress: "Seksyen 7",
		});
		expect(text).toContain("Kaedah: Penyerahan");
	});
});
