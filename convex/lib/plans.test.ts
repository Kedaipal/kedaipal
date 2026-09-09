import { describe, expect, test } from "vitest";
import {
	ANNUAL_MONTHS_CHARGED,
	ANNUAL_MONTHS_FREE,
	ANNUAL_MONTHS_RECEIVED,
	annualQuote,
	BILLING_CURRENCIES,
	capsForPlan,
	featuresForPlan,
	FOUNDING_MONTHLY_PRICE,
	FOUNDING_MONTHLY_PRICES,
	FOUNDING_PRICE_LAPSE_MS,
	foundingPricingApplies,
	HOLD_MONTHLY_PRICES,
	isPlanSelectable,
	isUnlimited,
	OUTLET_ADDON_MONTHLY_PRICES,
	PLAN_CAPS,
	PLAN_MONTHLY_PRICE,
	PLAN_MONTHLY_PRICES,
	planPrice,
	planQualifiesForFounding,
	PLANS,
	starterPricePerDay,
	UNLIMITED,
} from "./plans";

describe("plans — feature entitlements", () => {
	// Mirrors the pricing table's LIVE ✓/– rows: CRM, Order Inbox, chargeable
	// pickup, product categories and Insights are Pro+.
	test("Starter has no Pro features", () => {
		expect(featuresForPlan("starter")).toEqual({
			crm: false,
			orderInbox: false,
			chargeablePickup: false,
			categories: false,
			insights: false,
			radiusDelivery: false,
			delivery: false,
			onlinePayments: false,
			waOrderAlerts: false,
		});
	});

	test("Pro and Scale have all", () => {
		expect(featuresForPlan("pro")).toEqual({
			crm: true,
			orderInbox: true,
			chargeablePickup: true,
			categories: true,
			insights: true,
			radiusDelivery: true,
			delivery: true,
			onlinePayments: true,
			waOrderAlerts: true,
		});
		expect(featuresForPlan("scale")).toEqual({
			crm: true,
			orderInbox: true,
			chargeablePickup: true,
			categories: true,
			insights: true,
			radiusDelivery: true,
			delivery: true,
			onlinePayments: true,
			waOrderAlerts: true,
		});
	});

	test("returns a copy — mutating the result can't poison the catalog", () => {
		const f = featuresForPlan("pro");
		f.crm = false;
		expect(featuresForPlan("pro").crm).toBe(true);
	});
});

