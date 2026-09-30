// Kedaipal Enterprise — the admin levers (Credits T6, ClickUp z8r3fdkp8h,
// docs/pricing.md#enterprise). A store is on Enterprise ONLY while it carries a
// contract, and only a Kedaipal admin can attach one: there is no public price
// and no self-serve door. Setting the contract flips the plan and writes its
// included credits through to the credit ledger's grant override in the same
// mutation; the way off a contract is a scheduled move to Pro, which clears the
// contract when that first Pro bill settles (`settleInvoicePaid`). Every lever
// is admin-only and audited.

import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { ADMIN_CREDIT_LIMIT, writeGrantOverride } from "./credits";
import { logAdminAction, requireAdmin } from "./lib/auth";
import { enterpriseContractProblem } from "./lib/enterprise";
import { capsForPlan, renewalCurrency } from "./lib/plans";

export const setContract = mutation({
	args: {
		retailerId: v.id("retailers"),
		baseFeeMinor: v.number(),
		includedCredits: v.number(),
		overageRateMinor: v.number(),
		blockSize: v.number(),
		billingCycle: v.union(v.literal("monthly"), v.literal("annual")),
		contactName: v.string(),
		notes: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<{ created: boolean }> => {
		const adminSubject = await requireAdmin(ctx);
		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", args.retailerId))
			.first();
		if (!sub) throw new ConvexError("This store has no subscription yet.");
		if (sub.comped === true)
			throw new ConvexError(
				"This store is comped — end the comp before putting it on a contract.",
			);
		if (retailer.isFoundingMember === true || sub.foundingIntent === true)
			throw new ConvexError(
				"Founding Members stay on Founding Pro — a founding store can't be put on an Enterprise contract.",
			);
		if (sub.status === "on_hold")
			throw new ConvexError(
				"This store is on Off-Season Hold — resume it before putting it on a contract.",
			);
		const problem = enterpriseContractProblem(
			{
				baseFeeMinor: args.baseFeeMinor,
				includedCredits: args.includedCredits,
				overageRateMinor: args.overageRateMinor,
				blockSize: args.blockSize,
				billingCycle: args.billingCycle,
				contactName: args.contactName,
				notes: args.notes,
			},
			// The ledger's own grant ceiling — the contract can never hold an
			// included-credits number the grant lever would refuse.
			ADMIN_CREDIT_LIMIT,
		);
		if (problem) throw new ConvexError(problem);

		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", args.retailerId))
			.order("desc")
			.collect();
		// An open bill at another tier would still bill that tier — settle or
		// void it first, so what the store owes always matches its contract.
		const pending = invoices.find((inv) => inv.status === "pending");
		if (pending && pending.plan !== "enterprise")
			throw new ConvexError(
				`Settle or void ${pending.invoiceNumber} first — it bills the store's old plan, not the contract.`,
			);

		const entering = sub.plan !== "enterprise" || sub.enterprise === undefined;
		const now = Date.now();
		// The contract's currency is agreed once and frozen — an SG deal stays
		// SGD, never converted. A new contract takes the store's billing
		// currency (its last paid invoice's, else its country's).
		const currency =
			sub.enterprise?.currency ??
			renewalCurrency({
				lastPaidCurrency: invoices.find((inv) => inv.status === "paid")
					?.currency,
				country: retailer.country,
			});
		const notes = args.notes?.trim();
		const caps = capsForPlan("enterprise");
		// No `updatedAt`: on a past_due row that field is the lock-flip moment
		// the founder report reads, and a contract edit must never move it.
		await ctx.db.patch(sub._id, {
			plan: "enterprise",
			billingCycle: args.billingCycle,
			enterprise: {
				baseFeeMinor: args.baseFeeMinor,
				currency,
				includedCredits: args.includedCredits,
				overageRateMinor: args.overageRateMinor,
				blockSize: args.blockSize,
				contactName: args.contactName.trim(),
				...(notes ? { notes } : {}),
				setBy: adminSubject,
				setAt: now,
			},
			// Entering: Enterprise's caps (unlimited seats), and any downgrade
			// the store had scheduled is superseded — a renewal must bill the
			// contract, not a stale Starter. Editing a live contract leaves a
			// scheduled move to Pro alone (cancel it explicitly).
			...(entering
				? {
						orderCap: caps.orderCap,
						userCap: caps.userCap,
						broadcastQuota: caps.broadcastQuota,
						pendingPlanChange: undefined,
					}
				: {}),
		});
		// The contract's included credits ARE the store's grant — one field.
		await writeGrantOverride(
			ctx,
			args.retailerId,
			args.includedCredits,
			adminSubject,
			now,
		);
		await logAdminAction(
			ctx,
			{ retailer, role: "admin", actingAsAdmin: true, userId: adminSubject },
			"enterprise.setContract",
			args.retailerId,
		);
		return { created: entering };
	},
});

/**
 * The way off a contract: schedule a move to Pro for the end of the period
 * already paid for. The renewal then bills Pro, and when that bill settles the
 * contract and its grant override are cleared together — the included credits
 * already granted this month stay; next month is Pro's allowance. Clearing a
 * contract outright is never offered: an Enterprise store must always have one.
 */
export const scheduleMoveToPro = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<{ effectiveAt: number }> => {
		const adminSubject = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (sub?.plan !== "enterprise")
			throw new ConvexError("This store isn't on an Enterprise contract.");
		const now = Date.now();
		await ctx.db.patch(sub._id, {
			pendingPlanChange: { plan: "pro", requestedAt: now },
		});
		await logAdminAction(
			ctx,
			{ retailer, role: "admin", actingAsAdmin: true, userId: adminSubject },
			"enterprise.scheduleMoveToPro",
			retailerId,
		);
		return { effectiveAt: sub.currentPeriodEnd ?? now };
	},
});

/** Call off a scheduled move to Pro — the contract simply carries on. */
export const cancelMoveToPro = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<{ ok: true }> => {
		const adminSubject = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (sub?.plan === "enterprise" && sub.pendingPlanChange !== undefined) {
			await ctx.db.patch(sub._id, { pendingPlanChange: undefined });
			await logAdminAction(
				ctx,
				{ retailer, role: "admin", actingAsAdmin: true, userId: adminSubject },
				"enterprise.cancelMoveToPro",
				retailerId,
			);
		}
		return { ok: true };
	},
});
