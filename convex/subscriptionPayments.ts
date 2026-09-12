/**
 * Subscription payments against KEDAIPAL'S OWN HitPay account (86eyb6z4r).
 *
 * Two rails on top of manual billing — never replacing it:
 *  - PAY-NOW: every issued invoice gets a one-off hosted-checkout link
 *    (mintInvoicePaymentRequest), surfaced in the billing tab + invoice
 *    emails; the v1 completion webhook settles it through
 *    invoices.internalSettleFromGateway (the markPaid path, no fork).
 *  - AUTO-RENEWAL: the seller authorises a card / Touch 'n Go wallet once
 *    (startAutoRenewSetup → HitPay's page → method_attached webhook or the
 *    finishAutoRenewSetup reconcile); each renewal the daily cron issues is
 *    then charged merchant-initiated (chargeDueRenewal). The charge response
 *    is SYNCHRONOUS — that's the primary success/failure signal, because
 *    HitPay ships no charge-failure webhook. Kedaipal owns the retry
 *    schedule (lib/hitpayBilling.ts) and the no-double-charge reconcile.
 *
 * Credentials live in the deployment env (HITPAY_BILLING_API_KEY/_SALT, plus
 * HITPAY_BILLING_WEBHOOK_SALT for dashboard-registered events) — the first two
 * absent ⇒ everything here quietly no-ops and manual billing is unchanged.
 * See docs/hitpay-recurring.md.
 */

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
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
import { requireAdmin } from "./lib/auth";
import {
	decimalStringToSen,
	HITPAY_API_BASE,
	senToDecimalString,
} from "./lib/hitpay";
import {
	AUTO_RENEW_METHODS,
	autoRenewMethodLabel,
	type BillingGatewayCredentials,
	buildAutoRenewSessionParams,
	buildInvoicePaymentRequestParams,
	CHARGE_OUTCOME_UNKNOWN_WINDOW_MS,
	nextChargeRetryAt,
	readAttachedMethodCode,
	resolveBillingGatewayCredentials,
} from "./lib/hitpayBilling";
import {
	BILLING_CURRENCY_FOR_COUNTRY,
	type BillingCurrency,
	foundingPricingApplies,
	planPrice,
} from "./lib/plans";
import { rateLimiter } from "./lib/rateLimiter";

/** How long an unfinished authorisation session is offered for "resume" before
 * a new one is minted. */
const SETUP_RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

function billingCredentials(): BillingGatewayCredentials | null {
	return resolveBillingGatewayCredentials({
		HITPAY_BILLING_API_KEY: process.env.HITPAY_BILLING_API_KEY,
		HITPAY_BILLING_SALT: process.env.HITPAY_BILLING_SALT,
		HITPAY_BILLING_WEBHOOK_SALT: process.env.HITPAY_BILLING_WEBHOOK_SALT,
	});
}

function hitpayHeaders(credentials: BillingGatewayCredentials): HeadersInit {
	return {
		"X-BUSINESS-API-KEY": credentials.apiKey,
		"Content-Type": "application/x-www-form-urlencoded",
		"X-Requested-With": "XMLHttpRequest",
	};
}

function billingPageUrl(extra?: string): string {
	const base = `${process.env.SITE_URL ?? "https://kedaipal.com"}/app/settings?tab=billing`;
	return extra ? `${base}&${extra}` : base;
}

// ---------------------------------------------------------------------------
// Capability surface — what the billing tab may offer this seller
// ---------------------------------------------------------------------------

/**
 * Whether the online rails exist for the CALLER's store, and with which
 * methods. Presence booleans only — credentials never leave the server. The
 * billing tab hides Pay-now / auto-renewal / the self-serve plan picker when
 * this says off, so the manual-only world renders exactly as before.
 *
 * `foundingPricing` is the server-resolved answer the plan picker MUST use
 * for its Pro price — reading `foundingIntent` client-side would show a
 * lapsed founding member the discount while `subscribeSelf` bills list
 * (the silent price divergence this field exists to prevent);
 * `foundingPricingLapsed` powers the one-line explanation instead.
 */
export const billingGatewayAvailable = query({
	args: {},
	handler: async (
		ctx,
	): Promise<{
		payNow: boolean;
		autoRenew: boolean;
		methods: string[];
		currency: BillingCurrency;
		foundingPricing: boolean;
		foundingPricingLapsed: boolean;
	} | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return null;
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.first();
		const available = billingCredentials() !== null;
		const currency = BILLING_CURRENCY_FOR_COUNTRY[retailer.country ?? "MY"];
		const foundingShaped =
			retailer.isFoundingMember === true || sub?.foundingIntent === true;
		const foundingPricing =
			sub !== null &&
			foundingPricingApplies({
				plan: "pro", // the picker's founding-priced tier
				isFoundingMember: retailer.isFoundingMember === true,
				foundingIntent: sub.foundingIntent === true,
				paidThrough: sub.currentPeriodEnd,
				now: Date.now(),
			});
		return {
			payNow: available,
			autoRenew: available,
			methods: AUTO_RENEW_METHODS[currency],
			currency,
			foundingPricing,
			foundingPricingLapsed: foundingShaped && !foundingPricing,
		};
	},
});

/** Admin: which retailers are on the auto-renewal rail, and who is failing —
 * the ticket's "see which retailers are on which rail" view. Bounded by the
 * subscription count (tiny at current scale, same posture as listPending). */
export const listAutoRenewForAdmin = query({
	args: {},
	handler: async (
		ctx,
	): Promise<
		Array<{
			retailerId: Id<"retailers">;
			storeName: string;
			slug: string;
			method: string;
			methodLabel: string;
			attachedAt: number;
			lastChargeAt?: number;
			failedAttempts: number;
			nextRetryAt?: number;
			lastChargeError?: string;
		}>
	> => {
		await requireAdmin(ctx);
		const subs = await ctx.db.query("subscriptions").collect();
		const rows = [];
		for (const sub of subs) {
			if (!sub.autoRenew) continue;
			const retailer = await ctx.db.get(sub.retailerId);
			if (!retailer) continue;
			rows.push({
				retailerId: sub.retailerId,
				storeName: retailer.storeName,
				slug: retailer.slug,
				method: sub.autoRenew.method,
				methodLabel:
					sub.autoRenew.methodLabel ??
					autoRenewMethodLabel(sub.autoRenew.method),
				attachedAt: sub.autoRenew.attachedAt,
				lastChargeAt: sub.autoRenew.lastChargeAt,
				failedAttempts: sub.autoRenew.failedAttempts ?? 0,
				nextRetryAt: sub.autoRenew.nextRetryAt,
				lastChargeError: sub.autoRenew.lastChargeError,
			});
		}
		// Failing first, then most recently attached.
		return rows.sort(
			(a, b) =>
				b.failedAttempts - a.failedAttempts || b.attachedAt - a.attachedAt,
		);
	},
});

