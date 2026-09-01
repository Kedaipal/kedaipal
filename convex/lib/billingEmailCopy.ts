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
	// Non-MYR invoice (e.g. an SGD-billed Singapore seller): the configured MY
	// bank/DuitNow rails aren't payable in that currency, so the pay panel becomes
	// a "we'll confirm payment details on WhatsApp" line instead. Callers must
	// leave the bank fields unset alongside this flag.
	crossBorder?: boolean;
	// HitPay hosted-checkout link for this invoice (86eyb6z4r). Present ⇒ the
	// pay panel leads with a "Pay online now" button; the manual rails stay
	// underneath as the fallback. Works for cross-border invoices too — it's
	// the ONLY self-serve rail an SGD seller has.
	payNowUrl?: string;
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
		contactForPayment:
			"We'll confirm payment details with you on WhatsApp — quote {invoiceNumber} as your payment reference.",
		cta: "View invoice & pay",
		wasPrefix: "was",
		foundingDiscount: "founding discount",
		storeStaysLive:
			"Your storefront and existing orders stay live — editing your store is paused until you pay.",
		choosePlan: "Choose a plan",
		payNow: "Pay online now",
		payNowHint: "Card, banking or eWallet — confirmed automatically.",
		orManual: "Prefer a bank transfer? The manual details are below.",
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
		contactForPayment:
			"Kami akan sahkan butiran pembayaran dengan anda melalui WhatsApp — gunakan {invoiceNumber} sebagai rujukan pembayaran.",
		cta: "Lihat bil & bayar",
		wasPrefix: "asal",
		foundingDiscount: "diskaun pengasas",
		storeStaysLive:
			"Storefront dan pesanan sedia ada kekal aktif — penyuntingan kedai dijeda sehingga anda membayar.",
		choosePlan: "Pilih pelan",
		payNow: "Bayar dalam talian",
		payNowHint: "Kad, perbankan atau eWallet — disahkan secara automatik.",
		orManual: "Lebih suka pindahan bank? Butiran manual di bawah.",
	},
	zh: {
		bank: "银行",
		accountName: "账户名称",
		accountNo: "账户号码",
		duitnow: "DuitNow",
		howToPay: "付款方式",
		invoice: "账单",
		plan: "套餐",
		amount: "金额",
		dueDate: "到期日",
		qrNote: "或扫描账单页面上的 DuitNow QR 码。",
		noDetails: "请打开您的账单页面查看付款详情和 QR 码。",
		contactForPayment:
			"我们会通过 WhatsApp 与您确认付款方式 —— 付款时请注明 {invoiceNumber} 作为参考。",
		cta: "查看账单并付款",
		wasPrefix: "原价",
		foundingDiscount: "创始会员折扣",
		storeStaysLive:
			"您的商店和现有订单会继续正常运作 —— 付款前暂停编辑功能。",
		choosePlan: "选择套餐",
		payNow: "立即在线付款",
		payNowHint: "银行卡、网银或电子钱包 —— 自动确认到账。",
		orManual: "想用银行转账？手动付款详情见下方。",
	},
} as const;

/** The cross-border pay line with the invoice number substituted in. */
function contactForPaymentLine(locale: Locale, v: BillingEmailVars): string {
	return t[locale].contactForPayment.replace(
		"{invoiceNumber}",
		v.invoiceNumber,
	);
}

