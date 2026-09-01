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
	type MutationCtx,
	query,
} from "./_generated/server";
import { isAdmin, requireAdmin } from "./lib/auth";
import { gatewayPaymentMethodTag } from "./lib/hitpayBilling";
import {
	invoiceToSubscriptionData,
	type SubscriptionInvoiceData,
} from "./lib/pdf/document";
import { buildSubscriptionInvoicePdf } from "./lib/pdf/render";
import {
	BILLING_CURRENCY_FOR_COUNTRY,
	type BillingCurrency,
	type BillingCycle,
	isPlanSelectable,
	type Plan,
	planPrice,
} from "./lib/plans";
import { rateLimiter } from "./lib/rateLimiter";
import { getPaymentProvider, type PaymentRecord } from "./payments/provider";
import { reserveFoundingRank, stampFoundingPaid } from "./foundingMembers";
import { defaultCapsForPlan } from "./subscriptions";

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_GRACE_DAYS = 14; // pay-by window when the admin doesn't override it

/** Delay between issuing an invoice and sending the "invoice issued" email —
 * long enough for the scheduled Pay-now mint (subscriptionPayments.
 * mintInvoicePaymentRequest) to land so the email carries the link, short
 * enough that nobody notices. A failed/absent mint just means the email goes
 * out with manual pay details only — never blocked, never skipped. */
const ISSUE_EMAIL_DELAY_MS = 30_000;

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
 * THE settle path — invoice → paid, subscription → active (period + caps
 * refreshed), Founding rank claimed, welcome/thanks email scheduled. One
 * implementation shared by the admin mark-paid flow and the gateway settles
 * (auto-renewal charge + Pay-now webhook), so a webhook-settled founding
 * invoice claims its rank through EXACTLY the code the manual flow uses.
 * Caller owns the transaction and has already normalized the payment fact
 * through the provider seam.
 */
async function settleInvoicePaid(
	ctx: MutationCtx,
	invoice: Doc<"invoices">,
	sub: Doc<"subscriptions">,
	record: PaymentRecord,
): Promise<{ rank: number | null; firstTime: boolean }> {
	const now = record.paidAt;

	// First-ever payment? (drives welcome vs thanks email below). Counted before
	// we flip this invoice, so it reflects PRIOR paid invoices.
	const priorPaid = await ctx.db
		.query("invoices")
		.withIndex("by_retailer", (q) => q.eq("retailerId", invoice.retailerId))
		.filter((q) => q.eq(q.field("status"), "paid"))
		.first();
	const firstTime = priorPaid === null;

	// 1) Flip the invoice.
	await ctx.db.patch(invoice._id, {
		status: "paid",
		markedPaidAt: record.paidAt,
		markedPaidBy: record.recordedBy,
		paymentMethod: record.method,
	});

	// 2) Reconcile the subscription FROM THE INVOICE (plan/cycle live on the
	//    invoice, not the sub — so issuing never changes the seller's visible tier
	//    before they pay). Falls back to the sub for pre-existing invoices.
	//    A settle also closes any auto-charge dunning on this subscription —
	//    however the money arrived (auto-charge, Pay-now, bank transfer), the
	//    invoice is resolved and retries must stop.
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
		...(sub.autoRenew
			? {
					autoRenew: {
						...sub.autoRenew,
						failedAttempts: undefined,
						nextRetryAt: undefined,
						lastChargeError: undefined,
						lastChargeAttemptAt: undefined,
						pendingChargeInvoiceId: undefined,
					},
				}
			: {}),
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
		await stampFoundingPaid(ctx, invoice.retailerId, invoice._id, now);
	}

	// 4) Welcome (first payment) / thanks (renewal) email — fire-and-forget.
	await ctx.scheduler.runAfter(
		0,
		internal.billingEmail.notifyPaymentReceived,
		{ invoiceId: invoice._id, firstTime },
	);

	return { rank, firstTime };
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

		// Normalize the payment fact through the provider seam (pure; we own the txn).
		const record = getPaymentProvider("manual_admin").recordPayment({
			method: paymentMethod,
			recordedBy: adminSubject,
			paidAt: Date.now(),
		});
		const { rank } = await settleInvoicePaid(ctx, invoice, sub, record);

		// Settled out-of-band while a Pay-now link is live → kill the link so the
		// seller can't ALSO pay online (best-effort; a payment that slips through
		// anyway lands as a `late_payment` audit stamp, never a second settle).
		if (invoice.gatewayRequestId) {
			await ctx.scheduler.runAfter(
				0,
				internal.subscriptionPayments.expireInvoiceRequest,
				{ requestId: invoice.gatewayRequestId },
			);
		}

		return { rank };
	},
});

