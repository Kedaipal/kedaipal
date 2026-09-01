import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ms from "../../messages/ms.json";
import zh from "../../messages/zh.json";

/**
 * Guards for the Mobbin-style landing redesign (docs/landing-redesign-mobbin.md):
 * Founding 10 came off `/` in favour of a live "10+ paying sellers" stat, and a
 * WhatsApp "Book a demo" entry point was added to the nav + final CTA. `/pricing`
 * followed later the same day (its banner, Pro founding box and placeholder
 * testimonial all removed), so the LAST `founding_*` keys and the
 * `pricingpage_*` banner/testimonial keys are gone too — the program's only
 * remaining home is billing (convex/lib/plans.ts + docs/manual-subscription.md),
 * which is code, not marketing copy.
 */

const catalogs = [
	["en", en as Record<string, string>],
	["ms", ms as Record<string, string>],
	["zh", zh as Record<string, string>],
] as const;

const REMOVED_KEYS = [
	"founding_heading",
	"founding_sub",
	"founding_sub_generic",
	"founding_spot_taken",
	"founding_spot_open",
	"founding_perk_1_label",
	"founding_perk_1_body",
	"founding_perk_2_label",
	"founding_perk_2_body",
	"founding_perk_3_label",
	"founding_perk_3_body",
	"founding_cta",
	"pricing_founding_line",
	"pricing_founding_card_label",
	// The /pricing pass (29 Aug, later the same day) removed the last three
	// founding keys plus the banner and the fabricated-placeholder testimonial.
	"founding_label",
	"founding_remaining",
	"founding_wa_message",
	"pricingpage_banner_heading",
	"pricingpage_banner_body",
	"pricingpage_banner_cta",
	"pricingpage_founding_forever",
	"pricingpage_founding_detail",
	"pricingpage_testimonial_quote",
	"pricingpage_testimonial_attrib",
	"pricingpage_testimonial_note",
];

const NEW_KEYS = [
	"proof_customer_count_number",
	"proof_customer_count_label",
	"book_demo_cta",
	"demo_wa_message",
	// The MY/SG toggle. Detection moved from a time-zone guess to Cloudflare's
	// CF-IPCountry (31 Aug 2026), but the toggle stays on all three pricing
	// surfaces: geo-IP is a guess about a person, and the override is what
	// stops a wrong guess being a dead end. See docs/pricing.md.
	"region_toggle_label",
	"region_my",
	"region_sg",
];

describe("landing redesign — Founding 10 off the landing page", () => {
	it("removes every landing-only founding key from every locale", () => {
		for (const [locale, catalog] of catalogs) {
			for (const key of REMOVED_KEYS) {
				expect(
					key in catalog,
					`${locale}.${key} should have been removed`,
				).toBe(false);
			}
		}
	});

	it("keeps the pricing surfaces' key namespaces founding-free", () => {
		// Both the landing teaser (`pricing_*`) and `/pricing` (`pricingpage_*`).
		// `/cost` (`cost_*`) still carries its own founding-price CTA — that page
		// is a lead tool with its own copy pass, deliberately out of scope here.
		const offenders: string[] = [];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of Object.entries(catalog)) {
				if (!key.startsWith("pricing_") && !key.startsWith("pricingpage_"))
					continue;
				if (typeof value === "string" && /founding/i.test(value)) {
					offenders.push(`${locale}.${key} = ${value}`);
				}
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});

describe("landing redesign — new copy present in every locale", () => {
	it("has every new key non-empty in en/ms/zh", () => {
		for (const [locale, catalog] of catalogs) {
			for (const key of NEW_KEYS) {
				expect(catalog[key], `${locale}.${key}`).toBeTruthy();
			}
		}
	});

	it("keeps the WhatsApp demo-booking link to a single authored message", () => {
		// Same one-author precedent as guarantee_line (landing-funnel.test.ts) —
		// the nav and final-cta buttons must build their wa.me link from the
		// same key so the two never drift into two different asks.
		for (const [locale, catalog] of catalogs) {
			const message = catalog.demo_wa_message;
			expect(message, locale).toBeTruthy();
			const duplicates = Object.entries(catalog)
				.filter(
					([key, value]) => key !== "demo_wa_message" && value === message,
				)
				.map(([key]) => `${locale}.${key}`);
			expect(duplicates, duplicates.join(", ")).toEqual([]);
		}
	});
});
