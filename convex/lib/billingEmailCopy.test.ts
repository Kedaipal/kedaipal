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

	it("trialEndingSoon shows the days left, names the first-order trigger, promises the store stays live", () => {
		const { subject, html, text } = renderTrialEmail("en", "trialEndingSoon", {
			...tv,
			daysLeft: 3,
		});
		expect(subject).toContain("3 days");
		// Start-when-you-sell framing: the deadline is the backstop, the order
		// is the trigger — never "trial with a deadline".
		expect(html).toContain("first live order");
		expect(html).toContain("storefront stays live");
		expect(text).toContain("first live order");
		expect(html).not.toMatch(/editing pauses/i);
		expect(html).toContain(tv.billingUrl);
	});

	it("renders Malay + Chinese free-period copy", () => {
		expect(
			renderTrialEmail("ms", "trialEndingSoon", { ...tv, daysLeft: 2 }).subject,
		).toContain("Tempoh percuma");
		expect(
			renderTrialEmail("zh", "trialEndingSoon", { ...tv, daysLeft: 2 }).subject,
		).toContain("免费期");
	});

	/**
	 * Founding-benefit notices (z8r3fdfyw5). Both are sent to a member who is
	 * LOSING something, so the assertions are mostly about what must still be
	 * there: the date they can act on, and the promise that survives.
	 */
	describe("founding benefit notices", () => {
		const endsOn = { ...tv, endsOnFormatted: "28 Oct 2026" };

		it("the T-14 warning names the date, says renewing later won't undo it, and keeps the badge promise", () => {
			const { subject, html, text } = renderTrialEmail(
				"en",
				"foundingBenefitsEndingSoon",
				endsOn,
			);
			expect(subject).toContain("28 Oct 2026");
			// The date is the whole point of a T-14 notice — it must survive into
			// the body and the plain-text part, not just the subject line.
			expect(html).toContain("28 Oct 2026");
			expect(text).toContain("28 Oct 2026");
			// Renewing in time keeps it; renewing after does NOT bring it back.
			expect(html).toMatch(/Renew before then/i);
			expect(html).toMatch(/won't bring the discount back/i);
			// The promise that outlives the discount.
			expect(html).toMatch(/rank and badge are yours for good/i);
			expect(html).toContain(tv.billingUrl);
		});

		it("the revocation notice is permanent, opens every plan, and never says renewing restores it", () => {
			const { subject, html, text } = renderTrialEmail(
				"en",
				"foundingBenefitsEnded",
				endsOn,
			);
			expect(subject.toLowerCase()).toContain("ended");
			expect(html).toMatch(/ordinary Pro seller/i);
			expect(html).toMatch(/rank and badge stay yours, permanently/i);
			// Must not imply the discount comes back — it doesn't, that's the ticket.
			expect(html).not.toMatch(/renew.{0,40}keep your founding price/i);
			expect(html).not.toMatch(/discount is locked in/i);
			// A wrong revocation needs a way back, and the seller has to be told.
			expect(html).toMatch(/Message us/i);
			expect(text).toMatch(/rank and badge stay yours/i);
		});

		it("BOTH keep the rank + badge promise in all three locales", () => {
			// The one sentence a member losing their discount most needs to still
			// be true, and the easiest to drop when translating.
			const promise = {
				en: /rank and badge/i,
				ms: /[Pp]angkat dan lencana/,
				zh: /创始会员等级和徽章/,
			} as const;
			for (const locale of ["en", "ms", "zh"] as const) {
				for (const key of [
					"foundingBenefitsEndingSoon",
					"foundingBenefitsEnded",
				] as const) {
					const { subject, html, text } = renderTrialEmail(locale, key, endsOn);
					expect(subject.length).toBeGreaterThan(0);
					expect(html).toMatch(promise[locale]);
					expect(text).toMatch(promise[locale]);
					expect(html).toContain(tv.billingUrl);
				}
			}
		});

		it("the warning degrades to a readable sentence if the date is missing", () => {
			// endsOnFormatted is optional on the shared vars type, so a caller that
			// forgets it must not produce "ends on undefined".
			const { subject, html } = renderTrialEmail(
				"en",
				"foundingBenefitsEndingSoon",
				tv,
			);
			expect(subject).not.toMatch(/undefined/);
			expect(html).not.toMatch(/undefined/);
		});
	});
});

