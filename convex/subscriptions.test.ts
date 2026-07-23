/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { resolveAccess } from "./subscriptions";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER_A = "user_sub_a";

/** Build a subscriptions doc for the pure resolveAccess tests. */
function sub(partial: Partial<Doc<"subscriptions">>): Doc<"subscriptions"> {
	return {
		_id: "s1" as Doc<"subscriptions">["_id"],
		_creationTime: 0,
		retailerId: "r1" as Doc<"subscriptions">["retailerId"],
		plan: "pro",
		billingCycle: "monthly",
		status: "active",
		orderCap: 500,
		userCap: 2,
		broadcastQuota: 100,
		createdAt: 0,
		updatedAt: 0,
		...partial,
	};
}

describe("resolveAccess (pure)", () => {
	test("missing subscription → comped full access (fail safe)", () => {
		const a = resolveAccess(null);
		expect(a.comped).toBe(true);
		expect(a.frozen).toBe(false);
		expect(a.active).toBe(true);
		expect(a.plan).toBe("pro");
	});

	test("trialing → full access, not frozen", () => {
		const a = resolveAccess(sub({ status: "trialing", trialEndsAt: 999 }));
		expect(a.status).toBe("trialing");
		expect(a.frozen).toBe(false);
		expect(a.trialEndsAt).toBe(999);
	});

	test("past_due (not comped) → frozen", () => {
		const a = resolveAccess(sub({ status: "past_due" }));
		expect(a.frozen).toBe(true);
		expect(a.active).toBe(false);
	});

	test("past_due but comped → NOT frozen (pilot/backfill)", () => {
		const a = resolveAccess(sub({ status: "past_due", comped: true }));
		expect(a.frozen).toBe(false);
		expect(a.comped).toBe(true);
	});

	test("carries denormalized caps", () => {
		const a = resolveAccess(sub({ orderCap: 100, userCap: 1, broadcastQuota: 0 }));
		expect(a.caps).toEqual({ orderCap: 100, userCap: 1, broadcastQuota: 0 });
	});

	test("resolves plan features — Starter locked out of the Pro set", () => {
		expect(resolveAccess(sub({ plan: "starter" })).features).toEqual({
			crm: false,
			orderInbox: false,
			chargeablePickup: false,
			categories: false,
			insights: false,
			radiusDelivery: false,
			delivery: false,
		});
		expect(resolveAccess(sub({ plan: "pro" })).features).toEqual({
			crm: true,
			orderInbox: true,
			chargeablePickup: true,
			categories: true,
			insights: true,
			radiusDelivery: true,
			delivery: true,
		});
		// Fail safe: a missing row gets Pro features, never a lockout.
		expect(resolveAccess(null).features).toEqual({
			crm: true,
			orderInbox: true,
			chargeablePickup: true,
			categories: true,
			insights: true,
			radiusDelivery: true,
			delivery: true,
		});
	});

	test("adminFullAccess overrides a Starter store to the highest tier", () => {
		// An admin on their OWN store gets every feature unlocked + never frozen,
		// while the real plan/status stay intact so billing still tells the truth.
		const a = resolveAccess(sub({ plan: "starter", status: "past_due" }), {
			adminFullAccess: true,
		});
		expect(a.features).toEqual({
			crm: true,
			orderInbox: true,
			chargeablePickup: true,
			categories: true,
			insights: true,
			radiusDelivery: true,
		delivery: true,
		});
		expect(a.active).toBe(true);
		expect(a.frozen).toBe(false);
		// The underlying subscription truth is preserved (for the billing page).
		expect(a.plan).toBe("starter");
		expect(a.status).toBe("past_due");
	});

	test("adminFullAccess=false leaves a Starter store gated (default path)", () => {
		const a = resolveAccess(sub({ plan: "starter" }), {
			adminFullAccess: false,
		});
		expect(a.features.crm).toBe(false);
	});
});

describe("subscriptions — signup wiring", () => {
	test("public signup creates a trialing Pro subscription (14d)", async () => {
		const t = setup();
		const asA = t.withIdentity({ subject: USER_A });
		const before = Date.now();
		await asA.mutation(api.retailers.createRetailer, {
			storeName: "Public Store",
			slug: "public-store",
		});

		const access = await asA.query(api.subscriptions.current, {});
		expect(access?.status).toBe("trialing");
		expect(access?.plan).toBe("pro");
		expect(access?.frozen).toBe(false);
		expect(access?.caps).toEqual({ orderCap: 500, userCap: 2, broadcastQuota: 100 });
		// ~14 days out.
		const days = ((access?.trialEndsAt ?? 0) - before) / (24 * 60 * 60 * 1000);
		expect(days).toBeGreaterThan(13.9);
		expect(days).toBeLessThan(14.1);

		// getMyRetailer carries the same summary for the nav pill.
		const retailer = await asA.query(api.retailers.getMyRetailer, {});
		expect(retailer?.subscription?.status).toBe("trialing");
		expect(retailer?.isFoundingMember).toBeUndefined();
	});

	test("founding signup → trialing (paid Pro only at mark-paid), foundingIntent flagged, NO invoice yet", async () => {
		const t = setup();
		const before = Date.now();
		const asA = t.withIdentity({ subject: "user_founding" });
		await asA.mutation(api.retailers.createRetailer, {
			storeName: "Founding Store",
			slug: "founding-store",
			intent: "founding",
		});

		// Same 14-day trial as everyone else — the PAID Pro plan only starts when Arif
		// marks the founding invoice paid. We must not pre-activate Pro at onboard.
		const access = await asA.query(api.subscriptions.current, {});
		expect(access?.status).toBe("trialing");
		expect(access?.frozen).toBe(false);

		const { sub, invoiceCount } = await t.run(async (ctx) => {
			const retailer = await ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "founding-store"))
				.first();
			if (!retailer) throw new Error("no retailer");
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.first();
			const invoices = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.collect();
			return { sub, invoiceCount: invoices.length };
		});
		// 14-day trial window; flagged for the founding discount on the invoice Arif issues.
		const trialDays = ((sub?.trialEndsAt ?? 0) - before) / (24 * 60 * 60 * 1000);
		expect(trialDays).toBeGreaterThan(13.9);
		expect(trialDays).toBeLessThan(14.1);
		expect(sub?.foundingIntent).toBe(true);
		// No auto-invoice — Arif issues it (monthly or annual).
		expect(invoiceCount).toBe(0);

		// The slot is RESERVED at onboard (not at payment): rank assigned, badge set,
		// and the public counter ticks down — so Arif can't over-commit past 10.
		const retailer = await t.run((ctx) =>
			ctx.db
				.query("retailers")
				.withIndex("by_slug", (q) => q.eq("slug", "founding-store"))
				.first(),
		);
		expect(retailer?.isFoundingMember).toBe(true);
		expect(retailer?.foundingMemberRank).toBe(1);
		expect(await asA.query(api.foundingMembers.getSpotsRemaining, {})).toBe(9);
	});
});
