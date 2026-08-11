/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { LOCALES, pickLocale } from "./locale";
import {
	type MessageTemplates,
	poweredByLine,
	renderMessage,
	renderPickupBlock,
	renderSystemMessage,
	TEMPLATE_KEYS,
	waCopy,
} from "./whatsappCopy";

const TRACK = "https://kedaipal.com/track/tok_abc";

describe("pickLocale", () => {
	test("narrows a known locale string", () => {
		expect(pickLocale("en")).toBe("en");
		expect(pickLocale("ms")).toBe("ms");
		expect(pickLocale("zh")).toBe("zh");
	});

	test("falls back to en for unknown, missing, or non-string input", () => {
		expect(pickLocale(undefined)).toBe("en");
		expect(pickLocale(null)).toBe("en");
		expect(pickLocale("")).toBe("en");
		expect(pickLocale("fr")).toBe("en");
		expect(pickLocale(42)).toBe("en");
		expect(pickLocale({})).toBe("en");
	});

	test("covers every locale in LOCALES round-trip", () => {
		for (const locale of LOCALES) {
			expect(pickLocale(locale)).toBe(locale);
		}
	});
});

// Fallback semantics (86eybjw5n): a retailer override is looked up PER LOCALE,
// independently — there is no cross-locale fallback chain. A store that has
// authored EN + BM overrides and switches to zh (no zh override yet) must fall
// through to the DEFAULT zh catalog, never silently reuse the BM/EN override
// text. Traced in docs/i18n.md "Backend locale" section.
describe("renderMessage — locale override fallback (86eybjw5n)", () => {
	test("zh with no zh override falls back to the DEFAULT zh catalog, not the EN/MS override", () => {
		const overrides: MessageTemplates = {
			en: { confirm: "EN OVERRIDE {shortId}" },
			ms: { confirm: "MS OVERRIDE {shortId}" },
		};
		const out = renderMessage(overrides, "zh", "confirm", {
			shortId: "ORD-AB23",
			storeName: "Acme",
		});
		expect(out).not.toContain("EN OVERRIDE");
		expect(out).not.toContain("MS OVERRIDE");
		// Matches the built-in zh confirm template, not an override.
		expect(out).toBe(waCopy.zh.confirm({ shortId: "ORD-AB23", storeName: "Acme" }));
	});

	test("once a zh override IS authored, it wins over the zh default (same as en/ms)", () => {
		const overrides: MessageTemplates = {
			zh: { confirm: "自定义确认 {shortId}" },
		};
		const out = renderMessage(overrides, "zh", "confirm", {
			shortId: "ORD-AB23",
			storeName: "Acme",
		});
		expect(out).toBe("自定义确认 ORD-AB23");
	});
});

describe("renderSystemMessage", () => {
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
		const zh = renderSystemMessage("zh", "storeQrConnected", {
			shortId: "",
			storeName: "Acme Outdoor",
			code: "K7",
		});
		expect(zh).toContain("Acme Outdoor");
		expect(zh).toContain("*K7*");
		expect(zh).toContain("kedaipal.com/privacy");
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

describe("poweredByLine growth footer", () => {
	test("EN renders the branded line with the marketing domain", () => {
		const out = poweredByLine("en");
		expect(out).toBe("\n\nThis shop runs on Kedaipal 🛒 kedaipal.com");
	});

	test("MS renders the exact locked BM copy", () => {
		const out = poweredByLine("ms");
		expect(out).toBe("\n\nKedai ini guna Kedaipal 🛒 kedaipal.com");
	});

	test("ZH renders the exact locked ZH copy", () => {
		const out = poweredByLine("zh");
		expect(out).toBe("\n\n这家店用 Kedaipal 营业 🛒 kedaipal.com");
	});

	test("leads with a blank line so it reads as a quiet footer under any body", () => {
		expect(poweredByLine("en").startsWith("\n\n")).toBe(true);
		expect(poweredByLine("ms").startsWith("\n\n")).toBe(true);
		expect(poweredByLine("zh").startsWith("\n\n")).toBe(true);
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


// The seller-editable surface after 86eyd63r8: exactly one key. If this list
// grows, something re-introduced a customisable send — check it against
// docs/one-message-per-order.md before letting it through.
describe("TEMPLATE_KEYS — the one-message-per-order editable surface", () => {
	test("only `confirm` is seller-editable", () => {
		expect(TEMPLATE_KEYS).toEqual(["confirm"]);
	});

	test("the default confirm reply points at the order page and promises no follow-up", () => {
		for (const locale of LOCALES) {
			const out = renderMessage(undefined, locale, "confirm", {
				shortId: "ORD-AB23",
				storeName: "Acme Outdoor",
				trackingUrl: TRACK,
			});
			expect(out).toContain("ORD-AB23");
			expect(out).toContain(TRACK);
			// The old copy promised shipping updates that no longer exist.
			expect(out).not.toMatch(/we'll (update|let you know)/i);
		}
	});

	test("the legacy hold replies point at the order page instead of promising a follow-up message", () => {
		for (const key of ["mockupPendingConfirm", "deliveryFeePendingConfirm"] as const) {
			for (const locale of LOCALES) {
				const out = renderSystemMessage(locale, key, {
					shortId: "ORD-AB23",
					storeName: "Acme Outdoor",
					trackingUrl: TRACK,
				});
				expect(out).toContain(TRACK);
				// The old copy said "we'll send payment details right after" — a
				// message that no longer exists on any path.
				expect(out).not.toMatch(/we'll (send|share)/i);
				expect(out).not.toMatch(/kami akan (hantar|kongsi)/i);
			}
		}
	});
});
