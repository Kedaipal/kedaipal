// Subscription-invoice emails to the retailer: an issue-time "new invoice" and a
// pre-due-date reminder. Scheduled fire-and-forget (errors swallowed + logged) so
// the originating mutation/cron never fails on an outbound issue — mirrors the
// order-alert emails in convex/email.ts. Pure copy lives in lib/billingEmailCopy.ts.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalQuery } from "./_generated/server";
import {
	type AutoRenewEmailKey,
	type BillingEmailKey,
	type PaymentEmailKey,
	renderAutoRenewEmail,
	renderBillingEmail,
	renderHoldEmail,
	renderPaymentEmail,
	renderTrialEmail,
	type TrialEmailKey,
} from "./lib/billingEmailCopy";
import { sendEmail } from "./lib/email";
import { HOLD_LABEL } from "./lib/seasonalHold";
import type { Locale } from "./lib/emailCopy";
import {
	BILLING_CURRENCY_FOR_COUNTRY,
	type BillingCurrency,
	HOLD_MONTHLY_PRICES,
	renewalQuote,
} from "./lib/plans";

function billingPageUrl(): string {
	return `${process.env.SITE_URL ?? "https://kedaipal.com"}/app/settings?tab=billing`;
}

const MONTHS = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatMoney(cents: number, currency: string): string {
	return `${currency} ${(cents / 100).toFixed(2)}`;
}

/** Deterministic "5 Jul 2026" (UTC) — avoids locale-dependent toLocaleDateString. */
function formatDueDate(ms: number): string {
	const d = new Date(ms);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function planLabel(
	plan: string,
	cycle: string,
	kind: "plan" | "hold" = "plan",
): string {
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	if (kind === "hold") return `${HOLD_LABEL} · ${cap(cycle)}`;
	return `${cap(plan)} · ${cap(cycle)}`;
}

type InvoiceEmailMeta = {
	invoiceNumber: string;
	amount: number;
	foundingDiscount: number | undefined;
	total: number;
	currency: string;
	dueDate: number;
	status: string;
	plan: string;
	billingCycle: string;
	kind: "plan" | "hold";
	notifyEmail: string | undefined;
	storeName: string;
	locale: Locale;
	bankName: string | undefined;
	bankAccountName: string | undefined;
	bankAccountNumber: string | undefined;
	duitnowId: string | undefined;
	// Non-MYR invoice: the billingConfig rails are MYR-only, so the bank fields
	// above are deliberately withheld and the email shows a "we'll confirm
	// payment details on WhatsApp" line instead.
	crossBorder: boolean;
	// HitPay Pay-now link (86eyb6z4r), when the mint landed for this invoice.
	payNowUrl: string | undefined;
};

/** Loads everything the billing-email action needs in one roundtrip: invoice +
 * its subscription (plan/cycle) + retailer (email/locale/name) + Kedaipal's
 * payment details (the billingConfig singleton). */
export const getInvoiceForEmail = internalQuery({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<InvoiceEmailMeta | null> => {
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice) return null;
		const retailer = await ctx.db.get(invoice.retailerId);
		if (!retailer) return null;
		const sub = await ctx.db.get(invoice.subscriptionId);
		// The billingConfig rails (MY bank + DuitNow) can only settle MYR — pointing
		// an SGD-billed seller at them would be a lie, so non-MYR invoices carry no
		// payment details and flag crossBorder instead.
		const crossBorder = invoice.currency !== "MYR";
		const config = crossBorder
			? null
			: await ctx.db.query("billingConfig").first();
		return {
			invoiceNumber: invoice.invoiceNumber,
			amount: invoice.amount,
			foundingDiscount: invoice.foundingDiscount,
			total: invoice.total,
			currency: invoice.currency,
			dueDate: invoice.dueDate,
			status: invoice.status,
			// From the INVOICE first, falling back to the sub — the same precedence
			// markPaid uses. `issueInvoice` deliberately never touches the
			// subscription (the seller's tier must not move before they pay), and
			// every sub is created "monthly" at signup, so reading the sub here made
			// the first annual invoice email "Pro · Monthly" beside a ten-times
			// amount while its own attached PDF said "Annual Subscription". Same bug
			// mislabelled a Starter invoice issued to a store still trialing on Pro.
			plan: invoice.plan ?? sub?.plan ?? "pro",
			billingCycle: invoice.billingCycle ?? sub?.billingCycle ?? "monthly",
			kind: invoice.kind ?? "plan",
			notifyEmail: retailer.notifyEmail,
			storeName: retailer.storeName,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			bankName: config?.bankName,
			bankAccountName: config?.bankAccountName,
			bankAccountNumber: config?.bankAccountNumber,
			duitnowId: config?.duitnowId,
			crossBorder,
			payNowUrl: invoice.gatewayPayment?.url,
		};
	},
});

