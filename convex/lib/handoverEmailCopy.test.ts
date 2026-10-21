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
			en: "The same link creates your login",
			ms: "Pautan yang sama mencipta log masuk anda",
			zh: "同一个链接会为您创建账号",
		}[locale];
		expect(r.html).toContain(firstTimer);
		expect(r.text).toContain(firstTimer);
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