describe("plans — pricing", () => {
	test("monthly price is the table price", () => {
		expect(planPrice("starter", "monthly")).toBe(7900);
		expect(planPrice("pro", "monthly")).toBe(14900);
		expect(planPrice("scale", "monthly")).toBe(39900);
	});

	test("annual = monthly × 10 (10 months paid, 12 received)", () => {
		expect(ANNUAL_MONTHS_CHARGED).toBe(10);
		expect(planPrice("pro", "annual")).toBe(14900 * 10);
	});

	test("2 months free is derived, not asserted", () => {
		expect(ANNUAL_MONTHS_RECEIVED).toBe(12);
		expect(ANNUAL_MONTHS_FREE).toBe(2);
		expect(ANNUAL_MONTHS_CHARGED + ANNUAL_MONTHS_FREE).toBe(
			ANNUAL_MONTHS_RECEIVED,
		);
	});

	test("founding applies the discounted monthly to pro/scale only", () => {
		expect(planPrice("pro", "monthly", true)).toBe(FOUNDING_MONTHLY_PRICE.pro);
		expect(planPrice("pro", "monthly", true)).toBe(10400);
		// Starter has no founding price → falls back to its standard price.
		expect(planPrice("starter", "monthly", true)).toBe(PLAN_MONTHLY_PRICE.starter);
	});

	test("Scale is RM399 / S$149 — the 30 Aug 2026 reset (Arif, FINAL 6 Sep)", () => {
		expect(planPrice("scale", "monthly")).toBe(39900);
		expect(planPrice("scale", "monthly", false, "SGD")).toBe(14900);
		// Starter / Pro did not move.
		expect(planPrice("starter", "monthly")).toBe(7900);
		expect(planPrice("pro", "monthly")).toBe(14900);
	});

	test("SGD table prices — S$29 / S$59 (Aug 2026 SG deck) and S$149 (reset)", () => {
		expect(planPrice("starter", "monthly", false, "SGD")).toBe(2900);
		expect(planPrice("pro", "monthly", false, "SGD")).toBe(5900);
		expect(planPrice("scale", "monthly", false, "SGD")).toBe(14900);
		// Annual keeps the same 10-months-charged rule in every currency.
		expect(planPrice("pro", "annual", false, "SGD")).toBe(5900 * 10);
	});

	test("MYR stays the default — legacy call shape is byte-identical", () => {
		expect(planPrice("pro", "monthly")).toBe(
			planPrice("pro", "monthly", false, "MYR"),
		);
		expect(PLAN_MONTHLY_PRICE).toBe(PLAN_MONTHLY_PRICES.MYR);
	});

	test("SGD founding prices — same ~30%-rounded-down rule as MYR", () => {
		expect(planPrice("pro", "monthly", true, "SGD")).toBe(4100); // S$41
		expect(FOUNDING_MONTHLY_PRICES.SGD.scale).toBe(10400); // S$104 (0.7 × S$149, floored)
		expect(FOUNDING_MONTHLY_PRICES.MYR.scale).toBe(27900); // RM279 (0.7 × RM399, floored)
		// Starter has no founding price → falls back to its standard SGD price.
		expect(planPrice("starter", "monthly", true, "SGD")).toBe(2900);
	});

	test("Off-Season Hold is RM19 / S$9 — priced in every billing currency, below Starter", () => {
		expect(HOLD_MONTHLY_PRICES.MYR).toBe(1900);
		expect(HOLD_MONTHLY_PRICES.SGD).toBe(900);
		for (const currency of BILLING_CURRENCIES) {
			expect(HOLD_MONTHLY_PRICES[currency]).toBeGreaterThan(0);
			expect(HOLD_MONTHLY_PRICES[currency]).toBeLessThan(
				PLAN_MONTHLY_PRICES[currency].starter,
			);
		}
		// A hold is a status, not a tier — the Plan union must not have grown.
		expect(PLANS).toEqual(["starter", "pro", "scale"]);
	});

	test("additional-outlet add-on: RM49 / S$18 (S$18 confirmed 1 Sep 2026)", () => {
		expect(OUTLET_ADDON_MONTHLY_PRICES.MYR).toBe(4900);
		expect(OUTLET_ADDON_MONTHLY_PRICES.SGD).toBe(1800);
	});

	test("every billing currency prices every plan (exhaustive tables)", () => {
		for (const currency of BILLING_CURRENCIES) {
			for (const plan of PLANS) {
				expect(PLAN_MONTHLY_PRICES[currency][plan]).toBeGreaterThan(0);
			}
			// Founding is always cheaper than standard, in every currency.
			for (const plan of ["pro", "scale"] as const) {
				expect(FOUNDING_MONTHLY_PRICES[currency][plan]).toBeLessThan(
					PLAN_MONTHLY_PRICES[currency][plan],
				);
			}
		}
	});
});

describe("plans — \"less than X a day\"", () => {
	/**
	 * The landing anchor renders this as "less than {perDay} a day", so the
	 * number has to make that sentence TRUE, not merely close. `Math.ceil`
	 * returns the daily rate itself at a price that divides evenly (RM90 → 3,
	 * and "less than RM3 a day" is then false); `floor + 1` cannot.
	 */
	test("is strictly greater than the actual daily rate", () => {
		for (const currency of BILLING_CURRENCIES) {
			const daily = PLAN_MONTHLY_PRICES[currency].starter / 100 / 30;
			expect(starterPricePerDay(currency)).toBeGreaterThan(daily);
		}
	});

	test("holds the copy today's prices produce", () => {
		// RM79/mo → "less than RM3 a day"; S$29/mo → "less than S$1 a day".
		expect(starterPricePerDay("MYR")).toBe(3);
		expect(starterPricePerDay("SGD")).toBe(1);
	});
});

