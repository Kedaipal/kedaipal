import { describe, expect, test } from "vitest";
import type { Locale } from "./emailCopy";
import { renderHandoverInvite } from "./handoverEmailCopy";

const LOCALES: Locale[] = ["en", "ms", "zh"];

const vars = {
	storeName: "Mak Cik Kuih",
	appUrl: "https://kedaipal.com/app",
	email: "vendor@example.com",
};

describe("handover invitation email", () => {
	test.each(LOCALES)("%s names the store, the address and the link", (locale) => {
		const r = renderHandoverInvite(locale, vars);
		expect(r.subject).toContain("Mak Cik Kuih");
		for (const body of [r.html, r.text]) {
			expect(body).toContain("Mak Cik Kuih");
			expect(body).toContain("vendor@example.com");
			expect(body).toContain("https://kedaipal.com/app");
		}
	});

	test.each(LOCALES)("%s carries no claim token — the address is the key", (locale) => {
		const r = renderHandoverInvite(locale, vars);
		// A link that works on its own would make a forwarded invite a handover
		// to the wrong person. Claiming is proved by Clerk verifying the address,
		// so the only URL here is the ordinary app one.
		for (const body of [r.html, r.text]) {
			expect(body).not.toMatch(/token|claim=|\?t=/i);
			const urls = body.match(/https?:\/\/[^\s"<]+/g) ?? [];
			for (const u of urls) {
				expect(
					u.startsWith("https://kedaipal.com/app") ||
						u.includes("kedaipal.com/logo") ||
						u.includes("kedaipal.com"),
				).toBe(true);
			}
		}
	});

	test.each(LOCALES)("%s tells a first-timer the link also creates their login", (locale) => {
		// The recipient usually has no Kedaipal login yet (z8r3fdwdvq). "Sign in
		// with <email>" alone sent them to a sign-in that refused the address.
		const r = renderHandoverInvite(locale, vars);
		const firstTimer = {
			en: ["New to Kedaipal?", "creates your login"],
			ms: ["Baru di Kedaipal?", "mendaftarkan akaun anda"],
			zh: ["第一次用 Kedaipal？", "为您创建账号"],
		}[locale];
		for (const body of [r.html, r.text])
			for (const phrase of firstTimer) expect(body).toContain(phrase);
		// It's its own line, not a clause buried in the address sentence.
		const textLine = r.text.split("\n\n").find((l) => l.includes(firstTimer[0]));
		expect(textLine?.includes("vendor@example.com")).toBe(false);
	});

	test.each(LOCALES)("%s sets the sign-in address apart in its own card", (locale) => {
		// The address is the one thing they must get right, so it is not left
		// mid-sentence: it gets the green key card, and the plain-text part puts
		// it on a line of its own.
		const r = renderHandoverInvite(locale, vars);
		expect(r.html).toMatch(/background:#ecfdf5[^>]*>(?:(?!<\/p>).)*vendor@example\.com/s);
		expect(r.text).toMatch(/[:：]vendor@example\.com\n|: vendor@example\.com\n/);
	});

	test.each(LOCALES)("%s puts 'new here?' right above the button and the reassurance under it", (locale) => {
		// "The button below" must sit next to the button it names, and the
		// "weren't expecting this" fine print must not stand between the reader
		// and the action.
		const r = renderHandoverInvite(locale, vars);
		const firstTimer = { en: "New to Kedaipal?", ms: "Baru di Kedaipal?", zh: "第一次用 Kedaipal？" }[locale];
		const ignore = { en: "weren&#39;t expecting this", ms: "tidak menjangkakan", zh: "如果您并不知情" }[locale];
		const button = r.html.indexOf("display:inline-block;background:#111827");
		const lastParaBeforeButton = r.html.lastIndexOf("<p ", button - 1);
		const prevPara = r.html.lastIndexOf("<p ", lastParaBeforeButton - 1);
		expect(r.html.slice(prevPara, lastParaBeforeButton)).toContain(firstTimer);
		expect(r.html.indexOf(ignore)).toBeGreaterThan(button);
	});

	test("Chinese plain text uses the full-width colon", () => {
		const r = renderHandoverInvite("zh", vars);
		expect(r.text).toContain("：vendor@example.com");
		expect(r.text).toContain("：https://kedaipal.com/app");
		expect(r.text).not.toMatch(/: (vendor@|https:)/);
	});

	test("escapes a store name that would otherwise close a tag", () => {
		const r = renderHandoverInvite("en", {
			...vars,
			storeName: '<script>alert(1)</script>',
		});
		expect(r.html).not.toContain("<script>alert(1)</script>");
		expect(r.html).toContain("&lt;script&gt;");
	});
});
