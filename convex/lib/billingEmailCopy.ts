// Retailer-facing BILLING email copy (subscription invoices). Kept separate from
// the order-event emails (emailCopy.ts) because the data is a different domain —
// invoice number / amount / due date / pay instructions, not order lines. Pure (no
// Convex imports) so it's unit-testable. Bilingual en / ms. Reuses the shared HTML
// shell is intentionally local here because invoices need a richer summary +
// payment-details layout than order alerts.

import { escapeHtml, type Locale, logoHeader, wrapHtml } from "./emailCopy";

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
		invoice: "Invoice",
		plan: "Plan",
		amount: "Amount",
		dueDate: "Due date",
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
		invoice: "Bil",
		plan: "Pelan",
		amount: "Jumlah",
		dueDate: "Tarikh akhir",
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

function amountText(locale: Locale, v: BillingEmailVars): string {
	const L = t[locale];
	if (v.baseFormatted && v.discountFormatted) {
		return `${v.totalFormatted} (${L.wasPrefix} ${v.baseFormatted}, ${v.discountFormatted} ${L.foundingDiscount})`;
	}
	return v.totalFormatted;
}

function invoiceStatusTone(key: BillingEmailKey): {
	accent: string;
	bg: string;
	labelBg: string;
	labelColor: string;
} {
	if (key === "invoiceOverdue") {
		return {
			accent: "#dc2626",
			bg: "#fef2f2",
			labelBg: "#fee2e2",
			labelColor: "#991b1b",
		};
	}
	if (key === "invoiceReminder") {
		return {
			accent: "#10b981",
			bg: "#ecfdf5",
			labelBg: "#d1fae5",
			labelColor: "#047857",
		};
	}
	return {
		accent: "#10b981",
		bg: "#ecfdf5",
		labelBg: "#d1fae5",
		labelColor: "#047857",
	};
}

function summaryTile(label: string, value: string, muted = false): string {
	return `<td style="width:50%;padding:6px;">
<div style="border:1px solid #e5e7eb;border-radius:14px;padding:14px;background:#ffffff;">
<p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${escapeHtml(label)}</p>
<p style="margin:0;font-size:${muted ? "14px" : "18px"};line-height:1.35;font-weight:800;color:#111827;">${value}</p>
</div>
</td>`;
}

function paymentRow(label: string, value: string, strong = false): string {
	return `<tr>
<td style="padding:10px 0;border-top:1px solid #e5e7eb;font-size:12px;color:#64748b;">${escapeHtml(label)}</td>
<td align="right" style="padding:10px 0;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.4;color:#111827;${strong ? "font-weight:800;" : "font-weight:600;"}">${escapeHtml(value)}</td>
</tr>`;
}

function paymentPanel(locale: Locale, v: BillingEmailVars): string {
	const L = t[locale];
	const rows = [
		v.bankName ? paymentRow(L.bank, v.bankName, true) : "",
		v.bankAccountName ? paymentRow(L.accountName, v.bankAccountName) : "",
		v.bankAccountNumber ? paymentRow(L.accountNo, v.bankAccountNumber, true) : "",
		v.duitnowId ? paymentRow(L.duitnow, v.duitnowId, true) : "",
	].join("");
	if (!rows) {
		return `<div style="border:1px solid #dbeafe;background:#eff6ff;border-radius:16px;padding:16px;">
<p style="margin:0;font-size:13px;line-height:1.6;color:#1e3a8a;">${escapeHtml(L.noDetails)}</p>
</div>`;
	}
	return `<div style="border:1px solid #e5e7eb;background:#ffffff;border-radius:16px;padding:16px;">
<p style="margin:0 0 10px 0;font-size:13px;font-weight:800;color:#111827;">${escapeHtml(L.howToPay)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<p style="margin:12px 0 0 0;font-size:12px;line-height:1.5;color:#64748b;">${escapeHtml(L.qrNote)}</p>
</div>`;
}