describe("plans — public tier set", () => {
	// Enterprise is drafted in strategy but must not appear on any pricing surface
	// yet (ClickUp 86ey4gaju). The exposed plan set is exactly the three public
	// tiers — a guard against an Enterprise enum sneaking back into rendering.
	test("exactly Starter, Pro, Scale — no Enterprise", () => {
		expect(PLANS).toEqual(["starter", "pro", "scale"]);
		expect(PLANS).not.toContain("enterprise");
	});
});

describe("plans — gating helpers", () => {
	test("Scale is not selectable at v1; only Pro qualifies for founding", () => {
		expect(isPlanSelectable("starter")).toBe(true);
		expect(isPlanSelectable("pro")).toBe(true);
		expect(isPlanSelectable("scale")).toBe(false);
		expect(planQualifiesForFounding("pro")).toBe(true);
		expect(planQualifiesForFounding("scale")).toBe(false);
		expect(planQualifiesForFounding("starter")).toBe(false);
	});

	test("capsForPlan returns the finite caps for every v1 tier", () => {
		expect(capsForPlan("starter")).toEqual({
			orderCap: 100,
			userCap: 1,
			broadcastQuota: 0,
		});
		// Pro 200 / Scale 400 — the allowances /pricing had advertised ahead of
		// enforcement (86eye2ccu), landed with the pricing reset (z8r3fday24).
		expect(capsForPlan("pro")).toEqual({
			orderCap: 200,
			userCap: 2,
			broadcastQuota: 100,
		});
		// Scale's "unlimited" was dropped for finite soft caps (Arif 2026-06-28);
		// broadcasts stay 500/mo (~5× Pro). All finite.
		expect(capsForPlan("scale")).toEqual({
			orderCap: 400,
			userCap: 5,
			broadcastQuota: 500,
		});
	});

	test("the order allowances match what /pricing advertises (100 / 200 / 400)", () => {
		expect(PLAN_CAPS.starter.orderCap).toBe(100);
		expect(PLAN_CAPS.pro.orderCap).toBe(200);
		expect(PLAN_CAPS.scale.orderCap).toBe(400);
	});

	// The UNLIMITED/isUnlimited sentinel is retained for a future Enterprise tier
	// even though no v1 plan uses it.
	test("isUnlimited recognises the unlimited sentinel", () => {
		expect(isUnlimited(UNLIMITED)).toBe(true);
		expect(isUnlimited(2000)).toBe(false);
		expect(isUnlimited(500)).toBe(false);
	});
});

describe("foundingPricingApplies (3-month lapse window, 86eyb6z4r)", () => {
	const DAY = 24 * 60 * 60 * 1000;
	const NOW = 1_900_000_000_000;
	const base = {
		plan: "pro" as const,
		isFoundingMember: true,
		foundingIntent: true, // never cleared after the claim — must not bypass the window
		now: NOW,
	};

	test("claimed member inside the window keeps the founding price", () => {
		expect(
			foundingPricingApplies({ ...base, paidThrough: NOW - 89 * DAY }),
		).toBe(true);
		// The renewal-cron case: paid through the future (active).
		expect(
			foundingPricingApplies({ ...base, paidThrough: NOW + 30 * DAY }),
		).toBe(true);
	});

	test("claimed member lapsed past 3 months bills at list — intent flag can't rescue it", () => {
		expect(
			foundingPricingApplies({ ...base, paidThrough: NOW - 91 * DAY }),
		).toBe(false);
		expect(FOUNDING_PRICE_LAPSE_MS).toBe(90 * DAY);
	});

	test("unclaimed onboard intent always qualifies (no lapse to measure)", () => {
		expect(
			foundingPricingApplies({
				...base,
				isFoundingMember: false,
				paidThrough: undefined,
			}),
		).toBe(true);
	});

	test("a claimed member with no paid period fails toward the promise", () => {
		expect(foundingPricingApplies({ ...base, paidThrough: undefined })).toBe(
			true,
		);
	});

	test("only founding-priced tiers qualify; plain stores never do", () => {
		expect(
			foundingPricingApplies({ ...base, plan: "starter", paidThrough: undefined }),
		).toBe(false);
		expect(
			foundingPricingApplies({
				plan: "pro",
				isFoundingMember: false,
				foundingIntent: false,
				paidThrough: NOW - DAY,
				now: NOW,
			}),
		).toBe(false);
	});
});