// ---------------------------------------------------------------------------
// Pay-now link on invoices
// ---------------------------------------------------------------------------

export const invoicePaymentContext = internalQuery({
	args: { invoiceId: v.id("invoices") },
	handler: async (
		ctx,
		{ invoiceId },
	): Promise<{
		status: string;
		alreadyMinted: boolean;
		invoiceNumber: string;
		totalSen: number;
		currency: string;
		storeName: string;
		notifyEmail: string | undefined;
	} | null> => {
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) return null;
		const retailer = await ctx.db.get(invoice.retailerId);
		if (!retailer) return null;
		return {
			status: invoice.status,
			alreadyMinted: invoice.gatewayRequestId !== undefined,
			invoiceNumber: invoice.invoiceNumber,
			totalSen: invoice.total,
			currency: invoice.currency,
			storeName: retailer.storeName,
			notifyEmail: retailer.notifyEmail,
		};
	},
});

export const recordInvoiceRequest = internalMutation({
	args: {
		invoiceId: v.id("invoices"),
		requestId: v.string(),
		url: v.string(),
	},
	handler: async (
		ctx,
		{ invoiceId, requestId, url },
	): Promise<{ ok: boolean }> => {
		const invoice = await ctx.db.get(invoiceId);
		// Settled/voided while the mint was on the wire → don't store; the
		// caller kills the orphaned request (`ok: false`).
		if (!invoice || invoice.status !== "pending") return { ok: false };
		// Double-scheduled mint — keep the first, kill this one.
		if (invoice.gatewayRequestId) return { ok: false };
		await ctx.db.patch(invoiceId, {
			gatewayRequestId: requestId,
			gatewayPayment: { provider: "hitpay", url },
		});
		return { ok: true };
	},
});

/**
 * Mint the invoice's Pay-now payment request. Scheduled by every issuance
 * path; a no-op without gateway credentials, idempotent per invoice, and a
 * failure is only a log line — the invoice already went out on the manual
 * rail. The request carries NO expiry (it lives in emails) and dies via
 * DELETE when the invoice is voided or settled out-of-band.
 */
export const mintInvoicePaymentRequest = internalAction({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<void> => {
		const credentials = billingCredentials();
		if (!credentials) return;
		const context = await ctx.runQuery(
			internal.subscriptionPayments.invoicePaymentContext,
			{ invoiceId },
		);
		if (!context || context.status !== "pending" || context.alreadyMinted)
			return;

		const siteUrl = process.env.CONVEX_SITE_URL;
		const params = buildInvoicePaymentRequestParams({
			invoiceNumber: context.invoiceNumber,
			storeName: context.storeName,
			amountSen: context.totalSen,
			currency: context.currency,
			redirectUrl: billingPageUrl("paid=return"),
			webhookUrl: siteUrl ? `${siteUrl}/webhook/hitpay` : "",
			customerEmail: context.notifyEmail,
		});
		let response: Response;
		try {
			response = await fetch(
				`${HITPAY_API_BASE[credentials.mode]}/payment-requests`,
				{
					method: "POST",
					headers: hitpayHeaders(credentials),
					body: params.toString(),
				},
			);
		} catch (err) {
			console.error("[billing] Pay-now mint failed (network)", {
				invoiceNumber: context.invoiceNumber,
				err: err instanceof Error ? err.message : String(err),
			});
			return;
		}
		if (!response.ok) {
			console.error("[billing] Pay-now mint rejected", {
				invoiceNumber: context.invoiceNumber,
				status: response.status,
				body: (await response.text()).slice(0, 300),
			});
			return;
		}
		const request = (await response.json()) as {
			id?: string;
			url?: string;
			payment_methods?: string[];
		};
		if (!request.id || !request.url) {
			console.error("[billing] Pay-now mint malformed response", {
				invoiceNumber: context.invoiceNumber,
			});
			return;
		}
		// The response echoes the ACCOUNT's resolved methods for this currency.
		// An explicit EMPTY list means the checkout page would render dead
		// ("Awaiting customer present card", sandbox-observed 11 Sep on an SGD
		// request with no SGD rails enabled) — don't store the link: no button
		// beats a dead button, and the invoice stays on the manual rail. An
		// absent field is treated as "no information", same as the BYO probe.
		if (request.payment_methods !== undefined && request.payment_methods.length === 0) {
			console.error(
				"[billing] Pay-now mint has NO usable payment methods for this currency — link not stored; enable a method on the HitPay account",
				{ invoiceNumber: context.invoiceNumber, currency: context.currency },
			);
			// HitPay already created it; a request we refuse to store is one no
			// void or settle path can ever reach, so kill it here or it stays
			// live and payable forever (these carry no expiry).
			await expireRequest(credentials, request.id);
			return;
		}
		const stored: { ok: boolean } = await ctx.runMutation(
			internal.subscriptionPayments.recordInvoiceRequest,
			{ invoiceId, requestId: request.id, url: request.url },
		);
		if (!stored.ok) {
			// Settled/voided under us, or a link already stored. Same reasoning:
			// an unstored request is unreachable by every later cleanup path.
			await expireRequest(credentials, request.id);
		}
	},
});

/** Re-mint a Pay-now link after a declined auto-charge killed it. Clears the
 * dead id first so the mint's already-minted guard doesn't refuse. */
export const remintInvoicePaymentRequest = internalAction({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<void> => {
		await ctx.runMutation(internal.subscriptionPayments.clearInvoiceRequest, {
			invoiceId,
		});
		await ctx.runAction(
			internal.subscriptionPayments.mintInvoicePaymentRequest,
			{ invoiceId },
		);
	},
});

export const clearInvoiceRequest = internalMutation({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<void> => {
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice || invoice.status !== "pending") return;
		await ctx.db.patch(invoiceId, {
			gatewayRequestId: undefined,
			gatewayPayment: undefined,
		});
	},
});

/** Kill an invoice's Pay-now request at HitPay (void / settled out-of-band).
 * Best-effort: DELETE on an already-completed request fails, and that's fine
 * — a payment that slipped through lands as a `late_payment` audit stamp. */