function discountHtml(locale: Locale, v: BillingEmailVars): string {
	const L = t[locale];
	if (!v.baseFormatted || !v.discountFormatted) return "";
	return `<p style="margin:6px 0 0 0;font-size:12px;line-height:1.5;color:#047857;">
${escapeHtml(v.baseFormatted)} ${escapeHtml(L.wasPrefix)} · ${escapeHtml(v.discountFormatted)} ${escapeHtml(L.foundingDiscount)}
</p>`;
}

function wrapBillingHtml(
	locale: Locale,
	key: BillingEmailKey,
	headline: string,
	intro: string,
	v: BillingEmailVars,
	ctaLabel: string,
): string {
	const L = t[locale];
	const tone = invoiceStatusTone(key);
	const safeUrl = escapeHtml(v.billingUrl);
	return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;padding:28px 14px;">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.06);">
<tr><td style="height:6px;background:${tone.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 20px 28px;">
${logoHeader(18)}
<div style="display:inline-block;margin:0 0 14px 0;padding:6px 10px;border-radius:999px;background:${tone.labelBg};color:${tone.labelColor};font-size:12px;font-weight:800;">${escapeHtml(v.invoiceNumber)}</div>
<h1 style="margin:0;font-size:26px;line-height:1.18;color:#0f172a;">${escapeHtml(headline)}</h1>
<p style="margin:12px 0 0 0;font-size:15px;line-height:1.65;color:#475569;">${intro}</p>
</td></tr>
<tr><td style="padding:0 22px 8px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
${summaryTile(L.amount, escapeHtml(v.totalFormatted))}
${summaryTile(L.dueDate, escapeHtml(v.dueDateFormatted))}
</tr>
<tr>
${summaryTile(L.plan, escapeHtml(v.planLabel), true)}
${summaryTile(L.invoice, escapeHtml(v.invoiceNumber), true)}
</tr>
</table>
</td></tr>
<tr><td style="padding:8px 28px 0 28px;">
${discountHtml(locale, v)}
</td></tr>
<tr><td style="padding:20px 28px 0 28px;">
${paymentPanel(locale, v)}
</td></tr>
<tr><td style="padding:24px 28px 30px 28px;">
<a href="${safeUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:13px 18px;border-radius:12px;">${escapeHtml(ctaLabel)}</a>
</td></tr>
</table>
<p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">Sent by Kedaipal — your WhatsApp-first order hub.</p>
</td></tr></table></body></html>`;
}

const render: Record<
	Locale,
	Record<BillingEmailKey, (v: BillingEmailVars) => RenderedEmail>
> = {
	en: {
		invoiceIssued: (v) => {
			const subject = `🧾 New invoice ${v.invoiceNumber} · ${v.totalFormatted}`;
			const html = wrapBillingHtml(
				"en",
				"invoiceIssued",
				"Your Kedaipal invoice is ready",
				`Hi ${escapeHtml(v.storeName)}, your subscription invoice is ready. Please settle it by the due date below.`,
				v,
				t.en.cta,
			);
			const text = `🧾 New invoice ${v.invoiceNumber}\n${v.planLabel} · ${amountText("en", v)}\nDue by ${v.dueDateFormatted}.\n\n${payText("en", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		invoiceReminder: (v) => {
			const subject = `⏰ Reminder: invoice ${v.invoiceNumber} due ${v.dueDateFormatted}`;
			const html = wrapBillingHtml(
				"en",
				"invoiceReminder",
				"Your invoice is due soon",
				`Hi ${escapeHtml(v.storeName)}, this is a quick reminder to settle your Kedaipal invoice before the due date.`,
				v,
				t.en.cta,
			);
			const text = `⏰ Reminder: invoice ${v.invoiceNumber} due ${v.dueDateFormatted}\n${v.planLabel} · ${amountText("en", v)}\nPay before then to keep your store fully active.\n\n${payText("en", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		invoiceOverdue: (v) => {
			const subject = `🔒 Your subscription is past due · ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"en",
				"invoiceOverdue",
				"Your subscription is past due",
				`Hi ${escapeHtml(v.storeName)}, your Kedaipal subscription is now past due. ${escapeHtml(t.en.storeStaysLive)}`,
				v,
				t.en.cta,
			);
			const text = `🔒 Your subscription is past due · ${v.invoiceNumber}\n${t.en.storeStaysLive}\n${v.planLabel} · ${amountText("en", v)}\n\n${payText("en", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
	ms: {
		invoiceIssued: (v) => {
			const subject = `🧾 Bil baru ${v.invoiceNumber} · ${v.totalFormatted}`;
			const html = wrapBillingHtml(
				"ms",
				"invoiceIssued",
				"Bil Kedaipal anda sudah sedia",
				`Hai ${escapeHtml(v.storeName)}, bil langganan anda sudah sedia. Sila jelaskan sebelum tarikh akhir di bawah.`,
				v,
				t.ms.cta,
			);
			const text = `🧾 Bil baru ${v.invoiceNumber}\n${v.planLabel} · ${amountText("ms", v)}\nPerlu dibayar sebelum ${v.dueDateFormatted}.\n\n${payText("ms", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		invoiceReminder: (v) => {
			const subject = `⏰ Peringatan: bil ${v.invoiceNumber} perlu dibayar ${v.dueDateFormatted}`;
			const html = wrapBillingHtml(
				"ms",
				"invoiceReminder",
				"Bil anda hampir tiba tempoh",
				`Hai ${escapeHtml(v.storeName)}, ini peringatan ringkas untuk menjelaskan bil Kedaipal anda sebelum tarikh akhir.`,
				v,
				t.ms.cta,
			);
			const text = `⏰ Peringatan: bil ${v.invoiceNumber} perlu dibayar ${v.dueDateFormatted}\n${v.planLabel} · ${amountText("ms", v)}\nBayar sebelum itu untuk memastikan kedai anda aktif sepenuhnya.\n\n${payText("ms", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		invoiceOverdue: (v) => {
			const subject = `🔒 Langganan anda telah tertunggak · ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"ms",
				"invoiceOverdue",
				"Langganan anda telah tertunggak",
				`Hai ${escapeHtml(v.storeName)}, langganan Kedaipal anda kini telah tertunggak. ${escapeHtml(t.ms.storeStaysLive)}`,
				v,
				t.ms.cta,
			);
			const text = `🔒 Langganan anda telah tertunggak · ${v.invoiceNumber}\n${t.ms.storeStaysLive}\n${v.planLabel} · ${amountText("ms", v)}\n\n${payText("ms", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
};

/** Retailer notices with no invoice attached (trial nudges + a lapsed-subscription
 * notice), so a separate (smaller) var shape. */
export type TrialEmailKey =
	| "trialEndingSoon"
	| "trialEnded"
	| "subscriptionLapsed";

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
		subscriptionLapsed: (v) => {
			const subject = "🔒 Your Kedaipal subscription has lapsed";
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your subscription period has ended and isn't renewed yet.`,
				t.en.storeStaysLive,
				"Message us to renew and we'll send your invoice.",
			];
			const html = wrapHtml("🔒", "Your subscription has lapsed", lines, v.billingUrl, t.en.choosePlan);
			const text = `🔒 Your Kedaipal subscription has lapsed\n${t.en.storeStaysLive}\nMessage us to renew and we'll send your invoice.\n\n${v.billingUrl}`;
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
		subscriptionLapsed: (v) => {
			const subject = "🔒 Langganan Kedaipal anda telah luput";
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, tempoh langganan anda telah tamat dan belum diperbaharui.`,
				t.ms.storeStaysLive,
				"Hubungi kami untuk memperbaharui dan kami akan hantar bil anda.",
			];
			const html = wrapHtml("🔒", "Langganan anda telah luput", lines, v.billingUrl, t.ms.choosePlan);
			const text = `🔒 Langganan Kedaipal anda telah luput\n${t.ms.storeStaysLive}\nHubungi kami untuk memperbaharui.\n\n${v.billingUrl}`;
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
