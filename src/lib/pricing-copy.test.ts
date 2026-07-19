import { describe, expect, it } from "vitest";
import { PLAN_CAPS } from "../../convex/lib/plans";
import en from "../../messages/en.json";
import ms from "../../messages/ms.json";

/**
 * Guards the public pricing copy (`pricing_*` teaser + `pricingpage_*` full
 * page) against drifting from shipped reality (ClickUp 86eyb9zwt):
 *   1. Scale is the flat multi-outlet tier — reseller-band language is dead and
 *      must not creep back in either locale.
 *   2. Displayed caps must match PLAN_CAPS — the table lied ("Unlimited") once;
 *      never again.
 * Layout/rendering stays a review concern; this only pins the catalog strings.
 */

const catalogs = [
	["en", en as Record<string, string>],
	["ms", ms as Record<string, string>],
] as const;

function pricingEntries(catalog: Record<string, string>): [string, string][] {
	return Object.entries(catalog).filter(([key]) =>
		/^(pricing_|pricingpage_)/.test(key),
	);
}

describe("pricing copy stays in sync with shipped plans", () => {
	it("carries no reseller-band language in either locale", () => {
		// en + ms spellings of the dead reseller-tier identity. Key check catches
		// the old `pricingpage_band_*` table keys; value check catches copy.
		// ("band" alone would false-positive on ms "Banding pelan" = compare plans.)
		const forbiddenKey = /reseller|_band_/i;
		const forbiddenValue = /reseller|penjual semula|pengedar/i;
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

	it('never claims "Unlimited" — all caps are finite per PLAN_CAPS', () => {
		const forbidden = /unlimited|tanpa had/i;
		const offenders: string[] = [];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of pricingEntries(catalog)) {
				if (forbidden.test(value)) offenders.push(`${locale}.${key}`);
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("order-cap copy matches PLAN_CAPS per tier", () => {
		for (const [, catalog] of catalogs) {
			expect(catalog.pricingpage_ordercap_starter).toContain(
				String(PLAN_CAPS.starter.orderCap),
			);
			expect(catalog.pricingpage_ordercap_pro).toContain(
				String(PLAN_CAPS.pro.orderCap),
			);
			// 2000 renders with a thousands separator.
			expect(catalog.pricingpage_ordercap_scale).toContain(
				PLAN_CAPS.scale.orderCap.toLocaleString("en-MY"),
			);
		}
	});

	it("broadcast quota copy matches PLAN_CAPS", () => {
		for (const [, catalog] of catalogs) {
			expect(catalog.pricingpage_val_broadcast_pro).toContain(
				String(PLAN_CAPS.pro.broadcastQuota),
			);
			expect(catalog.pricingpage_val_broadcast_scale).toContain(
				String(PLAN_CAPS.scale.broadcastQuota),
			);
		}
	});
});
