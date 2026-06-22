// Subscription-invoice emails to the retailer: an issue-time "new invoice" and a
// pre-due-date reminder. Scheduled fire-and-forget (errors swallowed + logged) so
// the originating mutation/cron never fails on an outbound issue — mirrors the
// order-alert emails in convex/email.ts. Pure copy lives in lib/billingEmailCopy.ts.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalQuery } from "./_generated/server";
import {
	type BillingEmailKey,
	renderBillingEmail,
	renderTrialEmail,
	type TrialEmailKey,
} from "./lib/billingEmailCopy";
import { sendEmail } from "./lib/email";
import type { Locale } from "./lib/emailCopy";

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
		const config = await ctx.db.query("billingConfig").first();
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
 * Add "locale":"ms" or "founding":true to preview those variants.
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
		),
		locale: v.optional(v.union(v.literal("en"), v.literal("ms"))),
		founding: v.optional(v.boolean()),
	},
	handler: async (
		_ctx,
		{ to, key, locale, founding },
	): Promise<{ sent: string; key: string }> => {
		const loc: Locale = locale ?? "en";
		const url = billingPageUrl();
		const rendered =
			key === "trialEndingSoon" || key === "trialEnded"
				? renderTrialEmail(loc, key, {
						storeName: "Sample Store",
						billingUrl: url,
						daysLeft: 3,
					})
				: renderBillingEmail(loc, key, {
						storeName: "Sample Store",
						invoiceNumber: "INV-202607-SAMPLE",
						planLabel: "Pro · Monthly",
						totalFormatted: founding ? "MYR 104.00" : "MYR 149.00",
						baseFormatted: founding ? "MYR 149.00" : undefined,
						discountFormatted: founding ? "MYR 45.00" : undefined,
						dueDateFormatted: "5 Jul 2026",
						bankName: "Maybank",
						bankAccountName: "Kedaipal Sdn Bhd",
						bankAccountNumber: "5123 4567 8901",
						duitnowId: "kedaipal",
						billingUrl: url,
					});
		await sendEmail(to, rendered.subject, rendered.html, rendered.text);
		return { sent: to, key };
	},
});

/** Trial nudges (no invoice). `trialEndingSoon` (~3 days left) and `trialEnded`
 * (locked) — scheduled by the daily cron. Fire-and-forget. */
export const notifyTrialEmail = internalAction({
	args: {
		retailerId: v.id("retailers"),
		key: v.union(v.literal("trialEndingSoon"), v.literal("trialEnded")),
		daysLeft: v.optional(v.number()),
	},
	handler: async (ctx, { retailerId, key, daysLeft }): Promise<void> => {
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
			console.error(`Trial email ${key} lookup failed`, err);
			return;
		}
		if (!meta || !meta.notifyEmail) return;
		const { subject, html, text } = renderTrialEmail(
			meta.locale,
			key as TrialEmailKey,
			{ storeName: meta.storeName, billingUrl: billingPageUrl(), daysLeft },
		);
		try {
			await sendEmail(meta.notifyEmail, subject, html, text);
		} catch (err) {
			console.error(
				`Trial email ${key} failed (${retailerId}, to=${meta.notifyEmail}): ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	},
});
