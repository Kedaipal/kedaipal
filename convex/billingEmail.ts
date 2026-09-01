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
	renderPaymentEmail,
	renderTrialEmail,
	type TrialEmailKey,
} from "./lib/billingEmailCopy";
import { sendEmail } from "./lib/email";
import type { Locale } from "./lib/emailCopy";
import {
	BILLING_CURRENCY_FOR_COUNTRY,
	type BillingCurrency,
	planPrice,
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

function planLabel(plan: string, cycle: string): string {
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
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
			plan: sub?.plan ?? "pro",
			billingCycle: sub?.billingCycle ?? "monthly",
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
		planLabel: planLabel(meta.plan, meta.billingCycle),
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

/** Scheduled by invoices.issueInvoice — "here's your new invoice + how to pay". */
export const notifyInvoiceIssued = internalAction({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }): Promise<void> => {
		await sendInvoiceEmail(ctx, invoiceId, "invoiceIssued");
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
			v.literal("trialEndingSoon"),
			v.literal("trialEnded"),
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
				: key === "trialEndingSoon" || key === "trialEnded"
					? renderTrialEmail(loc, key, {
							storeName: "Sample Store",
							billingUrl: url,
							daysLeft: 3,
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

/** Trial nudges (no invoice). `trialEndingSoon` (~3 days left) and `trialEnded`
 * (locked) — scheduled by the daily cron. */
export const notifyTrialEmail = internalAction({
	args: {
		retailerId: v.id("retailers"),
		key: v.union(v.literal("trialEndingSoon"), v.literal("trialEnded")),
		daysLeft: v.optional(v.number()),
	},
	handler: async (ctx, { retailerId, key, daysLeft }): Promise<void> => {
		await sendRetailerNotice(ctx, retailerId, key, daysLeft);
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
			planLabel: planLabel(meta.plan, meta.billingCycle),
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

/** Scheduled when the daily cron locks a paid vendor whose period lapsed with no
 * pending invoice. Since 86eyb6z4r the cron ISSUES the renewal instead of
 * locking, so this no longer fires in the normal flow — kept (path-stable) for
 * any in-flight scheduled call across the deploy. */
export const notifySubscriptionLapsed = internalAction({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		await sendRetailerNotice(ctx, retailerId, "subscriptionLapsed");
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
		const currency: BillingCurrency =
			lastPaid?.currency === "SGD" || lastPaid?.currency === "MYR"
				? lastPaid.currency
				: BILLING_CURRENCY_FOR_COUNTRY[retailer.country ?? "MY"];
		const founding =
			retailer.isFoundingMember === true &&
			(sub.plan === "pro" || sub.plan === "scale");
		const amount = planPrice(sub.plan, sub.billingCycle, founding, currency);
		return {
			notifyEmail: retailer.notifyEmail,
			storeName: retailer.storeName,
			locale: (retailer.locale as Locale | undefined) ?? "en",
			planLabel: planLabel(sub.plan, sub.billingCycle),
			amountFormatted: formatMoney(amount, currency),
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