/** DELETE a payment request at HitPay. Plain helper so the mint can kill a
 * request it just created without hopping through the scheduler — an orphan
 * must die in the same action that orphaned it. Best-effort by contract. */
async function expireRequest(
	credentials: BillingGatewayCredentials,
	requestId: string,
): Promise<void> {
	try {
		const response = await fetch(
			`${HITPAY_API_BASE[credentials.mode]}/payment-requests/${requestId}`,
			{
				method: "DELETE",
				headers: {
					"X-BUSINESS-API-KEY": credentials.apiKey,
					"X-Requested-With": "XMLHttpRequest",
				},
			},
		);
		if (!response.ok) {
			console.warn("[billing] Pay-now link delete rejected", {
				requestId,
				status: response.status,
			});
		}
	} catch (err) {
		console.warn("[billing] Pay-now link delete failed", {
			requestId,
			err: err instanceof Error ? err.message : String(err),
		});
	}
}

export const expireInvoiceRequest = internalAction({
	args: { requestId: v.string() },
	handler: async (_ctx, { requestId }): Promise<void> => {
		const credentials = billingCredentials();
		if (!credentials) return;
		try {
			const response = await fetch(
				`${HITPAY_API_BASE[credentials.mode]}/payment-requests/${requestId}`,
				{
					method: "DELETE",
					headers: {
						"X-BUSINESS-API-KEY": credentials.apiKey,
						"X-Requested-With": "XMLHttpRequest",
					},
				},
			);
			if (!response.ok) {
				console.warn("[billing] Pay-now link delete rejected", {
					requestId,
					status: response.status,
				});
			}
		} catch (err) {
			console.warn("[billing] Pay-now link delete failed", {
				requestId,
				err: err instanceof Error ? err.message : String(err),
			});
		}
	},
});

/** The caller's own pending invoice with a minted Pay-now request — the
 * redirect-return reconcile's read. */
export const myPendingGatewayInvoice = internalQuery({
	args: { userId: v.string() },
	handler: async (
		ctx,
		{ userId },
	): Promise<{ invoiceId: Id<"invoices">; requestId: string } | null> => {
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!retailer) return null;
		const pending = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.filter((q) => q.eq(q.field("status"), "pending"))
			.first();
		if (!pending?.gatewayRequestId) return null;
		return { invoiceId: pending._id, requestId: pending.gatewayRequestId };
	},
});

/**
 * Redirect-return reconcile for the invoice Pay-now link — the seller lands
 * back on the billing tab after HitPay's checkout; ask HitPay's status API
 * whether the request settled rather than trusting the trip (the buyer
 * gateway's lost-webhook lesson, PR #172). Settles through the same
 * idempotent gateway path, so racing the webhook is a harmless duplicate.
 */
export const verifyInvoicePayment = action({
	args: {},
	handler: async (ctx): Promise<{ settled: boolean }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		await rateLimiter.limit(ctx, "billingSelfServe", {
			key: identity.subject,
			throws: true,
		});
		const credentials = billingCredentials();
		if (!credentials) return { settled: false };
		const pending = await ctx.runQuery(
			internal.subscriptionPayments.myPendingGatewayInvoice,
			{ userId: identity.subject },
		);
		if (!pending) return { settled: false };

		let response: Response;
		try {
			response = await fetch(
				`${HITPAY_API_BASE[credentials.mode]}/payment-requests/${pending.requestId}`,
				{
					headers: {
						"X-BUSINESS-API-KEY": credentials.apiKey,
						"X-Requested-With": "XMLHttpRequest",
					},
				},
			);
		} catch {
			return { settled: false };
		}
		if (!response.ok) return { settled: false };
		const request = (await response.json()) as {
			payments?: Array<{
				id: string;
				status: string;
				amount: string;
				currency: string;
				payment_type?: string;
			}>;
		};
		const payment = request.payments?.find((p) => p.status === "succeeded");
		if (!payment) return { settled: false };
		const amountSen = decimalStringToSen(payment.amount);
		if (amountSen === null) return { settled: false };
		const result: { applied: boolean; reason?: string } = await ctx.runMutation(
			internal.invoices.internalSettleFromGateway,
			{
				invoiceId: pending.invoiceId,
				paymentId: payment.id,
				amountSen,
				currency: payment.currency,
				methodCode: payment.payment_type,
			},
		);
		return { settled: result.applied || result.reason === "duplicate" };
	},
});

/** Webhook correlation for the v1 form branch: payment-request id → invoice. */
export const resolveInvoiceRequestContext = internalQuery({
	args: { paymentRequestId: v.string() },
	handler: async (
		ctx,
		{ paymentRequestId },
	): Promise<{ invoiceId: Id<"invoices"> } | null> => {
		const invoice = await ctx.db
			.query("invoices")
			.withIndex("by_gateway_request", (q) =>
				q.eq("gatewayRequestId", paymentRequestId),
			)
			.first();
		return invoice ? { invoiceId: invoice._id } : null;
	},
});

// ---------------------------------------------------------------------------
// Auto-renewal — authorisation
// ---------------------------------------------------------------------------

export const autoRenewSetupContext = internalQuery({
	args: { userId: v.string() },
	handler: async (
		ctx,
		{ userId },
	): Promise<{
		retailerId: Id<"retailers">;
		subscriptionId: Id<"subscriptions">;
		storeName: string;
		notifyEmail: string | undefined;
		currency: BillingCurrency;
		plan: Doc<"subscriptions">["plan"];
		comped: boolean;
		founding: boolean;
		attached: boolean;
		existingSetup: Doc<"subscriptions">["autoRenewSetup"] | null;
		existingSessionId: string | undefined;
		/** The seller's open bill, when one exists — the authorisation page then
		 * displays THAT amount (it is what attach will immediately charge). */
		pendingInvoiceId: Id<"invoices"> | undefined;
		pendingInvoiceTotalSen: number | undefined;
		pendingInvoiceCurrency: string | undefined;
		/** The plan being BILLED (invoices carry it; the sub's own `plan` is
		 * still the OLD tier until settle — every trial row says "pro"). */
		pendingInvoicePlan: Doc<"subscriptions">["plan"] | undefined;
	} | null> => {
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		if (!retailer) return null;
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.first();
		if (!sub) return null;
		const pending = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.filter((q) => q.eq(q.field("status"), "pending"))
			.first();
		return {
			retailerId: retailer._id,
			subscriptionId: sub._id,
			storeName: retailer.storeName,
			notifyEmail: retailer.notifyEmail,
			currency: BILLING_CURRENCY_FOR_COUNTRY[retailer.country ?? "MY"],
			plan: sub.plan,
			comped: sub.comped === true,
			// Display amount on HitPay's page mirrors what the next bill will
			// actually be — founding pricing honours the 3-month lapse window.
			founding: foundingPricingApplies({
				plan: sub.plan,
				isFoundingMember: retailer.isFoundingMember === true,
				foundingIntent: sub.foundingIntent === true,
				paidThrough: sub.currentPeriodEnd,
				now: Date.now(),
			}),
			attached: sub.autoRenew !== undefined,
			existingSetup: sub.autoRenewSetup ?? null,
			existingSessionId: sub.autoRenewSessionId,
			pendingInvoiceId: pending?._id,
			pendingInvoiceTotalSen: pending?.total,
			pendingInvoiceCurrency: pending?.currency,
			pendingInvoicePlan: pending?.plan,
		};
	},
});

