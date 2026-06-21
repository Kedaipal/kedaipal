// Retailer-facing BILLING email copy (subscription invoices). Kept separate from
// the order-event emails (emailCopy.ts) because the data is a different domain —
// invoice number / amount / due date / pay instructions, not order lines. Pure (no
// Convex imports) so it's unit-testable. Bilingual en / ms. Reuses the shared HTML
// shell from emailCopy.ts.

import { escapeHtml, type Locale, wrapHtml } from "./emailCopy";

export type BillingEmailKey = "invoiceIssued" | "invoiceReminder";

export type BillingEmailVars = {
	storeName: string;
	invoiceNumber: string;
	planLabel: string; // e.g. "Pro · Monthly" (built by the caller)
	totalFormatted: string; // e.g. "MYR 104.00"
	// Set only when a founding discount applies, to show the struck price + saving.
	baseFormatted?: string;
	discountFormatted?: string;
	dueDateFormatted: string; // e.g. "5 Jul 2026"
	// Kedaipal payment details (from billingConfig) — any subset may be present.
	bankName?: string;
	bankAccountName?: string;
	bankAccountNumber?: string;
	duitnowId?: string;
	billingUrl: string;
};

type RenderedEmail = { subject: string; html: string; text: string };

const t = {
	en: {
		bank: "Bank",
		accountName: "Account name",
		accountNo: "Account no.",
		duitnow: "DuitNow",
		howToPay: "How to pay",
		qrNote: "Or scan the DuitNow QR on your billing page.",
		noDetails: "Open your billing page for the payment details and QR.",
		cta: "View invoice & pay",
		wasPrefix: "was",
		foundingDiscount: "founding discount",
	},
	ms: {
		bank: "Bank",
		accountName: "Nama akaun",
		accountNo: "No. akaun",
		duitnow: "DuitNow",
		howToPay: "Cara bayar",
		qrNote: "Atau imbas kod QR DuitNow di halaman bil anda.",
		noDetails: "Buka halaman bil anda untuk butiran pembayaran dan QR.",
		cta: "Lihat bil & bayar",
		wasPrefix: "asal",
		foundingDiscount: "diskaun pengasas",
	},
} as const;

/** Localized "how to pay" lines from whatever bank fields are present. */
function payLines(locale: Locale, v: BillingEmailVars): string[] {
	const L = t[locale];
	const rows: string[] = [];
	if (v.bankName) rows.push(`${L.bank}: <strong>${escapeHtml(v.bankName)}</strong>`);
	if (v.bankAccountName)
		rows.push(`${L.accountName}: ${escapeHtml(v.bankAccountName)}`);
	if (v.bankAccountNumber)
		rows.push(`${L.accountNo}: <strong>${escapeHtml(v.bankAccountNumber)}</strong>`);
	if (v.duitnowId) rows.push(`${L.duitnow}: <strong>${escapeHtml(v.duitnowId)}</strong>`);
	if (rows.length === 0) return [L.noDetails];
	return [`<strong>${L.howToPay}</strong>`, ...rows, L.qrNote];
}

/** Plain-text version of the pay lines (no HTML tags). */
function payText(locale: Locale, v: BillingEmailVars): string {
	const L = t[locale];
	const rows: string[] = [];
	if (v.bankName) rows.push(`${L.bank}: ${v.bankName}`);
	if (v.bankAccountName) rows.push(`${L.accountName}: ${v.bankAccountName}`);
	if (v.bankAccountNumber) rows.push(`${L.accountNo}: ${v.bankAccountNumber}`);
	if (v.duitnowId) rows.push(`${L.duitnow}: ${v.duitnowId}`);
	if (rows.length === 0) return L.noDetails;
	return `${L.howToPay}:\n${rows.join("\n")}\n${L.qrNote}`;
}

function amountLine(locale: Locale, v: BillingEmailVars): string {
	const L = t[locale];
	if (v.baseFormatted && v.discountFormatted) {
		return `<strong>${escapeHtml(v.totalFormatted)}</strong> (${L.wasPrefix} ${escapeHtml(v.baseFormatted)}, ${escapeHtml(v.discountFormatted)} ${L.foundingDiscount})`;
	}
	return `<strong>${escapeHtml(v.totalFormatted)}</strong>`;
}

