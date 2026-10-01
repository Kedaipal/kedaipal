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
import {
	requireAdmin,
	requireRetailerAccess,
	resolveMyRetailerFor,
} from "./lib/auth";
import { sendEmail } from "./lib/email";
import { escapeHtml } from "./lib/emailCopy";
import {
	decimalStringToSen,
	HITPAY_API_BASE,
	senToDecimalString,
} from "./lib/hitpay";
import {
	type AdminAutoChargeState,
	AUTO_RENEW_METHODS,
	adminAutoChargeState,
	autoChargeAllowed,
	autoRenewMethodLabel,
	type BillingGatewayCredentials,
	buildAutoRenewSessionParams,
	buildInvoicePaymentRequestParams,
	CHARGE_ATTEMPT_LOCK_MS,
	nextChargeRetryAt,
	readAttachedMethodCode,
	readSessionChargeCount,
	resolveBillingGatewayCredentials,
} from "./lib/hitpayBilling";
import {
	BILLING_CURRENCY_FOR_COUNTRY,
	type BillingCurrency,
	foundingBenefitsAtRisk,
	foundingBenefitsEndAt,
	foundingPriceEligible,
	type RenewalQuote,
	renewalCurrency,
	renewalQuote,
} from "./lib/plans";
import { rateLimiter } from "./lib/rateLimiter";
import { HOLD_LABEL } from "./lib/seasonalHold";

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
 * Whether the online rails exist for the store, and with which methods, plus
 * every SERVER-resolved pricing fact the billing tab quotes. Presence booleans
 * only — credentials never leave the server. The billing tab hides Pay-now /
 * auto-renewal / the self-serve plan picker when this says off, so the
 * manual-only world renders exactly as before.
 *
 * Every price on the billing page is built from these fields and nothing the
 * client derives (z8r3fdfty4) — the page used to decide "founding?" three
 * ways, and only this one matched what the server bills:
 *  - `foundingPricing` — the store is on founding pricing (tier-agnostic,
 *    `foundingPriceEligible`). Reading `foundingIntent` client-side misses
 *    every member marked founding by admin and shows a lapsed one a discount
 *    `subscribeSelf` won't bill; `foundingPricingLapsed` powers the one-line
 *    explanation instead. A store on it is locked to Founding Pro.
 *  - `currency` — what a NEW self-serve subscription bills in (the country).
 *  - `renewalCurrency` — what renewals and plan changes bill in (the last
 *    paid invoice's currency, else the country).
 *  - `nextRenewal` — the renewal bill itself (`renewalQuote`, the author the
 *    cron's invoice and the heads-up email read), or null for a comped store
 *    or one with no subscription row.
 *
 * `retailerId` is the admin act-as path. Omitted, the query resolves the
 * CALLER's store — which, inside act-as, is the ADMIN's own: the tab then
 * priced a founding seller's plan at the admin's (list) rate and currency.
 * Owner-or-admin gated by `requireRetailerAccess`.
 */
export const billingGatewayAvailable = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		payNow: boolean;
		autoRenew: boolean;
		methods: string[];
		currency: BillingCurrency;
		renewalCurrency: BillingCurrency;
		foundingPricing: boolean;
		foundingPricingLapsed: boolean;
		/** Benefits ended for good (z8r3fdfyw5) — a DIFFERENT state from
		 * `foundingPricingLapsed`, and the ribbon copy must not conflate them:
		 * lapsed-not-yet-revoked is recoverable by paying (the period advances and
		 * the window reopens), revoked is not. Telling a revoked member to "renew
		 * to keep your founding price" would be a lie the billing page tells. */
		foundingBenefitsRevoked: boolean;
		/** When benefits end if this member never renews — drives the T-14
		 * warning banner and the date in the ribbon. Gated on
		 * `foundingBenefitsAtRisk`, the SAME predicate the cron's warn and revoke
		 * gates use, so the page can never count down to a deadline the pass will
		 * not enforce: undefined once revoked, for a member with no paid period,
		 * for a non-member, and for any store the pass skips (`active`,
		 * `on_hold`, `comped`). A comped founding member was otherwise shown a red
		 * "your founding price ends on …" alert that could never come true. */
		foundingBenefitsEndAt: number | undefined;
		nextRenewal: RenewalQuote | null;
	} | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		// Billing READ is grantable (86exr91r4): a member with billing:read sees
		// the same billing tab the owner does; without it, null → tab locked.
		const access = retailerId
			? await requireRetailerAccess(ctx, retailerId, {
					area: "billing",
					level: "read",
				})
			: await resolveMyRetailerFor(ctx, { area: "billing", level: "read" });
		const retailer = access?.retailer ?? null;
		if (!retailer) return null;
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.first();
		// Newest paid invoice only — `renewalCurrency` needs nothing else, and
		// this query stays live on the billing tab.
		const lastPaid = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.order("desc")
			.filter((q) => q.eq(q.field("status"), "paid"))
			.first();
		const available = billingCredentials() !== null;
		const now = Date.now();
		const currency = BILLING_CURRENCY_FOR_COUNTRY[retailer.country ?? "MY"];
		const foundingShaped =
			retailer.isFoundingMember === true || sub?.foundingIntent === true;
		const eligibility = sub
			? {
					isFoundingMember: retailer.isFoundingMember === true,
					benefitsRevokedAt: retailer.foundingBenefitsRevokedAt,
					benefitsRestoredAt: retailer.foundingBenefitsRestoredAt,
					foundingIntent: sub.foundingIntent === true,
					paidThrough: sub.currentPeriodEnd,
					now,
				}
			: null;
		const foundingPricing =
			eligibility !== null && foundingPriceEligible(eligibility);
		return {
			payNow: available,
			autoRenew: available,
			methods: AUTO_RENEW_METHODS[currency],
			currency,
			renewalCurrency: renewalCurrency({
				lastPaidCurrency: lastPaid?.currency,
				country: retailer.country,
			}),
			foundingPricing,
			foundingPricingLapsed: foundingShaped && !foundingPricing,
			foundingBenefitsRevoked:
				retailer.foundingBenefitsRevokedAt !== undefined,
			foundingBenefitsEndAt:
				retailer.isFoundingMember === true &&
				sub !== null &&
				foundingBenefitsAtRisk({
					status: sub.status,
					comped: sub.comped === true,
					paidThrough: sub.currentPeriodEnd,
					benefitsRevokedAt: retailer.foundingBenefitsRevokedAt,
					benefitsRestoredAt: retailer.foundingBenefitsRestoredAt,
					now,
				})
					? foundingBenefitsEndAt(
							sub.currentPeriodEnd,
							retailer.foundingBenefitsRestoredAt,
						)
					: undefined,
			nextRenewal:
				sub && eligibility && sub.comped !== true
					? renewalQuote({
							...eligibility,
							status: sub.status,
							plan: sub.plan,
							billingCycle: sub.billingCycle,
							pendingPlanChange: sub.pendingPlanChange?.plan,
							lastPaidCurrency: lastPaid?.currency,
							country: retailer.country,
						})
					: null,
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
			methodLabel: string;
			attachedAt: number;
			lastChargeAt?: number;
			/** Same projection the pending-bills list carries (one author). */
			charge: AdminAutoChargeState;
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
				methodLabel:
					sub.autoRenew.methodLabel ??
					autoRenewMethodLabel(sub.autoRenew.method),
				attachedAt: sub.autoRenew.attachedAt,
				lastChargeAt: sub.autoRenew.lastChargeAt,
				charge: adminAutoChargeState(sub.autoRenew),
			});
		}
		// Stopped first (a human must act), then failing, then most recently
		// attached.
		return rows.sort(
			(a, b) =>
				Number(b.charge.stranded !== undefined) -
					Number(a.charge.stranded !== undefined) ||
				b.charge.failedAttempts - a.charge.failedAttempts ||
				b.attachedAt - a.attachedAt,
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
				// The seller paid the Pay-now link themselves — NOT the saved-
				// method session, so this settle may not touch the charge
				// counter or answer an attempt stamp.
				viaSessionCharge: false,
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
		/** What the NEXT renewal bills (`renewalQuote` — the author the cron's
		 * invoice, the heads-up email and the billing page read). With no open
		 * bill, the authorisation page displays this: the plan (a scheduled
		 * downgrade included), the cycle, the founding price and the renewal
		 * currency — or the hold price for a paused store. */
		renewal: RenewalQuote;
		comped: boolean;
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
		/** …and whether that bill is an Off-Season Hold rather than the tier —
		 * a hold invoice carries the TIER in `plan` (it is what the seller
		 * resumes to), so without this the page would title an RM19 hold charge
		 * "Kedaipal Pro". */
		pendingInvoiceKind: "plan" | "hold" | undefined;
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
		const lastPaid = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.order("desc")
			.filter((q) => q.eq(q.field("status"), "paid"))
			.first();
		return {
			retailerId: retailer._id,
			subscriptionId: sub._id,
			storeName: retailer.storeName,
			notifyEmail: retailer.notifyEmail,
			// HitPay's page quotes what the next bill will actually be — this
			// used to be the MONTHLY price in the COUNTRY currency, so an annual
			// or an SGD-billed store was shown a number no bill would carry.
			renewal: renewalQuote({
				status: sub.status,
				plan: sub.plan,
				billingCycle: sub.billingCycle,
				pendingPlanChange: sub.pendingPlanChange?.plan,
				isFoundingMember: retailer.isFoundingMember === true,
				benefitsRevokedAt: retailer.foundingBenefitsRevokedAt,
				benefitsRestoredAt: retailer.foundingBenefitsRestoredAt,
				foundingIntent: sub.foundingIntent === true,
				paidThrough: sub.currentPeriodEnd,
				lastPaidCurrency: lastPaid?.currency,
				country: retailer.country,
				now: Date.now(),
			}),
			comped: sub.comped === true,
			attached: sub.autoRenew !== undefined,
			existingSetup: sub.autoRenewSetup ?? null,
			existingSessionId: sub.autoRenewSessionId,
			pendingInvoiceId: pending?._id,
			pendingInvoiceTotalSen: pending?.total,
			pendingInvoiceCurrency: pending?.currency,
			pendingInvoicePlan: pending?.plan,
			pendingInvoiceKind: pending ? (pending.kind ?? "plan") : undefined,
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
		const billedPlan = context.pendingInvoicePlan ?? context.renewal.plan;
		// …and an Off-Season Hold bill carries the TIER in `plan` (it is what
		// the seller resumes to), so it needs naming as the hold it is — either
		// the open bill IS a hold invoice, or there is no bill and the paused
		// store's next charge will be one.
		const billingHold =
			context.pendingInvoiceKind === "hold" ||
			(context.pendingInvoiceKind === undefined &&
				context.renewal.kind === "hold");
		const planLabel = billingHold
			? HOLD_LABEL
			: `${billedPlan.charAt(0).toUpperCase()}${billedPlan.slice(1)}`;
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
			// total), else the next renewal bill — which for a PAUSED store is
			// the flat hold price, not the tier. Display-only either way; charges
			// always pass the invoice total at charge time.
			amountSen: context.pendingInvoiceTotalSen ?? context.renewal.amount,
			currency:
				context.pendingInvoiceCurrency === "SGD" ||
				context.pendingInvoiceCurrency === "MYR"
					? context.pendingInvoiceCurrency
					: context.renewal.currency,
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
		if (session.kind !== "found" || session.status !== "active") {
			return { attached: false };
		}
		await ctx.runMutation(internal.subscriptionPayments.recordMethodAttached, {
			billingId: context.existingSessionId,
			methodCode: session.paymentMethod,
			methodLabel: undefined,
		});
		return { attached: true };
	},
});

