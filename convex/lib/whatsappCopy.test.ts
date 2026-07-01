/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import type { PaymentMethod } from "./payment";
import {
	paymentQrCaption,
	renderPaymentMethods,
	renderPickupBlock,
	renderSystemMessage,
} from "./whatsappCopy";

function bank(over: Partial<PaymentMethod> = {}): PaymentMethod {
	return {
		type: "bank",
		label: "Maybank",
		bankName: "Maybank",
		bankAccountName: "Acme Outdoor Sdn Bhd",
		bankAccountNumber: "5123 4567 8901",
		sortOrder: 0,
		...over,
	};
}

describe("renderPaymentMethods", () => {
	test("returns empty string when there are no methods", () => {
		expect(renderPaymentMethods("en", [])).toBe("");
	});

	test("renders a bank method with the label as a bold heading", () => {
		const out = renderPaymentMethods("en", [bank()]);
		expect(out).toContain("💳 Payment details");
		expect(out).toContain("*Maybank*");
		// label === bankName → no redundant "Bank: Maybank" line.
		expect(out).not.toContain("Bank: Maybank");
		expect(out).toContain("Name: Acme Outdoor Sdn Bhd");
		// Account number on its OWN line so a long-press selects just the number.
		expect(out).toContain("Account:");
		expect(out.split("\n")).toContain("5123 4567 8901");
	});

	test("shows the bank name line when it differs from the label", () => {
		const out = renderPaymentMethods("en", [
			bank({ label: "Main account", bankName: "Maybank" }),
		]);
		expect(out).toContain("*Main account*");
		expect(out).toContain("Bank: Maybank");
	});

	test("lists multiple methods, each as its own labelled block", () => {
		const out = renderPaymentMethods("en", [
			bank({ label: "Maybank", bankAccountNumber: "111" }),
			bank({
				label: "CIMB",
				bankName: "CIMB",
				bankAccountNumber: "222",
				sortOrder: 1,
			}),
		]);
		expect(out).toContain("*Maybank*");
		expect(out).toContain("*CIMB*");
		expect(out.split("\n")).toContain("111");
		expect(out.split("\n")).toContain("222");
	});

	test("a QR method points to the image (sent separately), with its note", () => {
		const out = renderPaymentMethods("en", [
			{
				type: "qr",
				label: "DuitNow QR",
				qrImageStorageId: "kg:abc",
				note: "Scan to pay via DuitNow.",
				sortOrder: 0,
			},
		]);
		expect(out).toContain("*DuitNow QR*");
		expect(out).toContain("Scan the QR below 👇");
		expect(out).toContain("Scan to pay via DuitNow.");
	});

	test("Bahasa Malaysia labels", () => {
		const out = renderPaymentMethods("ms", [bank({ bankAccountNumber: "5123" })]);
		expect(out).toContain("💳 Maklumat pembayaran");
		expect(out).toContain("Akaun:");
		expect(out.split("\n")).toContain("5123");
	});

	test("paymentQrCaption — generic, and prefixed with a label when given", () => {
		expect(paymentQrCaption("en")).toBe("Scan to pay");
		expect(paymentQrCaption("ms")).toBe("Imbas untuk bayar");
		expect(paymentQrCaption("en", "DuitNow")).toBe("DuitNow — Scan to pay");
	});
});

