import { describe, expect, it } from "vitest";
import {
	CREDIT_PACKS,
	ENTERPRISE_FROM_ORDERS,
	type ListedPlan,
	PLAN_CREDIT_GRANT,
	PLAN_MONTHLY_PRICES,
} from "../../convex/lib/plans";
import {
	BOUNDS_FOR,
	COST_INPUTS_SCHEMA_FOR,
	type CostInputs,
	cheapestTopUp,
	clamp,
	clampInputs,
	computeStatusQuoCost,
	DEFAULT_CHASE_MIN,
	DEFAULT_INPUTS_FOR,
	LABOR_RATE_PER_HR,
	monthlyOrdersFromWeekly,
	type PlanOption,
	recommendPlan,
	WEEKS_PER_MONTH,
} from "./calculator";

/** What covering `ordersPerWeek` on `plan` costs a month — the plan's price
 * plus its cheapest top-ups — to check `recommendPlan` against every tier. */
function optionCost(
	ordersPerWeek: number,
	currency: "MYR" | "SGD",
	plan: ListedPlan,
): number {
	const shortfall =
		monthlyOrdersFromWeekly(ordersPerWeek) - PLAN_CREDIT_GRANT[plan];
	return (
		PLAN_MONTHLY_PRICES[currency][plan] +
		cheapestTopUp(shortfall, CREDIT_PACKS[currency]).priceMinor
	);
}

/** "pro + 2×50" — a recommendation as one comparable string. */
function shape(option: PlanOption | null): string {
	if (!option) return "none";
	return [
		option.plan,
		...option.packs.map((p) => `${p.count}×${p.credits}`),
	].join(" + ");
}

const ICP: CostInputs = {
	ordersPerWeek: 40,
	aov: 35,
	missedPerWeek: 4,
	chaseMin: DEFAULT_CHASE_MIN,
};

describe("computeStatusQuoCost — formula", () => {
	it("computes A, B and C exactly for a representative ICP seller", () => {
		const r = computeStatusQuoCost(ICP, "MYR");
		// A = M × AOV × 4.33 = 4 × 35 × 4.33
		expect(r.missedRevenue).toBeCloseTo(4 * 35 * WEEKS_PER_MONTH, 6);
		// B = (W × min / 60) × 4.33 × 25 = (40 × 5 / 60) × 4.33 × 25
		expect(r.chaseCost).toBeCloseTo(
			((40 * 5) / 60) * WEEKS_PER_MONTH * LABOR_RATE_PER_HR.MYR,
			6,
		);
		expect(r.total).toBeCloseTo(r.missedRevenue + r.chaseCost, 6);
	});

	it("derives savings and ratio from the total vs the plan their volume needs", () => {
		const r = computeStatusQuoCost(ICP, "MYR");
		// 40 a week ≈ 174 a month → Pro's 200 covers it.
		expect(r.recommendation.best.plan).toBe("pro");
		expect(r.kedaipalMonthly).toBe(PLAN_MONTHLY_PRICES.MYR.pro / 100);
		expect(r.savings).toBeCloseTo(r.total - r.kedaipalMonthly, 6);
		expect(r.ratio).toBeCloseTo(r.total / r.kedaipalMonthly, 6);
	});

	it("yields positive savings and is not disqualified for an ICP seller", () => {
		const r = computeStatusQuoCost(ICP, "MYR");
		expect(r.total).toBeGreaterThan(r.kedaipalMonthly);
		expect(r.savings).toBeGreaterThan(0);
		expect(r.disqualified).toBe(false);
		expect(r.disqualifyReason).toBeNull();
	});

	it("defaults chase minutes via DEFAULT_CHASE_MIN constant", () => {
		expect(DEFAULT_CHASE_MIN).toBe(5);
	});
});

describe("computeStatusQuoCost — the SGD arm", () => {
	const SG_ICP: CostInputs = { ...ICP, aov: DEFAULT_INPUTS_FOR.SGD.aov };

	it("prices chase labour at the SG rate, not an FX conversion of the MY one", () => {
		const r = computeStatusQuoCost(SG_ICP, "SGD");
		expect(r.chaseCost).toBeCloseTo(
			((40 * 5) / 60) * WEEKS_PER_MONTH * LABOR_RATE_PER_HR.SGD,
			6,
		);
		expect(LABOR_RATE_PER_HR.SGD).toBe(15);
	});

	it("anchors savings against the SGD price of the recommended plan", () => {
		const r = computeStatusQuoCost(SG_ICP, "SGD");
		expect(r.kedaipalMonthly).toBe(PLAN_MONTHLY_PRICES.SGD.pro / 100);
		expect(r.savings).toBeCloseTo(r.total - r.kedaipalMonthly, 6);
		expect(r.ratio).toBeCloseTo(r.total / r.kedaipalMonthly, 6);
	});

	it("never mixes currencies — the same inputs cost differently in each", () => {
		const my = computeStatusQuoCost(ICP, "MYR");
		const sg = computeStatusQuoCost(ICP, "SGD");
		expect(sg.chaseCost).not.toBeCloseTo(my.chaseCost, 6);
		expect(sg.savings).not.toBeCloseTo(my.savings, 6);
	});
});