/** What a session GET told us. `gone` and `unavailable` are different facts:
 * a session HitPay says it doesn't have can't take a charge either, while a
 * read that failed tells us nothing at all. */
type RecurringSessionRead =
	| {
			kind: "found";
			status: string;
			/** Undefined when the body carries no count — "can't judge", never
			 * zero (lib/hitpayBilling.ts `readSessionChargeCount`). */
			chargeCount: number | undefined;
			paymentMethod: string | undefined;
	  }
	/** 404/410 — HitPay has no such session (e.g. removed at their end and the
	 * detach webhook never reached us). */
	| { kind: "gone"; httpStatus: number }
	/** No usable answer: a network error, 5xx, 429, or any other refusal. */
	| { kind: "unavailable" };

async function fetchRecurringSession(
	credentials: BillingGatewayCredentials,
	sessionId: string,
): Promise<RecurringSessionRead> {
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
			sessionId,
			err: err instanceof Error ? err.message : String(err),
		});
		return { kind: "unavailable" };
	}
	if (response.status === 404 || response.status === 410) {
		console.warn("[billing] recurring session not found at HitPay", {
			sessionId,
			status: response.status,
		});
		return { kind: "gone", httpStatus: response.status };
	}
	if (!response.ok) {
		console.error("[billing] recurring session fetch rejected", {
			sessionId,
			status: response.status,
		});
		return { kind: "unavailable" };
	}
	let body: Record<string, unknown>;
	try {
		body = (await response.json()) as Record<string, unknown>;
	} catch {
		console.error("[billing] recurring session body unreadable", { sessionId });
		return { kind: "unavailable" };
	}
	// Same readers the webhook uses — the GET response IS a recurring-billing
	// object, and reading only the docs' flat `payment_method` here is what
	// made the reconcile path record "card" for a Touch 'n Go wallet.
	return {
		kind: "found",
		status: typeof body.status === "string" ? body.status : "unknown",
		chargeCount: readSessionChargeCount(body),
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
	//     still pending, and the in-flight charge hasn't moved HitPay's charge
	//     count yet, so the reconcile guard waves the second through).
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
	// A charge whose outcome is still unknown must outlive the autoRenew state
	// it was recorded on — see scheduleLostAttemptReconcile. HitPay detaching
	// the METHOD doesn't delete the session object, so the count stays readable.
	await scheduleLostAttemptReconcile(ctx, sub, { deleteSessionAfter: false });
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

/**
 * The attempt stamp is an open MONEY question, and clearing `autoRenew`
 * (seller cancel, remote detach) destroys every hook the daily reconcile
 * hangs off — the stamp, the counter, even the session id the webhook
 * resolves by. Before that state goes, capture the question into a
 * self-contained action (`reconcileLostAttempt`) that answers it against
 * HitPay directly: settle the bill if the charge landed, put the Pay-now
 * link back if it never did. Without this, cancelling mid-unknown made a
 * landed charge permanently invisible — the seller's money, recorded
 * nowhere.
 */
async function scheduleLostAttemptReconcile(
	ctx: MutationCtx,
	sub: Doc<"subscriptions">,
	{ deleteSessionAfter }: { deleteSessionAfter: boolean },
): Promise<boolean> {
	const autoRenew = sub.autoRenew;
	const sessionId = sub.autoRenewSessionId;
	if (
		!autoRenew ||
		autoRenew.lastChargeAttemptAt === undefined ||
		autoRenew.pendingChargeInvoiceId === undefined ||
		!sessionId
	) {
		return false;
	}
	const invoice = await ctx.db.get(autoRenew.pendingChargeInvoiceId);
	if (!invoice) return false;
	await ctx.scheduler.runAfter(0, internal.subscriptionPayments.reconcileLostAttempt, {
		sessionId,
		invoiceId: invoice._id,
		invoiceNumber: invoice.invoiceNumber,
		amountSen: invoice.total,
		currency: invoice.currency,
		methodCode: autoRenew.method,
		// The count to beat: this attempt's own baseline if it was captured,
		// else the success tally (the pre-baseline fallback).
		baselineCount: autoRenew.chargeCountAtAttempt ?? autoRenew.timesCharged ?? 0,
		attempt: 0,
		deleteSessionAfter,
	});
	console.warn(
		"[billing] auto-renew ending with a charge outcome unknown — final reconcile scheduled",
		{ subscriptionId: sub._id, sessionId, invoiceNumber: invoice.invoiceNumber },
	);
	return true;
}

/** How long `reconcileLostAttempt` waits before asking HitPay again when it
 * can't get an answer. Front-loaded (transient blips), then spread across the
 * day HitPay outages realistically last. After the last one it stops and
 * logs for a human — never guesses about money. */
const LOST_ATTEMPT_RETRY_DELAYS_MS = [
	60 * 60 * 1000,
	3 * 60 * 60 * 1000,
	8 * 60 * 60 * 1000,
	12 * 60 * 60 * 1000,
];

/**
 * The last reconcile for a charge whose autoRenew state is gone (seller
 * cancelled / method detached mid-unknown). Self-contained: every fact it
 * needs was captured when it was scheduled, so it works however the sub has
 * changed since — even if the seller re-subscribed onto a new session.
 *
 *  - HitPay's count moved past ours ⇒ the money is real ⇒ settle the bill it
 *    was fired for (`viaSessionCharge` — a non-pending bill lands as a
 *    late_payment audit in the review queue instead).
 *  - Count says it never landed ⇒ re-mint the invoice's Pay-now link: the
 *    seller is on the manual rail now and the claim killed their button.
 *  - No answer (network, 5xx, no count, or the session is gone) ⇒ retry on
 *    LOST_ATTEMPT_RETRY_DELAYS_MS, then log CRITICALLY for a human. Never
 *    re-mint on a non-answer — inviting a manual payment while the charge
 *    may have landed is the double-payment this file exists to prevent.
 *  - `deleteSessionAfter` (seller cancel): the remote session is deleted only
 *    AFTER the money question is answered — deleting first would 404 the
 *    very count this reconcile needs.
 */
export const reconcileLostAttempt = internalAction({
	args: {
		sessionId: v.string(),
		invoiceId: v.id("invoices"),
		invoiceNumber: v.string(),
		amountSen: v.number(),
		currency: v.string(),
		methodCode: v.string(),
		/** HitPay's count as of the moment the lost charge fired. */
		baselineCount: v.number(),
		attempt: v.number(),
		deleteSessionAfter: v.boolean(),
	},
	handler: async (ctx, args): Promise<void> => {
		const credentials = billingCredentials();
		if (!credentials) {
			console.error(
				"[billing] CRITICAL: lost-attempt reconcile has no gateway credentials — check HitPay manually",
				{ sessionId: args.sessionId, invoiceNumber: args.invoiceNumber },
			);
			return;
		}
		const session = await fetchRecurringSession(credentials, args.sessionId);
		const answer =
			session.kind === "found" && session.chargeCount !== undefined
				? session.chargeCount
				: null;
		if (answer === null) {
			const delay = LOST_ATTEMPT_RETRY_DELAYS_MS[args.attempt];
			if (delay !== undefined) {
				await ctx.scheduler.runAfter(
					delay,
					internal.subscriptionPayments.reconcileLostAttempt,
					{ ...args, attempt: args.attempt + 1 },
				);
				return;
			}
			console.error(
				"[billing] CRITICAL: lost-attempt reconcile exhausted — a charge may have landed with no record. Check the session in HitPay's dashboard by hand.",
				{
					sessionId: args.sessionId,
					invoiceNumber: args.invoiceNumber,
					amountSen: args.amountSen,
					currency: args.currency,
				},
			);
			return; // keep the remote session inspectable — no delete
		}
		if (answer > args.baselineCount) {
			console.warn(
				"[billing] lost attempt reconciled after auto-renew ended — the charge was real, settling",
				{ sessionId: args.sessionId, invoiceNumber: args.invoiceNumber },
			);
			await ctx.runMutation(internal.invoices.internalSettleFromGateway, {
				invoiceId: args.invoiceId,
				paymentId: `reconciled:${args.sessionId}:${answer}`,
				amountSen: args.amountSen,
				currency: args.currency,
				methodCode: args.methodCode,
				viaSessionCharge: true,
			});
		} else {
			// Never landed. The claim killed the Pay-now button; give the
			// now-manual seller their way to pay back (no-ops unless pending).
			await ctx.scheduler.runAfter(
				0,
				internal.subscriptionPayments.remintInvoicePaymentRequest,
				{ invoiceId: args.invoiceId },
			);
		}
		if (args.deleteSessionAfter) {
			await deleteRemoteSession(credentials, args.sessionId);
		}
	},
});

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
		// A charge whose outcome is unknown outlives the cancel: the final
		// reconcile owns the money question AND the remote session delete —
		// deleting the session first would 404 the count it needs. Turning off
		// stays instant and ungated either way: `autoRenew` is cleared below,
		// so nothing can charge from this moment.
		const reconcilePending = await scheduleLostAttemptReconcile(ctx, sub, {
			deleteSessionAfter: true,
		});
		if (sub.autoRenew !== undefined || sub.autoRenewSetup !== undefined) {
			await ctx.db.patch(sub._id, {
				autoRenew: undefined,
				autoRenewSetup: undefined,
				autoRenewSessionId: undefined,
			});
		}
		if (sessionId && !reconcilePending) {
			await ctx.scheduler.runAfter(
				0,
				internal.subscriptionPayments.deleteRecurringSession,
				{ sessionId },
			);
		}
		return { ok: true };
	},
});

