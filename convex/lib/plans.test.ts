import { describe, expect, test } from "vitest";
import {
	ANNUAL_MONTHS_CHARGED,
	capsForPlan,
	featuresForPlan,
	FOUNDING_MONTHLY_PRICE,
	isPlanSelectable,
	isUnlimited,
	PLAN_MONTHLY_PRICE,
	PLANS,
	planPrice,
	planQualifiesForFounding,
	UNLIMITED,
} from "./plans";

describe("plans — feature entitlements", () => {
	// Mirrors the pricing table's LIVE ✓/– rows: CRM, Order Inbox, chargeable
	// pickup and Insights are Pro+.
	test("Starter has no Pro features", () => {
		expect(featuresForPlan("starter")).toEqual({
			crm: false,
			orderInbox: false,
			chargeablePickup: false,
			insights: false,
		});
	});

	test("Pro and Scale have all", () => {
		expect(featuresForPlan("pro")).toEqual({
			crm: true,
			orderInbox: true,
			chargeablePickup: true,
			insights: true,
		});
		expect(featuresForPlan("scale")).toEqual({
			crm: true,
			orderInbox: true,
			chargeablePickup: true,
			insights: true,
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
		expect(capsForPlan("pro")).toEqual({
			orderCap: 500,
			userCap: 2,
			broadcastQuota: 100,
		});
		// Scale's "unlimited" was dropped for finite soft caps (Arif 2026-06-28):
		// orders 2,000/mo (~4× Pro), broadcasts 500/mo (~5× Pro). All finite now.
		expect(capsForPlan("scale")).toEqual({
			orderCap: 2000,
			userCap: 5,
			broadcastQuota: 500,
		});
	});

	// The UNLIMITED/isUnlimited sentinel is retained for a future Enterprise tier
	// even though no v1 plan uses it.
	test("isUnlimited recognises the unlimited sentinel", () => {
		expect(isUnlimited(UNLIMITED)).toBe(true);
		expect(isUnlimited(2000)).toBe(false);
		expect(isUnlimited(500)).toBe(false);
	});
});
