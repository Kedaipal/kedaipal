import { describe, expect, test } from "vitest";
import {
	ANNUAL_MONTHS_CHARGED,
	capsForPlan,
	FOUNDING_MONTHLY_PRICE,
	isPlanSelectable,
	isUnlimited,
	PLAN_MONTHLY_PRICE,
	planPrice,
	planQualifiesForFounding,
	UNLIMITED,
} from "./plans";

describe("plans — pricing", () => {
	test("monthly price is the table price", () => {
		expect(planPrice("starter", "monthly")).toBe(7900);
		expect(planPrice("pro", "monthly")).toBe(14900);
		expect(planPrice("scale", "monthly")).toBe(29900);
	});

	test("annual = monthly × 10 (10 months paid, 12 received)", () => {
		expect(ANNUAL_MONTHS_CHARGED).toBe(10);
		expect(planPrice("pro", "annual")).toBe(14900 * 10);
	});

	test("founding applies the discounted monthly to pro/scale only", () => {
		expect(planPrice("pro", "monthly", true)).toBe(FOUNDING_MONTHLY_PRICE.pro);
		expect(planPrice("pro", "monthly", true)).toBe(10400);
		// Starter has no founding price → falls back to its standard price.
		expect(planPrice("starter", "monthly", true)).toBe(PLAN_MONTHLY_PRICE.starter);
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

	test("capsForPlan denormalizes unlimited to a finite sentinel", () => {
		expect(capsForPlan("starter")).toEqual({
			orderCap: 100,
			userCap: 1,
			broadcastQuota: 0,
		});
		expect(capsForPlan("pro")).toEqual({
			orderCap: 500,
			userCap: 2,
			broadcastQuota: 100,
		});
		const scale = capsForPlan("scale");
		expect(scale.userCap).toBe(5);
		expect(isUnlimited(scale.orderCap)).toBe(true);
		expect(isUnlimited(scale.broadcastQuota)).toBe(true);
		expect(scale.orderCap).toBe(UNLIMITED);
	});
});