/** DELETE a recurring-billing session at HitPay. Best-effort by contract:
 * failure is a log line — with no local `autoRenew`, nothing charges
 * regardless. Plain helper so the lost-attempt reconcile can delete in-line
 * AFTER it has read the session's charge count. */
async function deleteRemoteSession(
	credentials: BillingGatewayCredentials,
	sessionId: string,
): Promise<void> {
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
}

/** Best-effort remote cleanup of a recurring-billing session (cancel /
 * supersede). */
export const deleteRecurringSession = internalAction({
	args: { sessionId: v.string() },
	handler: async (_ctx, { sessionId }): Promise<void> => {
		const credentials = billingCredentials();
		if (!credentials) return;
		await deleteRemoteSession(credentials, sessionId);
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
		/** The bill an unresolved attempt was FIRED FOR — usually this one; a
		 * different one only when that bill was voided (or reissued) while the
		 * outcome was unknown. A reconciled charge belongs to it, not to us. */
		attemptInvoice: {
			invoiceId: Id<"invoices">;
			totalSen: number;
			currency: string;
		} | null;
	} | null> => {
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) return null;
		const sub = await ctx.db.get(invoice.subscriptionId);
		if (!sub) return null;
		const attemptId = sub.autoRenew?.pendingChargeInvoiceId;
		const attempt =
			attemptId === undefined
				? null
				: attemptId === invoiceId
					? invoice
					: await ctx.db.get(attemptId);
		return {
			invoiceStatus: invoice.status,
			invoiceNumber: invoice.invoiceNumber,
			totalSen: invoice.total,
			currency: invoice.currency,
			subscriptionId: sub._id,
			sessionId: sub.autoRenewSessionId,
			autoRenew: sub.autoRenew,
			gatewayRequestId: invoice.gatewayRequestId,
			attemptInvoice: attempt
				? {
						invoiceId: attempt._id,
						totalSen: attempt.total,
						currency: attempt.currency,
					}
				: null,
		};
	},
});

