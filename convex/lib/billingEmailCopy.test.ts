import { describe, expect, it } from "vitest";
import {
	type BillingEmailVars,
	renderBillingEmail,
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

	it("renders Malay copy for the ms locale", () => {
		const { subject, html } = renderBillingEmail("ms", "invoiceIssued", base);
		expect(subject).toContain("Bil baru");
		expect(html).toContain("Cara bayar"); // "How to pay"
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

	it("subscriptionLapsed reads as a lapsed-renewal notice (no invoice)", () => {
		const { subject, html } = renderTrialEmail("en", "subscriptionLapsed", tv);
		expect(subject.toLowerCase()).toContain("lapsed");
		expect(html.toLowerCase()).not.toContain("invoice no");
		expect(html).toContain("Message us to renew");
	});
});
