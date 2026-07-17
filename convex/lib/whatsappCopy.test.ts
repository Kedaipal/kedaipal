/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	hasTemplateOverride,
	poweredByLine,
	renderPaymentCta,
	renderPickupBlock,
	renderStageUpdate,
	renderSystemMessage,
	waCopy,
} from "./whatsappCopy";

const TRACK = "https://kedaipal.com/track/tok_abc";

describe("renderPaymentCta", () => {
	test("returns empty string when the seller has no payment methods", () => {
		expect(renderPaymentCta("en", TRACK, false)).toBe("");
	});

	test("points the buyer to the order page — never raw bank details", () => {
		const out = renderPaymentCta("en", TRACK, true);
		expect(out).toContain("💳 Payment details");
		expect(out).toContain("See how to pay and confirm your payment on your order page");
		// The tracking URL is embedded as text so it survives a text-only fallback.
		expect(out.split("\n")).toContain(TRACK);
		// No raw account number / bank labels ever leak into the chat.
		expect(out).not.toContain("Account:");
		expect(out).not.toContain("Bank:");
	});

	test("leads with a blank line so it separates from the preceding block", () => {
		expect(renderPaymentCta("en", TRACK, true).startsWith("\n")).toBe(true);
	});

	test("Bahasa Malaysia copy", () => {
		const out = renderPaymentCta("ms", TRACK, true);
		expect(out).toContain("💳 Maklumat pembayaran");
		expect(out).toContain("Lihat cara membayar dan sahkan pembayaran di halaman pesanan anda");
		expect(out.split("\n")).toContain(TRACK);
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

	test("storeQrConnected names the store + the pairing code, in both locales", () => {
		const en = renderSystemMessage("en", "storeQrConnected", {
			shortId: "",
			storeName: "Acme Outdoor",
			code: "K7",
		});
		expect(en).toContain("connected to Acme Outdoor");
		expect(en).toContain("*K7*");
		expect(en).toContain("kedaipal.com/privacy");
		const ms = renderSystemMessage("ms", "storeQrConnected", {
			shortId: "",
			storeName: "Acme Outdoor",
			code: "K7",
		});
		expect(ms).toContain("disambungkan dengan Acme Outdoor");
		expect(ms).toContain("*K7*");
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

	test("renders the fee line (EN + BM) when the snapshot carries a fee and currency is given", () => {
		const en = renderPickupBlock(
			"en",
			{
				label: "Pasar Tani Seksyen 7",
				address: "Seksyen 7, Shah Alam",
				locationType: "drop_off",
				fee: 500,
			},
			"MYR",
		);
		expect(en).toContain("💵 Pickup fee (included in total): MYR 5.00");
		const ms = renderPickupBlock(
			"ms",
			{ label: "Kedai", address: "KL", fee: 250 },
			"MYR",
		);
		expect(ms).toContain("💵 Caj ambilan (termasuk dalam jumlah): MYR 2.50");
	});

	test("skips the fee line when the snapshot is free or currency is missing", () => {
		const free = renderPickupBlock(
			"en",
			{ label: "Kedai", address: "KL" },
			"MYR",
		);
		expect(free).not.toContain("Pickup fee");
		// Fee present but no currency (a caller that can't carry a fee) → no
		// half-rendered amount.
		const noCurrency = renderPickupBlock("en", {
			label: "Kedai",
			address: "KL",
			fee: 500,
		});
		expect(noCurrency).not.toContain("Pickup fee");
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

// ---------------------------------------------------------------------------
// Drop-off-aware status copy (86ey570am) — pickupKind branches the "pickup"
// wording only for self-collect orders at a drop-off point.
// ---------------------------------------------------------------------------

describe("drop-off-aware status copy", () => {
	const base = { shortId: "ORD-TEST", storeName: "Bearcamp" };

	test("packed EN: drop-off wording only when kind is drop_off", () => {
		expect(
			waCopy.en.status.packed({
				...base,
				deliveryMethod: "self_collect",
				pickupKind: "drop_off",
			}),
		).toContain("ready for the drop-off point");
		expect(
			waCopy.en.status.packed({ ...base, deliveryMethod: "self_collect" }),
		).toContain("ready for pickup");
		// pickupKind on a delivery order is stale data — never changes wording.
		expect(
			waCopy.en.status.packed({
				...base,
				deliveryMethod: "delivery",
				pickupKind: "drop_off",
			}),
		).toContain("ready to ship");
	});

	test("shipped EN: drop-off meetup wording", () => {
		expect(
			waCopy.en.status.shipped({
				...base,
				deliveryMethod: "self_collect",
				pickupKind: "drop_off",
			}),
		).toContain("see you at the drop-off point");
		expect(
			waCopy.en.status.shipped({ ...base, deliveryMethod: "self_collect" }),
		).toContain("ready for pickup");
	});

	test("confirm EN: drop-off orders promise the drop-off point, not pickup", () => {
		expect(
			waCopy.en.confirm({
				...base,
				deliveryMethod: "self_collect",
				pickupKind: "drop_off",
			}),
		).toContain("ready at the drop-off point");
	});

	test("packed/shipped MS: penyerahan wording for drop-off", () => {
		expect(
			waCopy.ms.status.packed({
				...base,
				deliveryMethod: "self_collect",
				pickupKind: "drop_off",
			}),
		).toContain("lokasi penyerahan");
		expect(
			waCopy.ms.status.shipped({
				...base,
				deliveryMethod: "self_collect",
				pickupKind: "drop_off",
			}),
		).toContain("jumpa di lokasi penyerahan");
		// Default self-collect MS copy unchanged.
		expect(
			waCopy.ms.status.packed({ ...base, deliveryMethod: "self_collect" }),
		).toContain("sedia untuk diambil");
	});
});

describe("renderStageUpdate carrier link", () => {
	test("includes the carrier tracking line when provided", () => {
		const out = renderStageUpdate("en", {
			shortId: "ORD-TEST",
			stageLabel: "On the lorry",
			trackingUrl: "https://kedaipal.com/track/tok",
			carrierTrackingUrl: "https://track.example/123",
		});
		expect(out).toContain("Track shipment: https://track.example/123");
		expect(out).toContain("Track your order: https://kedaipal.com/track/tok");
	});

	test("omits the carrier line when absent (existing shape unchanged)", () => {
		const out = renderStageUpdate("ms", {
			shortId: "ORD-TEST",
			stageLabel: "Siap",
		});
		expect(out).not.toContain("Jejak penghantaran");
		expect(out).toContain("Kemaskini pesanan ORD-TEST: Siap.");
	});
});

describe("hasTemplateOverride", () => {
	test("true only for a non-empty authored override", () => {
		expect(
			hasTemplateOverride({ en: { packed: "Custom" } }, "en", "packed"),
		).toBe(true);
		expect(
			hasTemplateOverride({ en: { packed: "   " } }, "en", "packed"),
		).toBe(false);
		expect(hasTemplateOverride({ en: {} }, "en", "packed")).toBe(false);
		expect(hasTemplateOverride(undefined, "en", "packed")).toBe(false);
		// Locale-scoped: an EN override is not an MS override.
		expect(
			hasTemplateOverride({ en: { packed: "Custom" } }, "ms", "packed"),
		).toBe(false);
	});
});

describe("paymentReminder system message", () => {
	test("EN includes store, amount, and the I've-paid CTA link", () => {
		const out = renderSystemMessage("en", "paymentReminder", {
			shortId: "ORD-TEST",
			storeName: "Bearcamp",
			amount: "MYR 120.00",
			trackingUrl: "https://kedaipal.com/track/tok",
			contactPhone: "60166210242",
		});
		expect(out).toContain("Friendly reminder from Bearcamp");
		expect(out).toContain("ORD-TEST (MYR 120.00)");
		expect(out).toContain("still awaiting payment");
		expect(out).toContain("https://kedaipal.com/track/tok");
		expect(out).toContain("wa.me/60166210242");
	});

	test("MS renders the localized nudge", () => {
		const out = renderSystemMessage("ms", "paymentReminder", {
			shortId: "ORD-TEST",
			storeName: "Bearcamp",
		});
		expect(out).toContain("Peringatan mesra daripada Bearcamp");
		expect(out).toContain("masih menunggu pembayaran");
	});
});

describe("poweredByLine growth footer", () => {
	test("EN renders the branded line with the marketing domain", () => {
		const out = poweredByLine("en");
		expect(out).toBe("\n\nThis shop runs on Kedaipal 🛒 kedaipal.com");
	});

	test("MS renders the exact locked BM copy", () => {
		const out = poweredByLine("ms");
		expect(out).toBe("\n\nKedai ini guna Kedaipal 🛒 kedaipal.com");
	});

	test("leads with a blank line so it reads as a quiet footer under any body", () => {
		expect(poweredByLine("en").startsWith("\n\n")).toBe(true);
		expect(poweredByLine("ms").startsWith("\n\n")).toBe(true);
	});

	test("is a system suffix, independent of retailer confirm-template overrides", () => {
		// The line is appended by the send site, so a retailer override of the
		// `confirm` template (which renderMessage handles) can never strip it.
		const overridden = waCopy.en.confirm({
			shortId: "ORD-TEST",
			storeName: "Bearcamp",
		});
		expect(overridden).not.toContain("Powered by");
		expect(poweredByLine("en")).toContain("Kedaipal");
	});
});
