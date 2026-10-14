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

	test("escapes a store name that would otherwise close a tag", () => {
		const r = renderHandoverInvite("en", {
			...vars,
			storeName: '<script>alert(1)</script>',
		});
		expect(r.html).not.toContain("<script>alert(1)</script>");
		expect(r.html).toContain("&lt;script&gt;");
	});
});
