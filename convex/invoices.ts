// Invoice reads + the admin mark-paid flow. `markPaid` is the heart of manual
// billing: ONE transaction flips the invoice → reconciles the subscription →
// refreshes denormalized caps → claims the Founding rank → schedules the welcome
// WhatsApp. When automated billing lands, the webhook handler reuses this same
// settle path (the PaymentProvider seam). See docs/manual-subscription.md.

import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { isAdmin, requireAdmin } from "./lib/auth";
import {
	invoiceToSubscriptionData,
	type SubscriptionInvoiceData,
} from "./lib/pdf/document";
import { buildSubscriptionInvoicePdf } from "./lib/pdf/render";
import { type BillingCycle, type Plan, planPrice } from "./lib/plans";
import { getPaymentProvider } from "./payments/provider";
import { reserveFoundingRank, stampFoundingPaid } from "./foundingMembers";
import { defaultCapsForPlan } from "./subscriptions";

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_GRACE_DAYS = 14; // pay-by window when the admin doesn't override it

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

		// First-ever payment? (drives welcome vs thanks email below). Counted before
		// we flip this invoice, so it reflects PRIOR paid invoices.
		const priorPaid = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", invoice.retailerId))
			.filter((q) => q.eq(q.field("status"), "paid"))
			.first();
		const firstTime = priorPaid === null;

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

		// 2) Reconcile the subscription FROM THE INVOICE (plan/cycle live on the
		//    invoice, not the sub — so issuing never changes the seller's visible tier
		//    before they pay). Falls back to the sub for pre-existing invoices.
		const billedPlan = (invoice.plan ?? sub.plan) as Plan;
		const billedCycle = invoice.billingCycle ?? sub.billingCycle;
		const caps = defaultCapsForPlan(billedPlan);
		await ctx.db.patch(sub._id, {
			plan: billedPlan,
			billingCycle: billedCycle,
			status: "active",
			currentPeriodStart: now,
			currentPeriodEnd: nextPeriodEnd(billedCycle, now),
			orderCap: caps.orderCap,
			userCap: caps.userCap,
			broadcastQuota: caps.broadcastQuota,
			updatedAt: now,
		});

		// 3) Founding — the slot is reserved at onboard (signup). For the
		//    "promote a standard vendor" path (a founding invoice for someone not yet
		//    reserved), reserve it now + welcome them. A plain (non-founding) invoice
		//    never claims. Either way, stamp the payment onto the founding row. We
		//    return the rank ONLY for a fresh reservation, so the admin "claimed" toast
		//    fires once (onboard members were already claimed + welcomed at signup).
		let rank: number | null = null;
		if (sub.comped !== true) {
			if (invoice.foundingDiscount !== undefined) {
				const reserved = await reserveFoundingRank(ctx, invoice.retailerId);
				if (reserved !== null) {
					rank = reserved;
					await ctx.scheduler.runAfter(
						0,
						internal.whatsapp.notifyFoundingWelcome,
						{ retailerId: invoice.retailerId, rank: reserved },
					);
				}
			}
			await stampFoundingPaid(ctx, invoice.retailerId, invoiceId, now);
		}

		// 4) Welcome (first payment) / thanks (renewal) email — fire-and-forget.
		await ctx.scheduler.runAfter(
			0,
			internal.billingEmail.notifyPaymentReceived,
			{ invoiceId, firstTime },
		);

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
		// Optional override; normally the system sets it (issue date + grace) so the
		// admin doesn't pick a date. The actual paid CYCLE starts at mark-paid.
		dueDate: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{ retailerId, plan, billingCycle, founding, dueDate: dueDateArg },
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
		// System-set pay-by deadline (issue date + grace). The subscription's billing
		// cycle is set later at mark-paid, so Pro only starts once payment lands.
		const dueDate = dueDateArg ?? now + DUE_GRACE_DAYS * DAY_MS;

		// The billed plan/cycle live ON THE INVOICE — we do NOT touch the sub here, so
		// the seller's visible tier stays put until they actually pay (mark-paid
		// reconciles the sub from these). Voiding therefore leaves the tier untouched.
		const invoiceId = await ctx.db.insert("invoices", {
			retailerId,
			subscriptionId: sub._id,
			invoiceNumber: generateInvoiceNumber(now),
			plan,
			billingCycle,
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
		// Render + store the invoice PDF (frozen at issue). Async so a render hiccup
		// never fails issuance; the download surfaces "preparing" until it lands.
		await ctx.scheduler.runAfter(0, internal.invoices.generateInvoicePdf, {
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
			plan?: Doc<"subscriptions">["plan"];
			isFoundingMember: boolean;
			foundingIntent: boolean;
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
				plan: sub?.plan,
				isFoundingMember: r.isFoundingMember === true,
				foundingIntent: sub?.foundingIntent === true,
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
				plan: (inv.plan ?? sub?.plan ?? "pro") as Plan,
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

// --- Invoice PDF (UC B) ----------------------------------------------------
// An invoice is a financial document, so its PDF is rendered + stored ONCE at
// issue time (not regenerated on download): `billingConfig` bank details are a
// mutable singleton and could otherwise drift from what the seller received.
// generateInvoicePdf (internal action) does the render; the data prep + the
// money/label mapping are the pure helpers in lib/pdf. See docs/invoices-receipts.md.

/** Read-only inputs the PDF action needs, assembled inside the transaction. */
export const pdfInputs = internalQuery({
	args: { invoiceId: v.id("invoices") },
	handler: async (
		ctx,
		{ invoiceId },
	): Promise<{
		alreadyRendered: boolean;
		data: SubscriptionInvoiceData;
	} | null> => {
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) return null;
		const retailer = await ctx.db.get(invoice.retailerId);
		if (!retailer) return null;
		const billingConfig = await ctx.db.query("billingConfig").first();
		return {
			alreadyRendered: invoice.pdfStorageId !== undefined,
			data: invoiceToSubscriptionData({
				invoice,
				retailer: {
					storeName: retailer.storeName,
					waPhone: retailer.waPhone,
					slug: retailer.slug,
				},
				billingConfig,
			}),
		};
	},
});

/** Stamp the rendered blob onto the invoice. Idempotency is enforced upstream
 * (the action skips when one already exists), so this is a plain patch. */
export const attachPdf = internalMutation({
	args: { invoiceId: v.id("invoices"), storageId: v.id("_storage") },
	handler: async (ctx, { invoiceId, storageId }): Promise<void> => {
		await ctx.db.patch(invoiceId, { pdfStorageId: storageId });
	},
});

/** Render + store an invoice's PDF. Scheduled from issueInvoice; safe to re-run
 * (skips if a PDF already exists). Kept internal — callers reach the bytes via
 * the ownership-checked getInvoicePdfUrl query. */
export const generateInvoicePdf = internalAction({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<void> => {
		const inputs = await ctx.runQuery(internal.invoices.pdfInputs, { invoiceId });
		if (!inputs || inputs.alreadyRendered) return;
		const bytes = await buildSubscriptionInvoicePdf(inputs.data);
		// Copy into a standalone ArrayBuffer so the Blob types line up across runtimes.
		const buffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		const storageId = await ctx.storage.store(
			new Blob([buffer], { type: "application/pdf" }),
		);
		await ctx.runMutation(internal.invoices.attachPdf, { invoiceId, storageId });
	},
});

/**
 * Signed download URL for an invoice PDF. Authorized for the OWNING retailer or
 * an admin (Kedaipal issues these). Returns null when the PDF hasn't been
 * rendered yet (just-issued, or a legacy invoice from before this feature). New
 * financial data exposed here stays behind this ownership gate.
 */
export const getInvoicePdfUrl = query({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<string | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) return null;
		const retailer = await ctx.db.get(invoice.retailerId);
		const ownsIt = retailer?.userId === identity.subject;
		if (!ownsIt && !(await isAdmin(ctx))) throw new ConvexError("Forbidden");
		if (!invoice.pdfStorageId) return null;
		return ctx.storage.getUrl(invoice.pdfStorageId);
	},
});

/**
 * Download entry point used by the UI: returns a signed PDF URL, **rendering the
 * PDF on demand if it's missing** (legacy invoices issued before this feature,
 * or a just-issued one whose async render hasn't landed). Ownership is enforced
 * by `getInvoicePdfUrl` BEFORE any generation, so a non-owner can't trigger a
 * render for an invoice they don't own. Idempotent.
 */
export const getOrCreateInvoicePdfUrl = action({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<string | null> => {
		// Authorize + fast-path: throws Forbidden for non-owners; returns the URL
		// when already rendered.
		const existing = await ctx.runQuery(api.invoices.getInvoicePdfUrl, {
			invoiceId,
		});
		if (existing) return existing;
		// Authorized but not yet rendered → generate, then resolve the URL.
		await ctx.runAction(internal.invoices.generateInvoicePdf, { invoiceId });
		return ctx.runQuery(api.invoices.getInvoicePdfUrl, { invoiceId });
	},
});
