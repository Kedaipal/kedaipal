// Invoice reads + the admin mark-paid flow. `markPaid` is the heart of manual
// billing: ONE transaction flips the invoice → reconciles the subscription →
// refreshes denormalized caps → claims the Founding rank → schedules the welcome
// WhatsApp. When automated billing lands, the webhook handler reuses this same
// settle path (the PaymentProvider seam). See docs/manual-subscription.md.

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { type Plan } from "./lib/plans";
import { getPaymentProvider } from "./payments/provider";
import { claimRankIfEligible } from "./foundingMembers";
import { defaultCapsForPlan } from "./subscriptions";

const DAY_MS = 24 * 60 * 60 * 1000;

function nextPeriodEnd(
	cycle: Doc<"subscriptions">["billingCycle"],
	from: number,
): number {
	return from + (cycle === "annual" ? 365 : 30) * DAY_MS;
}

/**
 * Admin: mark a pending invoice paid. Atomic — invoice → paid, subscription →
 * active (period + caps refreshed), Founding rank claimed (Pro, non-comped, first
 * paid, cohort not full), welcome WhatsApp scheduled. Throws + rolls back on any
 * invalid input, so there's never a partial entitlement update or partial claim.
 */
export const markPaid = mutation({
	args: {
		invoiceId: v.id("invoices"),
		// Freeform v1: "duitnow", "bank_transfer", etc. Defaults to "manual".
		paymentMethod: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ invoiceId, paymentMethod },
	): Promise<{ rank: number | null }> => {
		const adminSubject = await requireAdmin(ctx);

		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) throw new ConvexError("Invoice not found");
		if (invoice.status !== "pending")
			throw new ConvexError(`Invoice is already ${invoice.status}`);

		const sub = await ctx.db.get(invoice.subscriptionId);
		if (!sub) throw new ConvexError("Subscription not found for invoice");

		const now = Date.now();
		// Normalize the payment fact through the provider seam (pure; we own the txn).
		const record = getPaymentProvider().recordPayment({
			method: paymentMethod,
			recordedBy: adminSubject,
			paidAt: now,
		});

		// 1) Flip the invoice.
		await ctx.db.patch(invoiceId, {
			status: "paid",
			markedPaidAt: record.paidAt,
			markedPaidBy: record.recordedBy,
			paymentMethod: record.method,
		});

		// 2) Reconcile the subscription: active + fresh period + caps re-denormalized
		//    from the plan (never read `plan` downstream — caps are the seam).
		const caps = defaultCapsForPlan(sub.plan as Plan);
		await ctx.db.patch(sub._id, {
			status: "active",
			currentPeriodStart: now,
			currentPeriodEnd: nextPeriodEnd(sub.billingCycle, now),
			orderCap: caps.orderCap,
			userCap: caps.userCap,
			broadcastQuota: caps.broadcastQuota,
			updatedAt: now,
		});

		// 3) Founding rank claim — skipped for comped (pilot/backfill) retailers.
		let rank: number | null = null;
		if (sub.comped !== true) {
			rank = await claimRankIfEligible(ctx, {
				retailerId: invoice.retailerId,
				firstInvoiceId: invoiceId,
				plan: sub.plan,
				paidAt: now,
			});
		}

		// 4) Welcome flow — fire-and-forget so the mutation stays a pure transaction.
		if (rank !== null) {
			await ctx.scheduler.runAfter(0, internal.whatsapp.notifyFoundingWelcome, {
				retailerId: invoice.retailerId,
				rank,
			});
		}

		return { rank };
	},
});

/** Admin: list pending invoices (newest first) with retailer name/slug for the
 * mark-paid UI. */
export const listPending = query({
	args: {},
	handler: async (
		ctx,
	): Promise<
		Array<{
			_id: Id<"invoices">;
			invoiceNumber: string;
			retailerId: Id<"retailers">;
			storeName: string;
			slug: string;
			total: number;
			currency: string;
			dueDate: number;
			createdAt: number;
			plan: Plan;
		}>
	> => {
		await requireAdmin(ctx);
		const pending = await ctx.db
			.query("invoices")
			.withIndex("by_status", (q) => q.eq("status", "pending"))
			.order("desc")
			.collect();
		const rows = [];
		for (const inv of pending) {
			const retailer = await ctx.db.get(inv.retailerId);
			const sub = await ctx.db.get(inv.subscriptionId);
			if (!retailer) continue;
			rows.push({
				_id: inv._id,
				invoiceNumber: inv.invoiceNumber,
				retailerId: inv.retailerId,
				storeName: retailer.storeName,
				slug: retailer.slug,
				total: inv.total,
				currency: inv.currency,
				dueDate: inv.dueDate,
				createdAt: inv.createdAt,
				plan: (sub?.plan ?? "pro") as Plan,
			});
		}
		return rows;
	},
});

/** The caller's own invoices (billing page). Newest first. */
export const myInvoices = query({
	args: {},
	handler: async (ctx): Promise<Doc<"invoices">[]> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return [];
		return ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.order("desc")
			.collect();
	},
});
