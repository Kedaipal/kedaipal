import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ms from "../../messages/ms.json";
import zh from "../../messages/zh.json";

/**
 * Semantic guards on the funnel copy added by ClickUp 86eye3p6z. These are the
 * claims we are legally and commercially on the hook for, so they get a test
 * rather than a review habit:
 *
 *   1. The guarantee has exactly ONE author. The WhatsApp outreach ladder makes
 *      the same promise word-for-word; a second copy of the sentence in the
 *      catalog is how the two start drifting.
 *   2. Shopee's rate is always hedged. Their commission is category-based and
 *      the 5.5% Free Shipping slice is opt-in, so "up to ~20%" is defensible
 *      and a bare "20%" is not.
 *   3. Nothing in the payment strip implies HitPay's gateway fee is waived.
 *      "0% cut" is about Kedaipal's subscription; under BYO accounts HitPay
 *      bills the seller directly and we add nothing on top.
 *   4. The money math never becomes a SAVINGS claim. A seller's WhatsApp orders
 *      already cost 0%, so Kedaipal is an added cost on them — we may say we
 *      never take a cut, we may not say "save RMx versus Shopee".
 *
 * Key parity across locales lives in i18n.test.ts; tier copy in
 * pricing-copy.test.ts.
 */

const catalogs = [
	["en", en as Record<string, string>],
	["ms", ms as Record<string, string>],
	["zh", zh as Record<string, string>],
] as const;

describe("landing funnel copy", () => {
	it("keeps the guarantee to a single authored sentence per locale", () => {
		for (const [locale, catalog] of catalogs) {
			const guarantee = catalog.guarantee_line;
			expect(guarantee, locale).toBeTruthy();

			const duplicates = Object.entries(catalog)
				.filter(
					([key, value]) => key !== "guarantee_line" && value === guarantee,
				)
				.map(([key]) => `${locale}.${key}`);
			expect(
				duplicates,
				`the guarantee is duplicated — delete the copy and read guarantee_line: ${duplicates.join(", ")}`,
			).toEqual([]);
		}
	});

	it("always hedges Shopee's rate", () => {
		// The hedge itself is what matters, not the character: EN/BM lean on the
		// tilde, ZH says 最高约 ("at most, approximately"). A bare "20%" in any of
		// them would be a claim Shopee's category-based commission doesn't support.
		const hedge: Record<string, RegExp> = {
			en: /up to|~/i,
			ms: /sampai|~/i,
			zh: /最高|约|~/,
		};
		for (const [locale, catalog] of catalogs) {
			expect(catalog.mm_line1, `${locale} mm_line1`).toContain("20%");
			expect(catalog.mm_line1, `${locale} mm_line1`).toMatch(hedge[locale]);
			expect(catalog.mm_rate_shopee, `${locale} mm_rate_shopee`).toMatch(
				hedge[locale],
			);
		}
	});

	it("never implies gateway fees are waived", () => {
		// A "free"/"percuma"/"免费" anywhere in the payment strip would read as free
		// processing sitting right under the money-math block's "0%".
		const freeWord = /\bfree\b|percuma|免费|zero fee|tanpa yuran/i;
		const offenders: string[] = [];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of Object.entries(catalog)) {
				if (!key.startsWith("pay_") && key !== "footer_pay_line") continue;
				if (freeWord.test(value)) offenders.push(`${locale}.${key} = ${value}`);
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);

		// …and the fee note must actually name who bills it.
		for (const [locale, catalog] of catalogs) {
			expect(catalog.pay_fee_note, locale).toMatch(/HitPay/i);
			expect(catalog.pay_strong, locale).toMatch(/HitPay/i);
		}
	});

	it("keeps the money math a positioning claim, not a savings claim", () => {
		const savingsWord = /\bsave\b|\bsavings\b|jimat|penjimatan|省下|节省/i;
		const offenders: string[] = [];
		for (const [locale, catalog] of catalogs) {
			for (const [key, value] of Object.entries(catalog)) {
				if (!key.startsWith("mm_")) continue;
				if (savingsWord.test(value))
					offenders.push(`${locale}.${key} = ${value}`);
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});
