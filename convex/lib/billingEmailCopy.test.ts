import { describe, expect, it } from "vitest";
import {
	type AutoRenewEmailVars,
	type BillingEmailVars,
	renderAutoRenewEmail,
	renderBillingEmail,
	renderPaymentEmail,
	renderTrialEmail,
} from "./billingEmailCopy";

const base: BillingEmailVars = {
	storeName: "Mak Kuih",
	invoiceNumber: "INV-202607-AB12",
	planLabel: "Pro · Monthly",
	totalFormatted: "MYR 104.00",
	dueDateFormatted: "5 Jul 2026",
	bankName: "Maybank",
	bankAccountName: "Kedaipal Sdn Bhd",
	bankAccountNumber: "5123 4567 8901",
	duitnowId: "kedaipal",
	billingUrl: "https://kedaipal.com/app/settings?tab=billing",
};

describe("renderBillingEmail", () => {
	it("issued email carries invoice number, amount, due date and pay details", () => {
		const { subject, html, text } = renderBillingEmail("en", "invoiceIssued", base);
		expect(subject).toContain("INV-202607-AB12");
		expect(subject).toContain("MYR 104.00");
		expect(html).toContain("Maybank");
		expect(html).toContain("5123 4567 8901");
		expect(html).toContain("5 Jul 2026");
		expect(html).toContain(base.billingUrl);
		expect(text).toContain("Pro · Monthly");
	});

	it("shows the founding discount line when base + discount are set", () => {
		const { html } = renderBillingEmail("en", "invoiceIssued", {
			...base,
			baseFormatted: "MYR 149.00",
			discountFormatted: "MYR 45.00",
		});
		expect(html).toContain("MYR 149.00");
		expect(html).toContain("MYR 45.00");
		expect(html).toContain("founding discount");
	});

	it("reminder email reads as a due-soon nudge", () => {
		const { subject, html } = renderBillingEmail("en", "invoiceReminder", base);
		expect(subject.toLowerCase()).toContain("reminder");
		expect(subject).toContain("5 Jul 2026");
		expect(html.toLowerCase()).toContain("due soon");
	});

	it("falls back to a billing-page pointer when no bank details are set", () => {
		const { html } = renderBillingEmail("en", "invoiceIssued", {
			...base,
			bankName: undefined,
			bankAccountName: undefined,
			bankAccountNumber: undefined,
			duitnowId: undefined,
		});
		expect(html).toContain("Open your billing page");
		expect(html).not.toContain("Maybank");
	});

	// Cross-border (non-MYR, e.g. an SGD-billed SG seller): the MY rails can't
	// settle the invoice, so the pay panel becomes a WhatsApp-contact line naming
	// the invoice as the payment reference — in every locale, HTML and text alike.
	it("crossBorder replaces the pay panel with a WhatsApp-contact line (en/ms/zh)", () => {
		const crossBase: BillingEmailVars = {
			...base,
			totalFormatted: "SGD 59.00",
			bankName: undefined,
			bankAccountName: undefined,
			bankAccountNumber: undefined,
			duitnowId: undefined,
			crossBorder: true,
		};
		// The EN fragment skips "We'll" — escapeHtml renders the apostrophe as
		// &#39; in the HTML body.
		const expected: Record<"en" | "ms" | "zh", string> = {
			en: "confirm payment details with you on WhatsApp",
			ms: "Kami akan sahkan butiran pembayaran",
			zh: "我们会通过 WhatsApp 与您确认付款方式",
		};
		for (const locale of ["en", "ms", "zh"] as const) {
			const { html, text } = renderBillingEmail(locale, "invoiceIssued", crossBase);
			expect(html).toContain(expected[locale]);
			expect(text).toContain(expected[locale]);
			// The invoice number is substituted in as the payment reference.
			expect(text).toContain("INV-202607-AB12");
			// No MY rails, no billing-page pointer (that page shows the DuitNow QR),
			// no DuitNow QR note.
			expect(html).not.toContain("Maybank");
			expect(html).not.toContain("DuitNow");
			expect(html).not.toContain("Open your billing page");
		}
	});

	it("renders Malay copy for the ms locale", () => {
		const { subject, html } = renderBillingEmail("ms", "invoiceIssued", base);
		expect(subject).toContain("Bil baru");
		expect(html).toContain("Cara bayar"); // "How to pay"
	});

	it("renders Chinese copy for the zh locale", () => {
		const { subject, html } = renderBillingEmail("zh", "invoiceIssued", base);
		expect(subject).toContain("新账单");
		expect(html).toContain("付款方式"); // "How to pay"
	});

	it("overdue email reads as a past-due lock notice + keeps pay details", () => {
		const { subject, html } = renderBillingEmail("en", "invoiceOverdue", base);
		expect(subject.toLowerCase()).toContain("past due");
		expect(html.toLowerCase()).toContain("storefront");
		expect(html).toContain("Maybank"); // can still pay to resume
	});
});