describe("recommendPlan — the plan a seller's volume actually needs (Credits T5)", () => {
	it("turns orders a week into orders a month as 52/12, rounded up", () => {
		expect(monthlyOrdersFromWeekly(20)).toBe(87); // 86.67
		expect(monthlyOrdersFromWeekly(60)).toBe(260); // exactly
		expect(monthlyOrdersFromWeekly(130)).toBe(564); // 563.33
		expect(monthlyOrdersFromWeekly(0)).toBe(0);
	});

	/**
	 * The three volumes the ticket named, in both currencies. Every number is
	 * derived from the billing tables, so a price or pack change re-derives the
	 * expectation instead of leaving a stale literal to argue with.
	 */
	const price = (currency: "MYR" | "SGD", plan: ListedPlan) =>
		PLAN_MONTHLY_PRICES[currency][plan];
	const pack = (currency: "MYR" | "SGD", credits: number) => {
		const found = CREDIT_PACKS[currency].find((p) => p.credits === credits);
		if (!found) throw new Error(`no ${credits}-credit pack in ${currency}`);
		return found.priceMinor;
	};

	it("20 a week (~87 a month): Starter covers it, alone", () => {
		for (const currency of ["MYR", "SGD"] as const) {
			const r = recommendPlan(20, currency);
			expect(r.monthlyOrders).toBeLessThanOrEqual(PLAN_CREDIT_GRANT.starter);
			expect(shape(r.best), currency).toBe("starter");
			expect(r.best.monthlyMinor).toBe(price(currency, "starter"));
			expect(r.best.topUpCredits).toBe(0);
		}
	});

	it("30 a week (~130 a month): Starter + 1 × 50, and Pro is the honest comparison", () => {
		for (const currency of ["MYR", "SGD"] as const) {
			const r = recommendPlan(30, currency);
			expect(r.monthlyOrders).toBe(130);
			expect(shape(r.best), currency).toBe("starter + 1×50");
			expect(r.best.monthlyMinor).toBe(
				price(currency, "starter") + pack(currency, 50),
			);
			// "Cheaper than Pro at RM149" — Pro covers 130 on its own credits.
			expect(shape(r.nextTierUp), currency).toBe("pro");
			expect(r.nextTierUp?.monthlyMinor).toBe(price(currency, "pro"));
		}
	});

	it("60 a week (~260 a month): Pro + 2 × 50 in both currencies", () => {
		const my = recommendPlan(60, "MYR");
		expect(shape(my.best)).toBe("pro + 2×50");
		expect(my.best.monthlyMinor).toBe(
			price("MYR", "pro") + 2 * pack("MYR", 50),
		);
		// RM239 — and Starter + 1 × 200 costs the same RM239. The tie goes to
		// the HIGHER tier: the same money with more credits built in.
		expect(price("MYR", "starter") + pack("MYR", 200)).toBe(
			my.best.monthlyMinor,
		);

		const sg = recommendPlan(60, "SGD");
		expect(shape(sg.best)).toBe("pro + 2×50");
		expect(sg.best.monthlyMinor).toBe(
			price("SGD", "pro") + 2 * pack("SGD", 50),
		);
		// Pro is the top LISTED tier — there is no bigger plan to compare
		// against, and Enterprise (no price) is never one (T6).
		expect(my.nextTierUp).toBeNull();
		expect(sg.nextTierUp).toBeNull();
	});

	it("130 a week (~564 a month): Pro + 2 × 200 in both currencies", () => {
		for (const currency of ["MYR", "SGD"] as const) {
			const r = recommendPlan(130, currency);
			expect(shape(r.best), currency).toBe("pro + 2×200");
			expect(r.best.monthlyMinor).toBe(
				price(currency, "pro") + 2 * pack(currency, 200),
			);
			expect(r.nextTierUp).toBeNull();
		}
	});

	it("never recommends Enterprise — it has no price, and the slider stops short of it", () => {
		// The PlanOption type already forbids it; this pins the claim the
		// type's comment makes: the busiest volume the page can express is
		// below where Enterprise begins, so "Pro + top-ups" never pretends to
		// be the answer for a seller who should be talking to us.
		for (const currency of ["MYR", "SGD"] as const) {
			const max = BOUNDS_FOR[currency].ordersPerWeek.max;
			expect(monthlyOrdersFromWeekly(max)).toBeLessThan(ENTERPRISE_FROM_ORDERS);
			expect(recommendPlan(max, currency).best.plan).toBe("pro");
		}
	});

	it("always covers the volume it quotes", () => {
		for (const currency of ["MYR", "SGD"] as const) {
			for (let w = 0; w <= BOUNDS_FOR[currency].ordersPerWeek.max; w++) {
				const { monthlyOrders, best } = recommendPlan(w, currency);
				expect(
					best.included + best.topUpCredits,
					`${currency} ${w}/wk`,
				).toBeGreaterThanOrEqual(monthlyOrders);
			}
		}
	});

	it("is never beaten, and 'cheaper than' the next tier up is always strictly true", () => {
		for (const currency of ["MYR", "SGD"] as const) {
			for (let w = 0; w <= BOUNDS_FOR[currency].ordersPerWeek.max; w++) {
				const r = recommendPlan(w, currency);
				for (const plan of ["starter", "pro"] as const) {
					expect(
						r.best.monthlyMinor,
						`${currency} ${w}/wk vs ${plan}`,
					).toBeLessThanOrEqual(optionCost(w, currency, plan));
				}
				if (r.nextTierUp)
					expect(r.nextTierUp.monthlyMinor).toBeGreaterThan(
						r.best.monthlyMinor,
					);
			}
		}
	});

	it("never compares against a lower tier — the 260-order tie is the trap", () => {
		// Starter + 1 × 200 costs the same RM239 as Pro + 2 × 50. A "cheaper
		// than Starter + 1 × 200" line would be false; the comparison is the
		// bigger plan the seller didn't need.
		expect(optionCost(60, "MYR", "starter")).toBe(
			recommendPlan(60, "MYR").best.monthlyMinor,
		);
		expect(recommendPlan(60, "MYR").best.plan).toBe("pro");
		expect(recommendPlan(60, "MYR").nextTierUp).toBeNull();
	});
});