/**
 * Gateway settle (86eyb6z4r): a HitPay payment on Kedaipal's own account —
 * the tokenised auto-renewal charge (sync response or charge.created webhook)
 * or the invoice Pay-now link (v1 completion webhook). Idempotent by
 * construction:
 *  - already paid by THIS payment id → duplicate webhook, plain no-op;
 *  - already paid another way / voided → `late_payment` audit stamp for the
 *    admin console, nothing else changes (double-payment surfaced, never
 *    double-settled);
 *  - amount/currency mismatch → `amount_mismatch` audit stamp, NO settle
 *    (a stale link paid after a reissue must not activate the wrong bill).
 * A clean pending invoice settles through settleInvoicePaid — the exact
 * markPaid path, founding claim included, no fork.
 */
export const internalSettleFromGateway = internalMutation({
	args: {
		invoiceId: v.id("invoices"),
		paymentId: v.string(),
		amountSen: v.number(),
		currency: v.string(),
		// HitPay method code when the event carries one ("card"/"touch_n_go").
		methodCode: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ invoiceId, paymentId, amountSen, currency, methodCode },
	): Promise<{
		applied: boolean;
		reason?: "duplicate" | "late_payment" | "amount_mismatch" | "gone";
	}> => {
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) return { applied: false, reason: "gone" };

		if (invoice.status !== "pending") {
			if (
				invoice.status === "paid" &&
				(invoice.markedPaidBy === paymentId ||
					invoice.gatewayPayment?.paymentId === paymentId)
			) {
				return { applied: false, reason: "duplicate" };
			}
			// Real money landed on a settled/voided invoice — audit, don't settle.
			console.error("[billing] gateway payment on a non-pending invoice", {
				invoiceNumber: invoice.invoiceNumber,
				status: invoice.status,
				paymentId,
			});
			if (invoice.gatewayIssue === undefined) {
				await ctx.db.patch(invoiceId, {
					gatewayIssue: {
						kind: "late_payment",
						paymentId,
						amountSen,
						at: Date.now(),
					},
				});
			}
			return { applied: false, reason: "late_payment" };
		}

		if (
			amountSen !== invoice.total ||
			currency.toUpperCase() !== invoice.currency.toUpperCase()
		) {
			console.error("[billing] gateway payment amount mismatch", {
				invoiceNumber: invoice.invoiceNumber,
				expected: invoice.total,
				got: amountSen,
				currency,
				paymentId,
			});
			if (invoice.gatewayIssue === undefined) {
				await ctx.db.patch(invoiceId, {
					gatewayIssue: {
						kind: "amount_mismatch",
						paymentId,
						amountSen,
						at: Date.now(),
					},
				});
			}
			return { applied: false, reason: "amount_mismatch" };
		}

		const sub = await ctx.db.get(invoice.subscriptionId);
		if (!sub) return { applied: false, reason: "gone" };

		const record = getPaymentProvider("hitpay").recordPayment({
			method: gatewayPaymentMethodTag(methodCode),
			recordedBy: paymentId,
			paidAt: Date.now(),
		});
		await settleInvoicePaid(ctx, invoice, sub, record);
		if (invoice.gatewayPayment) {
			await ctx.db.patch(invoiceId, {
				gatewayPayment: { ...invoice.gatewayPayment, paymentId },
			});
		}
		// A successful AUTO-CHARGE also advances the saved-method counters —
		// resolved via the pending-charge stamp so a Pay-now settle on a session
		// mid-dunning doesn't inflate timesCharged. (Dunning state itself was
		// already cleared inside settleInvoicePaid.)
		if (sub.autoRenew?.pendingChargeInvoiceId === invoiceId) {
			const settled = await ctx.db.get(sub._id);
			if (settled?.autoRenew) {
				await ctx.db.patch(sub._id, {
					autoRenew: {
						...settled.autoRenew,
						lastChargeAt: record.paidAt,
						timesCharged: (sub.autoRenew.timesCharged ?? 0) + 1,
					},
				});
			}
		}
		return { applied: true };
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
		// Billing currency (default MYR). SGD serves Singapore-based sellers —
		// their invoice carries no MY bank/DuitNow block (those rails are MYR-only)
		// and prices come from the SGD table in lib/plans.
		currency: v.optional(v.union(v.literal("MYR"), v.literal("SGD"))),
		// Optional override; normally the system sets it (issue date + grace) so the
		// admin doesn't pick a date. The actual paid CYCLE starts at mark-paid.
		dueDate: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{
			retailerId,
			plan,
			billingCycle,
			founding,
			currency: currencyArg,
			dueDate: dueDateArg,
		},
	): Promise<{ invoiceId: Id<"invoices"> }> => {
		await requireAdmin(ctx);
		const currency: BillingCurrency = currencyArg ?? "MYR";
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

		const invoiceId = await insertPendingInvoice(ctx, {
			retailerId,
			subscriptionId: sub._id,
			plan,
			billingCycle,
			founding,
			currency,
			dueDate: dueDateArg,
			origin: "admin",
		});
		return { invoiceId };
	},
});

