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
	| "invoiceOverdue"
	// Start-when-you-sell (z8r3fday24): the store's FIRST invoice, framed by
	// what ended the free period — the first live order, or the day-14 backstop.
	| "firstInvoiceOrder"
	| "firstInvoiceBackstop"
	// Post-lock recovery chain (z8r3fdg3mh): the two nudges AFTER the lock has
	// landed. `invoiceOverdue` fires on the transition itself; these follow at
	// +3d and +7d past the due date. `recoveryFinal` is the last automatic
	// contact — nothing chases them after it — so it names the Off-Season Hold
	// as the cheaper alternative to walking away.
	| "recoveryNudge"
	| "recoveryFinal";

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
	// Post-lock recovery chain (z8r3fdg3mh). `daysPastDue` states the elapsed
	// time as a fact rather than a threat; `holdPriceFormatted` is the
	// Off-Season Hold monthly price (RM19 / S$9) offered in the final nudge —
	// omitted when a hold makes no sense for this row (already held).
	daysPastDue?: number;
	holdPriceFormatted?: string;
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
		// Post-lock recovery chain (z8r3fdg3mh).
		pastDueDays: "Invoice {invoiceNumber} is {days} days past due.",
		lastReminder:
			"This is our last automatic reminder — after this we'll leave you to it.",
		holdOffer:
			"Between seasons? Pause your plan for {holdPrice} a month instead of cancelling. Your storefront, catalog and order history all stay — new orders just close until you resume.",
		needHelp: "Stuck on something? Reply to this email and we'll sort it out.",
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
		// Post-lock recovery chain (z8r3fdg3mh).
		pastDueDays: "Bil {invoiceNumber} telah lewat {days} hari.",
		lastReminder:
			"Ini peringatan automatik terakhir kami — selepas ini kami takkan kacau lagi.",
		holdOffer:
			"Antara musim? Jeda pelan anda pada {holdPrice} sebulan daripada membatalkannya. Storefront, katalog dan sejarah pesanan anda semuanya kekal — cuma pesanan baharu ditutup sehingga anda sambung semula.",
		needHelp:
			"Ada masalah? Balas e-mel ini dan kami akan bantu selesaikan.",
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
		// Post-lock recovery chain (z8r3fdg3mh).
		pastDueDays: "账单 {invoiceNumber} 已逾期 {days} 天。",
		lastReminder: "这是我们最后一封自动提醒 —— 之后不会再打扰您。",
		holdOffer:
			"季节之间的空档？与其取消，不如以每月 {holdPrice} 暂停您的套餐。您的商店、商品目录和订单记录都会保留 —— 只是暂停接收新订单，直到您恢复。",
		needHelp: "遇到问题？直接回复这封邮件，我们会帮您处理。",
	},
} as const;

/** The cross-border pay line with the invoice number substituted in. */
function contactForPaymentLine(locale: Locale, v: BillingEmailVars): string {
	return t[locale].contactForPayment.replace(
		"{invoiceNumber}",
		v.invoiceNumber,
	);
}

/** "Invoice INV-2609-0007 is 3 days past due." — the recovery chain states the
 * elapsed time as a fact and never guesses: a caller that somehow has no
 * `daysPastDue` gets the invoice number alone rather than "0 days". */