export const recordAutoRenewSession = internalMutation({
	args: {
		subscriptionId: v.id("subscriptions"),
		sessionId: v.string(),
		url: v.string(),
		// What the page at `url` displays — the consent record attach checks
		// against before charging anything. Absent ⇒ the page promised no
		// charge today.
		invoiceId: v.optional(v.id("invoices")),
		amountSen: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{ subscriptionId, sessionId, url, invoiceId, amountSen },
	): Promise<void> => {
		const sub = await ctx.db.get(subscriptionId);
		if (!sub) return;
		// No `updatedAt` — for a past_due row that field IS the lock-flip moment
		// the founder report reads (docs/shipped-log.md).
		await ctx.db.patch(subscriptionId, {
			autoRenewSessionId: sessionId,
			autoRenewSetup: { url, createdAt: Date.now(), invoiceId, amountSen },
		});
	},
});

/**
 * Seller: start (or resume) auto-renewal setup. Mints a HitPay
 * recurring-billing session with `save_payment_method=true` and returns the
 * hosted authorisation URL to redirect to; the seller picks card / Touch 'n
 * Go there and lands back on the billing tab. Attachment is recorded by the
 * `method_attached` webhook or the redirect-return reconcile
 * (finishAutoRenewSetup) — whichever wins.
 */
export const startAutoRenewSetup = action({
	args: {},
	handler: async (ctx): Promise<{ url: string }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		await rateLimiter.limit(ctx, "billingSelfServe", {
			key: identity.subject,
			throws: true,
		});
		const credentials = billingCredentials();
		if (!credentials) {
			throw new ConvexError(
				"Auto-renewal isn't available right now — you can still pay each invoice from its Pay-now link.",
			);
		}
		const context = await ctx.runQuery(
			internal.subscriptionPayments.autoRenewSetupContext,
			{ userId: identity.subject },
		);
		if (!context) throw new ConvexError("No store found for your account");
		if (context.comped)
			throw new ConvexError("Your account is on the house — nothing to set up.");
		if (context.attached)
			throw new ConvexError("Auto-renewal is already on for your store.");

		// Resume a fresh unfinished session — but ONLY while the page it points
		// at still tells the truth. The amount and the "nothing is charged
		// today" line were baked in when it was minted; if the seller's open
		// bill has since appeared, changed, or been voided-and-reissued, that
		// page would collect consent for one amount and attach would charge
		// another. Mint a fresh one instead (the stale session is superseded
		// below).
		if (
			context.existingSetup &&
			Date.now() - context.existingSetup.createdAt < SETUP_RESUME_WINDOW_MS &&
			context.existingSetup.invoiceId === context.pendingInvoiceId &&
			context.existingSetup.amountSen === context.pendingInvoiceTotalSen
		) {
			return { url: context.existingSetup.url };
		}

		const email =
			context.notifyEmail ??
			(typeof identity.email === "string" ? identity.email : undefined);
		if (!email) {
			throw new ConvexError(
				"Add a notification email in Settings → WhatsApp first — HitPay needs an email for your saved method.",
			);
		}

		// The plan being BILLED — the sub's own `plan` is the OLD tier until
		// settle (every trial row reads "pro"), so titling the authorisation
		// page from it shows "Kedaipal Pro" above a Starter amount.
		const billedPlan = context.pendingInvoicePlan ?? context.plan;
		const planLabel = `${billedPlan.charAt(0).toUpperCase()}${billedPlan.slice(1)}`;
		const chargesToday = context.pendingInvoiceTotalSen !== undefined;
		const inputs = {
			planLabel,
			storeName: context.storeName,
			// HitPay's page button always reads "Pay {amount}" — this line under
			// the plan name is our only way to tell the seller whether money
			// moves today (subscribe flow) or only at the next renewal (opt-in
			// from an already-paid plan).
			description: chargesToday
				? "Kedaipal subscription — pay & save your method for auto-renewal"
				: "Auto-renewal setup — nothing is charged today; renewals bill automatically",
			customerEmail: email,
			// The store name is the customer identity on HitPay's dashboard —
			// without it the Subscriptions list reads "N/A" (sandbox, 11 Sep).
			customerName: context.storeName,
			// Show the amount attach will actually charge: the open bill when one
			// exists (the subscribe-with-auto-renewal flow — possibly an annual
			// total), else the seller's current renewal price. Display-only
			// either way; charges always pass the invoice total at charge time.
			amountSen:
				context.pendingInvoiceTotalSen ??
				planPrice(context.plan, "monthly", context.founding, context.currency),
			currency:
				context.pendingInvoiceCurrency === "SGD" ||
				context.pendingInvoiceCurrency === "MYR"
					? context.pendingInvoiceCurrency
					: context.currency,
			redirectUrl: billingPageUrl("autorenew=return"),
			reference: context.subscriptionId,
		};
		// Offer the rails for the currency THIS SESSION bills in, not the
		// store's home currency — a MY store holding an SGD invoice was being
		// offered Touch 'n Go (MYR-only) against an SGD amount, and only
		// HitPay's 422 wording saved it from dead-ending.
		const methods = AUTO_RENEW_METHODS[inputs.currency];
		let result = await createRecurringSession(credentials, {
			...inputs,
			paymentMethods: methods,
		});
		// The account may not have OUR preferred rails enabled — sandbox proved
		// the assumption cuts both ways (a TnG-only account rejected card, a
		// card-only account would reject TnG). On a payment-methods rejection,
		// retry with the param OMITTED so HitPay offers whatever the ACCOUNT can
		// actually tokenise — the buyer gateway's omit-and-let-the-account-decide
		// posture. Log loudly so ops chases enablement of the missing rail.
		if (result.kind === "invalid_methods") {
			console.error(
				"[billing] auto-renew session rejected our method list — retrying with the account's own set",
				{ methods, providerMessage: result.message },
			);
			result = await createRecurringSession(credentials, {
				...inputs,
				paymentMethods: undefined,
			});
		}
		if (result.kind !== "ok") {
			throw new ConvexError(
				"Couldn't reach the payment service — try again in a moment.",
			);
		}
		const session = result.session;
		// Supersede any stale session so a forgotten link can't attach later.
		if (context.existingSessionId) {
			await ctx.scheduler.runAfter(
				0,
				internal.subscriptionPayments.deleteRecurringSession,
				{ sessionId: context.existingSessionId },
			);
		}
		await ctx.runMutation(internal.subscriptionPayments.recordAutoRenewSession, {
			subscriptionId: context.subscriptionId,
			sessionId: session.id,
			url: session.url,
			// The consent record: what this page shows is what attach may charge.
			invoiceId: context.pendingInvoiceId,
			amountSen: context.pendingInvoiceTotalSen,
		});
		return { url: session.url };
	},
});

