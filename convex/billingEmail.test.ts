/// <reference types="vite/client" />
// The invoice emails' data loader (convex/billingEmail.ts) — Kedaipal Credits
// T5: every plan invoice email names what the billed plan gives THIS store a
// month, through `monthlyCreditGrant`, the one author of grant precedence.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	FOUNDING_PRO_CREDIT_GRANT,
	PLAN_CREDIT_GRANT,
} from "./lib/plans";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const DAY = 24 * 60 * 60 * 1000;

async function seed(t: ReturnType<typeof setup>, userId: string) {
	const slug = `bem-${userId.replace(/[^a-z0-9]/g, "")}`;
	await t
		.withIdentity({ subject: userId })
		.mutation(api.retailers.createRetailer, { storeName: `Store ${slug}`, slug });
	return t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		const sub = r
			? await ctx.db
					.query("subscriptions")
					.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
					.first()
			: null;
		if (!r || !sub) throw new Error("seed failed");
		return { retailerId: r._id, subId: sub._id };
	});
}

async function invoice(
	t: ReturnType<typeof setup>,
	ids: { retailerId: Id<"retailers">; subId: Id<"subscriptions"> },
	fields: Partial<Doc<"invoices">>,
) {
	return t.run((ctx) => {
		const now = Date.now();
		return ctx.db.insert("invoices", {
			retailerId: ids.retailerId,
			subscriptionId: ids.subId,
			invoiceNumber: `INV-BEM-${now}-${Math.random()}`,
			plan: "pro",
			billingCycle: "monthly",
			amount: 14900,
			total: 14900,
			currency: "MYR",
			periodStart: now,
			periodEnd: now + 30 * DAY,
			dueDate: now + 14 * DAY,
			status: "pending",
			createdAt: now,
			...fields,
		});
	});
}

const meta = (t: ReturnType<typeof setup>, invoiceId: Id<"invoices">) =>
	t.query(internal.billingEmail.getInvoiceForEmail, { invoiceId });

describe("getInvoiceForEmail — the credits the billed plan includes", () => {
	test("each tier's invoice carries that tier's monthly credits", async () => {
		const t = setup();
		const ids = await seed(t, "user_bem_tiers");
		for (const plan of ["starter", "pro", "scale"] as const) {
			const id = await invoice(t, ids, { plan });
			expect((await meta(t, id))?.includedCredits, plan).toBe(
				PLAN_CREDIT_GRANT[plan],
			);
		}
	});

	test("a founding-priced Pro invoice is Founding Pro's grant — the member's own email", async () => {
		const t = setup();
		const ids = await seed(t, "user_bem_founding");
		const id = await invoice(t, ids, {
			plan: "pro",
			foundingDiscount: 4500,
			total: 10400,
		});
		expect((await meta(t, id))?.includedCredits).toBe(FOUNDING_PRO_CREDIT_GRANT);
	});

	test("an admin's custom grant beats the tier", async () => {
		const t = setup();
		const ids = await seed(t, "user_bem_custom");
		await t.run(async (ctx) => {
			const account = await ctx.db
				.query("creditAccounts")
				.withIndex("by_retailer", (q) => q.eq("retailerId", ids.retailerId))
				.first();
			if (!account) throw new Error("no credit account");
			await ctx.db.patch(account._id, { grantOverride: 1000 });
		});
		const id = await invoice(t, ids, { plan: "pro" });
		expect((await meta(t, id))?.includedCredits).toBe(1000);
	});

	test("a hold invoice grants nothing, so it names no credits", async () => {
		const t = setup();
		const ids = await seed(t, "user_bem_hold");
		const id = await invoice(t, ids, { kind: "hold", amount: 1900, total: 1900 });
		expect((await meta(t, id))?.includedCredits).toBeUndefined();
	});
});
