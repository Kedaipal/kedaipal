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
import { isAdmin, requireAdmin, requireRetailerAccess } from "./lib/auth";
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
	DEFAULT_BILLING_CURRENCY,
	foundingPlanLocked,
	foundingPriceEligible,
	foundingPricingApplies,
	HOLD_MONTHLY_PRICES,
	isPlanSelectable,
	isPlanUpgrade,
	type Plan,
	planChangeCarryoverDays,
	planPrice,
	renewalCurrency,
	renewalQuote,
} from "./lib/plans";
import { rateLimiter } from "./lib/rateLimiter";
import { getPaymentProvider, type PaymentRecord } from "./payments/provider";
import { reserveFoundingRank, stampFoundingPaid } from "./foundingMembers";
import { defaultCapsForPlan } from "./subscriptions";

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_GRACE_DAYS = 14; // pay-by window when the admin doesn't override it

/** The refusal every self-serve plan path gives a store on founding pricing
 * that asks for anything but Founding Pro (`foundingPlanLocked`). Names the one
 * thing they CAN do, so the refusal is never a dead end. */
const FOUNDING_PLAN_LOCKED_MESSAGE =
	"Founding Members stay on Founding Pro — your founding price only exists on Pro. To stop renewing, turn off auto-renewal on your billing page.";

