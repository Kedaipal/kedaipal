import { describe, expect, it } from "vitest";
import { type BillingEmailVars, renderBillingEmail } from "./billingEmailCopy";

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
});