describe("comp emails (z8r3fdeub2)", () => {
	const cv = {
		storeName: "Huff & Puff",
		billingUrl: "https://kedaipal.com/app/settings?tab=billing",
		sponsorLabel: "Sponsored by Maybank SME",
	};

	it("compEnded: storefront + ordering live, the dashboard view-only until a plan — no second free period", () => {
		const { subject, html, text } = renderTrialEmail("en", "compEnded", cv);
		expect(subject).toMatch(/sponsored Kedaipal access has ended/);
		expect(html).toContain("buyers can still place orders");
		// The lock is the whole dashboard, not just editing (z8r3fdeub2,
		// 19 Sep) — an email promising they can still work their orders would
		// send them to a screen that refuses every tap.
		expect(text).toContain("view-only until you choose a plan");
		expect(html).toMatch(/working orders/);
		expect(text).not.toMatch(/14-day|free period|invoice/i);
	});

	it("renders Malay + Chinese comp copy, and a label-less comp reads cleanly", () => {
		expect(renderTrialEmail("ms", "compEnded", cv).subject).toContain("tajaan");
		expect(renderTrialEmail("zh", "compEnded", cv).subject).toContain("赞助");
		const bare = renderTrialEmail("en", "compEnded", {
			...cv,
			sponsorLabel: undefined,
		});
		expect(bare.text).not.toContain("()");
		expect(bare.html).not.toContain("undefined");
	});
});