/**
 * Close an attempt stamp whose question the reconcile ANSWERED "never
 * landed" (HitPay's count didn't move) — or that can never be answered
 * (session gone). Without this, a stamp whose bill is no longer pending
 * (settled by Pay-now / mark-paid, or voided) had no path that cleared it:
 * the daily sweep re-reconciled it forever and the seller's "confirming"
 * state never ended.
 *
 * Guarded three ways so it can NEVER break the mutex of a live charge:
 * the stamp must still be the exact one we reconciled (same timestamp, same
 * bill — a newer claim is a different question), and it must be STALE
 * (older than the lock): a fresh stamp can belong to a charge literally in
 * flight, whose count HitPay simply hasn't moved yet — clearing that would
 * hand the lock to a second charge, the double debit. A fresh stamp is left
 * for its own action's outcome recording, exactly like the claim path.
 */
export const resolveChargeAttempt = internalMutation({
	args: {
		subscriptionId: v.id("subscriptions"),
		invoiceId: v.id("invoices"),
		observedAttemptAt: v.number(),
	},
	handler: async (
		ctx,
		{ subscriptionId, invoiceId, observedAttemptAt },
	): Promise<void> => {
		const sub = await ctx.db.get(subscriptionId);
		if (!sub?.autoRenew) return;
		if (sub.autoRenew.lastChargeAttemptAt !== observedAttemptAt) return;
		if (sub.autoRenew.pendingChargeInvoiceId !== invoiceId) return;
		if (Date.now() - observedAttemptAt < CHARGE_ATTEMPT_LOCK_MS) return;
		await ctx.db.patch(subscriptionId, {
			autoRenew: {
				...sub.autoRenew,
				lastChargeAttemptAt: undefined,
				pendingChargeInvoiceId: undefined,
				chargeCountAtAttempt: undefined,
			},
		});
	},
});

