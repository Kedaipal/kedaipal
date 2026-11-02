import { describe, expect, test } from "vitest";
import { renderLowWalletEmail } from "./courierWalletEmailCopy";
import type { Locale } from "./emailCopy";

/** The once-per-crossing low courier-wallet email (z8r3fdrgxc). */

const base = {
	storeName: "Kek Mak Jah",
	providerName: "Lalamove",
	state: "low" as const,
	balanceFormatted: "RM 12.40",
	lowLineFormatted: "RM 30.00",
	topUpUrl: "https://web.lalamove.com",
	integrationsUrl: "https://kedaipal.com/app/settings?tab=integrations",
};

describe("renderLowWalletEmail", () => {
	test("names the wallet, the balance and the line, and links to the courier", () => {
		const r = renderLowWalletEmail("en", base);
		expect(r.subject).toBe("Lalamove wallet running low — Kek Mak Jah");
		expect(r.text).toContain("RM 12.40");
		expect(r.text).toContain("RM 30.00");
		expect(r.html).toContain("https://web.lalamove.com");
	});

	test("a refusal with no amount says what happened, not a made-up balance", () => {
		const r = renderLowWalletEmail("en", {
			...base,
			state: "short",
			balanceFormatted: null,
		});
		expect(r.text).toMatch(/refused a booking/);
		expect(r.text).not.toMatch(/RM 0/);
	});

	test("with no courier site for the country it links to Integrations instead", () => {
		const r = renderLowWalletEmail("en", { ...base, topUpUrl: null });
		expect(r.html).toContain("tab=integrations");
	});

	test.each<Locale>(["en", "ms", "zh"])(
		"%s: never calls it 'credits' and never implies Kedaipal tops it up",
		(locale) => {
			const r = renderLowWalletEmail(locale, base);
			expect(r.subject.toLowerCase()).not.toContain("credit");
			// Each locale states plainly that Kedaipal can't top it up.
			const disclaimer = {
				en: "Kedaipal doesn't hold this money and can't top it up for you.",
				ms: "Kedaipal tidak memegang wang ini",
				zh: "Kedaipal 不持有这笔钱",
			}[locale];
			expect(r.text).toContain(disclaimer);
		},
	);
});