/** Plain-text version of the pay lines (no HTML tags). */
function payText(locale: Locale, v: BillingEmailVars): string {
	const L = t[locale];
	const payNow = v.payNowUrl ? `${L.payNow}: ${v.payNowUrl}\n` : "";
	if (v.crossBorder) return `${payNow}${contactForPaymentLine(locale, v)}`;
	const rows: string[] = [];
	if (v.bankName) rows.push(`${L.bank}: ${v.bankName}`);
	if (v.bankAccountName) rows.push(`${L.accountName}: ${v.bankAccountName}`);
	if (v.bankAccountNumber) rows.push(`${L.accountNo}: ${v.bankAccountNumber}`);
	if (v.duitnowId) rows.push(`${L.duitnow}: ${v.duitnowId}`);
	if (rows.length === 0) return `${payNow}${L.noDetails}`;
	return `${payNow}${L.howToPay}:\n${rows.join("\n")}\n${L.qrNote}`;
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

/** The lead "Pay online now" block when the invoice carries a HitPay link —
 * rendered ABOVE whatever manual rail applies. */
function payNowBlock(locale: Locale, v: BillingEmailVars): string {
	if (!v.payNowUrl) return "";
	const L = t[locale];
	const safeUrl = escapeHtml(v.payNowUrl);
	return `<div style="border:1px solid #a7f3d0;background:#ecfdf5;border-radius:16px;padding:16px;margin:0 0 12px 0;">
<a href="${safeUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:12px 18px;border-radius:12px;">${escapeHtml(L.payNow)}</a>
<p style="margin:10px 0 0 0;font-size:12px;line-height:1.5;color:#047857;">${escapeHtml(L.payNowHint)}</p>
</div>`;
}

function paymentPanel(locale: Locale, v: BillingEmailVars): string {
	const L = t[locale];
	const payNow = payNowBlock(locale, v);
	if (v.crossBorder) {
		return `${payNow}<div style="border:1px solid #dbeafe;background:#eff6ff;border-radius:16px;padding:16px;">
<p style="margin:0;font-size:13px;line-height:1.6;color:#1e3a8a;">${escapeHtml(contactForPaymentLine(locale, v))}</p>
</div>`;
	}
	const rows = [
		v.bankName ? paymentRow(L.bank, v.bankName, true) : "",
		v.bankAccountName ? paymentRow(L.accountName, v.bankAccountName) : "",
		v.bankAccountNumber ? paymentRow(L.accountNo, v.bankAccountNumber, true) : "",
		v.duitnowId ? paymentRow(L.duitnow, v.duitnowId, true) : "",
	].join("");
	if (!rows) {
		return `${payNow}<div style="border:1px solid #dbeafe;background:#eff6ff;border-radius:16px;padding:16px;">
<p style="margin:0;font-size:13px;line-height:1.6;color:#1e3a8a;">${escapeHtml(L.noDetails)}</p>
</div>`;
	}
	return `${payNow}<div style="border:1px solid #e5e7eb;background:#ffffff;border-radius:16px;padding:16px;">
<p style="margin:0 0 10px 0;font-size:13px;font-weight:800;color:#111827;">${escapeHtml(payNow ? L.orManual : L.howToPay)}</p>
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
	zh: {
		invoiceIssued: (v) => {
			const subject = `🧾 新账单 ${v.invoiceNumber} · ${v.totalFormatted}`;
			const html = wrapBillingHtml(
				"zh",
				"invoiceIssued",
				"您的 Kedaipal 账单已就绪",
				`您好 ${escapeHtml(v.storeName)}，您的订阅账单已经准备好了，请在下方到期日前付清。`,
				v,
				t.zh.cta,
			);
			const text = `🧾 新账单 ${v.invoiceNumber}\n${v.planLabel} · ${amountText("zh", v)}\n请在 ${v.dueDateFormatted} 前付款。\n\n${payText("zh", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		invoiceReminder: (v) => {
			const subject = `⏰ 提醒：账单 ${v.invoiceNumber} 将于 ${v.dueDateFormatted} 到期`;
			const html = wrapBillingHtml(
				"zh",
				"invoiceReminder",
				"您的账单即将到期",
				`您好 ${escapeHtml(v.storeName)}，提醒您在到期日前付清 Kedaipal 账单。`,
				v,
				t.zh.cta,
			);
			const text = `⏰ 提醒：账单 ${v.invoiceNumber} 将于 ${v.dueDateFormatted} 到期\n${v.planLabel} · ${amountText("zh", v)}\n请在到期前付款，让您的商店保持完整运作。\n\n${payText("zh", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		invoiceOverdue: (v) => {
			const subject = `🔒 您的订阅已逾期 · ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"zh",
				"invoiceOverdue",
				"您的订阅已逾期",
				`您好 ${escapeHtml(v.storeName)}，您的 Kedaipal 订阅目前已逾期。${escapeHtml(t.zh.storeStaysLive)}`,
				v,
				t.zh.cta,
			);
			const text = `🔒 您的订阅已逾期 · ${v.invoiceNumber}\n${t.zh.storeStaysLive}\n${v.planLabel} · ${amountText("zh", v)}\n\n${payText("zh", v)}\n\n${v.billingUrl}`;
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
	zh: {
		trialEndingSoon: (v) => {
			const d = v.daysLeft ?? 0;
			const dayStr = `${d} 天`;
			const subject = `⏰ 您的 Kedaipal 试用期还剩 ${dayStr}`;
			const lines = [
				`您好 ${escapeHtml(v.storeName)}，您的免费试用期还剩 <strong>${dayStr}</strong>。`,
				"选择一个套餐，继续壮大您的商店 —— 商店会保持正常运作，但试用期结束后编辑功能会暂停。",
			];
			const html = wrapHtml("⏰", `试用期还剩 ${dayStr}`, lines, v.billingUrl, t.zh.choosePlan);
			const text = `⏰ 您的 Kedaipal 试用期还剩 ${dayStr}\n选择一个套餐，继续壮大您的商店 —— 试用期结束后编辑功能会暂停。\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		trialEnded: (v) => {
			const subject = "🔒 您的 Kedaipal 免费试用期已结束";
			const lines = [
				`您好 ${escapeHtml(v.storeName)}，您的免费试用期已经结束。`,
				t.zh.storeStaysLive,
				"选择一个套餐，继续壮大您的商店。",
			];
			const html = wrapHtml("🔒", "您的免费试用期已结束", lines, v.billingUrl, t.zh.choosePlan);
			const text = `🔒 您的 Kedaipal 免费试用期已结束\n${t.zh.storeStaysLive}\n选择一个套餐继续使用。\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		subscriptionLapsed: (v) => {
			const subject = "🔒 您的 Kedaipal 订阅已失效";
			const lines = [
				`您好 ${escapeHtml(v.storeName)}，您的订阅期已经结束，还未续订。`,
				t.zh.storeStaysLive,
				"联系我们续订，我们会把账单发给您。",
			];
			const html = wrapHtml("🔒", "您的订阅已失效", lines, v.billingUrl, t.zh.choosePlan);
			const text = `🔒 您的 Kedaipal 订阅已失效\n${t.zh.storeStaysLive}\n联系我们续订，我们会把账单发给您。\n\n${v.billingUrl}`;
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

/** Payment-received emails — sent when an admin marks an invoice paid. `welcome`
 * for a retailer's first-ever payment, `thanks` for a renewal. No invoice/pay
 * panel (it's already settled) — same logo'd shell as the rest. */
export type PaymentEmailKey = "welcome" | "thanks";

export type PaymentEmailVars = {
	storeName: string;
	planLabel: string; // e.g. "Pro · Monthly"
	totalFormatted: string; // e.g. "MYR 104.00"
	dashboardUrl: string;
};

const paymentRender: Record<
	Locale,
	Record<PaymentEmailKey, (v: PaymentEmailVars) => RenderedEmail>
> = {
	en: {
		welcome: (v) => {
			const subject = `🎉 Welcome to Kedaipal ${v.planLabel.split(" ")[0]}`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your payment landed — your <strong>${escapeHtml(v.planLabel)}</strong> plan is now active.`,
				`Welcome aboard, and thank you for choosing Kedaipal. Here's to growing your store.`,
			];
			const html = wrapHtml("🎉", "Payment received — welcome!", lines, v.dashboardUrl, "Open dashboard");
			const text = `🎉 Welcome to Kedaipal\nYour payment landed — your ${v.planLabel} plan is now active.\nThank you for choosing Kedaipal.\n\n${v.dashboardUrl}`;
			return { subject, html, text };
		},
		thanks: (v) => {
			const subject = "🙏 Thanks for your payment";
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, we've received your <strong>${escapeHtml(v.planLabel)}</strong> payment of ${escapeHtml(v.totalFormatted)}.`,
				`Thanks for your continued support — it genuinely means a lot.`,
			];
			const html = wrapHtml("🙏", "Payment received — thank you", lines, v.dashboardUrl, "Open dashboard");
			const text = `🙏 Thanks for your payment\nWe've received your ${v.planLabel} payment of ${v.totalFormatted}.\nThanks for your continued support.\n\n${v.dashboardUrl}`;
			return { subject, html, text };
		},
	},
	ms: {
		welcome: (v) => {
			const subject = `🎉 Selamat datang ke Kedaipal ${v.planLabel.split(" ")[0]}`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, pembayaran anda telah diterima — pelan <strong>${escapeHtml(v.planLabel)}</strong> anda kini aktif.`,
				`Selamat menyertai, dan terima kasih kerana memilih Kedaipal. Semoga kedai anda terus berkembang.`,
			];
			const html = wrapHtml("🎉", "Pembayaran diterima — selamat datang!", lines, v.dashboardUrl, "Buka dashboard");
			const text = `🎉 Selamat datang ke Kedaipal\nPembayaran anda telah diterima — pelan ${v.planLabel} anda kini aktif.\nTerima kasih kerana memilih Kedaipal.\n\n${v.dashboardUrl}`;
			return { subject, html, text };
		},
		thanks: (v) => {
			const subject = "🙏 Terima kasih atas pembayaran anda";
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, kami telah menerima pembayaran <strong>${escapeHtml(v.planLabel)}</strong> anda sebanyak ${escapeHtml(v.totalFormatted)}.`,
				`Terima kasih atas sokongan berterusan anda — ia amat bermakna.`,
			];
			const html = wrapHtml("🙏", "Pembayaran diterima — terima kasih", lines, v.dashboardUrl, "Buka dashboard");
			const text = `🙏 Terima kasih atas pembayaran anda\nKami telah menerima pembayaran ${v.planLabel} anda sebanyak ${v.totalFormatted}.\nTerima kasih atas sokongan anda.\n\n${v.dashboardUrl}`;
			return { subject, html, text };
		},
	},
	zh: {
		welcome: (v) => {
			const subject = `🎉 欢迎加入 Kedaipal ${v.planLabel.split(" ")[0]}`;
			const lines = [
				`您好 ${escapeHtml(v.storeName)}，我们已收到您的付款 —— 您的 <strong>${escapeHtml(v.planLabel)}</strong> 套餐现已生效。`,
				`欢迎加入，感谢您选择 Kedaipal。祝您的商店生意兴隆。`,
			];
			const html = wrapHtml("🎉", "已收到付款 —— 欢迎加入！", lines, v.dashboardUrl, "打开后台");
			const text = `🎉 欢迎加入 Kedaipal\n我们已收到您的付款 —— 您的 ${v.planLabel} 套餐现已生效。\n感谢您选择 Kedaipal。\n\n${v.dashboardUrl}`;
			return { subject, html, text };
		},
		thanks: (v) => {
			const subject = "🙏 感谢您的付款";
			const lines = [
				`您好 ${escapeHtml(v.storeName)}，我们已收到您 <strong>${escapeHtml(v.planLabel)}</strong> 套餐的付款，金额 ${escapeHtml(v.totalFormatted)}。`,
				`感谢您一直以来的支持 —— 这对我们意义重大。`,
			];
			const html = wrapHtml("🙏", "已收到付款 —— 谢谢", lines, v.dashboardUrl, "打开后台");
			const text = `🙏 感谢您的付款\n我们已收到您 ${v.planLabel} 套餐的付款，金额 ${v.totalFormatted}。\n感谢您一直以来的支持。\n\n${v.dashboardUrl}`;
			return { subject, html, text };
		},
	},
};

export function renderPaymentEmail(
	locale: Locale,
	key: PaymentEmailKey,
	vars: PaymentEmailVars,
): RenderedEmail {
	return paymentRender[locale][key](vars);
}

export function renderBillingEmail(
	locale: Locale,
	key: BillingEmailKey,
	vars: BillingEmailVars,
): RenderedEmail {
	return render[locale][key](vars);
}

/**
 * Auto-renewal notices (86eyb6z4r): the setup confirmation, the one-per-cycle
 * "renewing soon" heads-up before a merchant-initiated charge (the
 * no-surprise-debit rule), and the charge-failure dunning notice. Same small
 * shell as the trial emails — these are notices, not invoices.
 */
export type AutoRenewEmailKey =
	| "autoRenewEnabled"
	| "autoRenewUpcoming"
	| "autoRenewFailed";

export type AutoRenewEmailVars = {
	storeName: string;
	/** "Card" / "Touch 'n Go" / "Visa ·· 4242". */
	methodLabel: string;
	billingUrl: string;
	/** upcoming only. */
	planLabel?: string;
	amountFormatted?: string;
	chargeDateFormatted?: string;
	/** failed only. */
	payNowUrl?: string;
	final?: boolean;
};

const autoRenewRender: Record<
	Locale,
	Record<AutoRenewEmailKey, (v: AutoRenewEmailVars) => RenderedEmail>
> = {
	en: {
		autoRenewEnabled: (v) => {
			const subject = "✅ Auto-renewal is on";
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, auto-renewal is now on for your Kedaipal subscription using <strong>${escapeHtml(v.methodLabel)}</strong>.`,
				"Each renewal will be charged automatically and you'll get a receipt every time. You can turn this off any time in Settings → Billing.",
			];
			const html = wrapHtml("✅", "Auto-renewal is on", lines, v.billingUrl, "View billing");
			const text = `✅ Auto-renewal is on\nYour Kedaipal subscription will renew automatically using ${v.methodLabel}. You'll get a receipt for every charge, and you can turn it off any time in Settings → Billing.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		autoRenewUpcoming: (v) => {
			const subject = `🔄 Your Kedaipal plan renews on ${v.chargeDateFormatted}`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your <strong>${escapeHtml(v.planLabel ?? "Kedaipal")}</strong> plan renews on <strong>${escapeHtml(v.chargeDateFormatted ?? "")}</strong>.`,
				`We'll charge ${escapeHtml(v.amountFormatted ?? "the renewal amount")} to your ${escapeHtml(v.methodLabel)} automatically — nothing for you to do.`,
				"Not planning to continue? Turn off auto-renewal in Settings → Billing before then.",
			];
			const html = wrapHtml("🔄", `Renewing on ${v.chargeDateFormatted}`, lines, v.billingUrl, "View billing");
			const text = `🔄 Your Kedaipal plan renews on ${v.chargeDateFormatted}\nWe'll charge ${v.amountFormatted ?? "the renewal amount"} to your ${v.methodLabel} automatically. Turn off auto-renewal in Settings → Billing if you don't want this.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		autoRenewFailed: (v) => {
			const subject = v.final
				? "⚠️ We couldn't charge your saved payment method"
				: "⚠️ Renewal payment failed — we'll retry";
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, we tried to charge your <strong>${escapeHtml(v.methodLabel)}</strong> for your Kedaipal renewal and it didn't go through.`,
				v.final
					? "We've stopped retrying. Pay your invoice online or by bank transfer to keep your store fully active — or update your payment method for next time."
					: "We'll retry automatically in a couple of days. You can also pay now, or update your payment method, and it's settled straight away.",
			];
			const cta = v.payNowUrl ?? v.billingUrl;
			const html = wrapHtml("⚠️", "Renewal payment failed", lines, cta, "Pay now");
			const text = `⚠️ Renewal payment failed\nWe tried to charge your ${v.methodLabel} and it didn't go through. ${v.final ? "We've stopped retrying — pay online or by bank transfer to keep your store fully active." : "We'll retry in a couple of days, or pay now to settle it straight away."}\n\n${cta}`;
			return { subject, html, text };
		},
	},
	ms: {
		autoRenewEnabled: (v) => {
			const subject = "✅ Pembaharuan automatik telah diaktifkan";
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, pembaharuan automatik kini aktif untuk langganan Kedaipal anda menggunakan <strong>${escapeHtml(v.methodLabel)}</strong>.`,
				"Setiap pembaharuan akan dicaj secara automatik dan anda akan menerima resit setiap kali. Anda boleh mematikannya bila-bila masa di Tetapan → Bil.",
			];
			const html = wrapHtml("✅", "Pembaharuan automatik aktif", lines, v.billingUrl, "Lihat bil");
			const text = `✅ Pembaharuan automatik telah diaktifkan\nLangganan Kedaipal anda akan diperbaharui secara automatik menggunakan ${v.methodLabel}. Anda akan menerima resit untuk setiap caj, dan boleh mematikannya bila-bila masa di Tetapan → Bil.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		autoRenewUpcoming: (v) => {
			const subject = `🔄 Pelan Kedaipal anda diperbaharui pada ${v.chargeDateFormatted}`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, pelan <strong>${escapeHtml(v.planLabel ?? "Kedaipal")}</strong> anda akan diperbaharui pada <strong>${escapeHtml(v.chargeDateFormatted ?? "")}</strong>.`,
				`Kami akan mencaj ${escapeHtml(v.amountFormatted ?? "jumlah pembaharuan")} ke ${escapeHtml(v.methodLabel)} anda secara automatik — tiada apa yang perlu anda buat.`,
				"Tidak mahu meneruskan? Matikan pembaharuan automatik di Tetapan → Bil sebelum tarikh itu.",
			];
			const html = wrapHtml("🔄", `Diperbaharui pada ${v.chargeDateFormatted}`, lines, v.billingUrl, "Lihat bil");
			const text = `🔄 Pelan Kedaipal anda diperbaharui pada ${v.chargeDateFormatted}\nKami akan mencaj ${v.amountFormatted ?? "jumlah pembaharuan"} ke ${v.methodLabel} anda secara automatik. Matikan pembaharuan automatik di Tetapan → Bil jika anda tidak mahu.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		autoRenewFailed: (v) => {
			const subject = v.final
				? "⚠️ Kami tidak dapat mencaj kaedah pembayaran anda"
				: "⚠️ Caj pembaharuan gagal — kami akan cuba lagi";
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, kami cuba mencaj <strong>${escapeHtml(v.methodLabel)}</strong> anda untuk pembaharuan Kedaipal tetapi tidak berjaya.`,
				v.final
					? "Kami telah berhenti mencuba. Bayar bil anda dalam talian atau melalui pindahan bank untuk memastikan kedai anda aktif sepenuhnya — atau kemas kini kaedah pembayaran untuk kali seterusnya."
					: "Kami akan cuba lagi secara automatik dalam beberapa hari. Anda juga boleh bayar sekarang, atau kemas kini kaedah pembayaran, dan ia selesai serta-merta.",
			];
			const cta = v.payNowUrl ?? v.billingUrl;
			const html = wrapHtml("⚠️", "Caj pembaharuan gagal", lines, cta, "Bayar sekarang");
			const text = `⚠️ Caj pembaharuan gagal\nKami cuba mencaj ${v.methodLabel} anda tetapi tidak berjaya. ${v.final ? "Kami telah berhenti mencuba — bayar dalam talian atau melalui pindahan bank untuk memastikan kedai anda aktif sepenuhnya." : "Kami akan cuba lagi dalam beberapa hari, atau bayar sekarang untuk menyelesaikannya serta-merta."}\n\n${cta}`;
			return { subject, html, text };
		},
	},
	zh: {
		autoRenewEnabled: (v) => {
			const subject = "✅ 自动续订已开启";
			const lines = [
				`您好 ${escapeHtml(v.storeName)}，您的 Kedaipal 订阅已开启自动续订，使用 <strong>${escapeHtml(v.methodLabel)}</strong>。`,
				"每次续订都会自动扣款，并且每次都会收到收据。您可以随时在 设置 → 账单 中关闭。",
			];
			const html = wrapHtml("✅", "自动续订已开启", lines, v.billingUrl, "查看账单");
			const text = `✅ 自动续订已开启\n您的 Kedaipal 订阅将使用 ${v.methodLabel} 自动续订。每次扣款都会收到收据，您可以随时在 设置 → 账单 中关闭。\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		autoRenewUpcoming: (v) => {
			const subject = `🔄 您的 Kedaipal 套餐将于 ${v.chargeDateFormatted} 续订`;
			const lines = [
				`您好 ${escapeHtml(v.storeName)}，您的 <strong>${escapeHtml(v.planLabel ?? "Kedaipal")}</strong> 套餐将于 <strong>${escapeHtml(v.chargeDateFormatted ?? "")}</strong> 续订。`,
				`我们会自动从您的 ${escapeHtml(v.methodLabel)} 扣除 ${escapeHtml(v.amountFormatted ?? "续订金额")} —— 您无需任何操作。`,
				"不打算继续？请在此之前到 设置 → 账单 关闭自动续订。",
			];
			const html = wrapHtml("🔄", `将于 ${v.chargeDateFormatted} 续订`, lines, v.billingUrl, "查看账单");
			const text = `🔄 您的 Kedaipal 套餐将于 ${v.chargeDateFormatted} 续订\n我们会自动从您的 ${v.methodLabel} 扣除 ${v.amountFormatted ?? "续订金额"}。如不需要，请到 设置 → 账单 关闭自动续订。\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		autoRenewFailed: (v) => {
			const subject = v.final
				? "⚠️ 我们无法从您保存的付款方式扣款"
				: "⚠️ 续订扣款失败 —— 我们会重试";
			const lines = [
				`您好 ${escapeHtml(v.storeName)}，我们尝试从您的 <strong>${escapeHtml(v.methodLabel)}</strong> 扣除 Kedaipal 续订费用，但没有成功。`,
				v.final
					? "我们已停止重试。请在线支付账单或通过银行转账，让您的商店保持完整运作 —— 也可以更新付款方式以备下次使用。"
					: "我们会在几天后自动重试。您也可以立即付款，或更新付款方式，马上完成结算。",
			];
			const cta = v.payNowUrl ?? v.billingUrl;
			const html = wrapHtml("⚠️", "续订扣款失败", lines, cta, "立即付款");
			const text = `⚠️ 续订扣款失败\n我们尝试从您的 ${v.methodLabel} 扣款但没有成功。${v.final ? "我们已停止重试 —— 请在线支付或通过银行转账，让您的商店保持完整运作。" : "我们会在几天后重试，您也可以立即付款马上完成结算。"}\n\n${cta}`;
			return { subject, html, text };
		},
	},
};

export function renderAutoRenewEmail(
	locale: Locale,
	key: AutoRenewEmailKey,
	vars: AutoRenewEmailVars,
): RenderedEmail {
	return autoRenewRender[locale][key](vars);
}