async function sendInvoiceEmail(
	ctx: ActionCtx,
	invoiceId: Id<"invoices">,
	key: BillingEmailKey,
	/** Post-lock recovery chain only (z8r3fdg3mh) — how long this invoice has
	 * been overdue, so the copy can state it as a fact. */
	daysPastDue?: number,
): Promise<void> {
	let meta: InvoiceEmailMeta | null = null;
	try {
		meta = await ctx.runQuery(internal.billingEmail.getInvoiceForEmail, {
			invoiceId,
		});
	} catch (err) {
		console.error(`Billing email ${key} lookup failed`, err);
		return;
	}
	if (!meta) {
		console.error(`Billing email ${key} skipped: no invoice meta (${invoiceId})`);
		return;
	}
	// Only mail an unpaid invoice — guards against a race where it's settled before
	// the scheduled send runs.
	if (meta.status !== "pending") return;
	if (!meta.notifyEmail) {
		console.warn(
			`Billing email ${key} skipped: notifyEmail empty (${meta.invoiceNumber})`,
		);
		return;
	}

	const hasDiscount =
		meta.foundingDiscount !== undefined && meta.foundingDiscount > 0;
	const { subject, html, text } = renderBillingEmail(meta.locale, key, {
		storeName: meta.storeName,
		invoiceNumber: meta.invoiceNumber,
		planLabel: planLabel(meta.plan, meta.billingCycle, meta.kind),
		totalFormatted: formatMoney(meta.total, meta.currency),
		baseFormatted: hasDiscount
			? formatMoney(meta.amount, meta.currency)
			: undefined,
		discountFormatted: hasDiscount
			? formatMoney(meta.foundingDiscount as number, meta.currency)
			: undefined,
		dueDateFormatted: formatDueDate(meta.dueDate),
		bankName: meta.bankName,
		bankAccountName: meta.bankAccountName,
		bankAccountNumber: meta.bankAccountNumber,
		duitnowId: meta.duitnowId,
		crossBorder: meta.crossBorder,
		payNowUrl: meta.payNowUrl,
		billingUrl: billingPageUrl(),
		daysPastDue,
		// The Off-Season Hold is only an alternative for a seller who ISN'T
		// already on it — a hold invoice means they took that door already, and
		// offering it again would point them at a button that refuses them.
		holdPriceFormatted:
			key === "recoveryFinal" && meta.kind === "plan"
				? formatMoney(
						HOLD_MONTHLY_PRICES[meta.currency as BillingCurrency],
						meta.currency,
					)
				: undefined,
	});

	try {
		await sendEmail(meta.notifyEmail, subject, html, text);
	} catch (err) {
		console.error(
			`Billing email ${key} failed (${meta.invoiceNumber}, to=${meta.notifyEmail}): ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}

/** Scheduled by every issuance path — "here's your new invoice + how to pay".
 * A store's FIRST invoice (z8r3fday24) gets its own framing: "your first
 * order is in" or "your free period has ended", by what ended the period. */
export const notifyInvoiceIssued = internalAction({
	args: {
		invoiceId: v.id("invoices"),
		firstInvoice: v.optional(
			v.union(v.literal("first_order"), v.literal("backstop")),
		),
	},
	handler: async (ctx, { invoiceId, firstInvoice }): Promise<void> => {
		const key: BillingEmailKey =
			firstInvoice === "first_order"
				? "firstInvoiceOrder"
				: firstInvoice === "backstop"
					? "firstInvoiceBackstop"
					: "invoiceIssued";
		await sendInvoiceEmail(ctx, invoiceId, key);
	},
});

/** Scheduled by the daily billing cron a few days before an invoice's due date. */
export const notifyInvoiceReminder = internalAction({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<void> => {
		await sendInvoiceEmail(ctx, invoiceId, "invoiceReminder");
	},
});

/** Scheduled when the daily cron flips an active sub to past_due over an unpaid
 * invoice — the "your store editing is now locked, pay to resume" notice. */
export const notifyInvoiceOverdue = internalAction({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<void> => {
		await sendInvoiceEmail(ctx, invoiceId, "invoiceOverdue");
	},
});

/**
 * Post-lock recovery chain (z8r3fdg3mh) — the two nudges AFTER the lock, at
 * +3d and +7d past the due date. `invoiceOverdue` above fires on the
 * transition itself; before this existed that was the last thing a lapsing
 * seller ever heard from us.
 *
 * `sendInvoiceEmail` re-guards `status === "pending"`, so a seller who paid
 * between the cron stamping the stage and this action running gets nothing —
 * the chain's stop condition is enforced at both ends.
 */
export const notifyInvoiceRecovery = internalAction({
	args: {
		invoiceId: v.id("invoices"),
		stage: v.union(v.literal(1), v.literal(2)),
		daysPastDue: v.number(),
	},
	handler: async (ctx, { invoiceId, stage, daysPastDue }): Promise<void> => {
		await sendInvoiceEmail(
			ctx,
			invoiceId,
			stage === 1 ? "recoveryNudge" : "recoveryFinal",
			daysPastDue,
		);
	},
});

/** Minimal retailer contact for the invoice-less trial emails. */
export const getRetailerForEmail = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		notifyEmail: string | undefined;
		storeName: string;
		locale: Locale;
	} | null> => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return null;
		return {
			notifyEmail: retailer.notifyEmail,
			storeName: retailer.storeName,
			locale: (retailer.locale as Locale | undefined) ?? "en",
		};
	},
});

/**
 * DEV/QA preview: render any billing/trial email with representative sample data
 * and send it to `to`, so the template can be eyeballed in a real inbox without
 * touching the DB. CLI only (internalAction):
 *   npx convex run billingEmail:sendSampleBillingEmail '{"to":"you@email.com","key":"invoiceIssued"}'
 * Add "locale":"ms" or "founding":true to preview those variants, or
 * "currency":"SGD" for the cross-border (no pay-details) invoice variant.
 */
export const sendSampleBillingEmail = internalAction({
	args: {
		to: v.string(),
		key: v.union(
			v.literal("invoiceIssued"),
			v.literal("invoiceReminder"),
			v.literal("invoiceOverdue"),
			v.literal("firstInvoiceOrder"),
			v.literal("firstInvoiceBackstop"),
			v.literal("trialEndingSoon"),
			v.literal("holdStarted"),
			v.literal("holdResumed"),
			v.literal("welcome"),
			v.literal("thanks"),
			v.literal("autoRenewEnabled"),
			v.literal("autoRenewUpcoming"),
			v.literal("autoRenewFailed"),
		),
		locale: v.optional(v.union(v.literal("en"), v.literal("ms"))),
		founding: v.optional(v.boolean()),
		currency: v.optional(v.union(v.literal("MYR"), v.literal("SGD"))),
		// Adds the sample Pay-now button to the invoice emails ("payNow": true).
		payNow: v.optional(v.boolean()),
	},
	handler: async (
		_ctx,
		{ to, key, locale, founding, currency, payNow },
	): Promise<{ sent: string; key: string }> => {
		const loc: Locale = locale ?? "en";
		const url = billingPageUrl();
		const samplePayNow = payNow
			? "https://securecheckout.sandbox.hit-pay.com/payment-request/sample"
			: undefined;
		const crossBorder = currency === "SGD";
		const withDiscount = founding === true;
		const sampleBase = crossBorder ? "SGD 59.00" : "MYR 149.00";
		const sampleDiscount = crossBorder ? "SGD 18.00" : "MYR 45.00";
		const sampleTotal = withDiscount
			? crossBorder
				? "SGD 41.00"
				: "MYR 104.00"
			: sampleBase;
		const rendered =
			key === "welcome" || key === "thanks"
				? renderPaymentEmail(loc, key, {
						storeName: "Sample Store",
						planLabel: "Pro · Monthly",
						totalFormatted: sampleTotal,
						dashboardUrl: url,
					})
				: key === "trialEndingSoon"
					? renderTrialEmail(loc, key, {
							storeName: "Sample Store",
							billingUrl: url,
							daysLeft: 3,
						})
					: key === "holdStarted" || key === "holdResumed"
						? renderHoldEmail(loc, key, {
								storeName: "Sample Store",
								billingUrl: url,
								planLabel: "Pro",
								holdPriceFormatted: crossBorder ? "SGD 9.00" : "MYR 19.00",
								billsNow: true,
							})
					: key === "autoRenewEnabled" ||
							key === "autoRenewUpcoming" ||
							key === "autoRenewFailed"
						? renderAutoRenewEmail(loc, key, {
								storeName: "Sample Store",
								methodLabel: "Visa ·· 4242",
								billingUrl: url,
								planLabel: "Pro · Monthly",
								amountFormatted: sampleTotal,
								chargeDateFormatted: "5 Jul 2026",
								payNowUrl: samplePayNow,
								final: false,
							})
						: renderBillingEmail(loc, key, {
								storeName: "Sample Store",
								invoiceNumber: "INV-202607-SAMPLE",
								planLabel: "Pro · Monthly",
								totalFormatted: sampleTotal,
								baseFormatted: withDiscount ? sampleBase : undefined,
								discountFormatted: withDiscount ? sampleDiscount : undefined,
								dueDateFormatted: "5 Jul 2026",
								bankName: crossBorder ? undefined : "Maybank",
								bankAccountName: crossBorder ? undefined : "Kedaipal Sdn Bhd",
								bankAccountNumber: crossBorder ? undefined : "5123 4567 8901",
								duitnowId: crossBorder ? undefined : "kedaipal",
								crossBorder,
								payNowUrl: samplePayNow,
								billingUrl: url,
							});
		await sendEmail(to, rendered.subject, rendered.html, rendered.text);
		return { sent: to, key };
	},
});

/** Send a retailer-only (no invoice) notice — trial nudges or the lapsed notice.
 * Shared by the named actions below. Fire-and-forget. */
async function sendRetailerNotice(
	ctx: ActionCtx,
	retailerId: Id<"retailers">,
	key: TrialEmailKey,
	daysLeft?: number,
	endsOnFormatted?: string,
): Promise<void> {
	let meta: {
		notifyEmail: string | undefined;
		storeName: string;
		locale: Locale;
	} | null = null;
	try {
		meta = await ctx.runQuery(internal.billingEmail.getRetailerForEmail, {
			retailerId,
		});
	} catch (err) {
		console.error(`Retailer notice ${key} lookup failed`, err);
		return;
	}
	if (!meta || !meta.notifyEmail) return;
	const { subject, html, text } = renderTrialEmail(meta.locale, key, {
		storeName: meta.storeName,
		billingUrl: billingPageUrl(),
		daysLeft,
		endsOnFormatted,
	});
	try {
		await sendEmail(meta.notifyEmail, subject, html, text);
	} catch (err) {
		console.error(
			`Retailer notice ${key} failed (${retailerId}, to=${meta.notifyEmail}): ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}

/** Free-period nudge (no invoice): `trialEndingSoon` (~3 days before the
 * backstop) — scheduled by the daily cron. The old `trialEnded` lock notice is
 * gone with start-when-you-sell: the free period ending now ISSUES a first
 * invoice (`firstInvoice*` keys above), and only that invoice going overdue
 * locks — which sends the ordinary `invoiceOverdue`. */
export const notifyTrialEmail = internalAction({
	args: {
		retailerId: v.id("retailers"),
		key: v.union(v.literal("trialEndingSoon")),
		daysLeft: v.optional(v.number()),
	},
	handler: async (ctx, { retailerId, key, daysLeft }): Promise<void> => {
		await sendRetailerNotice(ctx, retailerId, key, daysLeft);
	},
});

/**
 * Founding-benefit lifecycle notices (z8r3fdfyw5), both scheduled by the daily
 * pass (`foundingMembers.internalRevokeLapsedBenefits`):
 * `foundingBenefitsEndingSoon` at T-14 and `foundingBenefitsEnded` once it is
 * taken. `endsOnAt` is the date from `foundingBenefitsEndAt` — the SAME author
 * the cron's gate and the billing-tab banner read, so the email can't promise a
 * date the cron doesn't honour. Fire-and-forget like every other billing email:
 * the revoke itself has already committed, so a bounced email must never undo
 * it (and never blocks it — Zaki, 18 Sep 2026).
 */
export const notifyFoundingBenefitsEmail = internalAction({
	args: {
		retailerId: v.id("retailers"),
		key: v.union(
			v.literal("foundingBenefitsEndingSoon"),
			v.literal("foundingBenefitsEnded"),
		),
		endsOnAt: v.number(),
	},
	handler: async (ctx, { retailerId, key, endsOnAt }): Promise<void> => {
		await sendRetailerNotice(
			ctx,
			retailerId,
			key,
			undefined,
			formatDueDate(endsOnAt),
		);
	},
});

/** Off-Season Hold notices (z8r3fday24): `holdStarted` (what's paused, what
 * stays live, the hold price, when it bills, how to resume) and `holdResumed`
 * (the tier is back; whether its invoice is on its way now or at period end).
 * Scheduled by subscriptions.setSeasonalHold. Fire-and-forget. */
export const notifyHoldEmail = internalAction({
	args: {
		retailerId: v.id("retailers"),
		key: v.union(v.literal("holdStarted"), v.literal("holdResumed")),
		billsNow: v.boolean(),
		billsFromAt: v.optional(v.number()),
	},
	handler: async (ctx, { retailerId, key, billsNow, billsFromAt }): Promise<void> => {
		let meta: {
			notifyEmail: string | undefined;
			storeName: string;
			locale: Locale;
			plan: string;
			currency: BillingCurrency;
		} | null = null;
		try {
			meta = await ctx.runQuery(internal.billingEmail.getHoldEmailContext, {
				retailerId,
			});
		} catch (err) {
			console.error(`Hold notice ${key} lookup failed`, err);
			return;
		}
		if (!meta || !meta.notifyEmail) return;
		const { subject, html, text } = renderHoldEmail(meta.locale, key, {
			storeName: meta.storeName,
			billingUrl: billingPageUrl(),
			planLabel: meta.plan.charAt(0).toUpperCase() + meta.plan.slice(1),
			holdPriceFormatted: formatMoney(
				HOLD_MONTHLY_PRICES[meta.currency],
				meta.currency,
			),
			billsNow,
			billsFromFormatted:
				billsFromAt !== undefined ? formatDueDate(billsFromAt) : undefined,
		});
		try {
			await sendEmail(meta.notifyEmail, subject, html, text);
		} catch (err) {
			console.error(
				`Hold notice ${key} failed (${retailerId}, to=${meta.notifyEmail}): ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	},
});

/** Contact + tier + billing currency for the hold notices. */
export const getHoldEmailContext = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		notifyEmail: string | undefined;
		storeName: string;
		locale: Locale;
		plan: string;
		currency: BillingCurrency;
	} | null> => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return null;
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		return {
			notifyEmail: retailer.notifyEmail,
			storeName: retailer.storeName,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			plan: sub?.plan ?? "pro",
			currency: BILLING_CURRENCY_FOR_COUNTRY[retailer.country ?? "MY"],
		};
	},
});

/** Scheduled by invoices.markPaid — a "welcome" on the retailer's first-ever
 * payment, a "thanks" on every renewal after. Same logo'd template. */
export const notifyPaymentReceived = internalAction({
	args: { invoiceId: v.id("invoices"), firstTime: v.boolean() },
	handler: async (ctx, { invoiceId, firstTime }): Promise<void> => {
		let meta: InvoiceEmailMeta | null = null;
		try {
			meta = await ctx.runQuery(internal.billingEmail.getInvoiceForEmail, {
				invoiceId,
			});
		} catch (err) {
			console.error("Payment-received email lookup failed", err);
			return;
		}
		if (!meta || !meta.notifyEmail) return;
		const key: PaymentEmailKey = firstTime ? "welcome" : "thanks";
		const { subject, html, text } = renderPaymentEmail(meta.locale, key, {
			storeName: meta.storeName,
			planLabel: planLabel(meta.plan, meta.billingCycle, meta.kind),
			totalFormatted: formatMoney(meta.total, meta.currency),
			dashboardUrl: billingPageUrl(),
		});
		try {
			await sendEmail(meta.notifyEmail, subject, html, text);
		} catch (err) {
			console.error(
				`Payment-received email failed (${meta.invoiceNumber}): ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	},
});

// --- Auto-renewal notices (86eyb6z4r) ---------------------------------------

/** Everything the auto-renew notices need: contact + the seller's CURRENT
 * renewal price (plan/cycle/founding/currency-aware — the number the upcoming
 * charge will actually be) + the pending invoice's Pay-now link for the
 * failure notice. */
export const getAutoRenewEmailContext = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		notifyEmail: string | undefined;
		storeName: string;
		locale: Locale;
		planLabel: string;
		amountFormatted: string;
		payNowUrl: string | undefined;
	} | null> => {
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return null;
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) return null;
		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.collect();
		const lastPaid = invoices.find((inv) => inv.status === "paid");
		const pending = invoices.find((inv) => inv.status === "pending");
		// The heads-up must quote exactly what the renewal will charge, so it
		// reads the same author as the cron's invoice (z8r3fdfty4): a scheduled
		// downgrade lands WITH the renewal (quote the plan they're moving to,
		// not the one they're leaving), and a PAUSED subscription renews the
		// hold, not the tier — the hold price outranks a scheduled plan change,
		// which only lands when they resume (z8r3fday24 × 86eyb6z4r).
		const quote = renewalQuote({
			status: sub.status,
			plan: sub.plan,
			billingCycle: sub.billingCycle,
			pendingPlanChange: sub.pendingPlanChange?.plan,
			isFoundingMember: retailer.isFoundingMember === true,
			foundingIntent: sub.foundingIntent === true,
			benefitsRevokedAt: retailer.foundingBenefitsRevokedAt,
			benefitsRestoredAt: retailer.foundingBenefitsRestoredAt,
			paidThrough: sub.currentPeriodEnd,
			lastPaidCurrency: lastPaid?.currency,
			country: retailer.country,
			now: Date.now(),
		});
		return {
			notifyEmail: retailer.notifyEmail,
			storeName: retailer.storeName,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			planLabel: planLabel(quote.plan, quote.billingCycle, quote.kind),
			amountFormatted: formatMoney(quote.amount, quote.currency),
			payNowUrl: pending?.gatewayPayment?.url,
		};
	},
});

