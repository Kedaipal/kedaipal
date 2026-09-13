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
		// The landing teaser (`pricing_*`), `/pricing` (`pricingpage_*`) AND
		// `/cost` (`cost_*`) — the calculator's founding-price CTA was the last
		// public advert of the retired RM104/S$41 rate (30 Aug 2026 pricing
		// reset, ClickUp z8r3fday21). The regex covers all three locales'
		// wording: "Founding", "Pengasas", "创始".
		const offenders: string[] = [];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of Object.entries(catalog)) {
				if (
					!key.startsWith("pricing_") &&
					!key.startsWith("pricingpage_") &&
					!key.startsWith("cost_")
				)
					continue;
				if (typeof value === "string" && /founding|pengasas|创始/i.test(value)) {
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

/**
 * Sections cut in landing v2 (z8r3fdegej): the problem strip, how-it-works
 * timeline, features bento, the MoneyMath block and the old hero chat/stickers.
 * Their keys must stay gone in every catalog — a resurrected key is how a cut
 * section quietly comes back through a merge.
 */
const REMOVED_PREFIXES = ["problem_", "how_", "bento_", "features_", "hero_chat_", "pay_group_"];
const REMOVED_LANDING_V2_KEYS = [
	"mm_heading", "mm_line1", "mm_line2_pre", "mm_line2_zero", "mm_line2_post", "mm_line3", "mm_cta_note", "mm_note",
	"hero_badge", "hero_pain_missed", "hero_pain_chase", "hero_pain_chase_sub", "hero_cta_primary", "hero_cta_secondary", "hero_phone_alt",
	"nav_features", "nav_how", "pricing_see_full_breakdown", "pricing_feat_radius",
];

describe("landing v2 — cut sections stay cut", () => {
	it("keeps every retired key out of every catalog", () => {
		for (const [locale, catalog] of catalogs) {
			const resurrected = Object.keys(catalog).filter(
				(k) => REMOVED_LANDING_V2_KEYS.includes(k) || REMOVED_PREFIXES.some((p) => k.startsWith(p)),
			);
			expect(resurrected, `${locale}: ${resurrected.join(", ")}`).toEqual([]);
		}
	});

	it("never says 14-day or RM299 on a key the landing renders", () => {
		// Start-when-you-sell replaced the calendar trial and Scale is RM399
		// (pricing reset, 30 Aug 2026). Prefixes = every section on `/`.
		const onLanding = /^(nav_|hero_|demo_video_|proof_|handshake_|delivery_|pay_|pricing_|faq_|final_|footer_|guarantee_|region_)/;
		const stale = /14[- ]day|14 hari|14 天|RM ?299|S\$ ?119/i;
		for (const [locale, catalog] of catalogs) {
			const hits = Object.entries(catalog)
				.filter(([k, v]) => onLanding.test(k) && stale.test(String(v)))
				.map(([k]) => k);
			expect(hits, `${locale}: ${hits.join(", ")}`).toEqual([]);
		}
	});
});