function amountText(locale: Locale, v: BillingEmailVars): string {
	const L = t[locale];
	if (v.baseFormatted && v.discountFormatted) {
		return `${v.totalFormatted} (${L.wasPrefix} ${v.baseFormatted}, ${v.discountFormatted} ${L.foundingDiscount})`;
	}
	return v.totalFormatted;
}

const render: Record<
	Locale,
	Record<BillingEmailKey, (v: BillingEmailVars) => RenderedEmail>
> = {
	en: {
		invoiceIssued: (v) => {
			const subject = `🧾 New invoice ${v.invoiceNumber} · ${v.totalFormatted}`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, here's your Kedaipal subscription invoice.`,
				`<strong>${escapeHtml(v.invoiceNumber)}</strong> · ${escapeHtml(v.planLabel)}`,
				amountLine("en", v),
				`Due by <strong>${escapeHtml(v.dueDateFormatted)}</strong>.`,
				...payLines("en", v),
			];
			const html = wrapHtml("🧾", `New invoice ${v.invoiceNumber}`, lines, v.billingUrl, t.en.cta);
			const text = `🧾 New invoice ${v.invoiceNumber}\n${v.planLabel} · ${amountText("en", v)}\nDue by ${v.dueDateFormatted}.\n\n${payText("en", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		invoiceReminder: (v) => {
			const subject = `⏰ Reminder: invoice ${v.invoiceNumber} due ${v.dueDateFormatted}`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, a quick reminder that your Kedaipal invoice is due soon.`,
				`<strong>${escapeHtml(v.invoiceNumber)}</strong> · ${escapeHtml(v.planLabel)} · ${amountLine("en", v)}`,
				`Due by <strong>${escapeHtml(v.dueDateFormatted)}</strong>. Pay before then to keep your store fully active.`,
				...payLines("en", v),
			];
			const html = wrapHtml("⏰", `Invoice ${v.invoiceNumber} due soon`, lines, v.billingUrl, t.en.cta);
			const text = `⏰ Reminder: invoice ${v.invoiceNumber} due ${v.dueDateFormatted}\n${v.planLabel} · ${amountText("en", v)}\nPay before then to keep your store fully active.\n\n${payText("en", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
	ms: {
		invoiceIssued: (v) => {
			const subject = `🧾 Bil baru ${v.invoiceNumber} · ${v.totalFormatted}`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, ini bil langganan Kedaipal anda.`,
				`<strong>${escapeHtml(v.invoiceNumber)}</strong> · ${escapeHtml(v.planLabel)}`,
				amountLine("ms", v),
				`Perlu dibayar sebelum <strong>${escapeHtml(v.dueDateFormatted)}</strong>.`,
				...payLines("ms", v),
			];
			const html = wrapHtml("🧾", `Bil baru ${v.invoiceNumber}`, lines, v.billingUrl, t.ms.cta);
			const text = `🧾 Bil baru ${v.invoiceNumber}\n${v.planLabel} · ${amountText("ms", v)}\nPerlu dibayar sebelum ${v.dueDateFormatted}.\n\n${payText("ms", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		invoiceReminder: (v) => {
			const subject = `⏰ Peringatan: bil ${v.invoiceNumber} perlu dibayar ${v.dueDateFormatted}`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, peringatan ringkas bahawa bil Kedaipal anda akan tiba tempoh.`,
				`<strong>${escapeHtml(v.invoiceNumber)}</strong> · ${escapeHtml(v.planLabel)} · ${amountLine("ms", v)}`,
				`Perlu dibayar sebelum <strong>${escapeHtml(v.dueDateFormatted)}</strong>. Bayar sebelum itu untuk memastikan kedai anda aktif sepenuhnya.`,
				...payLines("ms", v),
			];
			const html = wrapHtml("⏰", `Bil ${v.invoiceNumber} akan tiba tempoh`, lines, v.billingUrl, t.ms.cta);
			const text = `⏰ Peringatan: bil ${v.invoiceNumber} perlu dibayar ${v.dueDateFormatted}\n${v.planLabel} · ${amountText("ms", v)}\nBayar sebelum itu untuk memastikan kedai anda aktif sepenuhnya.\n\n${payText("ms", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
};

export function renderBillingEmail(
	locale: Locale,
	key: BillingEmailKey,
	vars: BillingEmailVars,
): RenderedEmail {
	return render[locale][key](vars);
}