describe("cheapestTopUp", () => {
	it("buys nothing when nothing is short", () => {
		expect(cheapestTopUp(0, CREDIT_PACKS.MYR)).toEqual({
			packs: [],
			credits: 0,
			priceMinor: 0,
		});
		expect(cheapestTopUp(-40, CREDIT_PACKS.MYR).packs).toEqual([]);
	});

	it("takes the cheapest whole packs that reach the shortfall", () => {
		// 60 short: 2 × 50 (RM90) beats 1 × 200 (RM160).
		expect(cheapestTopUp(60, CREDIT_PACKS.MYR)).toMatchObject({
			credits: 100,
			priceMinor: 2 * CREDIT_PACKS.MYR[0].priceMinor,
		});
		// 364 short: 2 × 200 (RM320) beats 1 × 200 + 4 × 50 (RM340).
		expect(cheapestTopUp(364, CREDIT_PACKS.MYR).packs).toEqual([
			{ credits: 200, count: 2, priceMinor: 16000 },
		]);
	});
});

describe("computeStatusQuoCost — honest disqualification", () => {
	it("flags no_missed when missed orders is zero (priority over below_price)", () => {
		const r = computeStatusQuoCost({ ...ICP, missedPerWeek: 0 }, "MYR");
		expect(r.missedRevenue).toBe(0);
		expect(r.disqualified).toBe(true);
		expect(r.disqualifyReason).toBe("no_missed");
	});

	it("flags below_price when total status-quo cost is at or under the price", () => {
		// Tiny seller: 1 missed order/wk at RM5, almost no chasing.
		const r = computeStatusQuoCost(
			{ ordersPerWeek: 2, aov: 5, missedPerWeek: 1, chaseMin: 1 },
			"MYR",
		);
		expect(r.total).toBeLessThanOrEqual(r.kedaipalMonthly);
		expect(r.disqualified).toBe(true);
		expect(r.disqualifyReason).toBe("below_price");
	});

	it("measures the threshold against the plan they'd be on, not a fixed Pro", () => {
		// No weekly orders → Starter (RM79). A leak of 1 × 19 × 4.33 = 82.27
		// clears it, 1 × 18 × 4.33 = 77.94 doesn't — the old flat Pro anchor
		// (RM149) disqualified both.
		const over = computeStatusQuoCost(
			{ ordersPerWeek: 0, aov: 19, missedPerWeek: 1, chaseMin: 0 },
			"MYR",
		);
		expect(over.kedaipalMonthly).toBe(PLAN_MONTHLY_PRICES.MYR.starter / 100);
		expect(over.disqualified).toBe(false);
		const under = computeStatusQuoCost(
			{ ordersPerWeek: 0, aov: 18, missedPerWeek: 1, chaseMin: 0 },
			"MYR",
		);
		expect(under.disqualifyReason).toBe("below_price");
	});
});

