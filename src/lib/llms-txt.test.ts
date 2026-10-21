import { describe, expect, test } from "vitest";
import {
	annualQuote,
	LISTED_PLANS,
	PLAN_CREDIT_GRANT,
	PLAN_MONTHLY_PRICES,
} from "../../convex/lib/plans";
import { buildLlmsTxt } from "./llms-txt";
import { ORG_DESCRIPTION, SITE_URL, SUPPORT_EMAIL } from "./site-identity";

const FAQ = [
	{
		q: "Do I need my own WhatsApp Business number?",
		a: "No — one shared WABA.",
	},
	{ q: "How are payments handled?", a: "HitPay, bank transfer or QR." },
];

const txt = buildLlmsTxt({ siteUrl: SITE_URL, faq: FAQ });

describe("buildLlmsTxt", () => {
	test("opens with the H1 and the locked Organization description", () => {
		expect(txt.startsWith("# Kedaipal\n")).toBe(true);
		expect(txt).toContain(`> ${ORG_DESCRIPTION}`);
	});

	/**
	 * The reprice guard (same intent as `landing-seo.test.ts`): an LLM quotes
	 * whatever number it last read, so a stale price here outlives a reprice
	 * for as long as the crawl cache does. Every listed tier, both currencies,
	 * monthly AND annual, must equal the constants the billing code charges.
	 */
	test("prices every listed tier from the billing constants, both currencies", () => {
		for (const plan of LISTED_PLANS) {
			const myr = PLAN_MONTHLY_PRICES.MYR[plan] / 100;
			const sgd = PLAN_MONTHLY_PRICES.SGD[plan] / 100;
			expect(txt).toContain(`RM${myr}/month`);
			expect(txt).toContain(`S$${sgd}/month`);
			expect(txt).toContain(
				`RM${annualQuote(plan, false, "MYR").annualTotal / 100}/year`,
			);
			expect(txt).toContain(
				`S$${annualQuote(plan, false, "SGD").annualTotal / 100}/year`,
			);
			expect(txt).toContain(`${PLAN_CREDIT_GRANT[plan]} orders`);
		}
	});

	test("Enterprise is a contract, never a number", () => {
		const enterprise = txt.split("\n").filter((l) => /enterprise/i.test(l));
		expect(enterprise.length).toBeGreaterThan(0);
		for (const line of enterprise) expect(line).not.toMatch(/RM\d|S\$\d/);
	});

	test("never names a retired tier or a founding price", () => {
		expect(txt).not.toMatch(/\bScale\b/);
		expect(txt).not.toMatch(/founding/i);
		expect(txt).not.toMatch(/RM399|RM104/);
	});

	test("carries the shared-WABA differentiator in plain words", () => {
		expect(txt).toMatch(/no Meta (business )?verification/i);
	});

	test("lists the primary FAQ as question + answer pairs, in order", () => {
		const i1 = txt.indexOf(`- ${FAQ[0].q}`);
		const i2 = txt.indexOf(`- ${FAQ[1].q}`);
		expect(i1).toBeGreaterThan(-1);
		expect(i2).toBeGreaterThan(i1);
		expect(txt).toContain(FAQ[0].a);
	});

	test("links every public fact page and the support address", () => {
		for (const path of [
			"/",
			"/pricing",
			"/cost",
			"/stores",
			"/privacy",
			"/terms",
		]) {
			expect(txt).toContain(`](${SITE_URL}${path})`);
		}
		expect(txt).toContain(SUPPORT_EMAIL);
	});

	test("never lists a storefront — sellers own those and the sitemap carries them", () => {
		expect(txt).toContain(`${SITE_URL}/sitemap.xml`);
		// Only the whitelisted first-party paths may appear after the host.
		const paths = [
			...txt.matchAll(/https:\/\/kedaipal\.com(\/[a-z0-9./-]*)?/g),
		].map((m) => (m[1] ?? "/").replace(/\.$/, ""));
		const allowed = new Set([
			"/",
			"/pricing",
			"/cost",
			"/stores",
			"/privacy",
			"/terms",
			"/acceptable-use",
			"/sitemap.xml",
			"/llms.txt",
		]);
		for (const p of paths) expect(allowed.has(p), p).toBe(true);
	});
});
