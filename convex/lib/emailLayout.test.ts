import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type BillingEmailKey, renderBillingEmail } from "./billingEmailCopy";
import { ctaButton, wrapHtml } from "./emailCopy";

// The email layout rules (z8r3fdwfb7, see the block above `ctaButton` in
// emailCopy.ts): a card is fluid, a long word wraps, a button is ≥44px. Every
// wrapHtml email used to be 592px wide on a 375px phone and every CTA 37px
// tall — this file is what stops either coming back, in the two shells and in
// any template someone adds next to them.

const LIB = __dirname;
const COPY_MODULES = readdirSync(LIB).filter(
	(f) => f.endsWith("Copy.ts") && f !== "whatsappCopy.ts",
);

/** Every `<table …>` / `<a …>` opening tag in a chunk of HTML or source. */
const tags = (src: string, name: "table" | "a") =>
	src.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];

const styleOf = (tag: string) => /style="([^"]*)"/.exec(tag)?.[1] ?? "";

/** A button-shaped link: an inline-block anchor with a fill. */
const isButton = (tag: string) =>
	/display:inline-block/.test(styleOf(tag)) && /background:/.test(styleOf(tag));

function expectFluidCards(html: string) {
	const fixed = tags(html, "table").filter((t) => /\bwidth="\d+"/.test(t));
	expect(fixed.length).toBeGreaterThan(0);
	for (const t of fixed) {
		expect(styleOf(t)).toContain("width:100%");
		expect(styleOf(t)).toContain("overflow-wrap:anywhere");
	}
}

function expectTapTargetButtons(html: string, atLeast: number) {
	const buttons = tags(html, "a").filter(isButton);
	expect(buttons.length).toBeGreaterThanOrEqual(atLeast);
	for (const b of buttons) {
		// 20px line + 12px top + 12px bottom = 44px, whatever the font size.
		expect(styleOf(b)).toContain("line-height:20px");
		expect(styleOf(b)).toContain("padding:12px 20px");
	}
}

describe("email layout — the shells", () => {
	test("wrapHtml: the card is fluid and the CTA is a 44px tap target", () => {
		const html = wrapHtml("🔔", "New order", ["One line"], "https://kedaipal.com/app", "Open dashboard");
		expectFluidCards(html);
		expectTapTargetButtons(html, 1);
	});

	const BILLING_KEYS: BillingEmailKey[] = [
		"invoiceIssued",
		"invoiceReminder",
		"invoiceOverdue",
		"firstInvoiceOrder",
		"firstInvoiceBackstop",
		"recoveryNudge",
		"recoveryFinal",
	];

	test.each(BILLING_KEYS)("billing %s: fluid card, every button 44px — Pay-now and hold included", (key) => {
		const { html } = renderBillingEmail("en", key, {
			storeName: "Mak Kuih",
			invoiceNumber: "INV-202607-AB12",
			planLabel: "Pro · Monthly",
			totalFormatted: "MYR 104.00",
			dueDateFormatted: "5 Jul 2026",
			bankName: "Maybank",
			bankAccountName: "Kedaipal Sdn Bhd",
			bankAccountNumber: "5123 4567 8901",
			billingUrl: "https://kedaipal.com/app/settings?tab=billing",
			payNowUrl: "https://securecheckout.hit-pay.com/payment-request/x",
			daysPastDue: 7,
			holdPriceFormatted: "RM19",
		});
		expectFluidCards(html);
		// The billing CTA + Pay-now, and the hold offer on the final reminder.
		expectTapTargetButtons(html, key === "recoveryFinal" ? 3 : 2);
	});

	test("ctaButton escapes the url and the label it is given raw", () => {
		const html = ctaButton('https://x.test/?a=1&b="2"', "<Pay> & go");
		expect(html).toContain('href="https://x.test/?a=1&amp;b=&quot;2&quot;"');
		expect(html).toContain("&lt;Pay&gt; &amp; go");
	});
});

describe("email layout — every copy module (source scan)", () => {
	test("found the copy modules", () => {
		expect(COPY_MODULES).toEqual(
			expect.arrayContaining(["emailCopy.ts", "billingEmailCopy.ts", "handoverEmailCopy.ts"]),
		);
	});

	test.each(COPY_MODULES)("%s: no fixed-width table without width:100%%", (file) => {
		const src = readFileSync(join(LIB, file), "utf8");
		for (const t of tags(src, "table").filter((t) => /\bwidth="\d+"/.test(t))) {
			expect(styleOf(t), `${file}: ${t}`).toContain("width:100%");
		}
	});

	test.each(COPY_MODULES)("%s: buttons come from ctaButton, never hand-written", (file) => {
		const src = readFileSync(join(LIB, file), "utf8");
		const handRolled = tags(src, "a").filter(isButton);
		// The one allowed author is ctaButton itself.
		expect(handRolled.length, `${file}: ${handRolled.join("\n")}`).toBe(
			file === "emailCopy.ts" ? 1 : 0,
		);
	});
});