function pastDueLine(locale: Locale, v: BillingEmailVars): string {
	if (v.daysPastDue === undefined) return `${t[locale].invoice} ${v.invoiceNumber}.`;
	return t[locale].pastDueDays
		.replace("{invoiceNumber}", v.invoiceNumber)
		.replace("{days}", String(v.daysPastDue));
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
	if (
		key === "invoiceOverdue" ||
		key === "recoveryNudge" ||
		key === "recoveryFinal"
	) {
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
		// Start-when-you-sell (z8r3fday24): the store's FIRST invoice. Two
		// framings for the one event — the seller either just made a sale
		// (celebrate it, then bill) or ran out the 14-day backstop.
		firstInvoiceOrder: (v) => {
			const subject = `🎉 Your first order is in — your first invoice ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"en",
				"firstInvoiceOrder",
				"Your first order is in!",
				`Hi ${escapeHtml(v.storeName)}, congratulations on your first live order. As promised, that's when your plan starts — your first <strong>${escapeHtml(v.planLabel)}</strong> invoice is below, due by ${escapeHtml(v.dueDateFormatted)}. Your storefront and orders keep running as normal in the meantime, and you can switch to a different plan from your billing page before you pay.`,
				v,
				t.en.cta,
			);
			const text = `🎉 Your first order is in — here's your first invoice ${v.invoiceNumber}\n${v.planLabel} · ${amountText("en", v)}\nDue by ${v.dueDateFormatted}. Your storefront keeps running as normal; switch plan from your billing page before paying if Starter fits better.\n\n${payText("en", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		firstInvoiceBackstop: (v) => {
			const subject = `🧾 Your free period has ended — your first invoice ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"en",
				"firstInvoiceBackstop",
				"Your free period has ended",
				`Hi ${escapeHtml(v.storeName)}, your 14 free days are up — your first <strong>${escapeHtml(v.planLabel)}</strong> invoice is below, due by ${escapeHtml(v.dueDateFormatted)}. Nothing is locked: your storefront stays live and you keep full access while you settle it. Want a different plan? Switch from your billing page before you pay.`,
				v,
				t.en.cta,
			);
			const text = `🧾 Your free period has ended — here's your first invoice ${v.invoiceNumber}\n${v.planLabel} · ${amountText("en", v)}\nDue by ${v.dueDateFormatted}. Nothing is locked — your storefront stays live while you settle it; switch plan from your billing page before paying if Starter fits better.\n\n${payText("en", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		// Post-lock recovery chain (z8r3fdg3mh) — the two nudges AFTER the lock.
		// Both carry the full pay panel: the ONLY thing being asked for is
		// payment, so the button is never more than one line away.
		recoveryNudge: (v) => {
			const subject = `🔒 ${v.storeName} — your dashboard is locked · ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"en",
				"recoveryNudge",
				"Your dashboard is still locked",
				`Hi ${escapeHtml(v.storeName)}, ${escapeHtml(pastDueLine("en", v))} Until it's settled you can't edit your store or manage orders from the dashboard — ${escapeHtml(t.en.storeStaysLive)}`,
				v,
				t.en.cta,
			);
			const text = `🔒 ${v.storeName} — your dashboard is locked\n${pastDueLine("en", v)}\n${v.planLabel} · ${amountText("en", v)}\n${t.en.storeStaysLive}\n\n${payText("en", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		recoveryFinal: (v) => {
			const subject = `Last reminder — ${v.invoiceNumber} is still unpaid`;
			// The hold offer only renders when a price was passed — a row that is
			// already on hold has no cheaper option to move to, and inventing one
			// would send a seller to a button that refuses them.
			const holdLine = v.holdPriceFormatted
				? t.en.holdOffer.replace("{holdPrice}", v.holdPriceFormatted)
				: "";
			const html = wrapBillingHtml(
				"en",
				"recoveryFinal",
				"One last reminder",
				`Hi ${escapeHtml(v.storeName)}, ${escapeHtml(pastDueLine("en", v))} ${escapeHtml(t.en.lastReminder)}${holdLine ? ` ${escapeHtml(holdLine)}` : ""} ${escapeHtml(t.en.needHelp)}`,
				v,
				t.en.cta,
			);
			const text = `Last reminder — ${v.invoiceNumber} is still unpaid\n${pastDueLine("en", v)}\n${v.planLabel} · ${amountText("en", v)}\n${t.en.lastReminder}${holdLine ? `\n${holdLine}` : ""}\n${t.en.needHelp}\n\n${payText("en", v)}\n\n${v.billingUrl}`;
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
		firstInvoiceOrder: (v) => {
			const subject = `🎉 Pesanan pertama anda dah masuk — bil pertama anda ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"ms",
				"firstInvoiceOrder",
				"Pesanan pertama anda dah masuk!",
				`Hai ${escapeHtml(v.storeName)}, tahniah atas pesanan pertama anda. Seperti dijanjikan, di situlah pelan anda bermula — bil <strong>${escapeHtml(v.planLabel)}</strong> pertama anda ada di bawah, perlu dibayar sebelum ${escapeHtml(v.dueDateFormatted)}. Etalase dan pesanan anda terus berjalan seperti biasa, dan anda boleh tukar pelan dari halaman bil sebelum membayar.`,
				v,
				t.ms.cta,
			);
			const text = `🎉 Pesanan pertama anda dah masuk — bil pertama anda ${v.invoiceNumber}\n${v.planLabel} · ${amountText("ms", v)}\nPerlu dibayar sebelum ${v.dueDateFormatted}. Etalase anda terus berjalan seperti biasa; tukar pelan dari halaman bil sebelum membayar jika Starter lebih sesuai.\n\n${payText("ms", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		firstInvoiceBackstop: (v) => {
			const subject = `🧾 Tempoh percuma anda telah tamat — bil pertama anda ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"ms",
				"firstInvoiceBackstop",
				"Tempoh percuma anda telah tamat",
				`Hai ${escapeHtml(v.storeName)}, 14 hari percuma anda telah tamat — bil <strong>${escapeHtml(v.planLabel)}</strong> pertama anda ada di bawah, perlu dibayar sebelum ${escapeHtml(v.dueDateFormatted)}. Tiada apa yang dikunci: etalase anda kekal aktif dan anda masih ada akses penuh sementara menjelaskannya. Mahu pelan lain? Tukar dari halaman bil sebelum membayar.`,
				v,
				t.ms.cta,
			);
			const text = `🧾 Tempoh percuma anda telah tamat — bil pertama anda ${v.invoiceNumber}\n${v.planLabel} · ${amountText("ms", v)}\nPerlu dibayar sebelum ${v.dueDateFormatted}. Tiada apa yang dikunci — etalase anda kekal aktif; tukar pelan dari halaman bil sebelum membayar jika Starter lebih sesuai.\n\n${payText("ms", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		// Post-lock recovery chain (z8r3fdg3mh) — the two nudges AFTER the lock.
		// Both carry the full pay panel: the ONLY thing being asked for is
		// payment, so the button is never more than one line away.
		recoveryNudge: (v) => {
			const subject = `🔒 ${v.storeName} — dashboard anda dikunci · ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"ms",
				"recoveryNudge",
				"Dashboard anda masih dikunci",
				`Hai ${escapeHtml(v.storeName)}, ${escapeHtml(pastDueLine("ms", v))} Sehingga ia dijelaskan, anda tidak boleh menyunting kedai atau menguruskan pesanan dari dashboard — ${escapeHtml(t.ms.storeStaysLive)}`,
				v,
				t.ms.cta,
			);
			const text = `🔒 ${v.storeName} — dashboard anda dikunci\n${pastDueLine("ms", v)}\n${v.planLabel} · ${amountText("ms", v)}\n${t.ms.storeStaysLive}\n\n${payText("ms", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		recoveryFinal: (v) => {
			const subject = `Peringatan terakhir — ${v.invoiceNumber} masih belum dijelaskan`;
			// The hold offer only renders when a price was passed — a row that is
			// already on hold has no cheaper option to move to, and inventing one
			// would send a seller to a button that refuses them.
			const holdLine = v.holdPriceFormatted
				? t.ms.holdOffer.replace("{holdPrice}", v.holdPriceFormatted)
				: "";
			const html = wrapBillingHtml(
				"ms",
				"recoveryFinal",
				"Peringatan terakhir",
				`Hai ${escapeHtml(v.storeName)}, ${escapeHtml(pastDueLine("ms", v))} ${escapeHtml(t.ms.lastReminder)}${holdLine ? ` ${escapeHtml(holdLine)}` : ""} ${escapeHtml(t.ms.needHelp)}`,
				v,
				t.ms.cta,
			);
			const text = `Peringatan terakhir — ${v.invoiceNumber} masih belum dijelaskan\n${pastDueLine("ms", v)}\n${v.planLabel} · ${amountText("ms", v)}\n${t.ms.lastReminder}${holdLine ? `\n${holdLine}` : ""}\n${t.ms.needHelp}\n\n${payText("ms", v)}\n\n${v.billingUrl}`;
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
		firstInvoiceOrder: (v) => {
			const subject = `🎉 您的第一笔订单来了 —— 第一张账单 ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"zh",
				"firstInvoiceOrder",
				"您的第一笔订单来了！",
				`您好 ${escapeHtml(v.storeName)}，恭喜您收到第一笔订单。如约，您的方案从这一刻开始 —— 第一张 <strong>${escapeHtml(v.planLabel)}</strong> 账单见下方，请在 ${escapeHtml(v.dueDateFormatted)} 前付清。在此期间您的商店和订单照常运作；付款前可在账单页面更换方案。`,
				v,
				t.zh.cta,
			);
			const text = `🎉 您的第一笔订单来了 —— 第一张账单 ${v.invoiceNumber}\n${v.planLabel} · ${amountText("zh", v)}\n请在 ${v.dueDateFormatted} 前付款。您的商店照常运作；如果 Starter 更合适，付款前可在账单页面更换方案。\n\n${payText("zh", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		firstInvoiceBackstop: (v) => {
			const subject = `🧾 您的免费期已结束 —— 第一张账单 ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"zh",
				"firstInvoiceBackstop",
				"您的免费期已结束",
				`您好 ${escapeHtml(v.storeName)}，您的 14 天免费期已满 —— 第一张 <strong>${escapeHtml(v.planLabel)}</strong> 账单见下方，请在 ${escapeHtml(v.dueDateFormatted)} 前付清。没有任何功能被锁定：您的商店保持在线，付款期间您仍拥有完整权限。想换个方案？付款前可在账单页面更换。`,
				v,
				t.zh.cta,
			);
			const text = `🧾 您的免费期已结束 —— 第一张账单 ${v.invoiceNumber}\n${v.planLabel} · ${amountText("zh", v)}\n请在 ${v.dueDateFormatted} 前付款。没有任何功能被锁定 —— 您的商店保持在线；如果 Starter 更合适，付款前可在账单页面更换方案。\n\n${payText("zh", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		// Post-lock recovery chain (z8r3fdg3mh) — the two nudges AFTER the lock.
		// Both carry the full pay panel: the ONLY thing being asked for is
		// payment, so the button is never more than one line away.
		recoveryNudge: (v) => {
			const subject = `🔒 ${v.storeName} —— 您的管理后台已锁定 · ${v.invoiceNumber}`;
			const html = wrapBillingHtml(
				"zh",
				"recoveryNudge",
				"您的管理后台仍处于锁定状态",
				`您好 ${escapeHtml(v.storeName)}，${escapeHtml(pastDueLine("zh", v))} 在付清之前，您无法在管理后台编辑店铺或处理订单 —— ${escapeHtml(t.zh.storeStaysLive)}`,
				v,
				t.zh.cta,
			);
			const text = `🔒 ${v.storeName} —— 您的管理后台已锁定\n${pastDueLine("zh", v)}\n${v.planLabel} · ${amountText("zh", v)}\n${t.zh.storeStaysLive}\n\n${payText("zh", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		recoveryFinal: (v) => {
			const subject = `最后提醒 —— ${v.invoiceNumber} 仍未付款`;
			// The hold offer only renders when a price was passed — a row that is
			// already on hold has no cheaper option to move to, and inventing one
			// would send a seller to a button that refuses them.
			const holdLine = v.holdPriceFormatted
				? t.zh.holdOffer.replace("{holdPrice}", v.holdPriceFormatted)
				: "";
			const html = wrapBillingHtml(
				"zh",
				"recoveryFinal",
				"最后一次提醒",
				`您好 ${escapeHtml(v.storeName)}，${escapeHtml(pastDueLine("zh", v))} ${escapeHtml(t.zh.lastReminder)}${holdLine ? ` ${escapeHtml(holdLine)}` : ""} ${escapeHtml(t.zh.needHelp)}`,
				v,
				t.zh.cta,
			);
			const text = `最后提醒 —— ${v.invoiceNumber} 仍未付款\n${pastDueLine("zh", v)}\n${v.planLabel} · ${amountText("zh", v)}\n${t.zh.lastReminder}${holdLine ? `\n${holdLine}` : ""}\n${t.zh.needHelp}\n\n${payText("zh", v)}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
};

/** Retailer notices with no invoice attached — the free-period nudge and the
 * founding-benefit lifecycle — so a separate (smaller) var shape.
 *
 * Two siblings have been retired here. `trialEnded` went with z8r3fday24: a
 * free period ending now ISSUES the first invoice (`firstInvoice*` above), and
 * only that invoice going overdue locks. The lapsed-subscription notice went
 * with z8r3fdg3mh: the cron stopped locking lapsed periods when 86eyb6z4r made
 * it auto-issue the renewal, leaving copy that told sellers to "message us to
 * renew and we'll send your invoice" for a bill the machine had already sent.
 * A lapse now produces an ordinary invoice, and a lock produces
 * `invoiceOverdue` followed by the `recovery*` chain. */
export type TrialEmailKey =
	| "trialEndingSoon"
	// Founding-benefit lifecycle (z8r3fdfyw5): the T-14 warning, then the
	// notice that benefits ended. Both say the rank and badge are KEPT — that
	// is the promise, and an email that failed to repeat it would read as
	// though we had taken the badge too.
	| "foundingBenefitsEndingSoon"
	| "foundingBenefitsEnded";

export type TrialEmailVars = {
	storeName: string;
	billingUrl: string;
	daysLeft?: number; // only for trialEndingSoon
	/** Pre-formatted date the founding benefits end / ended (founding keys). */
	endsOnFormatted?: string;
};

const trialRender: Record<
	Locale,
	Record<TrialEmailKey, (v: TrialEmailVars) => RenderedEmail>
> = {
	en: {
		trialEndingSoon: (v) => {
			const d = v.daysLeft ?? 0;
			const dayStr = `${d} day${d === 1 ? "" : "s"}`;
			const subject = `⏰ Your free period ends in ${dayStr}`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your free period ends in <strong>${dayStr}</strong> — or sooner, the moment you take your first live order.`,
				"Either way your first invoice arrives then, with 14 days to pay, and your plan starts once it's settled. Your storefront stays live throughout — there's nothing to do before then.",
			];
			const html = wrapHtml("⏰", `Your free period ends in ${dayStr}`, lines, v.billingUrl, t.en.choosePlan);
			const text = `⏰ Your free period ends in ${dayStr} — or sooner, the moment you take your first live order.\nYour first invoice arrives then, with 14 days to pay; your storefront stays live throughout.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		foundingBenefitsEndingSoon: (v) => {
			const on = v.endsOnFormatted ?? "soon";
			const subject = `⏳ Your founding price ends on ${on}`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your Kedaipal subscription hasn't renewed, so your <strong>Founding Member 30% discount ends on ${escapeHtml(on)}</strong>.`,
				"Renew before then and nothing changes — you keep the founding price. After that date your plan bills at the standard price, and renewing later won't bring the discount back.",
				"Your Founding Member rank and badge are yours for good either way.",
			];
			const html = wrapHtml("⏳", `Your founding price ends on ${on}`, lines, v.billingUrl, t.en.choosePlan);
			const text = `⏳ Your founding price ends on ${on}\nRenew before then and you keep it. After that date your plan bills at the standard price, and renewing later won't bring the discount back.\nYour Founding Member rank and badge are yours for good either way.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		foundingBenefitsEnded: (v) => {
			const subject = "Your founding price has ended";
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your subscription stayed unrenewed past the 3-month window, so your founding 30% discount has now ended.`,
				"You're an ordinary Pro seller from here — every plan is open to you again, at the standard prices, and you can pick one whenever you're ready.",
				"<strong>Your Founding Member rank and badge stay yours, permanently.</strong> Nothing has changed on your storefront.",
				"Think this is wrong? Message us — we'll sort it out.",
			];
			const html = wrapHtml("🏅", "Your founding price has ended", lines, v.billingUrl, t.en.choosePlan);
			const text = `Your founding price has ended\nYour subscription stayed unrenewed past the 3-month window. You're an ordinary Pro seller from here — every plan is open again at standard prices.\nYour Founding Member rank and badge stay yours, permanently.\nThink this is wrong? Message us.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
	ms: {
		trialEndingSoon: (v) => {
			const d = v.daysLeft ?? 0;
			const dayStr = `${d} hari`;
			const subject = `⏰ Tempoh percuma anda tamat dalam ${dayStr}`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, tempoh percuma anda tamat dalam <strong>${dayStr}</strong> — atau lebih awal, sebaik sahaja anda terima pesanan pertama.`,
				"Bil pertama anda akan tiba ketika itu, dengan 14 hari untuk membayar, dan pelan anda bermula sebaik sahaja ia dijelaskan. Etalase anda kekal aktif sepanjang masa — tiada apa yang perlu dibuat sebelum itu.",
			];
			const html = wrapHtml("⏰", `Tempoh percuma anda tamat dalam ${dayStr}`, lines, v.billingUrl, t.ms.choosePlan);
			const text = `⏰ Tempoh percuma anda tamat dalam ${dayStr} — atau lebih awal, sebaik sahaja anda terima pesanan pertama.\nBil pertama anda tiba ketika itu, dengan 14 hari untuk membayar; etalase anda kekal aktif sepanjang masa.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		foundingBenefitsEndingSoon: (v) => {
			const on = v.endsOnFormatted ?? "tidak lama lagi";
			const subject = `⏳ Harga pengasas anda tamat pada ${on}`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, langganan Kedaipal anda belum diperbaharui, jadi <strong>diskaun 30% Ahli Pengasas anda tamat pada ${escapeHtml(on)}</strong>.`,
				"Perbaharui sebelum tarikh itu dan tiada apa berubah — harga pengasas kekal milik anda. Selepas tarikh itu pelan anda dibil pada harga biasa, dan memperbaharui kemudian tidak akan mengembalikan diskaun.",
				"Pangkat dan lencana Ahli Pengasas anda kekal milik anda selama-lamanya.",
			];
			const html = wrapHtml("⏳", `Harga pengasas anda tamat pada ${on}`, lines, v.billingUrl, t.ms.choosePlan);
			const text = `⏳ Harga pengasas anda tamat pada ${on}\nPerbaharui sebelum tarikh itu dan ia kekal milik anda. Selepas itu pelan anda dibil pada harga biasa, dan memperbaharui kemudian tidak akan mengembalikan diskaun.\nPangkat dan lencana Ahli Pengasas anda kekal milik anda selama-lamanya.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		foundingBenefitsEnded: (v) => {
			const subject = "Harga pengasas anda telah tamat";
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, langganan anda kekal tidak diperbaharui melebihi tempoh 3 bulan, jadi diskaun 30% pengasas anda telah tamat.`,
				"Dari sini anda peniaga Pro biasa — semua pelan terbuka semula untuk anda, pada harga biasa, dan anda boleh pilih bila-bila anda bersedia.",
				"<strong>Pangkat dan lencana Ahli Pengasas anda kekal milik anda, selama-lamanya.</strong> Tiada apa berubah pada etalase anda.",
				"Rasa ini tidak betul? Mesej kami — kami akan uruskan.",
			];
			const html = wrapHtml("🏅", "Harga pengasas anda telah tamat", lines, v.billingUrl, t.ms.choosePlan);
			const text = `Harga pengasas anda telah tamat\nLangganan anda kekal tidak diperbaharui melebihi tempoh 3 bulan. Dari sini anda peniaga Pro biasa — semua pelan terbuka semula pada harga biasa.\nPangkat dan lencana Ahli Pengasas anda kekal milik anda, selama-lamanya.\nRasa ini tidak betul? Mesej kami.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
	zh: {
		trialEndingSoon: (v) => {
			const d = v.daysLeft ?? 0;
			const dayStr = `${d} 天`;
			const subject = `⏰ 您的免费期还剩 ${dayStr}`;
			const lines = [
				`您好 ${escapeHtml(v.storeName)}，您的免费期还剩 <strong>${dayStr}</strong> —— 一旦收到第一笔订单，免费期会提前结束。`,
				"届时您会收到第一张账单，有 14 天的付款时间，付清后方案即开始。在此期间您的商店保持在线 —— 之前无需做任何事。",
			];
			const html = wrapHtml("⏰", `您的免费期还剩 ${dayStr}`, lines, v.billingUrl, t.zh.choosePlan);
			const text = `⏰ 您的免费期还剩 ${dayStr} —— 一旦收到第一笔订单，免费期会提前结束。\n届时您会收到第一张账单，有 14 天付款时间；您的商店保持在线。\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		foundingBenefitsEndingSoon: (v) => {
			const on = v.endsOnFormatted ?? "即将";
			const subject = `⏳ 您的创始价将于 ${on} 结束`;
			const lines = [
				`${escapeHtml(v.storeName)} 您好，您的 Kedaipal 订阅尚未续订，因此您的<strong>创始会员 30% 折扣将于 ${escapeHtml(on)} 结束</strong>。`,
				"在此之前续订，一切不变 — 创始价仍然属于您。该日期之后，您的方案将按标准价计费，之后再续订也无法恢复折扣。",
				"无论如何，您的创始会员等级和徽章永久属于您。",
			];
			const html = wrapHtml("⏳", `您的创始价将于 ${on} 结束`, lines, v.billingUrl, t.zh.choosePlan);
			const text = `⏳ 您的创始价将于 ${on} 结束\n在此之前续订即可保留。该日期之后将按标准价计费，之后再续订也无法恢复折扣。\n您的创始会员等级和徽章永久属于您。\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		foundingBenefitsEnded: (v) => {
			const subject = "您的创始价已结束";
			const lines = [
				`${escapeHtml(v.storeName)} 您好，您的订阅超过 3 个月仍未续订，因此您的创始 30% 折扣已结束。`,
				"从现在起您是普通 Pro 卖家 — 所有方案按标准价重新向您开放，随时可以选择。",
				"<strong>您的创始会员等级和徽章永久属于您。</strong>您的店面没有任何变化。",
				"觉得有误？请联系我们，我们会处理。",
			];
			const html = wrapHtml("🏅", "您的创始价已结束", lines, v.billingUrl, t.zh.choosePlan);
			const text = `您的创始价已结束\n您的订阅超过 3 个月仍未续订。从现在起您是普通 Pro 卖家 — 所有方案按标准价重新开放。\n您的创始会员等级和徽章永久属于您。\n觉得有误？请联系我们。\n\n${v.billingUrl}`;
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

/**
 * Off-Season Hold notices (z8r3fday24). `holdStarted` restates the deal the
 * seller just took — what's paused, what stays live, the flat price, when it
 * starts billing, and that one tap resumes — because a pause is exactly the
 * state a seller forgets about. `holdResumed` confirms the tier is back and
 * says whether its invoice is on its way now or waits for the paid period.
 */
export type HoldEmailKey = "holdStarted" | "holdResumed";

export type HoldEmailVars = {
	storeName: string;
	billingUrl: string;
	/** The tier the seller resumes to / resumed, e.g. "Pro". */
	planLabel: string;
	/** e.g. "MYR 19.00" — always from HOLD_MONTHLY_PRICES, never spelled. */
	holdPriceFormatted: string;
	/** Whether an invoice was issued at once (true) or billing waits for the
	 * running paid period to end (`billsFromFormatted`). */
	billsNow: boolean;
	billsFromFormatted?: string;
};

const holdRender: Record<
	Locale,
	Record<HoldEmailKey, (v: HoldEmailVars) => RenderedEmail>
> = {
	en: {
		holdStarted: (v) => {
			const subject = "⏸ Your store is on Off-Season Hold";
			const when = v.billsNow
				? `Your first hold invoice (${v.holdPriceFormatted}) is on its way, with 14 days to pay.`
				: `You're paid up until ${v.billsFromFormatted ?? "the end of your current period"} — the ${v.holdPriceFormatted}/month hold starts billing after that.`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your ${escapeHtml(v.planLabel)} plan is paused for the season.`,
				"<strong>Paused:</strong> new orders — buyers see your store with a “seasonal break” note, not a dead link.",
				"<strong>Still live:</strong> your storefront, catalog, buyer list, order history and editing.",
				escapeHtml(when),
				"When your season is back, tap <strong>Resume</strong> in Settings → Billing and your plan returns straight away.",
			];
			const html = wrapHtml("⏸", "Off-Season Hold is on", lines, v.billingUrl, "View billing");
			const text = `⏸ Your store is on Off-Season Hold\nPaused: new orders. Still live: storefront, catalog, buyer list, order history, editing.\n${when}\nResume any time from Settings → Billing.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		holdResumed: (v) => {
			const subject = `▶️ Welcome back — your ${v.planLabel} plan is on again`;
			const when = v.billsNow
				? `Your ${v.planLabel} invoice is on its way, with 14 days to pay — you keep full access meanwhile.`
				: `You're already paid up until ${v.billsFromFormatted ?? "the end of your current period"}, so nothing to pay right now.`;
			const lines = [
				`Hi ${escapeHtml(v.storeName)}, your ${escapeHtml(v.planLabel)} plan is back and your store is taking orders again.`,
				escapeHtml(when),
			];
			const html = wrapHtml("▶️", `${v.planLabel} is back on`, lines, v.billingUrl, "View billing");
			const text = `▶️ Welcome back — your ${v.planLabel} plan is on again and your store is taking orders.\n${when}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
	ms: {
		holdStarted: (v) => {
			const subject = "⏸ Kedai anda kini dalam Rehat Luar Musim";
			const when = v.billsNow
				? `Bil rehat pertama anda (${v.holdPriceFormatted}) sedang dihantar, dengan 14 hari untuk membayar.`
				: `Anda sudah bayar sehingga ${v.billsFromFormatted ?? "hujung tempoh semasa"} — rehat ${v.holdPriceFormatted}/bulan mula dicaj selepas itu.`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, pelan ${escapeHtml(v.planLabel)} anda dijeda untuk musim ini.`,
				"<strong>Dijeda:</strong> pesanan baharu — pembeli nampak kedai anda dengan nota “rehat bermusim”, bukan pautan mati.",
				"<strong>Kekal hidup:</strong> etalase, katalog, senarai pembeli, sejarah pesanan dan penyuntingan.",
				escapeHtml(when),
				"Bila musim anda kembali, ketik <strong>Sambung semula</strong> di Tetapan → Pengebilan dan pelan anda kembali serta-merta.",
			];
			const html = wrapHtml("⏸", "Rehat Luar Musim diaktifkan", lines, v.billingUrl, "Lihat pengebilan");
			const text = `⏸ Kedai anda kini dalam Rehat Luar Musim\nDijeda: pesanan baharu. Kekal hidup: etalase, katalog, senarai pembeli, sejarah pesanan, penyuntingan.\n${when}\nSambung semula bila-bila masa dari Tetapan → Pengebilan.\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		holdResumed: (v) => {
			const subject = `▶️ Selamat kembali — pelan ${v.planLabel} anda aktif semula`;
			const when = v.billsNow
				? `Bil ${v.planLabel} anda sedang dihantar, dengan 14 hari untuk membayar — akses penuh kekal sementara itu.`
				: `Anda sudah bayar sehingga ${v.billsFromFormatted ?? "hujung tempoh semasa"}, jadi tiada bayaran buat masa ini.`;
			const lines = [
				`Hai ${escapeHtml(v.storeName)}, pelan ${escapeHtml(v.planLabel)} anda kembali dan kedai anda menerima pesanan semula.`,
				escapeHtml(when),
			];
			const html = wrapHtml("▶️", `${v.planLabel} aktif semula`, lines, v.billingUrl, "Lihat pengebilan");
			const text = `▶️ Selamat kembali — pelan ${v.planLabel} anda aktif semula dan kedai anda menerima pesanan.\n${when}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
	zh: {
		holdStarted: (v) => {
			const subject = "⏸ 您的商店已进入淡季保留";
			const when = v.billsNow
				? `您的第一张保留账单（${v.holdPriceFormatted}）正在发出，有 14 天付款时间。`
				: `您已付费至 ${v.billsFromFormatted ?? "当前周期结束"} —— 之后才开始按每月 ${v.holdPriceFormatted} 计费。`;
			const lines = [
				`您好 ${escapeHtml(v.storeName)}，您的 ${escapeHtml(v.planLabel)} 方案已在本季暂停。`,
				"<strong>已暂停：</strong>新订单 —— 买家看到的是带“淡季休息”提示的商店，而不是失效链接。",
				"<strong>保持在线：</strong>您的商店、目录、买家名单、订单记录和编辑功能。",
				escapeHtml(when),
				"季节回来时，到 设置 → 账单 点击 <strong>恢复</strong>，方案立即回归。",
			];
			const html = wrapHtml("⏸", "淡季保留已开启", lines, v.billingUrl, "查看账单");
			const text = `⏸ 您的商店已进入淡季保留\n已暂停：新订单。保持在线：商店、目录、买家名单、订单记录、编辑。\n${when}\n随时可在 设置 → 账单 恢复。\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
		holdResumed: (v) => {
			const subject = `▶️ 欢迎回来 —— 您的 ${v.planLabel} 方案已恢复`;
			const when = v.billsNow
				? `您的 ${v.planLabel} 账单正在发出，有 14 天付款时间 —— 期间您仍拥有完整权限。`
				: `您已付费至 ${v.billsFromFormatted ?? "当前周期结束"}，目前无需付款。`;
			const lines = [
				`您好 ${escapeHtml(v.storeName)}，您的 ${escapeHtml(v.planLabel)} 方案已恢复，商店重新开始接单。`,
				escapeHtml(when),
			];
			const html = wrapHtml("▶️", `${v.planLabel} 已恢复`, lines, v.billingUrl, "查看账单");
			const text = `▶️ 欢迎回来 —— 您的 ${v.planLabel} 方案已恢复，商店重新开始接单。\n${when}\n\n${v.billingUrl}`;
			return { subject, html, text };
		},
	},
};

export function renderHoldEmail(
	locale: Locale,
	key: HoldEmailKey,
	vars: HoldEmailVars,
): RenderedEmail {
	return holdRender[locale][key](vars);
}