describe("slider bounds and defaults per currency", () => {
	it("shares every counting bound and differs only on the money one", () => {
		expect(BOUNDS_FOR.SGD.ordersPerWeek).toEqual(BOUNDS_FOR.MYR.ordersPerWeek);
		expect(BOUNDS_FOR.SGD.missedPerWeek).toEqual(BOUNDS_FOR.MYR.missedPerWeek);
		expect(BOUNDS_FOR.SGD.chaseMin).toEqual(BOUNDS_FOR.MYR.chaseMin);
		expect(BOUNDS_FOR.SGD.aov).not.toEqual(BOUNDS_FOR.MYR.aov);
	});

	it("keeps the MY slider byte-identical to pre-SG", () => {
		expect(BOUNDS_FOR.MYR.aov).toEqual({ min: 0, max: 500, step: 5 });
		expect(DEFAULT_INPUTS_FOR.MYR).toEqual({
			ordersPerWeek: 40,
			aov: 35,
			missedPerWeek: 4,
			chaseMin: 5,
		});
	});

	it("gives SG its own decided AOV shape", () => {
		expect(BOUNDS_FOR.SGD.aov).toEqual({ min: 0, max: 200, step: 2 });
		expect(DEFAULT_INPUTS_FOR.SGD.aov).toBe(15);
	});

	it("keeps every default inside its own bounds", () => {
		for (const currency of ["MYR", "SGD"] as const) {
			const bounds = BOUNDS_FOR[currency];
			const defaults = DEFAULT_INPUTS_FOR[currency];
			expect(clampInputs(defaults, bounds)).toEqual(defaults);
		}
	});
});

describe("costInputsSchema per currency", () => {
	it("accepts in-range inputs", () => {
		expect(() => COST_INPUTS_SCHEMA_FOR.MYR.parse(ICP)).not.toThrow();
	});

	it("rejects negative values", () => {
		expect(() =>
			COST_INPUTS_SCHEMA_FOR.MYR.parse({ ...ICP, missedPerWeek: -1 }),
		).toThrow();
		expect(() =>
			COST_INPUTS_SCHEMA_FOR.MYR.parse({ ...ICP, aov: -5 }),
		).toThrow();
	});

	it("rejects values beyond the slider bounds", () => {
		expect(() =>
			COST_INPUTS_SCHEMA_FOR.MYR.parse({ ...ICP, ordersPerWeek: 99999 }),
		).toThrow();
	});

	it("holds an AOV to its own currency's ceiling", () => {
		// RM 400 is a valid Malaysian basket and an impossible S$ slider position.
		expect(() =>
			COST_INPUTS_SCHEMA_FOR.MYR.parse({ ...ICP, aov: 400 }),
		).not.toThrow();
		expect(() =>
			COST_INPUTS_SCHEMA_FOR.SGD.parse({ ...ICP, aov: 400 }),
		).toThrow();
	});
});

describe("clampInputs", () => {
	it("fits an out-of-range basket into the new currency's slider", () => {
		const switched = clampInputs({ ...ICP, aov: 400 }, BOUNDS_FOR.SGD);
		expect(switched.aov).toBe(BOUNDS_FOR.SGD.aov.max);
		// Everything that isn't money is untouched by the switch.
		expect(switched.ordersPerWeek).toBe(ICP.ordersPerWeek);
		expect(switched.missedPerWeek).toBe(ICP.missedPerWeek);
		expect(switched.chaseMin).toBe(ICP.chaseMin);
	});

	it("leaves in-range inputs alone", () => {
		expect(clampInputs(ICP, BOUNDS_FOR.MYR)).toEqual(ICP);
	});
});

describe("clamp", () => {
	it("clamps into range and handles non-finite input", () => {
		expect(clamp(5, 0, 10)).toBe(5);
		expect(clamp(-3, 0, 10)).toBe(0);
		expect(clamp(50, 0, 10)).toBe(10);
		expect(clamp(Number.NaN, 0, 10)).toBe(0);
	});
});
