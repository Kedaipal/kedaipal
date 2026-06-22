import { describe, expect, it } from "vitest";
import {
	type CostInputs,
	clamp,
	computeStatusQuoCost,
	costInputsSchema,
	DEFAULT_CHASE_MIN,
	FOUNDING_PRICE_RM,
	LABOR_RATE_RM_PER_HR,
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
		const r = computeStatusQuoCost(ICP);
		// A = M × AOV × 4.33 = 4 × 35 × 4.33
		expect(r.missedRevenue).toBeCloseTo(4 * 35 * WEEKS_PER_MONTH, 6);
		// B = (W × min / 60) × 4.33 × 25 = (40 × 5 / 60) × 4.33 × 25
		expect(r.chaseCost).toBeCloseTo(
			((40 * 5) / 60) * WEEKS_PER_MONTH * LABOR_RATE_RM_PER_HR,
			6,
		);
		expect(r.total).toBeCloseTo(r.missedRevenue + r.chaseCost, 6);
	});

	it("derives savings and ratio from the total vs the Founding price", () => {
		const r = computeStatusQuoCost(ICP);
		expect(r.savings).toBeCloseTo(r.total - FOUNDING_PRICE_RM, 6);
		expect(r.ratio).toBeCloseTo(r.total / FOUNDING_PRICE_RM, 6);
	});

	it("yields positive savings and is not disqualified for an ICP seller", () => {
		const r = computeStatusQuoCost(ICP);
		expect(r.total).toBeGreaterThan(FOUNDING_PRICE_RM);
		expect(r.savings).toBeGreaterThan(0);
		expect(r.disqualified).toBe(false);
		expect(r.disqualifyReason).toBeNull();
	});

	it("defaults chase minutes via DEFAULT_CHASE_MIN constant", () => {
		expect(DEFAULT_CHASE_MIN).toBe(5);
	});
});

describe("computeStatusQuoCost — honest disqualification", () => {
	it("flags no_missed when missed orders is zero (priority over below_price)", () => {
		const r = computeStatusQuoCost({ ...ICP, missedPerWeek: 0 });
		expect(r.missedRevenue).toBe(0);
		expect(r.disqualified).toBe(true);
		expect(r.disqualifyReason).toBe("no_missed");
	});

	it("flags below_price when total status-quo cost is at or under the price", () => {
		// Tiny seller: 1 missed order/wk at RM5, almost no chasing.
		const r = computeStatusQuoCost({
			ordersPerWeek: 2,
			aov: 5,
			missedPerWeek: 1,
			chaseMin: 1,
		});
		expect(r.total).toBeLessThanOrEqual(FOUNDING_PRICE_RM);
		expect(r.disqualified).toBe(true);
		expect(r.disqualifyReason).toBe("below_price");
	});

	it("does not disqualify exactly above the price threshold", () => {
		// missedRevenue alone = 1 × 30 × 4.33 = 129.9 > 104, no chasing.
		const r = computeStatusQuoCost({
			ordersPerWeek: 0,
			aov: 30,
			missedPerWeek: 1,
			chaseMin: 0,
		});
		expect(r.total).toBeGreaterThan(FOUNDING_PRICE_RM);
		expect(r.disqualified).toBe(false);
	});
});

describe("costInputsSchema", () => {
	it("accepts in-range inputs", () => {
		expect(() => costInputsSchema.parse(ICP)).not.toThrow();
	});

	it("rejects negative values", () => {
		expect(() =>
			costInputsSchema.parse({ ...ICP, missedPerWeek: -1 }),
		).toThrow();
		expect(() => costInputsSchema.parse({ ...ICP, aov: -5 })).toThrow();
	});

	it("rejects values beyond the slider bounds", () => {
		expect(() =>
			costInputsSchema.parse({ ...ICP, ordersPerWeek: 99999 }),
		).toThrow();
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