describe("renderTrialEmail", () => {
	const tv = {
		storeName: "Mak Kuih",
		billingUrl: "https://kedaipal.com/app/settings?tab=billing",
	};

	it("trialEndingSoon shows the days left + a choose-a-plan CTA", () => {
		const { subject, html } = renderTrialEmail("en", "trialEndingSoon", {
			...tv,
			daysLeft: 3,
		});
		expect(subject).toContain("3 days");
		expect(html).toContain("Choose a plan");
		expect(html).toContain(tv.billingUrl);
	});

	it("trialEnded reads as a lock + does not mention an invoice", () => {
		const { subject, html } = renderTrialEmail("en", "trialEnded", tv);
		expect(subject.toLowerCase()).toContain("ended");
		expect(html.toLowerCase()).not.toContain("invoice");
	});

	it("renders Malay trial copy", () => {
		const { subject } = renderTrialEmail("ms", "trialEnded", tv);
		expect(subject.toLowerCase()).toContain("percubaan");
	});

	it("renders Chinese trial copy", () => {
		const { subject } = renderTrialEmail("zh", "trialEnded", tv);
		expect(subject).toContain("试用期");
	});

	it("subscriptionLapsed reads as a lapsed-renewal notice (no invoice)", () => {
		const { subject, html } = renderTrialEmail("en", "subscriptionLapsed", tv);
		expect(subject.toLowerCase()).toContain("lapsed");
		expect(html.toLowerCase()).not.toContain("invoice no");
		expect(html).toContain("Message us to renew");
	});
});

describe("renderPaymentEmail", () => {
	const pv = {
		storeName: "Mak Kuih",
		planLabel: "Pro · Monthly",
		totalFormatted: "MYR 104.00",
		dashboardUrl: "https://kedaipal.com/app/settings?tab=billing",
	};

	it("welcome (first payment) reads as a welcome, no how-to-pay", () => {
		const { subject, html } = renderPaymentEmail("en", "welcome", pv);
		expect(subject.toLowerCase()).toContain("welcome");
		expect(html).toContain("Pro · Monthly");
		expect(html.toLowerCase()).not.toContain("how to pay");
	});

	it("thanks (renewal) reads as a thank-you and shows the amount", () => {
		const { subject, html } = renderPaymentEmail("en", "thanks", pv);
		expect(subject.toLowerCase()).toContain("thanks");
		expect(html).toContain("MYR 104.00");
	});

	it("renders Malay payment copy", () => {
		const { subject } = renderPaymentEmail("ms", "welcome", pv);
		expect(subject.toLowerCase()).toContain("selamat datang");
	});

	it("renders Chinese payment copy", () => {
		const { subject } = renderPaymentEmail("zh", "welcome", pv);
		expect(subject).toContain("欢迎");
	});
});

