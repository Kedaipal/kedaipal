import { describe, expect, test } from "vitest";
import {
	annualQuote,
	LISTED_PLANS,
	PLAN_MONTHLY_PRICES,
} from "../../convex/lib/plans";
import { pricingJsonLd } from "./pricing-jsonld";

const SITE = "https://kedaipal.com";

describe("pricingJsonLd", () => {
	test.each([
		"MYR",
		"SGD",
	] as const)("%s: one monthly + one annual Offer per listed tier, priced from the constants", (currency) => {
		const ld = pricingJsonLd({ siteUrl: SITE, currency });
		expect(ld.offers).toHaveLength(LISTED_PLANS.length * 2);
		for (const plan of LISTED_PLANS) {
			const monthly = ld.offers.find((o) =>
				o.name.startsWith(`${plan === "pro" ? "Pro" : "Starter"} — monthly`),
			);
			const annual = ld.offers.find((o) =>
				o.name.startsWith(`${plan === "pro" ? "Pro" : "Starter"} — annual`),
			);
			expect(monthly?.price).toBe(
				String(PLAN_MONTHLY_PRICES[currency][plan] / 100),
			);
			expect(annual?.price).toBe(
				String(annualQuote(plan, false, currency).annualTotal / 100),
			);
			expect(annual?.priceSpecification.billingDuration).toBe(12);
		}
		for (const o of ld.offers) expect(o.priceCurrency).toBe(currency);
	});

	test("annual says how many months are free, never a percentage", () => {
		const ld = pricingJsonLd({ siteUrl: SITE, currency: "MYR" });
		const annual = ld.offers.filter((o) => o.name.includes("annual"));
		for (const o of annual) {
			expect(o.name).toMatch(/\d months free/);
			expect(o.name).not.toMatch(/%/);
		}
	});

	test("Enterprise and founding never appear as an offer", () => {
		const json = JSON.stringify(
			pricingJsonLd({ siteUrl: SITE, currency: "MYR" }),
		);
		expect(json).not.toMatch(/enterprise/i);
		expect(json).not.toMatch(/founding/i);
	});
});