/** The three auto-renewal notices: setup confirmation, the pre-charge
 * "renewing soon" heads-up (once per cycle — no surprise merchant-initiated
 * debits), and the charge-failure dunning notice. Fire-and-forget like every
 * other billing email. */
export const notifyAutoRenewEmail = internalAction({
	args: {
		retailerId: v.id("retailers"),
		key: v.union(
			v.literal("autoRenewEnabled"),
			v.literal("autoRenewUpcoming"),
			v.literal("autoRenewFailed"),
		),
		methodLabel: v.string(),
		chargeAt: v.optional(v.number()),
		invoiceId: v.optional(v.id("invoices")),
		final: v.optional(v.boolean()),
	},
	handler: async (
		ctx,
		{ retailerId, key, methodLabel, chargeAt, final },
	): Promise<void> => {
		let meta: {
			notifyEmail: string | undefined;
			storeName: string;
			locale: Locale;
			planLabel: string;
			amountFormatted: string;
			payNowUrl: string | undefined;
		} | null = null;
		try {
			meta = await ctx.runQuery(internal.billingEmail.getAutoRenewEmailContext, {
				retailerId,
			});
		} catch (err) {
			console.error(`Auto-renew email ${key} lookup failed`, err);
			return;
		}
		if (!meta || !meta.notifyEmail) return;
		const { subject, html, text } = renderAutoRenewEmail(
			meta.locale,
			key as AutoRenewEmailKey,
			{
				storeName: meta.storeName,
				methodLabel,
				billingUrl: billingPageUrl(),
				planLabel: meta.planLabel,
				amountFormatted: meta.amountFormatted,
				chargeDateFormatted:
					chargeAt !== undefined ? formatDueDate(chargeAt) : undefined,
				payNowUrl: meta.payNowUrl,
				final,
			},
		);
		try {
			await sendEmail(meta.notifyEmail, subject, html, text);
		} catch (err) {
			console.error(
				`Auto-renew email ${key} failed (${retailerId}): ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	},
});