type CreateSessionResult =
	| { kind: "ok"; session: { id: string; url: string } }
	// HitPay 422'd specifically on `payment_methods` — the account doesn't have
	// (all of) our preferred rails; the caller retries with the param omitted.
	| { kind: "invalid_methods"; message: string }
	| { kind: "failed" };

async function createRecurringSession(
	credentials: BillingGatewayCredentials,
	inputs: Parameters<typeof buildAutoRenewSessionParams>[0],
): Promise<CreateSessionResult> {
	let response: Response;
	try {
		response = await fetch(
			`${HITPAY_API_BASE[credentials.mode]}/recurring-billing`,
			{
				method: "POST",
				headers: hitpayHeaders(credentials),
				body: buildAutoRenewSessionParams(inputs).toString(),
			},
		);
	} catch (err) {
		console.error("[billing] recurring session create failed (network)", {
			err: err instanceof Error ? err.message : String(err),
		});
		return { kind: "failed" };
	}
	if (!response.ok) {
		const body = (await response.text()).slice(0, 500);
		console.error("[billing] recurring session create rejected", {
			status: response.status,
			body: body.slice(0, 300),
		});
		if (response.status === 422 && body.includes("payment_methods")) {
			return { kind: "invalid_methods", message: body.slice(0, 200) };
		}
		return { kind: "failed" };
	}
	const session = (await response.json()) as { id?: string; url?: string };
	if (!session.id || !session.url) {
		console.error("[billing] recurring session malformed response");
		return { kind: "failed" };
	}
	return { kind: "ok", session: { id: session.id, url: session.url } };
}

/**
 * Redirect-return reconcile: the seller lands back on the billing tab after
 * HitPay's authorisation page — never trust the trip, ask HitPay. The
 * method_attached webhook usually wins this race; both funnel into
 * recordMethodAttached, which is idempotent-by-overwrite.
 */
export const finishAutoRenewSetup = action({
	args: {},
	handler: async (ctx): Promise<{ attached: boolean }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		await rateLimiter.limit(ctx, "billingSelfServe", {
			key: identity.subject,
			throws: true,
		});
		const context = await ctx.runQuery(
			internal.subscriptionPayments.autoRenewSetupContext,
			{ userId: identity.subject },
		);
		if (!context) throw new ConvexError("No store found for your account");
		if (context.attached) return { attached: true };
		const credentials = billingCredentials();
		if (!credentials || !context.existingSessionId) return { attached: false };

		const session = await fetchRecurringSession(
			credentials,
			context.existingSessionId,
		);
		if (!session || session.status !== "active") return { attached: false };
		await ctx.runMutation(internal.subscriptionPayments.recordMethodAttached, {
			billingId: context.existingSessionId,
			methodCode: session.paymentMethod,
			methodLabel: undefined,
		});
		return { attached: true };
	},
});

type RecurringSessionStatus = {
	status: string;
	timesCharged: number;
	paymentMethod: string | undefined;
};