/** Stamp "a charge is about to fire" BEFORE the HTTP call, so a crash between
 * charge and settle is detectable (and reconciled) instead of double-charged. */
export const recordChargeAttempt = internalMutation({
	args: {
		subscriptionId: v.id("subscriptions"),
		invoiceId: v.id("invoices"),
		/** HitPay's charge count read moments ago, before this POST — the
		 * baseline the reconcile measures against. Omitted when the read
		 * failed; the reconcile then falls back to `timesCharged`. */
		chargeCountAtAttempt: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{ subscriptionId, invoiceId, chargeCountAtAttempt },
	): Promise<{ claimed: boolean }> => {
		const sub = await ctx.db.get(subscriptionId);
		if (!sub?.autoRenew) return { claimed: false };
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice || invoice.status !== "pending") return { claimed: false };
		// MUTEX, not just a stamp. Convex mutations are serializable, so this
		// read-then-patch is the one place two concurrent charge actions can be
		// made to disagree: whoever patches first owns the attempt, the loser
		// is told to stand down. Without it, two schedulers (attach webhook +
		// redirect reconcile, or cron + heal) both POST — and the
		// outcome-unknown reconcile can't save us, because while charge A is
		// still in flight HitPay's charge count hasn't moved yet, so charge B
		// reads "remote not ahead" and charges anyway.
		// The window is the LOCK's lifetime only: a stale stamp may be
		// re-claimed because chargeDueRenewal has already asked HitPay about it
		// by then — at any age (lib/hitpayBilling.ts CHARGE_ATTEMPT_LOCK_MS).
		const inFlight =
			sub.autoRenew.lastChargeAttemptAt !== undefined &&
			Date.now() - sub.autoRenew.lastChargeAttemptAt < CHARGE_ATTEMPT_LOCK_MS;
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
				chargeCountAtAttempt,
			},
		});
		// Retire the invoice's Pay-now link LOCALLY in the same transaction as
		// the claim. The remote DELETE (expireInvoiceRequest, scheduled by the
		// caller) kills the checkout; this kills the BUTTON — without it the
		// billing tab and every email kept offering "Pay online now" for a
		// link HitPay no longer had, for as long as a lost outcome stayed
		// unresolved. A decline re-mints both together (remintInvoicePaymentRequest).
		if (invoice.gatewayRequestId || invoice.gatewayPayment) {
			await ctx.db.patch(invoiceId, {
				gatewayRequestId: undefined,
				gatewayPayment: undefined,
			});
		}
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
				chargeCountAtAttempt: undefined,
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
 * Tell ops a charge was STRANDED (invoices.internalSettleFromGateway): the
 * seller has just been told "we'll be in touch", so a human must actually
 * hear about it rather than stumble on a pill in the admin console. Same
 * recipient resolution as the WABA alerts — ADMIN_ALERT_EMAIL, falling back
 * to EMAIL_FROM — and never throws: the hold itself is already recorded.
 */
