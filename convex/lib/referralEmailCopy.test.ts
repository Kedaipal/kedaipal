import { describe, expect, test } from "vitest";
import { LOCALES, type Locale } from "./locale";
import { referralExpiryDate, renderReferralEmail } from "./referralEmailCopy";

const vars = {
	storeName: "New Kedai",
	otherStoreName: "Siti's Kitchen",
	credits: 60,
	expiresAt: Date.UTC(2027, 9, 16, 4), // 16 Oct 2027, noon MYT
	billingUrl: "https://kedaipal.com/app/settings?tab=billing",
	referralLink: "https://kedaipal.com/referral/new-kedai",
};

describe("referral reward emails", () => {
	test.each(LOCALES as readonly Locale[])(
		"%s: both kinds name the other store, the credits and when they expire",
		(locale) => {
			const on = referralExpiryDate(vars.expiresAt, locale);
			for (const kind of ["referee", "referrer"] as const) {
				const r = renderReferralEmail(locale, kind, vars);
				expect(r.subject).toContain("60");
				expect(r.text).toContain("Siti's Kitchen");
				expect(r.text).toContain(on);
				expect(r.html).toContain(vars.billingUrl);
				// Credits are counted in orders — never money or a percentage.
				expect(`${r.subject} ${r.text}`).not.toMatch(/RM|S\$|%|wallet|commission/i);
			}
		},
	);

	test("only the referrer is shown their own link to keep sharing", () => {
		expect(renderReferralEmail("en", "referrer", vars).text).toContain(
			vars.referralLink,
		);
		expect(renderReferralEmail("en", "referee", vars).text).not.toContain(
			vars.referralLink,
		);
	});

	test("a deleted referrer reads generically, never as 'null'", () => {
		const r = renderReferralEmail("en", "referee", {
			...vars,
			otherStoreName: null,
		});
		expect(r.subject).toContain("a Kedaipal seller");
		expect(r.text).not.toContain("null");
	});

	test("the expiry date is on the MYT calendar", () => {
		expect(referralExpiryDate(Date.UTC(2027, 9, 15, 17), "en")).toBe(
			"16 Oct 2027",
		);
		expect(referralExpiryDate(vars.expiresAt, "zh")).toBe("2027年10月16日");
	});
});