describe("plans — annualQuote", () => {
	/**
	 * The regression this type exists for: `/pricing` used to render its yearly
	 * total as `floor(monthly × 10 / 12) × 10`, which quotes a year at 8.33
	 * months of list price. Every tier under-quoted by two months of the
	 * ROUNDING error on top of the real discount.
	 */
	test("annualTotal IS planPrice(annual) — the two can never diverge", () => {
		for (const currency of BILLING_CURRENCIES) {
			for (const plan of PLANS) {
				for (const founding of [false, true]) {
					expect(annualQuote(plan, founding, currency).annualTotal).toBe(
						planPrice(plan, "annual", founding, currency),
					);
				}
			}
		}
	});

	test("the old page arithmetic is NOT what we charge", () => {
		const q = annualQuote("starter");
		const oldPageTotal = Math.floor((7900 / 100) * 10 / 12) * 10 * 100;
		expect(oldPageTotal).toBe(65_000); // RM650 — what the card used to say
		expect(q.annualTotal).toBe(79_000); // RM790 — what the invoice says
		expect(q.annualTotal).toBeGreaterThan(oldPageTotal);
	});

	test("saving is exactly the free months, in every currency and plan", () => {
		for (const currency of BILLING_CURRENCIES) {
			for (const plan of PLANS) {
				const q = annualQuote(plan, false, currency);
				expect(q.saving).toBe(q.monthly * ANNUAL_MONTHS_FREE);
				expect(q.monthsFree).toBe(ANNUAL_MONTHS_FREE);
				// 12 monthly invoices vs one annual one.
				expect(q.monthly * 12 - q.annualTotal).toBe(q.saving);
			}
		}
	});

	test("MYR headline numbers", () => {
		expect(annualQuote("starter")).toEqual({
			monthly: 7900,
			annualTotal: 79_000,
			effectiveMonthly: 6584, // RM65.84 — rounded UP; 6583 × 12 < 79,000
			saving: 15_800, // RM158 = 2 × RM79
			monthsFree: 2,
		});
		expect(annualQuote("pro")).toEqual({
			monthly: 14_900,
			annualTotal: 149_000,
			effectiveMonthly: 12_417, // RM124.17 (149,000 / 12 = 12,416.6…)
			saving: 29_800,
			monthsFree: 2,
		});
	});

	test("SGD headline numbers", () => {
		expect(annualQuote("pro", false, "SGD")).toEqual({
			monthly: 5900,
			annualTotal: 59_000,
			effectiveMonthly: 4917, // S$49.17 (59,000 / 12 = 4,916.6…)
			saving: 11_800,
			monthsFree: 2,
		});
	});

	test("a Founding member's annual is 10 × their discounted rate", () => {
		const q = annualQuote("pro", true);
		expect(q.monthly).toBe(FOUNDING_MONTHLY_PRICE.pro);
		expect(q.annualTotal).toBe(FOUNDING_MONTHLY_PRICE.pro * 10);
		expect(q.saving).toBe(FOUNDING_MONTHLY_PRICE.pro * 2);
		// Never quotes a founding member the standard-price saving.
		expect(q.saving).toBeLessThan(annualQuote("pro", false).saving);
	});

	test("effectiveMonthly never understates the year — 12 × it covers the bill", () => {
		for (const currency of BILLING_CURRENCIES) {
			for (const plan of PLANS) {
				for (const founding of [false, true]) {
					const q = annualQuote(plan, founding, currency);
					// The whole point: a seller multiplying the small number by 12 must
					// never arrive under what we will invoice them.
					expect(q.effectiveMonthly * 12).toBeGreaterThanOrEqual(q.annualTotal);
					// …and it is still visibly cheaper than paying monthly.
					expect(q.effectiveMonthly).toBeLessThan(q.monthly);
				}
			}
		}
	});
});
