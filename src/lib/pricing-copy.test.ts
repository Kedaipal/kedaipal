import { describe, expect, it } from "vitest";
import { LOCALES } from "../../convex/lib/locale";
import {
	INVOICE_DUE_GRACE_DAYS,
	PLAN_CREDIT_GRANT,
	PLANS,
	TRIAL_CREDIT_GRANT,
} from "../../convex/lib/plans";
import en from "../../messages/en.json";
import ms from "../../messages/ms.json";
import zh from "../../messages/zh.json";
import { m } from "../paraglide/messages";

/**
 * Semantic guards on the public pricing copy (`pricing_*` teaser + `pricingpage_*`
 * full page) so the Scale repositioning (ClickUp 86eyb9zwt) can't silently rot:
 *   1. Scale is the flat multi-outlet tier — reseller-band language is dead and
 *      must not creep back in any locale.
 *   2. No tier ever advertises "Unlimited" — every allowance is finite.
 *   3. Every allowance the copy prints is `PLAN_CREDIT_GRANT` (Credits T5,
 *      z8r3fdfu31): the credits lines take the number as a `{credits}`
 *      placeholder, so the page cannot print one the ledger doesn't grant.
 *      The literal "400" Scale shipped with outlived the move to 500 in two
 *      catalogs and a hardcoded table row — that is the failure this pins.
 * Key parity across locales is covered separately by i18n.test.ts.
 */

const catalogs = [
	["en", en as Record<string, string>],
	["ms", ms as Record<string, string>],
	["zh", zh as Record<string, string>],
] as const;

function pricingEntries(catalog: Record<string, string>): [string, string][] {
	return Object.entries(catalog).filter(([key]) =>
		/^(pricing_|pricingpage_)/.test(key),
	);
}

