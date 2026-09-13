import { describe, expect, it } from "vitest";
import { PLAN_MONTHLY_PRICES } from "../../convex/lib/plans";
import {
	BOUNDS_FOR,
	COST_INPUTS_SCHEMA_FOR,
	type CostInputs,
	clamp,
	clampInputs,
	computeStatusQuoCost,
	DEFAULT_CHASE_MIN,
	DEFAULT_INPUTS_FOR,
	LABOR_RATE_PER_HR,
	PRO_PRICE,
	WEEKS_PER_MONTH,
} from "./calculator";

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

	it("derives savings and ratio from the total vs the Pro price", () => {
		const r = computeStatusQuoCost(ICP, "MYR");
		expect(r.savings).toBeCloseTo(r.total - PRO_PRICE.MYR, 6);
		expect(r.ratio).toBeCloseTo(r.total / PRO_PRICE.MYR, 6);
	});

	it("yields positive savings and is not disqualified for an ICP seller", () => {
		const r = computeStatusQuoCost(ICP, "MYR");
		expect(r.total).toBeGreaterThan(PRO_PRICE.MYR);
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

	it("anchors savings against the SGD Pro price", () => {
		const r = computeStatusQuoCost(SG_ICP, "SGD");
		expect(r.savings).toBeCloseTo(r.total - PRO_PRICE.SGD, 6);
		expect(r.ratio).toBeCloseTo(r.total / PRO_PRICE.SGD, 6);
	});

	it("never mixes currencies — the same inputs cost differently in each", () => {
		const my = computeStatusQuoCost(ICP, "MYR");
		const sg = computeStatusQuoCost(ICP, "SGD");
		expect(sg.chaseCost).not.toBeCloseTo(my.chaseCost, 6);
		expect(sg.savings).not.toBeCloseTo(my.savings, 6);
	});
});

describe("PRO_PRICE", () => {
	/**
	 * Guards the duplicate this file used to carry (a literal price). The
	 * calculator's anchor and the price the pricing page advertises are the
	 * same number by construction now, and this fails if someone reintroduces
	 * a local copy. Founding pricing retired 30 Aug 2026 — the anchor is the
	 * Pro LIST price, not a founding discount.
	 */
	it("is the Pro list price from the billing tables, in major units", () => {
		expect(PRO_PRICE.MYR).toBe(PLAN_MONTHLY_PRICES.MYR.pro / 100);
		expect(PRO_PRICE.SGD).toBe(PLAN_MONTHLY_PRICES.SGD.pro / 100);
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
		expect(r.total).toBeLessThanOrEqual(PRO_PRICE.MYR);
		expect(r.disqualified).toBe(true);
		expect(r.disqualifyReason).toBe("below_price");
	});

	it("does not disqualify exactly above the price threshold", () => {
		// missedRevenue alone = 1 × 40 × 4.33 = 173.2 > 149, no chasing.
		const r = computeStatusQuoCost(
			{ ordersPerWeek: 0, aov: 40, missedPerWeek: 1, chaseMin: 0 },
			"MYR",
		);
		expect(r.total).toBeGreaterThan(PRO_PRICE.MYR);
		expect(r.disqualified).toBe(false);
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