describe("renderSystemMessage", () => {
	test("paymentReceived (en) includes shortId, store, tracking link", () => {
		const out = renderSystemMessage("en", "paymentReceived", {
			shortId: "ORD-AB23",
			storeName: "Acme Outdoor",
			trackingUrl: "https://kedaipal.test/track/ORD-AB23",
		});
		expect(out).toContain("Payment received for ORD-AB23");
		expect(out).toContain("Acme Outdoor");
		expect(out).toContain("https://kedaipal.test/track/ORD-AB23");
	});

	test("paymentReceived (ms) renders Bahasa Malaysia copy", () => {
		const out = renderSystemMessage("ms", "paymentReceived", {
			shortId: "ORD-AB23",
			storeName: "Acme Outdoor",
			trackingUrl: "https://kedaipal.test/track/ORD-AB23",
		});
		expect(out).toContain("Pembayaran diterima untuk ORD-AB23");
		expect(out).toContain("sedang menyediakan");
	});

	test("paymentReceived omits Track block when no trackingUrl supplied", () => {
		const out = renderSystemMessage("en", "paymentReceived", {
			shortId: "ORD-AB23",
			storeName: "Acme",
		});
		expect(out).toContain("Payment received for ORD-AB23");
		expect(out).not.toContain("Track:");
	});

	test("transferReferenceLine is locale-aware", () => {
		expect(
			renderSystemMessage("en", "transferReferenceLine", {
				shortId: "ORD-AB23",
				storeName: "Acme",
			}),
		).toBe("Use ORD-AB23 as your transfer reference so we can match it.");
		expect(
			renderSystemMessage("ms", "transferReferenceLine", {
				shortId: "ORD-AB23",
				storeName: "Acme",
			}),
		).toBe(
			"Gunakan ORD-AB23 sebagai rujukan pemindahan supaya kami boleh padankan.",
		);
	});

	test("counterCheckoutBound names the store, in both locales", () => {
		const en = renderSystemMessage("en", "counterCheckoutBound", {
			shortId: "",
			storeName: "Acme Outdoor",
		});
		expect(en).toContain("connected to Acme Outdoor");
		const ms = renderSystemMessage("ms", "counterCheckoutBound", {
			shortId: "",
			storeName: "Acme Outdoor",
		});
		expect(ms).toContain("disambungkan dengan Acme Outdoor");
	});

	test("counterOrderConfirmedPaid quotes the amount + tracking link", () => {
		const out = renderSystemMessage("en", "counterOrderConfirmedPaid", {
			shortId: "ORD-AB23",
			storeName: "Acme",
			amount: "MYR 25.00",
			trackingUrl: "https://kedaipal.test/track/tok",
		});
		expect(out).toContain("ORD-AB23");
		expect(out).toContain("confirmed and paid");
		expect(out).toContain("MYR 25.00");
		expect(out).toContain("https://kedaipal.test/track/tok");
	});

	test("counterOrderConfirmedUnpaid frames the total as still-to-pay (no rush)", () => {
		const out = renderSystemMessage("ms", "counterOrderConfirmedUnpaid", {
			shortId: "ORD-AB23",
			storeName: "Acme",
			amount: "MYR 25.00",
			trackingUrl: "https://kedaipal.test/track/tok",
		});
		expect(out).toContain("untuk dibayar");
		expect(out).toContain("MYR 25.00");
		expect(out).toContain("https://kedaipal.test/track/tok");
	});

	test("order document captions name the doc type + order id", () => {
		expect(
			renderSystemMessage("en", "orderReceiptCaption", {
				shortId: "ORD-AB23",
				storeName: "Acme",
			}),
		).toContain("receipt for order ORD-AB23");
		expect(
			renderSystemMessage("en", "orderInvoiceCaption", {
				shortId: "ORD-AB23",
				storeName: "Acme",
			}),
		).toContain("invoice for order ORD-AB23");
	});
});

