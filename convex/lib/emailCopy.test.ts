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

	test("ZH drop-off uses the 交收 label, and renders every key on the catalog", () => {
		const { subject, html, text } = renderRetailerEmail("zh", "newOrder", {
			...base,
			pickupKind: "drop_off",
			pickupLabel: "Pasar Tani",
			pickupAddress: "Seksyen 7",
		});
		expect(subject).toContain("新订单");
		expect(text).toContain("方式：交收");
		expect(html).toContain("Pasar Tani");
		// Every RetailerEmailKey renders without throwing in zh.
		for (const key of [
			"newOrder",
			"orderConfirmed",
			"paymentClaimed",
			"mockupApproved",
			"mockupChangesRequested",
			"mockupDeclined",
			"deliveryJobFailed",
			"deliveryJobStale",
			"deliveryJobReturned",
		] as const) {
			expect(() => renderRetailerEmail("zh", key, base)).not.toThrow();
		}
	});
});

describe("courier job emails (z8r3fe11y8)", () => {
	const delivery = {
		...base,
		deliveryMethod: "delivery" as const,
		deliveryProvider: "delyva" as const,
	};
	test("stale: names the waybill, the first-scan rule, Refresh, and that the buyer wasn't messaged — in all three locales", () => {
		for (const locale of ["en", "ms", "zh"] as const) {
			const { subject, html, text } = renderRetailerEmail(locale, "deliveryJobStale", {
				...delivery,
				trackingNo: "632195694574",
			});
			expect(subject).toContain("ORD-AB12");
			expect(html).toContain("632195694574");
			expect(text).toContain("632195694574");
			expect(text).toContain(base.dashboardUrl);
		}
		const en = renderRetailerEmail("en", "deliveryJobStale", delivery);
		expect(en.text).toContain("No tracking number has been issued yet.");
		expect(en.text).toContain("Refresh status");
		expect(en.text).toContain("Your buyer has not been messaged.");
	});
	test("returned: carries Delyva's reason and the waybill, says the order still reads Shipped", () => {
		const { subject, text, html } = renderRetailerEmail("en", "deliveryJobReturned", {
			...delivery,
			jobFailureReason: "Returned to you",
			trackingNo: "632195694574",
		});
		expect(subject).toContain("on its way back to you");
		expect(text).toContain("Delyva says: Returned to you.");
		expect(text).toContain("Waybill 632195694574");
		expect(text).toContain("still reads Shipped");
		expect(html).toContain("mark it returned");
		const bare = renderRetailerEmail("ms", "deliveryJobReturned", delivery);
		expect(bare.text).toContain("Kurier memulangkan bungkusan.");
	});
});