export const sendStrandedChargeAlert = internalAction({
	args: {
		storeName: v.string(),
		slug: v.string(),
		invoiceNumber: v.string(),
		amountSen: v.number(),
		currency: v.string(),
		paymentId: v.string(),
	},
	handler: async (_ctx, args): Promise<void> => {
		const amount = `${args.currency.toUpperCase()} ${senToDecimalString(args.amountSen)}`;
		console.error("[billing] STRANDED auto-charge — auto-charging stopped", {
			slug: args.slug,
			invoiceNumber: args.invoiceNumber,
			paymentId: args.paymentId,
		});
		const to = process.env.ADMIN_ALERT_EMAIL ?? process.env.EMAIL_FROM;
		if (!to) {
			console.error(
				"Stranded-charge alert skipped: no ADMIN_ALERT_EMAIL / EMAIL_FROM",
			);
			return;
		}
		const text = [
			`HitPay took ${amount} from ${args.storeName} (/${args.slug}) for ${args.invoiceNumber}, which was voided before we heard back — so the charge was never recorded against any bill.`,
			"",
			`HitPay reference: ${args.paymentId}`,
			"",
			"Auto-charging for this store is STOPPED until a bill is settled, and the seller has been told we'll be in touch. Decide with them: refund the charge in HitPay, or apply it by marking their open bill paid.",
			"",
			"Admin console: /app/admin/billing",
		].join("\n");
		try {
			await sendEmail(
				to,
				`[Kedaipal] Stranded auto-charge — ${args.storeName}`,
				`<pre>${escapeHtml(text)}</pre>`,
				text,
			);
		} catch (err) {
			console.error("Stranded-charge alert email failed", err);
		}
	},
});

/** Operator report row for `syncChargeCounters`. */
type ChargeCounterSyncRow = {
	subscriptionId: Id<"subscriptions">;
	sessionId: string;
	outcome:
		| "in_sync"
		| "patched"
		| "skipped_unresolved"
		| "skipped_stranded"
		| "gone"
		| "unavailable"
		| "no_count";
	local?: number;
	remote?: number;
};

export const listAutoRenewSessions = internalQuery({
	args: {},
	handler: async (
		ctx,
	): Promise<
		Array<{
			subscriptionId: Id<"subscriptions">;
			sessionId: string;
			timesCharged: number;
			unresolved: boolean;
			stranded: boolean;
		}>
	> => {
		const subs = await ctx.db.query("subscriptions").collect();
		return subs
			.filter((s) => s.autoRenew !== undefined && s.autoRenewSessionId)
			.map((s) => ({
				subscriptionId: s._id,
				sessionId: s.autoRenewSessionId as string,
				timesCharged: s.autoRenew?.timesCharged ?? 0,
				unresolved: s.autoRenew?.lastChargeAttemptAt !== undefined,
				stranded: s.autoRenew?.strandedCharge !== undefined,
			}));
	},
});

export const setChargeCounter = internalMutation({
	args: { subscriptionId: v.id("subscriptions"), timesCharged: v.number() },
	handler: async (ctx, { subscriptionId, timesCharged }): Promise<void> => {
		const sub = await ctx.db.get(subscriptionId);
		if (!sub?.autoRenew) return;
		// Re-checked transactionally: a charge that claimed the mutex after the
		// action's read owns the counter now — overwriting it would erase the
		// very drift evidence the reconcile needs.
		if (sub.autoRenew.lastChargeAttemptAt !== undefined) return;
		await ctx.db.patch(subscriptionId, {
			autoRenew: { ...sub.autoRenew, timesCharged },
		});
	},
});

/**
 * OPERATOR one-shot: align every subscription's `timesCharged` with the
 * count HitPay actually holds (`total_charge`). Exists because the shipped
 * counter could drift — the pre-fix reconcile read a field that was always
 * null, and Pay-now settles used to bump it — and the reconcile's
 * no-double-charge verdict is exactly as good as this parity:
 *  - local BEHIND remote ⇒ the next lost outcome reads "remote ahead" and
 *    settles a bill nobody charged (lost revenue);
 *  - local AHEAD of remote ⇒ the next lost-but-landed charge reads "remote
 *    not ahead" and charges AGAIN (the double debit).
 *
 * Read-then-patch per session, never a charge. Sessions with an UNRESOLVED
 * attempt or a STRANDED charge are skipped and reported — syncing those
 * would erase the drift that IS the evidence of the open question.
 *
 * Run at release, after deploy:
 *   dev:  npx convex run subscriptionPayments:syncChargeCounters
 *   PROD: npx convex run subscriptionPayments:syncChargeCounters --prod
 * (write `--prod` yourself; the bare command runs against dev and reports
 * success, which reads exactly like a prod run that worked).
 */
