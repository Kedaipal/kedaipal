/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	paymentQrCaption,
	renderPaymentInstructions,
	renderPickupBlock,
	renderSystemMessage,
} from "./whatsappCopy";

describe("renderPaymentInstructions", () => {
	test("returns empty string when instructions undefined", () => {
		expect(renderPaymentInstructions("en", undefined)).toBe("");
	});

	test("returns empty string when all fields blank or whitespace", () => {
		expect(
			renderPaymentInstructions("en", {
				bankName: "  ",
				bankAccountName: "",
				bankAccountNumber: undefined,
				note: "   ",
			}),
		).toBe("");
	});

	test("renders English bank block with all fields", () => {
		const out = renderPaymentInstructions("en", {
			bankName: "Maybank",
			bankAccountName: "Acme Outdoor Sdn Bhd",
			bankAccountNumber: "5123 4567 8901",
		});
		expect(out).toContain("💳 Payment details");
		expect(out).toContain("Bank: Maybank");
		expect(out).toContain("Name: Acme Outdoor Sdn Bhd");
		expect(out).toContain("Account: 5123 4567 8901");
	});

	test("renders Bahasa Malaysia labels", () => {
		const out = renderPaymentInstructions("ms", {
			bankName: "Maybank",
			bankAccountNumber: "5123",
		});
		expect(out).toContain("💳 Maklumat pembayaran");
		expect(out).toContain("Bank: Maybank");
		expect(out).toContain("Akaun: 5123");
	});

	test("renders note even without bank fields (QR-only retailer)", () => {
		const out = renderPaymentInstructions("en", {
			qrImageStorageId: "kg:abc",
			note: "Scan the QR above to pay via DuitNow.",
		});
		expect(out).toContain("💳 Payment details");
		expect(out).toContain("Scan the QR above to pay via DuitNow.");
	});

	test("omits missing fields cleanly", () => {
		const out = renderPaymentInstructions("en", {
			bankName: "Maybank",
		});
		expect(out).toContain("Bank: Maybank");
		expect(out).not.toContain("Name:");
		expect(out).not.toContain("Account:");
	});

	test("trims whitespace inside fields", () => {
		const out = renderPaymentInstructions("en", {
			bankName: "  Maybank  ",
			bankAccountNumber: "\t5123\n",
		});
		expect(out).toContain("Bank: Maybank");
		expect(out).toContain("Account: 5123");
	});

	test("paymentQrCaption is locale-aware", () => {
		expect(paymentQrCaption("en")).toBe("Scan to pay");
		expect(paymentQrCaption("ms")).toBe("Imbas untuk bayar");
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
			"\n📍 Pickup details\nMain Store\n12 Jalan Tun Razak, 50400 Kuala Lumpur",
		);
	});

	test("renders Bahasa Malaysia header", () => {
		const out = renderPickupBlock("ms", {
			label: "Kedai Utama",
			address: "12 Jalan Tun Razak, 50400 KL",
		});
		expect(out.split("\n")[1]).toBe("📍 Maklumat pengambilan");
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
			"📍 Pickup details",
			"Main Store",
			"12 Jln Tun Razak, KL",
		]);
	});
});
