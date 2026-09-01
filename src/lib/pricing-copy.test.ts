import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ms from "../../messages/ms.json";
import zh from "../../messages/zh.json";

/**
 * Semantic guards on the public pricing copy (`pricing_*` teaser + `pricingpage_*`
 * full page) so the Scale repositioning (ClickUp 86eyb9zwt) can't silently rot:
 *   1. Scale is the flat multi-outlet tier — reseller-band language is dead and
 *      must not creep back in any locale.
 *   2. No tier ever advertises "Unlimited" — every allowance is finite.
 *   3. The decided order allowances (Starter 100 / Pro 200 / Scale 400) hold.
 *      Note these are display numbers from the caps ticket 86eye2ccu and
 *      deliberately lead PLAN_CAPS enforcement, so this asserts the *copy*, not
 *      the backend constant.
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
		const forbidden = /\bRM\s?\d|S\$\s?\d|\bMYR\b|\bSGD\b/;
		const offenders: string[] = [];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of pricingEntries(catalog)) {
				if (forbidden.test(value))
					offenders.push(`${locale}.${key} = ${value}`);
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("advertises the decided order allowances (100 / 200 / 400)", () => {
		for (const [locale, catalog] of catalogs) {
			expect(catalog.pricingpage_ordercap_starter, locale).toContain("100");
			expect(catalog.pricingpage_ordercap_pro, locale).toContain("200");
			// Scale's card allowance was deliberately number-free after the flat
			// multi-outlet repositioning (86eyb9zwt), while the comparison table
			// already printed a concrete 400 — two answers to the same question on
			// one page. The funnel redesign (86eye3p6z) settles it on 400
			// everywhere, so the card line now carries the number too.
			expect(catalog.pricingpage_ordercap_pro, locale).not.toContain("500");
			expect(catalog.pricingpage_ordercap_scale, locale).toContain("400");
		}
	});
});