export const syncChargeCounters = internalAction({
	args: {},
	handler: async (ctx): Promise<ChargeCounterSyncRow[]> => {
		const credentials = billingCredentials();
		if (!credentials) {
			console.error("[billing] counter sync: no gateway credentials");
			return [];
		}
		const sessions: Array<{
			subscriptionId: Id<"subscriptions">;
			sessionId: string;
			timesCharged: number;
			unresolved: boolean;
			stranded: boolean;
		}> = await ctx.runQuery(
			internal.subscriptionPayments.listAutoRenewSessions,
			{},
		);
		const report: ChargeCounterSyncRow[] = [];
		for (const s of sessions) {
			const base = { subscriptionId: s.subscriptionId, sessionId: s.sessionId };
			if (s.unresolved) {
				report.push({ ...base, outcome: "skipped_unresolved" });
				continue;
			}
			if (s.stranded) {
				report.push({ ...base, outcome: "skipped_stranded" });
				continue;
			}
			const session = await fetchRecurringSession(credentials, s.sessionId);
			if (session.kind === "gone") {
				report.push({ ...base, outcome: "gone", local: s.timesCharged });
				continue;
			}
			if (session.kind === "unavailable") {
				report.push({ ...base, outcome: "unavailable", local: s.timesCharged });
				continue;
			}
			if (session.chargeCount === undefined) {
				report.push({ ...base, outcome: "no_count", local: s.timesCharged });
				continue;
			}
			if (session.chargeCount === s.timesCharged) {
				report.push({
					...base,
					outcome: "in_sync",
					local: s.timesCharged,
					remote: session.chargeCount,
				});
				continue;
			}
			await ctx.runMutation(internal.subscriptionPayments.setChargeCounter, {
				subscriptionId: s.subscriptionId,
				timesCharged: session.chargeCount,
			});
			console.warn("[billing] charge counter drift corrected", {
				subscriptionId: s.subscriptionId,
				sessionId: s.sessionId,
				local: s.timesCharged,
				remote: session.chargeCount,
			});
			report.push({
				...base,
				outcome: "patched",
				local: s.timesCharged,
				remote: session.chargeCount,
			});
		}
		return report;
	},
});