describe("pricing copy stays aligned with the flat multi-outlet Scale", () => {
	it("carries no reseller-band language in any locale", () => {
		// en + ms + zh spellings of the dead reseller-tier identity. Key check
		// catches the old `pricingpage_band_*` table keys; value check catches copy.
		// (bare "band" would false-positive on ms "Banding pelan" = compare plans.)
		const forbiddenKey = /reseller|_band_/i;
		const forbiddenValue = /reseller|penjual semula|pengedar|经销/i;
		const offenders: string[] = [];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of pricingEntries(catalog)) {
				if (forbiddenKey.test(key) || forbiddenValue.test(value)) {
					offenders.push(`${locale}.${key} = ${value}`);
				}
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it('never advertises "Unlimited" in any locale', () => {
		const forbidden = /unlimited|tanpa had|无限制/i;
		const offenders: string[] = [];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of pricingEntries(catalog)) {
				if (forbidden.test(value)) offenders.push(`${locale}.${key}`);
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	/**
	 * Kedaipal bills Malaysian sellers in MYR and Singaporean ones in SGD, and
	 * the region is now detected from the visitor's IP (`src/lib/geo-region.ts`)
	 * with a MY/SG toggle beside the cards. A currency spelled into the copy
	 * therefore quotes the wrong money to half the audience: the anchor line
	 * said "Starter from RM 79/mo" directly above S$29 tier cards, and the Scale
	 * outlet add-on said "RM49/mo each" beside S$119.
	 *
	 * So: pricing copy names no currency. It takes a formatted amount as a
	 * placeholder and the surface derives it from the resolved currency.
	 */
	it("names no currency — every amount arrives as a placeholder", () => {
		// The character class is `[\d{]`, not `\d`, because the first version of
		// this guard only looked for a symbol glued to a DIGIT — and the one key
		// that broke the rule glued it to the PLACEHOLDER instead:
		// "Billed RM{total}/yr". `RM{` is not `RM\d`, so the guard read clean
		// while the annual line quoted ringgit to a Singaporean. A symbol in
		// front of `{` is exactly as wrong as one in front of `79`.
		const forbidden = /\bRM\s?[\d{]|S\$\s?[\d{]|\bMYR\b|\bSGD\b/;
		const offenders: string[] = [];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of pricingEntries(catalog)) {
				if (forbidden.test(value))
					offenders.push(`${locale}.${key} = ${value}`);
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("publishes the locked monthly credits: Starter 100, Pro 200, Scale 500", () => {
		// The decision (register z8r3fdf8j1, 17 Sep 2026). Every surface below
		// reads the constant, so this is the one place the numbers are spelled.
		expect(PLAN_CREDIT_GRANT).toEqual({ starter: 100, pro: 200, scale: 500 });
	});

	it("takes every allowance as a {credits} placeholder, never a literal", () => {
		const allowanceKeys = [
			"pricingpage_credits_per_month",
			"pricing_feat_credits",
			"pricingpage_tier_scale_tagline",
			"pricing_tier_scale_tagline",
		];
		for (const [locale, catalog] of catalogs) {
			for (const key of allowanceKeys) {
				expect(catalog[key], `${locale}.${key}`).toContain("{credits}");
				// A literal allowance beside the placeholder is how 400 survived.
				for (const grant of [...Object.values(PLAN_CREDIT_GRANT), 400]) {
					expect(catalog[key], `${locale}.${key}`).not.toContain(String(grant));
				}
			}
		}
	});

	it("renders each tier's credits from PLAN_CREDIT_GRANT, in every locale", () => {
		for (const locale of LOCALES) {
			for (const plan of PLANS) {
				const line = m.pricingpage_credits_per_month(
					{ credits: PLAN_CREDIT_GRANT[plan] },
					{ locale },
				);
				expect(line, `${locale} ${plan}`).toContain(
					String(PLAN_CREDIT_GRANT[plan]),
				);
				expect(
					m.pricing_feat_credits(
						{ credits: PLAN_CREDIT_GRANT[plan] },
						{ locale },
					),
					`${locale} ${plan}`,
				).toBe(line);
			}
		}
	});

	it('never carries the retired Scale 400 or an "orders/mo" line', () => {
		const offenders: string[] = [];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of Object.entries(catalog)) {
				if (/\b400\b|orders\/mo|order\/bulan|订单\/月/i.test(value))
					offenders.push(`${locale}.${key} = ${value}`);
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	/**
	 * The trial (Zaki, 30 Sep 2026): free until the first order, then N days
	 * or M orders, whichever comes first. The public lines take both as
	 * placeholders from `INVOICE_DUE_GRACE_DAYS` / `TRIAL_CREDIT_GRANT` — and
	 * the two bounds always travel together, because "14 days" alone is the
	 * calendar trial this model replaced.
	 */
	it("states the trial's two bounds together, from the constants", () => {
		const trialKeys = [
			"pricing_sub",
			"pricingpage_hero_sub",
			"pricingpage_faq_a5",
			"pricingpage_cta_sub",
		];
		for (const [locale, catalog] of catalogs) {
			for (const key of trialKeys) {
				expect(catalog[key], `${locale}.${key}`).toContain("{days}");
				expect(catalog[key], `${locale}.${key}`).toContain("{orders}");
			}
		}
		for (const locale of LOCALES) {
			const sub = m.pricingpage_hero_sub(
				{ days: INVOICE_DUE_GRACE_DAYS, orders: TRIAL_CREDIT_GRANT },
				{ locale },
			);
			expect(sub, locale).toContain(String(INVOICE_DUE_GRACE_DAYS));
			expect(sub, locale).toContain(String(TRIAL_CREDIT_GRANT));
		}
	});

	/**
	 * Words the credits model bans from public copy (docs/credits.md): no
	 * wallet, no pay-as-you-go, and no "commission" — the flat-price note said
	 * "komisen" / "佣金" in ms/zh while the en said "cut".
	 */
	it("keeps the banned credits vocabulary out of every locale", () => {
		const banned =
			/\bwallet\b|pay[- ]as[- ]you[- ]go|\bpayg\b|commission|komisen|佣金|dompet|钱包|off-season|luar musim|淡季/i;
		const offenders: string[] = [];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of pricingEntries(catalog)) {
				if (banned.test(value)) offenders.push(`${locale}.${key} = ${value}`);
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});