describe("renderPickupBlock", () => {
	test("returns empty string when snapshot is undefined", () => {
		expect(renderPickupBlock("en", undefined)).toBe("");
	});

	test("renders English header with label and address", () => {
		const out = renderPickupBlock("en", {
			label: "Main Store",
			address: "12 Jalan Tun Razak, 50400 Kuala Lumpur",
		});
		expect(out).toBe(
			"\n📍 Self-collect details\nMain Store\n12 Jalan Tun Razak, 50400 Kuala Lumpur",
		);
	});

	test("renders Bahasa Malaysia header (defaults to self-collect)", () => {
		const out = renderPickupBlock("ms", {
			label: "Kedai Utama",
			address: "12 Jalan Tun Razak, 50400 KL",
		});
		expect(out.split("\n")[1]).toBe("📍 Maklumat ambil sendiri");
	});

	test("renders a drop-off header + schedule note when kind is drop_off", () => {
		const out = renderPickupBlock("en", {
			label: "Pasar Tani Seksyen 7",
			address: "Seksyen 7, Shah Alam",
			locationType: "drop_off",
			scheduleNote: "Every Sat 3-5pm",
		});
		expect(out.split("\n")).toEqual([
			"",
			"📍 Drop-off point",
			"Pasar Tani Seksyen 7",
			"Seksyen 7, Shah Alam",
			"🗓️ Every Sat 3-5pm",
		]);
	});

	test("drop-off header localises to BM", () => {
		const out = renderPickupBlock("ms", {
			label: "Surau Al-Hidayah",
			address: "Seksyen 7",
			locationType: "drop_off",
		});
		expect(out.split("\n")[1]).toBe("📍 Lokasi penyerahan");
	});

	test("undefined locationType renders as self-collect (legacy snapshot)", () => {
		const out = renderPickupBlock("en", {
			label: "Main Store",
			address: "KL",
		});
		expect(out.split("\n")[1]).toBe("📍 Self-collect details");
	});

	test("includes mapsUrl on its own line when present", () => {
		const out = renderPickupBlock("en", {
			label: "Main Store",
			address: "12 Jln Tun Razak, KL",
			mapsUrl: "https://maps.app.goo.gl/abc",
		});
		expect(out).toContain("\nhttps://maps.app.goo.gl/abc");
	});

	test("appends notes with a blank-line separator", () => {
		const out = renderPickupBlock("en", {
			label: "Main Store",
			address: "12 Jln Tun Razak, KL",
			notes: "Pickup hours: 10am – 6pm Mon–Sat.",
		});
		// Address then blank line then notes
		expect(out).toContain(
			"\n12 Jln Tun Razak, KL\n\nPickup hours: 10am – 6pm Mon–Sat.",
		);
	});

	test("omits mapsUrl and notes when both absent", () => {
		const out = renderPickupBlock("en", {
			label: "Main Store",
			address: "12 Jln Tun Razak, KL",
		});
		expect(out.split("\n")).toEqual([
			"",
			"📍 Self-collect details",
			"Main Store",
			"12 Jln Tun Razak, KL",
		]);
	});

	test("includes the seller-pasted mapsUrl when set (legacy precedence)", () => {
		const out = renderPickupBlock("en", {
			label: "Main Store",
			address: "12 Jln Tun Razak, KL",
			mapsUrl: "https://maps.app.goo.gl/abc",
			latitude: 3.158,
			longitude: 101.712,
			placeId: "ChIJxxx",
		});
		// mapsUrl wins the deriveMapsUrl priority chain.
		expect(out).toContain("https://maps.app.goo.gl/abc");
		expect(out).not.toContain("place_id:");
	});

	test("falls back to a placeId-based URL when no mapsUrl", () => {
		const out = renderPickupBlock("en", {
			label: "Main Store",
			address: "12 Jln Tun Razak, KL",
			placeId: "ChIJ_pickup",
			latitude: 3.158,
			longitude: 101.712,
		});
		expect(out).toContain(
			"https://www.google.com/maps/place/?q=place_id:ChIJ_pickup",
		);
	});

	test("falls back to a lat/lng search URL when no mapsUrl and no placeId", () => {
		const out = renderPickupBlock("en", {
			label: "Main Store",
			address: "12 Jln Tun Razak, KL",
			latitude: 3.158,
			longitude: 101.712,
		});
		expect(out).toContain(
			"https://www.google.com/maps/search/?api=1&query=3.158,101.712",
		);
	});

	test("omits the URL line entirely when nothing usable is set", () => {
		const out = renderPickupBlock("en", {
			label: "Main Store",
			address: "12 Jln Tun Razak, KL",
		});
		expect(out).not.toContain("https://");
		expect(out.split("\n")).toEqual([
			"",
			"📍 Self-collect details",
			"Main Store",
			"12 Jln Tun Razak, KL",
		]);
	});
});