/** Who created an invoice — the schema's `origin` union (absent reads as "admin"). */
type InvoiceOrigin = NonNullable<Doc<"invoices">["origin"]>;

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

	// 1) Work out the period this payment actually buys, BEFORE writing anything.
	//    Plan/cycle live on the INVOICE, not the sub, so issuing never changes
	//    the seller's visible tier before they pay; pre-existing invoices fall
	//    back to the sub.
	// A HOLD invoice (Off-Season Hold, z8r3fday24) bills the flat hold price for
	// one paused month; the tier it resumes to stays on the row untouched.
	const isHold = invoice.kind === "hold";
	const billedPlan = isHold ? sub.plan : ((invoice.plan ?? sub.plan) as Plan);
	const billedCycle = isHold
		? sub.billingCycle
		: (invoice.billingCycle ?? sub.billingCycle);
	const caps = defaultCapsForPlan(billedPlan);
	// CREDIT AS DAYS: a seller never loses time they already paid for. Whatever
	// is left of a still-running paid period is converted into days of the plan
	// they're now on and added to the new period — an upgrade mid-cycle, an
	// early renewal, or an admin-issued change all preserve their remainder.
	// Computed HERE, at settle, from the days genuinely unused at the moment the
	// money lands: priced at issue instead, a manual-rail seller paying twelve
	// days later would be credited days that had already elapsed.
	const retailerForCarryover = await ctx.db.get(invoice.retailerId);
	const carryover = planChangeCarryoverDays({
		fromPlan: sub.plan,
		fromCycle: sub.billingCycle,
		toPlan: billedPlan,
		toCycle: billedCycle,
		// STORE eligibility, never "does the plan being left have a founding
		// price": a founding member moving Starter → Pro pays the founding Pro
		// invoice, so the days their remainder buys are priced at that rate
		// too. Asked with `sub.plan` this answered "no" and granted 5 days
		// where the billing page promised 8 (z8r3fdfty4). `planPrice` confines
		// the discount to Pro/Scale on each side of the conversion.
		founding: foundingPriceEligible({
			isFoundingMember: retailerForCarryover?.isFoundingMember === true,
			benefitsRevokedAt: retailerForCarryover?.foundingBenefitsRevokedAt,
			benefitsRestoredAt: retailerForCarryover?.foundingBenefitsRestoredAt,
			foundingIntent: sub.foundingIntent === true,
			paidThrough: sub.currentPeriodEnd,
			now,
		}),
		currency:
			invoice.currency === "SGD" || invoice.currency === "MYR"
				? invoice.currency
				: DEFAULT_BILLING_CURRENCY,
		// Carryover is a TIER-to-TIER conversion and must never cross the hold
		// rate in either direction (z8r3fday24 × 86eyb6z4r, reconciled 14 Sep):
		//  - INTO a hold: a hold is not a `Plan`, so `billedPlan` would still be
		//    the tier and the "conversion" would be a no-op dressed as a credit.
		//  - OUT OF a hold: the running period's days were bought at the HOLD
		//    price while `fromPlan` reads the TIER — so 29 unused hold days get
		//    valued at the Pro rate and hand back ~29 free Pro days for RM19.
		//    That exploit is what this gate exists to close.
		// `periodPaidBy` absent = plan-bought (every row that predates holds).
		periodEnd:
			!isHold &&
			sub.status === "active" &&
			(sub.periodPaidBy ?? "plan") === "plan"
				? sub.currentPeriodEnd
				: undefined,
		now,
	});
	if (carryover > 0) {
		console.info("[billing] carried unused paid days onto the new period", {
			retailerId: invoice.retailerId,
			fromPlan: sub.plan,
			toPlan: billedPlan,
			carryoverDays: carryover,
		});
	}
	const grantedPeriodEnd = isHold
		? nextPeriodEnd("monthly", now)
		: nextPeriodEnd(billedCycle, now) + carryover * DAY_MS;

	// 2) Flip the invoice, and correct the period it claims to cover.
	//    `insertPendingInvoice` can only ESTIMATE that period: it stamps 30 days
	//    from the issue date, but the period is granted from the moment the money
	//    lands and is extended by any carryover. Left alone, the PDF receipt says
	//    "Period: 13 Sep - 13 Oct" for a payment that bought service to 29 Oct
	//    (Zaki's store, 13 Sep 2026 — RM79 Starter upgraded same-day to Pro), and
	//    a manual-rail seller paying twelve days late got a receipt for twelve
	//    days they never had. The receipt now states what the money bought.
	await ctx.db.patch(invoice._id, {
		status: "paid",
		markedPaidAt: record.paidAt,
		markedPaidBy: record.recordedBy,
		paymentMethod: record.method,
		periodStart: now,
		periodEnd: grantedPeriodEnd,
	});

	// 3) Reconcile the subscription. A settle also closes any auto-charge dunning
	//    on this subscription — however the money arrived (auto-charge, Pay-now,
	//    bank transfer), the invoice is resolved and retries must stop.
	//    A HOLD invoice keeps the row `on_hold` on the tier it resumes to; only
	//    the status, the period and `periodPaidBy` differ from a tier settle.
	await ctx.db.patch(sub._id, {
		plan: billedPlan,
		billingCycle: billedCycle,
		status: isHold ? "on_hold" : "active",
		// What bought the CURRENT period — a resume mid-period reads this to
		// decide whether the tier bills at once, and the carryover gate above
		// reads it to refuse revaluing hold days at the tier rate.
		periodPaidBy: isHold ? "hold" : "plan",
		currentPeriodStart: now,
		currentPeriodEnd: grantedPeriodEnd,
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

	// 5) Render + store the payment RECEIPT (z8r3fdcrzj) — a second frozen
	// document beside the invoice blob, proof of payment for the seller's
	// books. Scheduled (not inline) for the same reason as the invoice PDF:
	// rendering doesn't belong in the settle transaction. Lives in the shared
	// settle core so gateway-settled invoices (auto-charge / Pay-now webhook)
	// get their receipt exactly like admin-marked ones.
	await ctx.scheduler.runAfter(
		0,
		internal.invoices.generateInvoiceReceiptPdf,
		{ invoiceId: invoice._id },
	);

	// 6) Server-side GA4 `subscribe_paid` key event (z8r3fdd1v1) — every
	//    payment (renewals too, `first_time` distinguishes), carrying the
	//    stored acquisition tag so subscription revenue segments by channel.
	//    Fire-and-forget: analytics never blocks or rolls back a payment.
	const retailer = await ctx.db.get(invoice.retailerId);
	await ctx.scheduler.runAfter(0, internal.ga4Events.sendKeyEvent, {
		event: "subscribe_paid",
		retailerId: invoice.retailerId,
		...(retailer?.gaClientId !== undefined
			? { gaClientId: retailer.gaClientId }
			: {}),
		...(retailer?.signupSource !== undefined
			? { src: retailer.signupSource }
			: {}),
		params: {
			plan: billedPlan,
			cycle: billedCycle,
			first_time: firstTime,
			// Invoice money is minor units (sen/cents); GA4 `value` is major.
			value: invoice.total / 100,
			currency: invoice.currency,
		},
	});

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
		// NOTE: no Pay-now link kill here. Every settle that reaches this point
		// already has a dead link — an auto-charge kills it when it CLAIMS the
		// attempt (the only window where both rails could take money), and a
		// Pay-now settle is the link completing itself. Killing again would fire
		// a guaranteed-to-fail DELETE on the commonest path and train the eye to
		// ignore the warn that matters. Manual markPaid/voidInvoice keep theirs.
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
		origin: InvoiceOrigin;
		/** Start-when-you-sell (z8r3fday24): the store's FIRST invoice, and what
		 * ended the free period — picks the "your first order is in" / "your
		 * free period has ended" email instead of the generic issued one. */
		firstInvoice?: "first_order" | "backstop";
		/** Off-Season Hold (z8r3fday24): a `hold` invoice bills the flat hold
		 * price for one month — no founding discount, no annual — and `plan` is
		 * the tier the seller resumes to. Default `plan`. */
		kind?: "plan" | "hold";
	},
): Promise<Id<"invoices">> {
	const kind = args.kind ?? "plan";
	const base =
		kind === "hold"
			? HOLD_MONTHLY_PRICES[args.currency]
			: planPrice(args.plan, args.billingCycle, false, args.currency);
	const total =
		kind === "hold"
			? base
			: planPrice(args.plan, args.billingCycle, args.founding, args.currency);
	const now = Date.now();
	// System-set pay-by deadline (issue date + grace). The subscription's billing
	// cycle is set later at settle, so the paid tier only starts once payment lands.
	const dueDate = args.dueDate ?? now + DUE_GRACE_DAYS * DAY_MS;

	const invoiceId = await ctx.db.insert("invoices", {
		retailerId: args.retailerId,
		subscriptionId: args.subscriptionId,
		invoiceNumber: generateInvoiceNumber(now),
		plan: args.plan,
		billingCycle: kind === "hold" ? "monthly" : args.billingCycle,
		amount: base,
		foundingDiscount:
			kind === "plan" && args.founding ? base - total : undefined,
		total,
		currency: args.currency,
		periodStart: now,
		periodEnd: nextPeriodEnd(kind === "hold" ? "monthly" : args.billingCycle, now),
		dueDate,
		status: "pending",
		origin: args.origin,
		...(kind === "hold" ? { kind } : {}),
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
		{ invoiceId, firstInvoice: args.firstInvoice },
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
	): Promise<{ invoiceId: Id<"invoices">; chargingSavedMethod: boolean }> => {
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
		// Founding pricing: an unclaimed onboard promise always gets it; a
		// CLAIMED member keeps it only within the 3-month lapse window
		// (foundingPriceEligible — rank/badge stay either way). Everyone else
		// pays list. The rank itself claims at settle. A store on it renews
		// Founding Pro and nothing else (foundingPlanLocked).
		const eligibility = {
			isFoundingMember: retailer.isFoundingMember === true,
			benefitsRevokedAt: retailer.foundingBenefitsRevokedAt,
			benefitsRestoredAt: retailer.foundingBenefitsRestoredAt,
			foundingIntent: sub.foundingIntent === true,
			paidThrough: sub.currentPeriodEnd,
			now: Date.now(),
		};
		if (foundingPlanLocked(plan, foundingPriceEligible(eligibility)))
			throw new ConvexError(FOUNDING_PLAN_LOCKED_MESSAGE);
		const existingPending = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.filter((q) => q.eq(q.field("status"), "pending"))
			.first();
		if (existingPending)
			throw new ConvexError(
				`You already have a pending invoice (${existingPending.invoiceNumber}) — pay that one, or contact us to change it.`,
			);

		const founding = foundingPricingApplies({ ...eligibility, plan });
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
		// A seller who still has a saved method (lapsed after a void, or came
		// back later) never reaches the authorisation page — startAutoRenewSetup
		// refuses with "already on". Without this their brand-new invoice would
		// sit unpaid forever while the button that made it promised an immediate
		// charge. Charge the saved method instead: same consent, same amount.
		if (sub.autoRenew !== undefined) {
			await ctx.scheduler.runAfter(
				0,
				internal.subscriptionPayments.chargeDueRenewal,
				{ invoiceId },
			);
		}
		return { invoiceId, chargingSavedMethod: sub.autoRenew !== undefined };
	},
});