/**
 * Charge the invoice total against the saved method — the auto-renewal
 * moment. Scheduled by the renewal cron, the retry sweep, and heal-on-attach.
 * Money rules:
 *  - charge the INVOICE total at charge time, never a cached plan amount;
 *  - never fire while an earlier attempt's outcome is unknown — reconcile
 *    against HitPay's charge count first (settle if it already went
 *    through), so a crashed action can't become a double charge. At ANY
 *    age: the retry after an unknown outcome lands a day later by
 *    construction, so an age-gated guard never ran where it was needed;
 *  - the synchronous response is the verdict: succeeded → settle through the
 *    markPaid path; anything else → Kedaipal-owned dunning
 *    (recordChargeFailure), whose decline re-mints the Pay-now link as the
 *    way out.
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
		const { autoRenew, sessionId } = context;
		if (!autoRenew || !sessionId) return; // turned off meanwhile — manual rail

		// Outcome-unknown guard — BEFORE the is-this-bill-still-pending return,
		// because the stamp is a question about MONEY, not about this bill: the
		// bill can settle by another rail (Pay-now, admin mark-paid) or be
		// voided while the session charge's fate is unknown, and returning
		// early on its status was how that question went unanswered for a
		// whole cycle. An attempt stamp is cleared only by a RECORDED outcome
		// on the session rail (a settle or a decline), so one still standing
		// means an earlier action may have charged and died before it could
		// say so. Ask HitPay how many charges the session has taken; if that
		// moved PAST THE BASELINE CAPTURED WHEN THAT CHARGE FIRED, the money
		// is real — settle it (against the bill the attempt was FIRED FOR),
		// never charge again.
		// The baseline, not our success tally, is the measure: the tally only
		// counts OUR successes, so anything else that moves HitPay's number
		// would read as "your lost charge landed" and settle a bill nobody
		// paid. (Whether a declined charge moves it is unproven — the sandbox
		// approves everything it validates, so it cannot be observed there.
		// Measuring the delta makes the answer irrelevant.) A stamp with no
		// baseline — a GET blip at claim time, or one written before the field
		// existed — falls back to the tally: the previous behaviour, never worse.
		// NO AGE LIMIT. The retry after an unknown outcome is scheduled a day
		// out and fired by a daily cron, so it always meets a stamp at least
		// 24h old; the old "< 24h" gate meant this never ran on that path, the
		// lock read the stamp as stale, and a charge HitPay had taken was POSTed
		// again. The lock's window (CHARGE_ATTEMPT_LOCK_MS) is not this one.
		// HitPay's count as of a moment ago. Set by whichever read happens
		// below, and handed to the claim as the next attempt's baseline.
		let liveChargeCount: number | undefined;
		// Whether we already asked HitPay this run. A session that answered
		// "gone" gives no count, but re-asking it would just 404 twice.
		let sessionAlreadyRead = false;
		if (autoRenew.lastChargeAttemptAt !== undefined) {
			const session = await fetchRecurringSession(credentials, sessionId);
			sessionAlreadyRead = true;
			// No usable answer — the retry sweep asks again tomorrow.
			if (session.kind === "unavailable") return;
			if (session.kind === "found") {
				if (session.chargeCount === undefined) {
					// A body without a count can't prove the lost charge DIDN'T land.
					console.error(
						"[billing] session carries no charge count — not charging blind",
						{ invoiceNumber: context.invoiceNumber, sessionId },
					);
					return;
				}
				liveChargeCount = session.chargeCount;
				const baseline =
					autoRenew.chargeCountAtAttempt ?? autoRenew.timesCharged ?? 0;
				if (session.chargeCount > baseline) {
					// The money belongs to the bill the attempt was FIRED FOR — this
					// one, unless it was voided while the outcome was unknown. Then the
					// settle audits it on the voided bill and stops auto-charging (a
					// stranded charge): never quietly booked against this bill, never
					// charged again on top of it.
					const charged = context.attemptInvoice ?? {
						invoiceId,
						totalSen: context.totalSen,
						currency: context.currency,
					};
					console.warn(
						"[billing] reconciled an untracked charge — settling without re-charging",
						{
							invoiceNumber: context.invoiceNumber,
							chargedInvoiceId: charged.invoiceId,
							sessionId,
						},
					);
					await ctx.runMutation(internal.invoices.internalSettleFromGateway, {
						invoiceId: charged.invoiceId,
						paymentId: `reconciled:${sessionId}:${session.chargeCount}`,
						amountSen: charged.totalSen,
						currency: charged.currency,
						methodCode: autoRenew.method,
						viaSessionCharge: true,
					});
					return;
				}
				// HitPay never took it — the stamp's question is ANSWERED "no",
				// so a stale stamp is resolved here (guarded: never a fresh one,
				// which may be a charge mid-flight whose count hasn't moved yet).
				// Without this, a stamp whose bill settled by another rail was
				// re-reconciled every day forever. A pending bill's charge below
				// re-claims and re-stamps as before.
				await ctx.runMutation(
					internal.subscriptionPayments.resolveChargeAttempt,
					{
						subscriptionId: context.subscriptionId,
						invoiceId:
							context.attemptInvoice?.invoiceId ?? invoiceId,
						observedAttemptAt: autoRenew.lastChargeAttemptAt,
					},
				);
			}
			if (session.kind === "gone") {
				// A session HitPay doesn't have (404/410) neither took the lost
				// charge nor can ever answer for it — the question is
				// UNANSWERABLE, not open. Close a stale stamp (same guard) so it
				// doesn't loop daily, and say loudly what a human should check.
				console.error(
					"[billing] CRITICAL: session gone with a charge outcome unknown — verify in HitPay's dashboard by hand",
					{
						sessionId,
						invoiceNumber: context.invoiceNumber,
						attemptInvoiceId: context.attemptInvoice?.invoiceId,
					},
				);
				await ctx.runMutation(
					internal.subscriptionPayments.resolveChargeAttempt,
					{
						subscriptionId: context.subscriptionId,
						invoiceId:
							context.attemptInvoice?.invoiceId ?? invoiceId,
						observedAttemptAt: autoRenew.lastChargeAttemptAt,
					},
				);
				// Fall through — the charge's own refusal becomes a recorded,
				// dunned decline instead of a silent skip forever.
			}
		}

		// Only now does THIS bill's status matter: a settled/voided bill takes
		// no charge (the reconcile above already dealt with the money question).
		if (context.invoiceStatus !== "pending") return;
		// Stopped over a stranded charge: nothing charges until a human settles a
		// bill. Every scheduler asks this rule first; re-asked here because a
		// charge queued before the stop can still run after it. Placed after the
		// reconcile on purpose — answering an open money question is always
		// safe, charging is what the stop forbids.
		if (!autoChargeAllowed(autoRenew)) return;

		// Capture HitPay's count BEFORE the POST, so the next reconcile can ask
		// "did it move since I fired?" instead of trusting our success tally.
		// The reconcile above may already have read it a moment ago — reuse
		// that rather than pay for a second GET. A failed read is not fatal:
		// the claim stores no baseline and the reconcile falls back.
		if (!sessionAlreadyRead) {
			const pre = await fetchRecurringSession(credentials, sessionId);
			if (pre.kind === "found") liveChargeCount = pre.chargeCount;
			else {
				console.warn(
					"[billing] could not read the charge count before charging — the reconcile will fall back to the success tally",
					{ invoiceNumber: context.invoiceNumber, sessionId },
				);
			}
		}

		const claim: { claimed: boolean } = await ctx.runMutation(
			internal.subscriptionPayments.recordChargeAttempt,
			{
				subscriptionId: context.subscriptionId,
				invoiceId,
				chargeCountAtAttempt: liveChargeCount,
			},
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
			let body: { payment_id?: string; status?: string };
			try {
				body = (await response.json()) as typeof body;
			} catch {
				// A 2xx we can't read says nothing about the money — the charge MAY
				// have landed. Unknown, not a decline: the stamp stays for the
				// reconcile (a thrown action here would record no outcome at all).
				console.error("[billing] auto-charge response unreadable", {
					invoiceNumber: context.invoiceNumber,
				});
				await ctx.runMutation(internal.subscriptionPayments.recordChargeFailure, {
					subscriptionId: context.subscriptionId,
					invoiceId,
					error: "unreadable charge response — outcome unknown",
					outcome: "unknown",
				});
				return;
			}
			if (body.status === "succeeded" && body.payment_id) {
				await ctx.runMutation(internal.invoices.internalSettleFromGateway, {
					invoiceId,
					paymentId: body.payment_id,
					viaSessionCharge: true, // the sync verdict of OUR charge
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
