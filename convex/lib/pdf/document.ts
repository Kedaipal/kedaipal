// Pure, render-free building blocks for the two PDF documents Kedaipal issues:
//   A) order receipts (buyer-facing, generated on demand — see orders.ts)
//   B) subscription invoices (Kedaipal -> seller, stored at issue — see invoices.ts)
//
// Everything here is a plain function over plain data — NO pdf-lib, NO Convex
// server imports — so the money/date formatting and the doc->view mappers are
// unit-testable in isolation. The actual drawing lives in `./render.ts`, which
// consumes the `*Data` view-models produced below.
//
// Money is stored in MINOR units (sen) everywhere — see src/lib/format.ts — so
// every amount here is sen and `formatMoney` divides by 100.

// Malaysia is UTC+8 with no DST, so a fixed offset renders the correct calendar
// day without depending on the runtime's timezone database.
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** Epoch ms -> "30 Jun 2026" in Malaysia time (UTC+8). Deterministic. */
export function formatDocDate(epochMs: number): string {
	const d = new Date(epochMs + MYT_OFFSET_MS);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Epoch ms -> "Jun 2026" billing-period label in Malaysia time. */
export function formatPeriodLabel(epochMs: number): string {
	const d = new Date(epochMs + MYT_OFFSET_MS);
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Minor units (sen) -> "RM 1,234.50". Falls back to a `<CODE> <amount>` prefix
 * for any non-MYR currency. Kept ASCII (no Unicode currency glyphs) so it encodes
 * cleanly in pdf-lib's standard WinAnsi fonts.
 */
export function formatMoney(minorUnits: number, currency: string): string {
	const negative = minorUnits < 0;
	const major = Math.abs(minorUnits) / 100;
	const fixed = major.toFixed(2);
	const [intPart, frac] = fixed.split(".");
	const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	const prefix = currency === "MYR" ? "RM" : currency;
	return `${negative ? "-" : ""}${prefix} ${grouped}.${frac}`;
}

// --- View-models -----------------------------------------------------------

export type ReceiptLineItem = {
	name: string;
	variantLabel?: string;
	quantity: number;
	unitPrice: number; // sen
};

/** A payment destination flattened to printable lines (bank block or a QR note). */
export type PaymentBlock = {
	label: string;
	lines: string[];
};

export type OrderReceiptData = {
	storeName: string;
	orderShortId: string;
	orderDate: number; // createdAt
	paidDate?: number; // paymentReceivedAt, when settled
	paymentStatusLabel: string;
	customerName?: string;
	customerPhone?: string;
	items: ReceiptLineItem[];
	subtotal: number; // sen
	total: number; // sen
	currency: string;
	fulfilmentDate?: number;
	customerNote?: string;
	paymentBlocks: PaymentBlock[];
};

export type SubscriptionInvoiceData = {
	invoiceNumber: string;
	billedToName: string;
	billedToContact?: string;
	issuedAt: number;
	dueDate: number;
	periodStart: number;
	periodEnd: number;
	planLineLabel: string;
	amount: number; // sen, pre-discount
	foundingDiscount?: number; // sen
	total: number; // sen
	currency: string;
	issuerBank: PaymentBlock[];
};

// --- Pure mappers (Doc -> view-model) --------------------------------------

type OrderForReceipt = {
	shortId: string;
	createdAt: number;
	paymentReceivedAt?: number;
	paymentStatus?: "unpaid" | "claimed" | "received";
	customer: { name?: string; waPhone?: string };
	items: Array<{
		name: string;
		variantLabel?: string;
		quantity: number;
		price: number;
	}>;
	subtotal: number;
	total: number;
	currency: string;
	fulfilmentDate?: number;
	customerNote?: string;
};

type PaymentMethodForReceipt = {
	type: "bank" | "qr";
	label: string;
	bankName?: string;
	bankAccountName?: string;
	bankAccountNumber?: string;
	note?: string;
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
	unpaid: "Awaiting payment",
	claimed: "Payment claimed",
	received: "Paid",
};

/** Flatten a retailer's resolved payment methods into printable receipt blocks. */
export function paymentMethodsToBlocks(
	methods: PaymentMethodForReceipt[],
): PaymentBlock[] {
	const blocks: PaymentBlock[] = [];
	for (const m of methods) {
		if (m.type === "bank") {
			const lines = [
				m.bankName,
				m.bankAccountName,
				m.bankAccountNumber,
				m.note,
			].filter((l): l is string => Boolean(l && l.trim()));
			blocks.push({ label: m.label, lines });
		} else {
			// QR images can't be embedded in the text receipt — point the buyer at
			// the live surfaces that do show it.
			blocks.push({
				label: m.label,
				lines: ["Scan the QR shown on WhatsApp or your tracking page."],
			});
		}
	}
	return blocks;
}

export function orderToReceiptData(args: {
	order: OrderForReceipt;
	storeName: string;
	paymentMethods: PaymentMethodForReceipt[];
}): OrderReceiptData {
	const { order, storeName, paymentMethods } = args;
	const status = order.paymentStatus ?? "unpaid";
	return {
		storeName,
		orderShortId: order.shortId,
		orderDate: order.createdAt,
		paidDate: status === "received" ? order.paymentReceivedAt : undefined,
		paymentStatusLabel: PAYMENT_STATUS_LABEL[status] ?? "Awaiting payment",
		customerName: order.customer.name?.trim() || undefined,
		customerPhone: order.customer.waPhone?.trim() || undefined,
		items: order.items.map((it) => ({
			name: it.name,
			variantLabel: it.variantLabel?.trim() || undefined,
			quantity: it.quantity,
			unitPrice: it.price,
		})),
		subtotal: order.subtotal,
		total: order.total,
		currency: order.currency,
		fulfilmentDate: order.fulfilmentDate,
		customerNote: order.customerNote?.trim() || undefined,
		paymentBlocks: paymentMethodsToBlocks(paymentMethods),
	};
}

type InvoiceForPdf = {
	invoiceNumber: string;
	plan?: "starter" | "pro" | "scale";
	billingCycle?: "monthly" | "annual";
	amount: number;
	foundingDiscount?: number;
	total: number;
	currency: string;
	periodStart: number;
	periodEnd: number;
	dueDate: number;
	createdAt: number;
};

type RetailerForInvoice = {
	storeName: string;
	waPhone?: string;
	slug: string;
};

type BillingConfigForInvoice = {
	bankName?: string;
	bankAccountName?: string;
	bankAccountNumber?: string;
	duitnowId?: string;
};

const PLAN_DISPLAY: Record<string, string> = {
	starter: "Starter",
	pro: "Pro",
	scale: "Scale",
};

/** Human line-item label for a subscription invoice, e.g.
 * "Kedaipal Founding 10 Seller Plan - Monthly Subscription". */
export function subscriptionLineLabel(invoice: {
	plan?: "starter" | "pro" | "scale";
	billingCycle?: "monthly" | "annual";
	foundingDiscount?: number;
}): string {
	const cycle = invoice.billingCycle === "annual" ? "Annual" : "Monthly";
	if (invoice.foundingDiscount !== undefined) {
		return `Kedaipal Founding 10 Seller Plan - ${cycle} Subscription`;
	}
	const plan = PLAN_DISPLAY[invoice.plan ?? "pro"] ?? "Pro";
	return `Kedaipal ${plan} Plan - ${cycle} Subscription`;
}

/** Flatten Kedaipal's billing config into the issuer payment block(s). */
export function billingConfigToBlocks(
	config: BillingConfigForInvoice | null | undefined,
): PaymentBlock[] {
	if (!config) return [];
	const blocks: PaymentBlock[] = [];
	const bankLines = [
		config.bankName,
		config.bankAccountName,
		config.bankAccountNumber,
	].filter((l): l is string => Boolean(l && l.trim()));
	if (bankLines.length > 0) {
		blocks.push({ label: "Bank transfer", lines: bankLines });
	}
	if (config.duitnowId?.trim()) {
		blocks.push({ label: "DuitNow", lines: [config.duitnowId.trim()] });
	}
	return blocks;
}

export function invoiceToSubscriptionData(args: {
	invoice: InvoiceForPdf;
	retailer: RetailerForInvoice;
	billingConfig: BillingConfigForInvoice | null | undefined;
}): SubscriptionInvoiceData {
	const { invoice, retailer, billingConfig } = args;
	return {
		invoiceNumber: invoice.invoiceNumber,
		billedToName: retailer.storeName,
		billedToContact: retailer.waPhone?.trim() || `kedaipal.com/${retailer.slug}`,
		issuedAt: invoice.createdAt,
		dueDate: invoice.dueDate,
		periodStart: invoice.periodStart,
		periodEnd: invoice.periodEnd,
		planLineLabel: subscriptionLineLabel(invoice),
		amount: invoice.amount,
		foundingDiscount: invoice.foundingDiscount,
		total: invoice.total,
		currency: invoice.currency,
		issuerBank: billingConfigToBlocks(billingConfig),
	};
}