/**
 * Seller: change tier mid-subscription (86eyb6z4r).
 *
 * Two directions, deliberately asymmetric, because what is fair differs:
 *
 *  - UPGRADE is immediate. A normal full-price invoice for the new plan (no
 *    special amount, no proration metadata — so it flows through every guard,
 *    the PDF and the MRR figure untouched), and `settleInvoicePaid` converts
 *    whatever was left of the old period into extra days on the new one. The
 *    seller pays the sticker price and loses nothing.
 *  - DOWNGRADE is SCHEDULED for the end of the period already paid for. No
 *    invoice, no charge, nothing forfeited: they keep the tier they bought —
 *    caps, features and data access — until it runs out, and the renewal the
 *    cron issues then bills the cheaper plan.
 *
 * Direction is decided by tier RANK, never by price: a seller on an annual
 * Starter (RM790) moving to a monthly Pro (RM149) is unmistakably an upgrade
 * that a price comparison would schedule as a downgrade.
 *
 * Cycle changes are refused here — monthly↔annual keeps the annual offer's
 * void-and-reissue runbook, which a human checks before any money moves.
 */
export const changePlan = mutation({
	args: {
		plan: v.union(v.literal("starter"), v.literal("pro")),
	},
	handler: async (
		ctx,
		{ plan },
	): Promise<
		| { kind: "scheduled"; effectiveAt: number }
		| {
				kind: "invoiced";
				invoiceId: Id<"invoices">;
				chargingSavedMethod: boolean;
		  }
	> => {
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
			throw new ConvexError("Your account is on the house — nothing to change.");
		// Only a seller mid-paid-period can "change" a plan; everyone else is
		// choosing one, which is the plan picker's job (and starts a fresh period).
		if (sub.status !== "active")
			throw new ConvexError(
				"Choose a plan from your billing page — a plan change applies to an active subscription.",
			);
		if (plan === sub.plan)
			throw new ConvexError(`You're already on ${plan}.`);
		// Founding Members stay on Founding Pro (Zaki, 17 Sep 2026) — refused in
		// BOTH directions before anything is scheduled or billed.
		const eligibility = {
			isFoundingMember: retailer.isFoundingMember === true,
			benefitsRevokedAt: retailer.foundingBenefitsRevokedAt,
			benefitsRestoredAt: retailer.foundingBenefitsRestoredAt,
			foundingIntent: sub.foundingIntent === true,
			paidThrough: sub.currentPeriodEnd,
			now: Date.now(),
		};
		if (foundingPlanLocked(plan, foundingPriceEligible(eligibility)))
			throw new ConvexError(FOUNDING_PLAN_LOCKED_MESSAGE);

		if (!isPlanUpgrade(sub.plan, plan)) {
			// Downgrade: schedule it, charge nothing, change nothing today.
			// No `updatedAt` — for a past_due row that field IS the lock-flip
			// moment the founder report reads (docs/shipped-log.md), and this
			// mutation must never be the thing that moves it.
			await ctx.db.patch(sub._id, {
				pendingPlanChange: { plan, requestedAt: Date.now() },
			});
			return {
				kind: "scheduled",
				effectiveAt: sub.currentPeriodEnd ?? Date.now(),
			};
		}

		// Upgrade: bill it now at the ordinary price.
		const existingPending = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.filter((q) => q.eq(q.field("status"), "pending"))
			.first();
		if (existingPending)
			throw new ConvexError(
				`Settle your open invoice (${existingPending.invoiceNumber}) first — then you can move up a plan.`,
			);
		const founding = foundingPricingApplies({ ...eligibility, plan });
		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.order("desc")
			.collect();
		const lastPaid = invoices.find((inv) => inv.status === "paid");
		const currency = renewalCurrency({
			lastPaidCurrency: lastPaid?.currency,
			country: retailer.country,
		});
		const invoiceId = await insertPendingInvoice(ctx, {
			retailerId: retailer._id,
			subscriptionId: sub._id,
			plan,
			// The seller's existing cycle — changing tier never silently changes
			// how often they are billed.
			billingCycle: sub.billingCycle,
			founding,
			currency,
			origin: "self_serve",
		});
		// An upgrade supersedes any scheduled downgrade.
		if (sub.pendingPlanChange !== undefined) {
			await ctx.db.patch(sub._id, { pendingPlanChange: undefined });
		}
		// Same rule as subscribeSelf: a seller who already authorised a method
		// is charged on it rather than being sent to an authorisation page that
		// would refuse them ("already on").
		if (sub.autoRenew !== undefined) {
			await ctx.scheduler.runAfter(
				0,
				internal.subscriptionPayments.chargeDueRenewal,
				{ invoiceId },
			);
		}
		return {
			kind: "invoiced",
			invoiceId,
			chargingSavedMethod: sub.autoRenew !== undefined,
		};
	},
});

