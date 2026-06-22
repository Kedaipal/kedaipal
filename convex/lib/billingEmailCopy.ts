// Retailer-facing BILLING email copy (subscription invoices). Kept separate from
// the order-event emails (emailCopy.ts) because the data is a different domain —
// invoice number / amount / due date / pay instructions, not order lines. Pure (no
// Convex imports) so it's unit-testable. Bilingual en / ms. Reuses the shared HTML
// shell from emailCopy.ts.

import { escapeHtml, type Locale, wrapHtml } from "./emailCopy";

export type BillingEmailKey =
	| "invoiceIssued"
	| "invoiceReminder"
	| "invoiceOverdue";

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
		storeStaysLive:
			"Your storefront and existing orders stay live — editing your store is paused until you pay.",
		choosePlan: "Choose a plan",
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
		storeStaysLive:
			"Storefront dan pesanan sedia ada kekal aktif — penyuntingan kedai dijeda sehingga anda membayar.",
		choosePlan: "Pilih pelan",
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
		invoiceOverdue: (v) => {
			const subject = `🔒 Your subscription is past due · ${v.invoiceNumber}`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your Kedaipal subscription is now past due.`,
				t.en.storeStaysLive,
				`<strong>${escapeHtml(v.invoiceNumber)}</strong> · ${escapeHtml(v.planLabel)} · ${amountLine("en", v)}`,
				...payLines("en", v),
			];
			const html = wrapHtml("🔒", "Your subscription is past due", lines, v.billingUrl, t.en.cta);
			const text = `🔒 Your subscription is past due · ${v.invoiceNumber}\n${t.en.storeStaysLive}\n${v.planLabel} · ${amountText("en", v)}\n\n${payText("en", v)}\n\n${v.billingUrl}`;
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
		invoiceOverdue: (v) => {
			const subject = `🔒 Langganan anda telah tertunggak · ${v.invoiceNumber}`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, langganan Kedaipal anda kini telah tertunggak.`,
				t.ms.storeStaysLive,
				`<strong>${escapeHtml(v.invoiceNumber)}</strong> · ${escapeHtml(v.planLabel)} · ${amountLine("ms", v)}`,
				...payLines("ms", v),
			];
			const html = wrapHtml("🔒", "Langganan anda telah tertunggak", lines, v.billingUrl, t.ms.cta);
			const text = `🔒 Langganan anda telah tertunggak · ${v.invoiceNumber}\n${t.ms.storeStaysLive}\n${v.planLabel} · ${amountText("ms", v)}\n\n${payText("ms", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
};

/** Trial emails — no invoice attached, so a separate (smaller) var shape. */
export type TrialEmailKey = "trialEndingSoon" | "trialEnded";

export type TrialEmailVars = {
	storeName: string;
	billingUrl: string;
	daysLeft?: number; // only for trialEndingSoon
};

const trialRender: Record<
	Locale,
	Record<TrialEmailKey, (v: TrialEmailVars) => RenderedEmail>
> = {
	en: {
		trialEndingSoon: (v) => {
			const d = v.daysLeft ?? 0;
			const dayStr = `${d} day${d === 1 ? "" : "s"}`;
			const subject = `⏰ Your Kedaipal trial ends in ${dayStr}`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your free trial ends in <strong>${dayStr}</strong>.`,
				"Choose a plan to keep growing your store — your storefront stays live, but editing pauses when the trial ends.",
			];
			const html = wrapHtml("⏰", `Your trial ends in ${dayStr}`, lines, v.billingUrl, t.en.choosePlan);
			const text = `⏰ Your Kedaipal trial ends in ${dayStr}\nChoose a plan to keep growing your store — editing pauses when the trial ends.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		trialEnded: (v) => {
			const subject = "🔒 Your Kedaipal free trial has ended";
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your free trial has ended.`,
				t.en.storeStaysLive,
				"Choose a plan to continue growing your store.",
			];
			const html = wrapHtml("🔒", "Your free trial has ended", lines, v.billingUrl, t.en.choosePlan);
			const text = `🔒 Your Kedaipal free trial has ended\n${t.en.storeStaysLive}\nChoose a plan to continue.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
	ms: {
		trialEndingSoon: (v) => {
			const d = v.daysLeft ?? 0;
			const dayStr = `${d} hari`;
			const subject = `⏰ Percubaan Kedaipal anda tamat dalam ${dayStr}`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, percubaan percuma anda tamat dalam <strong>${dayStr}</strong>.`,
				"Pilih pelan untuk terus mengembangkan kedai anda — storefront kekal aktif, tetapi penyuntingan dijeda apabila percubaan tamat.",
			];
			const html = wrapHtml("⏰", `Percubaan tamat dalam ${dayStr}`, lines, v.billingUrl, t.ms.choosePlan);
			const text = `⏰ Percubaan Kedaipal anda tamat dalam ${dayStr}\nPilih pelan untuk terus mengembangkan kedai anda — penyuntingan dijeda apabila percubaan tamat.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		trialEnded: (v) => {
			const subject = "🔒 Percubaan percuma Kedaipal anda telah tamat";
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, percubaan percuma anda telah tamat.`,
				t.ms.storeStaysLive,
				"Pilih pelan untuk terus mengembangkan kedai anda.",
			];
			const html = wrapHtml("🔒", "Percubaan percuma anda telah tamat", lines, v.billingUrl, t.ms.choosePlan);
			const text = `🔒 Percubaan percuma Kedaipal anda telah tamat\n${t.ms.storeStaysLive}\nPilih pelan untuk terus.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
};

export function renderTrialEmail(
	locale: Locale,
	key: TrialEmailKey,
	vars: TrialEmailVars,
): RenderedEmail {
	return trialRender[locale][key](vars);
}

export function renderBillingEmail(
	locale: Locale,
	key: BillingEmailKey,
	vars: BillingEmailVars,
): RenderedEmail {
	return render[locale][key](vars);
}