async function fetchRecurringSession(
	credentials: BillingGatewayCredentials,
	sessionId: string,
): Promise<RecurringSessionStatus | null> {
	let response: Response;
	try {
		response = await fetch(
			`${HITPAY_API_BASE[credentials.mode]}/recurring-billing/${sessionId}`,
			{
				headers: {
					"X-BUSINESS-API-KEY": credentials.apiKey,
					"X-Requested-With": "XMLHttpRequest",
				},
			},
		);
	} catch (err) {
		console.error("[billing] recurring session fetch failed", {
			err: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
	if (!response.ok) {
		console.error("[billing] recurring session fetch rejected", {
			status: response.status,
		});
		return null;
	}
	const body = (await response.json()) as Record<string, unknown>;
	// Same reader the webhook uses — the GET response IS a recurring-billing
	// object, and reading only the docs' flat `payment_method` here is what
	// made the reconcile path record "card" for a Touch 'n Go wallet.
	return {
		status: typeof body.status === "string" ? body.status : "unknown",
		timesCharged:
			typeof body.times_charged === "number" ? body.times_charged : 0,
		paymentMethod: readAttachedMethodCode(body),
	};
}

/**
 * A payment method landed on the session (webhook or reconcile). Overwrite
 * semantics so whichever path runs second only refines the label. Any open
 * bill is charged straight away — see the owner-decision comment below.
 * (No `updatedAt` on any patch here — the past_due flip-moment invariant,
 * docs/shipped-log.md.)
 */
async function applyMethodAttached(
	ctx: MutationCtx,
	{
		billingId,
		methodCode,
		methodLabel,
	}: { billingId: string; methodCode?: string; methodLabel?: string },
): Promise<{ applied: boolean }> {
	const sub = await ctx.db
		.query("subscriptions")
		.withIndex("by_autorenew_session", (q) =>
			q.eq("autoRenewSessionId", billingId),
		)
		.first();
	if (!sub) return { applied: false };
	const method = methodCode?.toLowerCase() ?? sub.autoRenew?.method ?? "card";
	await ctx.db.patch(sub._id, {
		autoRenew: {
			...(sub.autoRenew ?? {
				provider: "hitpay" as const,
				attachedAt: Date.now(),
			}),
			provider: "hitpay",
			method,
			methodLabel: methodLabel ?? sub.autoRenew?.methodLabel,
			attachedAt: sub.autoRenew?.attachedAt ?? Date.now(),
		},
		autoRenewSetup: undefined,
	});
	if (sub.autoRenew === undefined) {
		await ctx.scheduler.runAfter(0, internal.billingEmail.notifyAutoRenewEmail, {
			retailerId: sub.retailerId,
			key: "autoRenewEnabled",
			methodLabel: methodLabel ?? autoRenewMethodLabel(method),
			chargeAt: sub.currentPeriodEnd,
		});
	}
	// Attach charges the open bill immediately (owner decision, Zaki 11 Sep
	// 2026): authorising the method IS the consent. That makes the subscribe
	// flow Netflix-shaped (pick plan → authorise once → charged + auto-
	// renewing) and heals a mid-dunning store without waiting a cron day.
	//
	// TWO guards make "authorising IS the consent" actually true:
	//  1. FIRST ATTACH ONLY. This helper runs for every attach signal — the
	//     webhook, its retries, AND the redirect reconcile — so charging on
	//     each one races two charges onto the same bill (each sees the invoice
	//     still pending, and the in-flight charge hasn't moved HitPay's
	//     times_charged yet, so the reconcile guard waves the second through).
	//  2. THE BILL THE PAGE SHOWED. `autoRenewSetup` recorded the invoice and
	//     amount displayed at mint time; anything else — a renewal issued while
	//     the seller sat on HitPay's page, an admin invoice voided and
	//     reissued, or a bill that simply didn't exist when the page promised
	//     "nothing is charged today" — is NOT consented to. It stays for the
	//     cron/Pay-now rail, which is exactly where an unconsented bill belongs.
	const firstAttach = sub.autoRenew === undefined;
	const displayed = sub.autoRenewSetup;
	if (firstAttach && displayed?.invoiceId !== undefined) {
		const pending = await ctx.db.get(displayed.invoiceId);
		if (
			pending &&
			pending.status === "pending" &&
			pending.total === displayed.amountSen
		) {
			await ctx.scheduler.runAfter(
				0,
				internal.subscriptionPayments.chargeDueRenewal,
				{ invoiceId: pending._id },
			);
		} else {
			console.warn(
				"[billing] attach did not charge — the open bill is not the one the authorisation page displayed",
				{
					retailerId: sub.retailerId,
					displayedInvoiceId: displayed.invoiceId,
					displayedAmountSen: displayed.amountSen,
					actualStatus: pending?.status,
					actualTotal: pending?.total,
				},
			);
		}
	}
	return { applied: true };
}

export const recordMethodAttached = internalMutation({
	args: {
		billingId: v.string(),
		methodCode: v.optional(v.string()),
		methodLabel: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<{ applied: boolean }> =>
		applyMethodAttached(ctx, args),
});

/** The saved method was removed at HitPay's side (seller, support, or the
 * scheme). Auto-renewal is off; the manual rail (Pay-now + bank) carries on. */
async function applyMethodDetached(
	ctx: MutationCtx,
	billingId: string,
): Promise<{ applied: boolean }> {
	const sub = await ctx.db
		.query("subscriptions")
		.withIndex("by_autorenew_session", (q) =>
			q.eq("autoRenewSessionId", billingId),
		)
		.first();
	if (!sub || sub.autoRenew === undefined) return { applied: false };
	await ctx.db.patch(sub._id, {
		autoRenew: undefined,
		autoRenewSetup: undefined,
		autoRenewSessionId: undefined,
	});
	console.warn("[billing] auto-renew method detached at HitPay", {
		retailerId: sub.retailerId,
	});
	return { applied: true };
}

export const recordMethodDetached = internalMutation({
	args: { billingId: v.string() },
	handler: async (ctx, { billingId }): Promise<{ applied: boolean }> =>
		applyMethodDetached(ctx, billingId),
});

/**
 * Seller: turn auto-renewal off. ALWAYS allowed, never gated (the
 * downgrade-never-traps rule) — and structurally safe even if the remote
 * delete fails, because every charge is merchant-initiated by us: no
 * `autoRenew` on the sub ⇒ no charge is ever fired. Renewals fall back to
 * the invoice + Pay-now flow.
 */
export const cancelAutoRenew = mutation({
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
		if (!sub) return { ok: true };
		const sessionId = sub.autoRenewSessionId;
		if (sub.autoRenew !== undefined || sub.autoRenewSetup !== undefined) {
			await ctx.db.patch(sub._id, {
				autoRenew: undefined,
				autoRenewSetup: undefined,
				autoRenewSessionId: undefined,
			});
		}
		if (sessionId) {
			await ctx.scheduler.runAfter(
				0,
				internal.subscriptionPayments.deleteRecurringSession,
				{ sessionId },
			);
		}
		return { ok: true };
	},
});

/** Best-effort remote cleanup of a recurring-billing session (cancel /
 * supersede). Failure is a log line — with no local `autoRenew`, nothing
 * charges regardless. */
export const deleteRecurringSession = internalAction({
	args: { sessionId: v.string() },
	handler: async (_ctx, { sessionId }): Promise<void> => {
		const credentials = billingCredentials();
		if (!credentials) return;
		try {
			const response = await fetch(
				`${HITPAY_API_BASE[credentials.mode]}/recurring-billing/${sessionId}`,
				{
					method: "DELETE",
					headers: {
						"X-BUSINESS-API-KEY": credentials.apiKey,
						"X-Requested-With": "XMLHttpRequest",
					},
				},
			);
			if (!response.ok) {
				console.warn("[billing] recurring session delete rejected", {
					sessionId,
					status: response.status,
				});
			}
		} catch (err) {
			console.warn("[billing] recurring session delete failed", {
				sessionId,
				err: err instanceof Error ? err.message : String(err),
			});
		}
	},
});

// ---------------------------------------------------------------------------
// Auto-renewal — charging + dunning
// ---------------------------------------------------------------------------

export const chargeContext = internalQuery({
	args: { invoiceId: v.id("invoices") },
	handler: async (
		ctx,
		{ invoiceId },
	): Promise<{
		invoiceStatus: string;
		invoiceNumber: string;
		totalSen: number;
		currency: string;
		subscriptionId: Id<"subscriptions">;
		sessionId: string | undefined;
		autoRenew: Doc<"subscriptions">["autoRenew"];
		/** The invoice's live Pay-now request, killed while we charge. */
		gatewayRequestId: string | undefined;
	} | null> => {
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) return null;
		const sub = await ctx.db.get(invoice.subscriptionId);
		if (!sub) return null;
		return {
			invoiceStatus: invoice.status,
			invoiceNumber: invoice.invoiceNumber,
			totalSen: invoice.total,
			currency: invoice.currency,
			subscriptionId: sub._id,
			sessionId: sub.autoRenewSessionId,
			autoRenew: sub.autoRenew,
			gatewayRequestId: invoice.gatewayRequestId,
		};
	},
});

/** Stamp "a charge is about to fire" BEFORE the HTTP call, so a crash between
 * charge and settle is detectable (and reconciled) instead of double-charged. */
export const recordChargeAttempt = internalMutation({
	args: {
		subscriptionId: v.id("subscriptions"),
		invoiceId: v.id("invoices"),
	},
	handler: async (
		ctx,
		{ subscriptionId, invoiceId },
	): Promise<{ claimed: boolean }> => {
		const sub = await ctx.db.get(subscriptionId);
		if (!sub?.autoRenew) return { claimed: false };
		// MUTEX, not just a stamp. Convex mutations are serializable, so this
		// read-then-patch is the one place two concurrent charge actions can be
		// made to disagree: whoever patches first owns the attempt, the loser
		// is told to stand down. Without it, two schedulers (attach webhook +
		// redirect reconcile, or cron + heal) both POST — and the
		// outcome-unknown reconcile can't save us, because while charge A is
		// still in flight HitPay's times_charged hasn't moved yet, so charge B
		// reads "remote not ahead" and charges anyway.
		const inFlight =
			sub.autoRenew.lastChargeAttemptAt !== undefined &&
			Date.now() - sub.autoRenew.lastChargeAttemptAt <
				CHARGE_OUTCOME_UNKNOWN_WINDOW_MS;
		if (inFlight) {
			console.warn("[billing] charge attempt refused — one already in flight", {
				subscriptionId,
				invoiceId,
				pendingChargeInvoiceId: sub.autoRenew.pendingChargeInvoiceId,
			});
			return { claimed: false };
		}
		await ctx.db.patch(subscriptionId, {
			autoRenew: {
				...sub.autoRenew,
				lastChargeAttemptAt: Date.now(),
				pendingChargeInvoiceId: invoiceId,
			},
		});
		return { claimed: true };
	},
});

export const recordChargeFailure = internalMutation({
	args: {
		subscriptionId: v.id("subscriptions"),
		invoiceId: v.id("invoices"),
		error: v.string(),
		// "declined" = HitPay answered no (count it, dun the seller).
		// "unknown" = we never heard back (don't count it; reconcile + retry
		// tomorrow — the seller is never emailed over our own network blip).
		outcome: v.union(v.literal("declined"), v.literal("unknown")),
	},
	handler: async (
		ctx,
		{ subscriptionId, invoiceId, error, outcome },
	): Promise<void> => {
		const sub = await ctx.db.get(subscriptionId);
		if (!sub?.autoRenew) return;
		const now = Date.now();
		if (outcome === "unknown") {
			// Keep the attempt stamp (so the next run reconciles before charging)
			// and make sure SOMETHING retries even without a status flip.
			await ctx.db.patch(subscriptionId, {
				autoRenew: {
					...sub.autoRenew,
					nextRetryAt: sub.autoRenew.nextRetryAt ?? now + 24 * 60 * 60 * 1000,
					lastChargeError: error,
				},
			});
			return;
		}
		const failedAttempts = (sub.autoRenew.failedAttempts ?? 0) + 1;
		const nextRetry = nextChargeRetryAt(failedAttempts, now);
		await ctx.db.patch(subscriptionId, {
			autoRenew: {
				...sub.autoRenew,
				failedAttempts,
				nextRetryAt: nextRetry ?? undefined,
				lastChargeError: error,
				lastChargeAttemptAt: undefined,
				pendingChargeInvoiceId: undefined,
			},
		});
		await ctx.scheduler.runAfter(0, internal.billingEmail.notifyAutoRenewEmail, {
			retailerId: sub.retailerId,
			key: "autoRenewFailed",
			invoiceId,
			methodLabel:
				sub.autoRenew.methodLabel ?? autoRenewMethodLabel(sub.autoRenew.method),
			final: nextRetry === null,
		});
		// The charge killed the invoice's Pay-now link to close the
		// double-payment window; a decline means the seller needs it back —
		// the failure email's whole CTA is "pay it yourself". Idempotent: the
		// mint no-ops when a link is already stored.
		await ctx.scheduler.runAfter(
			0,
			internal.subscriptionPayments.remintInvoicePaymentRequest,
			{ invoiceId },
		);
	},
});

/**
 * Charge the invoice total against the saved method — the auto-renewal
 * moment. Scheduled by the renewal cron, the retry sweep, and heal-on-attach.
 * Money rules:
 *  - charge the INVOICE total at charge time, never a cached plan amount;
 *  - never fire when a recent attempt's outcome is unknown — reconcile
 *    against HitPay's `times_charged` first (settle if it already went
 *    through), so a crashed action can't become a double charge;
 *  - the synchronous response is the verdict: succeeded → settle through the
 *    markPaid path; anything else → Kedaipal-owned dunning
 *    (recordChargeFailure), with the Pay-now link always live as the way out.
 */
export const chargeDueRenewal = internalAction({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<void> => {
		const credentials = billingCredentials();
		if (!credentials) return;
		const context = await ctx.runQuery(
			internal.subscriptionPayments.chargeContext,
			{ invoiceId },
		);
		if (!context) return;
		if (context.invoiceStatus !== "pending") return; // settled/voided meanwhile
		const { autoRenew, sessionId } = context;
		if (!autoRenew || !sessionId) return; // turned off meanwhile — manual rail

		// Outcome-unknown guard: a fresh attempt stamp with no recorded result
		// means a previous action may have charged and died. Ask HitPay how many
		// charges the session has taken; if it moved past our counter, that money
		// is real — settle it, don't charge again.
		if (
			autoRenew.lastChargeAttemptAt !== undefined &&
			Date.now() - autoRenew.lastChargeAttemptAt <
				CHARGE_OUTCOME_UNKNOWN_WINDOW_MS
		) {
			const session = await fetchRecurringSession(credentials, sessionId);
			if (session === null) return; // can't judge — try again next sweep
			if (session.timesCharged > (autoRenew.timesCharged ?? 0)) {
				console.warn(
					"[billing] reconciled an untracked charge — settling without re-charging",
					{ invoiceNumber: context.invoiceNumber, sessionId },
				);
				await ctx.runMutation(internal.invoices.internalSettleFromGateway, {
					invoiceId,
					paymentId: `reconciled:${sessionId}:${session.timesCharged}`,
					amountSen: context.totalSen,
					currency: context.currency,
					methodCode: autoRenew.method,
				});
				return;
			}
			// Session never took the charge — fall through and charge normally.
		}

		const claim: { claimed: boolean } = await ctx.runMutation(
			internal.subscriptionPayments.recordChargeAttempt,
			{ subscriptionId: context.subscriptionId, invoiceId },
		);
		if (!claim.claimed) {
			// Another charge action owns this window (or the method vanished).
			// Standing down is always safe: the owner either settles the invoice
			// or records a failure, and the retry sweep picks it up from there.
			return;
		}
		// The seller must not be able to pay the same bill by hand while our
		// merchant-initiated charge is in flight — that window is the real
		// double-payment hazard (they are on HitPay's page, where no spinner of
		// ours can reach them). A decline re-mints the link, see
		// recordChargeFailure.
		if (context.gatewayRequestId) {
			await ctx.runAction(internal.subscriptionPayments.expireInvoiceRequest, {
				requestId: context.gatewayRequestId,
			});
		}

		let response: Response;
		try {
			response = await fetch(
				`${HITPAY_API_BASE[credentials.mode]}/charge/recurring-billing/${sessionId}`,
				{
					method: "POST",
					headers: hitpayHeaders(credentials),
					body: new URLSearchParams({
						amount: senToDecimalString(context.totalSen),
						currency: context.currency.toUpperCase(),
					}).toString(),
				},
			);
		} catch (err) {
			// Never heard back — the charge MAY have gone through. Leave the
			// attempt stamp so the next run reconciles before trying again.
			console.error("[billing] auto-charge failed (network)", {
				invoiceNumber: context.invoiceNumber,
				err: err instanceof Error ? err.message : String(err),
			});
			await ctx.runMutation(internal.subscriptionPayments.recordChargeFailure, {
				subscriptionId: context.subscriptionId,
				invoiceId,
				error: "network failure — outcome unknown",
				outcome: "unknown",
			});
			return;
		}

		if (response.ok) {
			const body = (await response.json()) as {
				payment_id?: string;
				status?: string;
			};
			if (body.status === "succeeded" && body.payment_id) {
				await ctx.runMutation(internal.invoices.internalSettleFromGateway, {
					invoiceId,
					paymentId: body.payment_id,
					amountSen: context.totalSen,
					currency: context.currency,
					methodCode: autoRenew.method,
				});
				console.info("[billing] auto-charge settled", {
					invoiceNumber: context.invoiceNumber,
				});
				return;
			}
			// 2xx but not succeeded — a decline in a success suit.
			await ctx.runMutation(internal.subscriptionPayments.recordChargeFailure, {
				subscriptionId: context.subscriptionId,
				invoiceId,
				error: `charge status: ${body.status ?? "missing"}`,
				outcome: "declined",
			});
			return;
		}

		const errorBody = (await response.text()).slice(0, 300);
		console.error("[billing] auto-charge rejected", {
			invoiceNumber: context.invoiceNumber,
			status: response.status,
			body: errorBody,
		});
		// 5xx from HitPay is indistinguishable from "processed but errored
		// rendering the response" — treat like a network blip (reconcile path);
		// a definitive 4xx is a decline.
		await ctx.runMutation(internal.subscriptionPayments.recordChargeFailure, {
			subscriptionId: context.subscriptionId,
			invoiceId,
			error: `HTTP ${response.status}: ${errorBody}`,
			outcome: response.status >= 500 ? "unknown" : "declined",
		});
	},
});

/** Webhook correlation for the recurring branch: billing-session id →
 * subscription + the invoice a charge event should settle. */
export const resolveRecurringContext = internalQuery({
	args: { billingId: v.string() },
	handler: async (
		ctx,
		{ billingId },
	): Promise<{
		subscriptionId: Id<"subscriptions">;
		retailerId: Id<"retailers">;
		settleInvoiceId: Id<"invoices"> | null;
		methodCode: string | undefined;
	} | null> => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_autorenew_session", (q) =>
				q.eq("autoRenewSessionId", billingId),
			)
			.first();
		if (!sub) return null;
		// Prefer the invoice a charge is in flight for; else the retailer's
		// single pending invoice (charge.created usually races the sync settle
		// and lands second as a duplicate no-op).
		const pendingCharge = sub.autoRenew?.pendingChargeInvoiceId ?? null;
		if (pendingCharge) {
			return {
				subscriptionId: sub._id,
				retailerId: sub.retailerId,
				settleInvoiceId: pendingCharge,
				methodCode: sub.autoRenew?.method,
			};
		}
		const pending = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", sub.retailerId))
			.filter((q) => q.eq(q.field("status"), "pending"))
			.first();
		return {
			subscriptionId: sub._id,
			retailerId: sub.retailerId,
			settleInvoiceId: pending?._id ?? null,
			methodCode: sub.autoRenew?.method,
		};
	},
});