/** Seller: call off a scheduled downgrade. Always available — nothing has been
 * charged, so nothing has to be undone. */
export const cancelPlanChange = mutation({
	args: {},
	handler: async (ctx): Promise<{ ok: true }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) throw new ConvexError("No store found for your account");
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.first();
		if (sub?.pendingPlanChange !== undefined) {
			await ctx.db.patch(sub._id, { pendingPlanChange: undefined });
		}
		return { ok: true };
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
 * Start-when-you-sell (z8r3fday24): the store's FIRST invoice, issued the
 * moment its free period ends — by the first live order (scheduled from
 * subscriptions.endFreePeriodOnFirstOrder) or by the daily cron's backstop.
 *
 * Bills the tier on the row (Pro — every trial showcases Pro; the seller can
 * switch the pending invoice to Starter before paying, `switchPendingPlan`),
 * monthly, in the store's country currency, at the founding price when the
 * store was promised one (`foundingPricingApplies`, same rule as self-serve).
 * Never auto-charged, even with a saved method — a first bill the seller has
 * not seen is exactly the surprise debit 86eyb6z4r refuses to send; the
 * Pay-now link is in the email and on the billing tab.
 *
 * Idempotent: refuses when the free period hasn't ended, the row isn't
 * trialing, it's comped, or ANY pending/paid invoice already exists — so the
 * trigger and the cron can both call it and only one bill ever lands.
 */
export const internalIssueFirstInvoice = internalMutation({
	args: { subscriptionId: v.id("subscriptions") },
	handler: async (ctx, { subscriptionId }): Promise<{ issued: boolean }> => {
		const sub = await ctx.db.get(subscriptionId);
		if (
			!sub ||
			sub.status !== "trialing" ||
			sub.comped === true ||
			sub.freePeriodEndedAt === undefined
		)
			return { issued: false };
		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", sub.retailerId))
			.collect();
		if (invoices.some((inv) => inv.status === "pending" || inv.status === "paid"))
			return { issued: false };
		const retailer = await ctx.db.get(sub.retailerId);
		if (!retailer) return { issued: false };
		const now = Date.now();
		const founding = foundingPricingApplies({
			plan: sub.plan,
			isFoundingMember: retailer.isFoundingMember === true,
			benefitsRevokedAt: retailer.foundingBenefitsRevokedAt,
			benefitsRestoredAt: retailer.foundingBenefitsRestoredAt,
			foundingIntent: sub.foundingIntent === true,
			paidThrough: sub.currentPeriodEnd,
			now,
		});
		const currency = BILLING_CURRENCY_FOR_COUNTRY[retailer.country ?? "MY"];
		const invoiceId = await insertPendingInvoice(ctx, {
			retailerId: sub.retailerId,
			subscriptionId: sub._id,
			plan: sub.plan,
			billingCycle: "monthly",
			founding,
			currency,
			origin: "free_period_end",
			firstInvoice: sub.freePeriodEndReason ?? "backstop",
		});
		console.info("[billing] first invoice issued", {
			retailerId: sub.retailerId,
			invoiceId,
			reason: sub.freePeriodEndReason,
		});
		return { issued: true };
	},
});

/**
 * Seller: switch the plan on a pending MACHINE-issued invoice before paying
 * it (z8r3fday24). Every trial runs on Pro, so the first invoice bills Pro;
 * a seller who wants Starter — or a Starter picker who changed their mind —
 * swaps here in ONE mutation: the old invoice is voided (its Pay-now link
 * killed) and the replacement issued at the new tier, same cycle, same
 * currency, and the SAME due date, so switching can never extend the grace.
 * Admin-issued invoices are deliberately excluded — Arif may have priced one
 * by hand — and hold invoices have no tier to switch.
 */
export const switchPendingPlan = mutation({
	args: { plan: v.union(v.literal("starter"), v.literal("pro")) },
	handler: async (ctx, { plan }): Promise<{ invoiceId: Id<"invoices"> }> => {
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
		const pending = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.filter((q) => q.eq(q.field("status"), "pending"))
			.first();
		if (!pending) throw new ConvexError("There's no unpaid invoice to switch.");
		if (pending.kind === "hold")
			throw new ConvexError(
				"That invoice is for your Off-Season Hold, not a plan — resume your plan first.",
			);
		if ((pending.origin ?? "admin") === "admin")
			throw new ConvexError(
				"This invoice was issued by our team — message us and we'll change it for you.",
			);
		// A RENEWAL invoice is the auto-charge machine's: `chargeDueRenewal` was
		// scheduled against THIS row, and dunning retries key off it. Replacing it
		// here would hand an auto-renew seller a bill nothing is scheduled to
		// charge — silently dropping them to manual for a cycle, ending in a
		// surprise lock at day 14. The UI only offers the switch on the first
		// invoice / a self-serve pick; this closes the direct-API door behind it.
		// Renewal plan changes stay a human conversation until the switch learns
		// to re-arm the charge.
		if (pending.origin === "auto_renewal")
			throw new ConvexError(
				"This is your renewal invoice — message us to change plan and we'll sort it out with you.",
			);
		const currentPlan = pending.plan ?? sub.plan;
		if (currentPlan === plan)
			throw new ConvexError(
				`Your invoice is already for ${plan === "pro" ? "Pro" : "Starter"}.`,
			);
		const now = Date.now();
		const eligibility = {
			isFoundingMember: retailer.isFoundingMember === true,
			benefitsRevokedAt: retailer.foundingBenefitsRevokedAt,
			benefitsRestoredAt: retailer.foundingBenefitsRestoredAt,
			foundingIntent: sub.foundingIntent === true,
			paidThrough: sub.currentPeriodEnd,
			now,
		};
		// Checked before the void — a refused switch must leave the bill intact.
		if (foundingPlanLocked(plan, foundingPriceEligible(eligibility)))
			throw new ConvexError(FOUNDING_PLAN_LOCKED_MESSAGE);
		await ctx.db.patch(pending._id, {
			status: "void",
			voidedAt: now,
			voidedBy: identity.subject,
			voidReason: `Switched to ${plan} by the seller`,
		});
		if (pending.gatewayRequestId) {
			await ctx.scheduler.runAfter(
				0,
				internal.subscriptionPayments.expireInvoiceRequest,
				{ requestId: pending.gatewayRequestId },
			);
		}
		const founding = foundingPricingApplies({ ...eligibility, plan });
		const currency: BillingCurrency =
			pending.currency === "SGD" ? "SGD" : "MYR";
		const invoiceId = await insertPendingInvoice(ctx, {
			retailerId: retailer._id,
			subscriptionId: sub._id,
			plan,
			billingCycle: pending.billingCycle ?? "monthly",
			founding,
			currency,
			dueDate: pending.dueDate,
			origin: "self_serve",
		});
		return { invoiceId };
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
	args: {
		subscriptionId: v.id("subscriptions"),
		// Off-Season Hold (z8r3fday24): the pause/resume switch issues the NEXT
		// bill at once regardless of the period clock — a plan bill it just
		// voided is replaced by the hold bill, or a forfeited hold period by the
		// tier bill. Everything else (single-pending, comped, status) still holds.
		force: v.optional(v.boolean()),
	},
	handler: async (
		ctx,
		{ subscriptionId, force },
	): Promise<{ issued: boolean; autoCharge: boolean }> => {
		const sub = await ctx.db.get(subscriptionId);
		const now = Date.now();
		if (
			!sub ||
			(sub.status !== "active" && sub.status !== "on_hold") ||
			sub.comped === true ||
			(!force &&
				(sub.currentPeriodEnd === undefined || sub.currentPeriodEnd >= now))
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
		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", sub.retailerId))
			.order("desc")
			.collect();

		// What this bill says comes from `renewalQuote` — the same author the
		// heads-up email, HitPay's authorisation page and the billing page read,
		// so none of them can quote a different number (z8r3fdfty4). It encodes:
		//  - A held subscription renews the HOLD, not the tier: flat price, no
		//    founding discount, monthly. The tier it resumes to rides on `plan`.
		//  - Founding pricing honours the 3-month lapse window (cron renewals
		//    fire right at period end, so an ACTIVE member is virtually always
		//    inside it — the check is there for uniformity with subscribeSelf).
		//  - A downgrade the seller scheduled takes effect HERE — the renewal is
		//    the first bill of the new tier, so the discount, the caps at settle
		//    and the amount all describe the same plan.
		//  - A HOLD renewal is NOT that bill (z8r3fday24 × 86eyb6z4r, reconciled
		//    14 Sep): it charges the flat hold price and `settleInvoicePaid`
		//    leaves the tier alone, so applying the change there would bill
		//    nothing for it and consuming the flag below would delete a
		//    downgrade the seller never received. It stays scheduled and lands
		//    on the first TIER bill after they resume.
		const quote = renewalQuote({
			status: sub.status,
			plan: sub.plan,
			billingCycle: sub.billingCycle,
			pendingPlanChange: sub.pendingPlanChange?.plan,
			isFoundingMember: retailer.isFoundingMember === true,
			benefitsRevokedAt: retailer.foundingBenefitsRevokedAt,
			benefitsRestoredAt: retailer.foundingBenefitsRestoredAt,
			foundingIntent: sub.foundingIntent === true,
			paidThrough: sub.currentPeriodEnd,
			lastPaidCurrency: invoices.find((inv) => inv.status === "paid")?.currency,
			country: retailer.country,
			now,
		});
		const kind = quote.kind;

		const invoiceId = await insertPendingInvoice(ctx, {
			retailerId: sub.retailerId,
			subscriptionId: sub._id,
			plan: quote.plan,
			billingCycle: quote.billingCycle,
			founding: quote.founding,
			currency: quote.currency,
			// A forced issue comes from the seller's own pause/resume tap —
			// their choice, so it is self-serve; the cron's issues are renewals.
			origin: force ? "self_serve" : "auto_renewal",
			kind,
		});
		// Consumed: the change is baked into a real bill now, and settle will
		// move the subscription onto it — or, for a store on founding pricing,
		// the quote CANCELLED it (the founding lock) and this is where the stale
		// flag goes. Leaving it set would re-apply the downgrade to every future
		// renewal. A hold bill never carries it (see above), so it must never
		// clear it either.
		if (kind === "plan" && sub.pendingPlanChange !== undefined) {
			await ctx.db.patch(sub._id, { pendingPlanChange: undefined });
		}
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
			/** Founding BENEFITS revoked (z8r3fdfyw5) — still a member, no longer
			 * on founding pricing. The issue form must not auto-apply (let alone
			 * lock in) a discount the daily pass has taken away. */
			foundingBenefitsRevoked: boolean;
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
				foundingBenefitsRevoked: r.foundingBenefitsRevokedAt !== undefined,
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
			origin: InvoiceOrigin;
			/** Off-Season Hold invoices bill the hold, not the tier (z8r3fday24). */
			kind: "plan" | "hold";
			hasPayNowLink: boolean;
			autoRenew: {
				method: string;
				failedAttempts: number;
				nextRetryAt?: number;
				lastChargeError?: string;
			} | null;
			gatewayIssue?: Doc<"invoices">["gatewayIssue"];
			billingCycle: BillingCycle;
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
				kind: inv.kind ?? "plan",
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
				// Without this the admin console shows an annual and a monthly
				// pending invoice identically except for the amount — while markPaid
				// grants 365 days off this invisible field.
				billingCycle: (inv.billingCycle ??
					sub?.billingCycle ??
					"monthly") as BillingCycle,
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

/** The caller's own invoices (billing page). Newest first.
 *
 * `retailerId` is the admin act-as path: without it the query resolves the
 * CALLER's store, so an admin viewing a seller's billing tab was shown their
 * OWN invoices beside the seller's plan (z8r3fdfty4). Owner-or-admin gated by
 * `requireRetailerAccess`; omitted, it is the unchanged owner read. */
export const myInvoices = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { retailerId }): Promise<Doc<"invoices">[]> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const retailer = retailerId
			? (await requireRetailerAccess(ctx, retailerId)).retailer
			: await ctx.db
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

// --- Payment receipt PDF (z8r3fdcrzj) --------------------------------------
// A PAID invoice gets a second frozen document: the receipt ("Amount paid",
// green Paid pill, no payment instructions). Never an overwrite of the invoice
// blob — that one is the bill the seller was sent, and both are theirs to keep.
// Same pipeline shape as the invoice PDF: inputs query → internal render action
// (idempotent) → attach mutation → ownership-checked URL query → on-demand
// action for rows paid before this shipped.

/** Read-only inputs for the receipt render. `eligible` is false for anything
 * not paid — pending must never grow a receipt, and a voided row (cancelled in
 * error) has nothing to prove. */
export const receiptPdfInputs = internalQuery({
	args: { invoiceId: v.id("invoices") },
	handler: async (
		ctx,
		{ invoiceId },
	): Promise<{
		alreadyRendered: boolean;
		eligible: boolean;
		data: SubscriptionInvoiceData;
	} | null> => {
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) return null;
		const retailer = await ctx.db.get(invoice.retailerId);
		if (!retailer) return null;
		return {
			alreadyRendered: invoice.receiptPdfStorageId !== undefined,
			eligible:
				invoice.status === "paid" && invoice.markedPaidAt !== undefined,
			data: invoiceToSubscriptionData({
				invoice,
				retailer: {
					storeName: retailer.storeName,
					waPhone: retailer.waPhone,
					slug: retailer.slug,
				},
				// The receipt face needs no billingConfig — payment instructions
				// are exactly what a receipt must NOT print.
				billingConfig: null,
				asReceipt: true,
			}),
		};
	},
});

/** Stamp the rendered receipt blob onto the invoice (attachPdf's sibling). */
export const attachReceiptPdf = internalMutation({
	args: { invoiceId: v.id("invoices"), storageId: v.id("_storage") },
	handler: async (ctx, { invoiceId, storageId }): Promise<void> => {
		await ctx.db.patch(invoiceId, { receiptPdfStorageId: storageId });
	},
});

/** Render + store a paid invoice's receipt. Scheduled from markPaid; safe to
 * re-run (skips when one exists) and a no-op for anything not paid, so a stray
 * schedule can never mint a receipt for a pending or voided invoice. */
export const generateInvoiceReceiptPdf = internalAction({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<void> => {
		const inputs = await ctx.runQuery(internal.invoices.receiptPdfInputs, {
			invoiceId,
		});
		if (!inputs || inputs.alreadyRendered || !inputs.eligible) return;
		const bytes = await buildSubscriptionInvoicePdf(inputs.data);
		const buffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		const storageId = await ctx.storage.store(
			new Blob([buffer], { type: "application/pdf" }),
		);
		await ctx.runMutation(internal.invoices.attachReceiptPdf, {
			invoiceId,
			storageId,
		});
	},
});

/** Signed URL for a paid invoice's receipt — same ownership gate as
 * getInvoicePdfUrl (owning retailer or admin). Null while unrendered or for an
 * unpaid/voided invoice (the UI only offers the button on paid rows). */
export const getInvoiceReceiptPdfUrl = query({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<string | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) return null;
		const retailer = await ctx.db.get(invoice.retailerId);
		const ownsIt = retailer?.userId === identity.subject;
		if (!ownsIt && !(await isAdmin(ctx))) throw new ConvexError("Forbidden");
		if (!invoice.receiptPdfStorageId) return null;
		return ctx.storage.getUrl(invoice.receiptPdfStorageId);
	},
});

/** Download entry point for the receipt: returns the signed URL, rendering on
 * demand for invoices paid before this shipped. Ownership is enforced by the
 * URL query BEFORE any generation (getOrCreateInvoicePdfUrl's posture), and
 * the generator itself refuses anything not paid, so an unpaid invoice can
 * never be coaxed into producing a receipt. */
export const getOrCreateInvoiceReceiptPdfUrl = action({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<string | null> => {
		const existing = await ctx.runQuery(api.invoices.getInvoiceReceiptPdfUrl, {
			invoiceId,
		});
		if (existing) return existing;
		await ctx.runAction(internal.invoices.generateInvoiceReceiptPdf, {
			invoiceId,
		});
		return ctx.runQuery(api.invoices.getInvoiceReceiptPdfUrl, { invoiceId });
	},
});