describe("first-invoice emails (start-when-you-sell, z8r3fday24)", () => {
	it("first order: celebrates, names the plan + due date, says the store keeps running and the plan can be switched", () => {
		const { subject, html, text } = renderBillingEmail("en", "firstInvoiceOrder", base);
		expect(subject).toContain("first order");
		expect(subject).toContain(base.invoiceNumber);
		expect(html).toContain("Pro · Monthly");
		expect(html).toContain("5 Jul 2026");
		expect(html).toMatch(/keep running as normal/);
		expect(html).toMatch(/switch to a different plan/);
		// It is still a real invoice email: the pay panel + CTA are there.
		expect(html).toContain("Maybank");
		expect(html).toContain("View invoice &amp; pay");
		expect(text).toContain("switch plan");
	});

	it("backstop: says the free period ended, nothing is locked, plan can be switched", () => {
		const { subject, html } = renderBillingEmail("en", "firstInvoiceBackstop", base);
		expect(subject).toContain("free period has ended");
		expect(html).toMatch(/Nothing is locked/);
		expect(html).toContain("storefront stays live");
		expect(html).toMatch(/Switch from your billing page/);
		// Never the old lock framing.
		expect(html).not.toMatch(/past due|editing (is )?paused/i);
	});

	it("both carry the Pay-now link when one exists", () => {
		const url = "https://securecheckout.sandbox.hit-pay.com/payment-request/x";
		for (const key of ["firstInvoiceOrder", "firstInvoiceBackstop"] as const) {
			const { html, text } = renderBillingEmail("en", key, { ...base, payNowUrl: url });
			expect(html).toContain(url);
			expect(text).toContain(url);
		}
	});

	it("renders in Malay and Chinese for both keys", () => {
		expect(renderBillingEmail("ms", "firstInvoiceOrder", base).subject).toContain("Pesanan pertama");
		expect(renderBillingEmail("ms", "firstInvoiceBackstop", base).subject).toContain("Tempoh percuma");
		expect(renderBillingEmail("zh", "firstInvoiceOrder", base).subject).toContain("第一笔订单");
		expect(renderBillingEmail("zh", "firstInvoiceBackstop", base).subject).toContain("免费期");
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

describe("post-lock recovery chain (z8r3fdg3mh)", () => {
	const overdue: BillingEmailVars = { ...base, daysPastDue: 3 };

	it("the +3d nudge states the elapsed days as a fact and still carries the pay panel", () => {
		const { subject, html, text } = renderBillingEmail(
			"en",
			"recoveryNudge",
			overdue,
		);
		expect(subject).toContain("INV-202607-AB12");
		expect(subject.toLowerCase()).toContain("locked");
		expect(html).toContain("3 days past due");
		// The only thing being asked for is payment — the rails must be present.
		expect(html).toContain("Maybank");
		expect(html).toContain(base.billingUrl);
		expect(text).toContain("3 days past due");
	});

	it("the +7d final says it is the last automatic contact and offers the hold", () => {
		const { subject, html, text } = renderBillingEmail("en", "recoveryFinal", {
			...overdue,
			daysPastDue: 7,
			holdPriceFormatted: "MYR 19.00",
		});
		expect(subject.toLowerCase()).toContain("last reminder");
		expect(html).toContain("7 days past due");
		expect(html).toContain("last automatic reminder");
		expect(html).toContain("MYR 19.00");
		expect(text).toContain("MYR 19.00");
	});

	it("omits the hold offer entirely when no hold price is passed", () => {
		const { html, text } = renderBillingEmail("en", "recoveryFinal", {
			...overdue,
			daysPastDue: 7,
		});
		// A seller already ON hold has no cheaper door to be pointed at.
		expect(html).not.toContain("Pause your plan");
		expect(text).not.toContain("Pause your plan");
		// …but the rest of the notice still renders.
		expect(html).toContain("last automatic reminder");
	});

	it("never invents a day count when none was passed", () => {
		const { html } = renderBillingEmail("en", "recoveryNudge", base);
		expect(html).not.toContain("0 days");
		expect(html).toContain("INV-202607-AB12");
	});

	it("renders Malay + Chinese recovery copy", () => {
		expect(
			renderBillingEmail("ms", "recoveryNudge", overdue).html,
		).toContain("lewat 3 hari");
		expect(
			renderBillingEmail("zh", "recoveryNudge", overdue).html,
		).toContain("已逾期 3 天");
		expect(
			renderBillingEmail("ms", "recoveryFinal", {
				...overdue,
				holdPriceFormatted: "MYR 19.00",
			}).html,
		).toContain("Jeda pelan anda");
	});

	it("the nudge states the lock ONCE — no repeat, no capital mid-sentence", () => {
		const { html } = renderBillingEmail("en", "recoveryNudge", overdue);
		// The intro used to add its own "you can't edit your store…" clause and
		// then append storeStaysLive, which ends with the same fact — the seller
		// read the lock twice in one sentence, the second time starting with a
		// stray capital after an em-dash.
		expect(html).not.toMatch(/— Your storefront/);
		expect(html).toMatch(/Hi Mak Kuih, invoice INV-202607-AB12 is 3 days past due\./);
		expect((html.match(/view-only until you pay/g) ?? []).length).toBe(1);
	});

	it("the hold offer is a PANEL with its own price and button, not buried prose", () => {
		const { html } = renderBillingEmail("en", "recoveryFinal", {
			...overdue,
			daysPastDue: 7,
			holdPriceFormatted: "MYR 19.00",
		});
		// In-app this offer is a card with a price chip and a button; an email
		// that demotes it to a mid-paragraph clause contradicts the product.
		expect(html).toMatch(/Pause instead of cancelling · MYR 19\.00/);
		expect(html).toMatch(/See the pause option/);
		// …and it is no longer sitting inside the intro paragraph.
		const intro = html.split("Pause instead of cancelling")[0];
		expect(intro).not.toMatch(/Pause your plan for/);
	});

	it("no hold price ⇒ no panel at all, and the rest still renders", () => {
		const { html } = renderBillingEmail("en", "recoveryFinal", {
			...overdue,
			daysPastDue: 7,
		});
		expect(html).not.toMatch(/Pause instead of cancelling/);
		expect(html).not.toMatch(/See the pause option/);
		expect(html).toMatch(/last automatic reminder/);
	});

	it("the plain-text body keeps the capital, because it starts its own line", () => {
		const { text } = renderBillingEmail("en", "recoveryNudge", overdue);
		expect(text).toMatch(/\nInvoice INV-202607-AB12 is 3 days past due\./);
	});

	it("Chinese is never case-folded — it has no letter case to fold", () => {
		const { html } = renderBillingEmail("zh", "recoveryNudge", overdue);
		expect(html).toContain("已逾期 3 天");
		expect(html).not.toContain("undefined");
	});

	it("the recovery pair is tonally red, like the overdue notice it follows", () => {
		const overdueHtml = renderBillingEmail("en", "invoiceOverdue", base).html;
		for (const key of ["recoveryNudge", "recoveryFinal"] as const) {
			const { html } = renderBillingEmail("en", key, overdue);
			// #dc2626 is the overdue accent — a recovery mail rendering green would
			// read as good news at the exact moment it is not.
			expect(html).toContain("#dc2626");
			expect(overdueHtml).toContain("#dc2626");
		}
	});
});
