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
import { type BillingCycle, type Plan, planPrice } from "./lib/plans";
import { getPaymentProvider } from "./payments/provider";
import { claimRankIfEligible } from "./foundingMembers";
import { defaultCapsForPlan } from "./subscriptions";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Short, human-ish invoice number with a random suffix (collisions negligible at
 * manual-billing volume). */
function generateInvoiceNumber(now: number): string {
	const d = new Date(now);
	const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
	const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
	return `INV-${ym}-${rand}`;
}

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

/**
 * Admin: issue a pending invoice to a retailer. Covers BOTH operational gaps —
 * standard conversions/renewals AND onboarding a Founding-10 member (`founding:
 * true` → 30% Pro discount; rank claims when this invoice is marked paid). Amounts
 * are computed from the plan (single source of truth — Arif doesn't type them).
 * The subscription's plan/cycle are aligned so mark-paid reconciles the right caps.
 * Rejects Scale (the v1 defense-in-depth guard's home) and founding-non-Pro.
 */
export const issueInvoice = mutation({
	args: {
		retailerId: v.id("retailers"),
		plan: v.union(
			v.literal("starter"),
			v.literal("pro"),
			v.literal("scale"),
		),
		billingCycle: v.union(v.literal("monthly"), v.literal("annual")),
		founding: v.boolean(),
		dueDate: v.number(),
	},
	handler: async (
		ctx,
		{ retailerId, plan, billingCycle, founding, dueDate },
	): Promise<{ invoiceId: Id<"invoices"> }> => {
		await requireAdmin(ctx);
		if (plan === "scale")
			throw new ConvexError("Scale is unavailable for v1.");
		if (founding && plan !== "pro")
			throw new ConvexError("Only Pro qualifies for Founding Member.");

		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Retailer not found");
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new ConvexError("Retailer has no subscription");

		// Prevent accidental duplicate pendings — settle/void the existing one first.
		const existingPending = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.filter((q) => q.eq(q.field("status"), "pending"))
			.first();
		if (existingPending)
			throw new ConvexError(
				`This retailer already has a pending invoice (${existingPending.invoiceNumber}). Settle or void it first.`,
			);

		const cycle = billingCycle as BillingCycle;
		const base = planPrice(plan, cycle, false);
		const total = planPrice(plan, cycle, founding);
		const now = Date.now();

		// Align the subscription to what's being billed so mark-paid reconciles the
		// right caps. (Status stays as-is until paid → active.)
		await ctx.db.patch(sub._id, {
			plan,
			billingCycle,
			updatedAt: now,
		});

		const invoiceId = await ctx.db.insert("invoices", {
			retailerId,
			subscriptionId: sub._id,
			invoiceNumber: generateInvoiceNumber(now),
			amount: base,
			foundingDiscount: founding ? base - total : undefined,
			total,
			currency: "MYR",
			periodStart: now,
			periodEnd: nextPeriodEnd(billingCycle, now),
			dueDate,
			status: "pending",
			createdAt: now,
		});
		// Ping the seller out-of-app — they won't always be in the dashboard.
		// Fire-and-forget so a mail issue never fails the issue mutation.
		await ctx.scheduler.runAfter(0, internal.billingEmail.notifyInvoiceIssued, {
			invoiceId,
		});
		return { invoiceId };
	},
});

/**
 * Admin: void (soft-cancel) a pending invoice issued in error. We keep the row
 * for audit/history/reconciliation — status flips to "void" — rather than hard
 * deleting it. Only a **pending** invoice can be voided (a paid one would be a
 * refund/credit, a separate flow). Voiding frees the single-pending-invoice slot
 * so a corrected invoice can be issued; it does NOT touch subscription status
 * (an overdue-driven lock stays — settle a replacement to reactivate).
 */
export const voidInvoice = mutation({
	args: { invoiceId: v.id("invoices"), reason: v.optional(v.string()) },
	handler: async (ctx, { invoiceId, reason }): Promise<{ ok: true }> => {
		const adminSubject = await requireAdmin(ctx);
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) throw new ConvexError("Invoice not found");
		if (invoice.status !== "pending")
			throw new ConvexError(
				`Only a pending invoice can be voided (this one is ${invoice.status}).`,
			);
		await ctx.db.patch(invoiceId, {
			status: "void",
			voidedAt: Date.now(),
			voidedBy: adminSubject,
			voidReason: reason?.trim() ? reason.trim() : undefined,
		});
		return { ok: true };
	},
});

/** Admin: retailers for the issue-invoice picker (id + store name + slug +
 * status + founding flag). Capped — fine at Founding-10 scale. */
export const listRetailersForAdmin = query({
	args: {},
	handler: async (
		ctx,
	): Promise<
		Array<{
			_id: Id<"retailers">;
			storeName: string;
			slug: string;
			status?: Doc<"subscriptions">["status"];
			isFoundingMember: boolean;
			hasPending: boolean;
		}>
	> => {
		await requireAdmin(ctx);
		const retailers = await ctx.db.query("retailers").order("desc").take(200);
		const rows = [];
		for (const r of retailers) {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
				.first();
			const pending = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
				.filter((q) => q.eq(q.field("status"), "pending"))
				.first();
			rows.push({
				_id: r._id,
				storeName: r.storeName,
				slug: r.slug,
				status: sub?.status,
				isFoundingMember: r.isFoundingMember === true,
				hasPending: pending !== null,
			});
		}
		return rows;
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

/** The caller's soonest-due **pending** invoice (or null). Powers the dashboard
 * "invoice due soon" warning banner — kept tiny so it's cheap to poll alongside
 * the shell. */
export const myNextDueInvoice = query({
	args: {},
	handler: async (
		ctx,
	): Promise<{ dueDate: number; total: number; currency: string } | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return null;
		const pending = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.filter((q) => q.eq(q.field("status"), "pending"))
			.collect();
		if (pending.length === 0) return null;
		const soonest = pending.reduce((a, b) => (b.dueDate < a.dueDate ? b : a));
		return {
			dueDate: soonest.dueDate,
			total: soonest.total,
			currency: soonest.currency,
		};
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