describe("invoice emails carry the Pay-now link (86eyb6z4r)", () => {
	const payNowUrl = "https://securecheckout.hit-pay.com/req_1";

	it("payNowUrl leads the pay panel and the text body; manual rails stay below", () => {
		const { html, text } = renderBillingEmail("en", "invoiceIssued", {
			...base,
			payNowUrl,
		});
		expect(html).toContain(payNowUrl);
		expect(html).toContain("Pay online now");
		// The manual bank rail survives as the fallback, reframed.
		expect(html).toContain("5123 4567 8901");
		expect(html).toContain("Prefer a bank transfer?");
		expect(text).toContain(`Pay online now: ${payNowUrl}`);
	});

	it("cross-border invoices get the link too — it's their ONLY self-serve rail", () => {
		const { html, text } = renderBillingEmail("en", "invoiceReminder", {
			storeName: "SG Store",
			invoiceNumber: "INV-SG-1",
			planLabel: "Pro · Monthly",
			totalFormatted: "SGD 59.00",
			dueDateFormatted: "5 Jul 2026",
			crossBorder: true,
			payNowUrl,
			billingUrl: base.billingUrl,
		});
		expect(html).toContain(payNowUrl);
		expect(text).toContain(payNowUrl);
	});

	it("without a link the panel renders exactly as before", () => {
		const { html, text } = renderBillingEmail("en", "invoiceIssued", base);
		expect(html).not.toContain("Pay online now");
		expect(html).toContain("How to pay");
		expect(text).not.toContain("Pay online now");
	});
});

describe("renderAutoRenewEmail (86eyb6z4r)", () => {
	const av: AutoRenewEmailVars = {
		storeName: "Mak Kuih",
		methodLabel: "Visa ·· 4242",
		billingUrl: "https://kedaipal.com/app/settings?tab=billing",
		planLabel: "Pro · Monthly",
		amountFormatted: "MYR 104.00",
		chargeDateFormatted: "5 Oct 2026",
	};

	it("enabled: names the method and the always-on off-switch", () => {
		const { subject, html } = renderAutoRenewEmail("en", "autoRenewEnabled", av);
		expect(subject.toLowerCase()).toContain("auto-renewal is on");
		expect(html).toContain("Visa ·· 4242");
		expect(html).toContain("turn this off any time");
	});

	it("upcoming: date + amount + method — the no-surprise-debit notice", () => {
		const { subject, html, text } = renderAutoRenewEmail(
			"en",
			"autoRenewUpcoming",
			av,
		);
		expect(subject).toContain("5 Oct 2026");
		expect(html).toContain("MYR 104.00");
		expect(html).toContain("Visa ·· 4242");
		expect(text).toContain("Turn off auto-renewal");
	});

	it("failed: CTA goes to the Pay-now link when one exists, else billing", () => {
		const withLink = renderAutoRenewEmail("en", "autoRenewFailed", {
			...av,
			payNowUrl: "https://pay.example/x",
		});
		expect(withLink.html).toContain("https://pay.example/x");
		const withoutLink = renderAutoRenewEmail("en", "autoRenewFailed", av);
		expect(withoutLink.html).toContain(av.billingUrl);
		// The final notice says retries stopped; the interim one promises a retry.
		const final = renderAutoRenewEmail("en", "autoRenewFailed", {
			...av,
			final: true,
		});
		expect(final.html.toLowerCase()).toContain("stopped retrying");
		expect(withoutLink.html.toLowerCase()).toContain("retry automatically");
	});

	it("renders in Malay and Chinese for every key", () => {
		for (const key of [
			"autoRenewEnabled",
			"autoRenewUpcoming",
			"autoRenewFailed",
		] as const) {
			expect(renderAutoRenewEmail("ms", key, av).subject.length).toBeGreaterThan(
				0,
			);
			expect(renderAutoRenewEmail("zh", key, av).subject.length).toBeGreaterThan(
				0,
			);
		}
		expect(
			renderAutoRenewEmail("ms", "autoRenewUpcoming", av).subject,
		).toContain("diperbaharui");
		expect(renderAutoRenewEmail("zh", "autoRenewUpcoming", av).subject).toContain(
			"续订",
		);
	});
});
