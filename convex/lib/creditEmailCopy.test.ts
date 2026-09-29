// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
	type CreditEmailKey,
	type CreditEmailVars,
	creditBalancePhrase,
	renderCreditEmail,
} from "./creditEmailCopy";
import type { Locale } from "./locale";

const LOCALES: Locale[] = ["en", "ms", "zh"];
const KEYS: CreditEmailKey[] = [
	"low",
	"locked",
	"stillLocked",
	"unlocked",
	"expiring",
];

function vars(over: Partial<CreditEmailVars> = {}): CreditEmailVars {
	return {
		storeName: "Kek Mak Jah",
		billingUrl: "https://kedaipal.com/app/settings?tab=billing",
		route: "topup",
		balance: 8,
		topUpAvailable: true,
		expiring: { credits: 20, onFormatted: "14 Oct 2026" },
		...over,
	};
}

describe("credit notice emails (Credits T3)", () => {
	test.each(LOCALES)("%s: every notice renders a subject, html and text", (locale) => {
		for (const key of KEYS) {
			const out = renderCreditEmail(locale, key, vars());
			expect(out.subject.length, `${locale}/${key}`).toBeGreaterThan(5);
			expect(out.html, `${locale}/${key}`).toContain(vars().billingUrl);
			expect(out.text, `${locale}/${key}`).toContain(vars().billingUrl);
		}
	});

	test("the lock says what's paused AND what still works, and that orders keep coming", () => {
		const out = renderCreditEmail("en", "locked", vars({ balance: 0 }));
		expect(out.html).toMatch(
			/Paused until you add credits:.*accepting and updating orders, and editing products/,
		);
		expect(out.html).toMatch(/Still working:.*cancelling and refunding/);
		expect(out.subject).toMatch(/orders are still coming in/);
	});

	test("still locked after a refresh: says how far short", () => {
		const out = renderCreditEmail("en", "stillLocked", vars({ balance: -15 }));
		expect(out.subject).toBe("Your credits refreshed — you're still 15 orders short");
		expect(out.html).toContain("<strong>15 orders short</strong>");
	});

	test.each(LOCALES)(
		"%s: a refresh that lands exactly on 0 never reads '0 orders short'",
		(locale) => {
			const out = renderCreditEmail(locale, "stillLocked", vars({ balance: 0 }));
			for (const part of [out.subject, out.html, out.text]) {
				expect(part).not.toMatch(/\b0 orders short|kurang 0 pesanan|欠 0 笔/);
				expect(part).toMatch(/0 orders left|0 pesanan|0 笔订单/);
			}
		},
	);

	test("the action line follows the store's way back", () => {
		const trial = renderCreditEmail("en", "locked", vars({ route: "pick_plan" }));
		expect(trial.html).toMatch(/Pick a plan/);
		expect(trial.html).not.toMatch(/credit pack/);
		const lapsed = renderCreditEmail("en", "locked", vars({ route: "pay_invoice" }));
		expect(lapsed.html).toMatch(/Pay your invoice/);
		const topUp = renderCreditEmail(
			"en",
			"low",
			vars({ upgrade: { planName: "Pro", included: 200 } }),
		);
		expect(topUp.html).toMatch(/with a credit pack/);
		expect(topUp.html).toMatch(/move to Pro, which includes 200 orders a month/);
		// Packs unsold on this deployment: never offered.
		const noPacks = renderCreditEmail("en", "low", vars({ topUpAvailable: false }));
		expect(noPacks.html).not.toMatch(/credit pack/);
	});

	test("a store name can't inject markup", () => {
		const out = renderCreditEmail(
			"en",
			"low",
			vars({ storeName: '<img src=x onerror="alert(1)">' }),
		);
		expect(out.html).not.toContain("<img src=x");
		expect(out.html).toContain("&lt;img");
	});

	test("bought credits expiring: how many, and when", () => {
		const out = renderCreditEmail("en", "expiring", vars());
		expect(`${out.subject} ${out.html}`).toMatch(/20/);
		expect(out.html).toContain("14 Oct 2026");
	});

	test("the WhatsApp balance phrase is always an order count", () => {
		expect(creditBalancePhrase(0, "en")).toBe("0 orders left");
		expect(creditBalancePhrase(-15, "en")).toBe("15 orders owed");
		expect(creditBalancePhrase(-15, "ms")).toBe("15 pesanan tertunggak");
		// zh rides the English template.
		expect(creditBalancePhrase(7, "zh")).toBe("7 orders left");
	});
});