/**
 * Shared invoice-creation core: computes the price from the plan (single
 * source of truth), inserts the pending row, and schedules the async trio —
 * Pay-now mint (immediately), invoice-issued email (delayed so the mint can
 * land and the email carries the link), and the frozen PDF. Every issuance
 * path (admin, self-serve, cron renewal) goes through here so the follow-ups
 * can never drift apart. The billed plan/cycle live ON THE INVOICE — the sub
 * is never touched here, so the seller's visible tier stays put until they
 * actually pay (settle reconciles the sub from these), and voiding leaves the
 * tier untouched.
 */
async function insertPendingInvoice(
	ctx: MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		subscriptionId: Id<"subscriptions">;
		plan: Plan;
		billingCycle: BillingCycle;
		founding: boolean;
		currency: BillingCurrency;
		dueDate?: number;
		origin: "admin" | "self_serve" | "auto_renewal";
	},
): Promise<Id<"invoices">> {
	const base = planPrice(args.plan, args.billingCycle, false, args.currency);
	const total = planPrice(
		args.plan,
		args.billingCycle,
		args.founding,
		args.currency,
	);
	const now = Date.now();
	// System-set pay-by deadline (issue date + grace). The subscription's billing
	// cycle is set later at settle, so the paid tier only starts once payment lands.
	const dueDate = args.dueDate ?? now + DUE_GRACE_DAYS * DAY_MS;

	const invoiceId = await ctx.db.insert("invoices", {
		retailerId: args.retailerId,
		subscriptionId: args.subscriptionId,
		invoiceNumber: generateInvoiceNumber(now),
		plan: args.plan,
		billingCycle: args.billingCycle,
		amount: base,
		foundingDiscount: args.founding ? base - total : undefined,
		total,
		currency: args.currency,
		periodStart: now,
		periodEnd: nextPeriodEnd(args.billingCycle, now),
		dueDate,
		status: "pending",
		origin: args.origin,
		createdAt: now,
	});
	// Mint the HitPay Pay-now link (no-op without gateway credentials; failure
	// never blocks issuance — the invoice just stays manual-pay).
	await ctx.scheduler.runAfter(
		0,
		internal.subscriptionPayments.mintInvoicePaymentRequest,
		{ invoiceId },
	);
	// Ping the seller out-of-app — they won't always be in the dashboard.
	// Fire-and-forget so a mail issue never fails the issue mutation; delayed a
	// beat so the Pay-now mint above can land and the email carries the button.
	// (An auto-charged renewal often settles inside this window — the send then
	// skips on the non-pending guard and the seller gets just the receipt.)
	await ctx.scheduler.runAfter(
		ISSUE_EMAIL_DELAY_MS,
		internal.billingEmail.notifyInvoiceIssued,
		{ invoiceId },
	);
	// Render + store the invoice PDF (frozen at issue). Async so a render hiccup
	// never fails issuance; the download surfaces "preparing" until it lands.
	await ctx.scheduler.runAfter(0, internal.invoices.generateInvoicePdf, {
		invoiceId,
	});
	return invoiceId;
}

/**
 * Seller: subscribe (or renew) themselves — the self-serve half of 86eyb6z4r.
 * Picks a plan + cycle, gets a pending invoice with a Pay-now link, pays,
 * and the webhook settles it: nobody at Kedaipal in the loop. Founding
 * pricing applies automatically for a store Arif onboarded with founding
 * intent (their promised discount must survive self-serve); founding is never
 * otherwise self-selectable — the last slots stay Arif's to hand out.
 * Deliberately refused while `active`: a mid-cycle plan change is a proration
 * conversation, not a second invoice (the UI says so instead of offering it).
 */