/** Recurring-branch dispatcher for /webhook/hitpay (V2 JSON events). Kept
 * here (not in http.ts) so the route stays a thin verify-then-dispatch shell
 * like its siblings. Ack-everything posture: unresolvable events are logged
 * and dropped — the sync charge path is primary, webhooks are corroboration. */
export const applyRecurringEvent = internalMutation({
	args: {
		kind: v.union(
			v.literal("method_attached"),
			v.literal("method_detached"),
			v.literal("billing_status"),
		),
		billingId: v.string(),
		methodCode: v.optional(v.string()),
		methodLabel: v.optional(v.string()),
		status: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ kind, billingId, methodCode, methodLabel, status },
	): Promise<void> => {
		if (kind === "method_attached") {
			const result = await applyMethodAttached(ctx, {
				billingId,
				methodCode,
				methodLabel,
			});
			if (!result.applied) {
				console.log("[billing] attach event for unknown session", { billingId });
			}
			return;
		}
		if (kind === "method_detached") {
			await applyMethodDetached(ctx, billingId);
			return;
		}
		// subscription_updated: cancelled/expired at HitPay's side kills the
		// local saved-method state too (we could no longer charge it anyway).
		if (status === "canceled" || status === "cancelled" || status === "expired") {
			await applyMethodDetached(ctx, billingId);
			return;
		}
		console.log("[billing] recurring status event", { billingId, status });
	},
});
