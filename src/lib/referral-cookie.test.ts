// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import {
	clearReferralCookie,
	parseReferralCookie,
	REFERRAL_COOKIE,
	readReferralSlug,
	writeReferralCookie,
} from "./referral-cookie";

afterEach(() => {
	clearReferralCookie();
});

describe("referral cookie", () => {
	test("round-trips a slug through document.cookie", () => {
		writeReferralCookie("siti-kitchen");
		expect(readReferralSlug(document.cookie)).toBe("siti-kitchen");
	});

	test("the latest link wins", () => {
		writeReferralCookie("siti-kitchen");
		writeReferralCookie("kak-yah");
		expect(readReferralSlug(document.cookie)).toBe("kak-yah");
	});

	test("clearing forgets it", () => {
		writeReferralCookie("siti-kitchen");
		clearReferralCookie();
		expect(readReferralSlug(document.cookie)).toBeUndefined();
	});

	test("never stores a value that isn't a slug", () => {
		writeReferralCookie("<script>");
		expect(readReferralSlug(document.cookie)).toBeUndefined();
	});

	test("a hand-edited or malformed cookie reads as no referral, never a crash", () => {
		expect(readReferralSlug(`${REFERRAL_COOKIE}=%`)).toBeUndefined();
		expect(readReferralSlug(`${REFERRAL_COOKIE}=not a slug!`)).toBeUndefined();
		expect(readReferralSlug("other=1; theme=dark")).toBeUndefined();
		expect(parseReferralCookie("Siti-Kitchen")).toBe("siti-kitchen");
	});

	test("finds the cookie among others", () => {
		expect(readReferralSlug(`a=1; ${REFERRAL_COOKIE}=siti-kitchen; b=2`)).toBe(
			"siti-kitchen",
		);
	});
});