export const subscribeSelf = mutation({
	args: {
		plan: v.union(v.literal("starter"), v.literal("pro")),
		billingCycle: v.union(v.literal("monthly"), v.literal("annual")),
	},
	handler: async (
		ctx,
		{ plan, billingCycle },
	): Promise<{ invoiceId: Id<"invoices"> }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) throw new ConvexError("No store found for your account");
		await rateLimiter.limit(ctx, "billingSelfServe", {
			key: retailer._id,
			throws: true,
		});
		if (!isPlanSelectable(plan))
			throw new ConvexError("That plan isn't available yet.");
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.first();
		if (!sub) throw new ConvexError("No subscription found for your store");
		if (sub.comped === true)
			throw new ConvexError("Your account is on the house — nothing to pay.");
		if (sub.status === "active")
			throw new ConvexError(
				"You're already on an active plan. Message us to change plans mid-cycle.",
			);
		const existingPending = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.filter((q) => q.eq(q.field("status"), "pending"))
			.first();
		if (existingPending)
			throw new ConvexError(
				`You already have a pending invoice (${existingPending.invoiceNumber}) — pay that one, or contact us to change it.`,
			);

		// A founding-intent store (Arif's onboard link) gets its promised 30%
		// on Pro; everyone else pays list. The rank itself claims at settle.
		const founding = sub.foundingIntent === true && plan === "pro";
		const currency = BILLING_CURRENCY_FOR_COUNTRY[retailer.country ?? "MY"];
		const invoiceId = await insertPendingInvoice(ctx, {
			retailerId: retailer._id,
			subscriptionId: sub._id,
			plan,
			billingCycle,
			founding,
			currency,
			origin: "self_serve",
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
		// A voided invoice's Pay-now link must die with it — a payment on a void
		// bill can only ever become a refund conversation.
		if (invoice.gatewayRequestId) {
			await ctx.scheduler.runAfter(
				0,
				internal.subscriptionPayments.expireInvoiceRequest,
				{ requestId: invoice.gatewayRequestId },
			);
		}
		return { ok: true };
	},
});

/**
 * Cron-issued renewal (86eyb6z4r): the daily billing cron calls this for each
 * active, non-comped subscription whose period has ended — the invoice Arif
 * used to type by hand. Founding members renew at their lifetime discount;
 * currency follows the store's last PAID invoice (a one-off experiment or
 * void must not flip it), falling back to the store's country. When a saved
 * payment method is attached, the tokenised charge is scheduled right behind
 * the invoice — settle then happens through the same path as every other
 * payment. Idempotent: re-checks period + single-pending inside the
 * transaction, so a double-fired cron issues nothing twice.
 */
export const internalIssueRenewalInvoice = internalMutation({
	args: { subscriptionId: v.id("subscriptions") },
	handler: async (
		ctx,
		{ subscriptionId },
	): Promise<{ issued: boolean; autoCharge: boolean }> => {
		const sub = await ctx.db.get(subscriptionId);
		const now = Date.now();
		if (
			!sub ||
			sub.status !== "active" ||
			sub.comped === true ||
			sub.currentPeriodEnd === undefined ||
			sub.currentPeriodEnd >= now
		) {
			return { issued: false, autoCharge: false };
		}
		const pending = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", sub.retailerId))
			.filter((q) => q.eq(q.field("status"), "pending"))
			.first();
		if (pending) return { issued: false, autoCharge: false };
		const retailer = await ctx.db.get(sub.retailerId);
		if (!retailer) return { issued: false, autoCharge: false };

		const founding =
			retailer.isFoundingMember === true &&
			(sub.plan === "pro" || sub.plan === "scale");
		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", sub.retailerId))
			.order("desc")
			.collect();
		const lastPaid = invoices.find((inv) => inv.status === "paid");
		const currency: BillingCurrency =
			lastPaid?.currency === "SGD" || lastPaid?.currency === "MYR"
				? lastPaid.currency
				: BILLING_CURRENCY_FOR_COUNTRY[retailer.country ?? "MY"];

		const invoiceId = await insertPendingInvoice(ctx, {
			retailerId: sub.retailerId,
			subscriptionId: sub._id,
			plan: sub.plan,
			billingCycle: sub.billingCycle,
			founding,
			currency,
			origin: "auto_renewal",
		});
		const autoCharge = sub.autoRenew !== undefined;
		if (autoCharge) {
			await ctx.scheduler.runAfter(
				0,
				internal.subscriptionPayments.chargeDueRenewal,
				{ invoiceId },
			);
		}
		console.info("[billing] renewal invoice issued", {
			retailerId: sub.retailerId,
			invoiceId,
			autoCharge,
		});
		return { issued: true, autoCharge };
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
 * mark-paid UI, plus which RAIL each one is on (auto-renew / Pay-now link /
 * manual) and any dunning state — so "which retailers are failing" is a
 * glance, not a spreadsheet. */
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
			origin: "admin" | "self_serve" | "auto_renewal";
			hasPayNowLink: boolean;
			autoRenew: {
				method: string;
				failedAttempts: number;
				nextRetryAt?: number;
				lastChargeError?: string;
			} | null;
			gatewayIssue?: Doc<"invoices">["gatewayIssue"];
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
				origin: inv.origin ?? "admin",
				hasPayNowLink: inv.gatewayPayment !== undefined,
				autoRenew: sub?.autoRenew
					? {
							method: sub.autoRenew.method,
							failedAttempts: sub.autoRenew.failedAttempts ?? 0,
							nextRetryAt: sub.autoRenew.nextRetryAt,
							lastChargeError: sub.autoRenew.lastChargeError,
						}
					: null,
				gatewayIssue: inv.gatewayIssue,
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
