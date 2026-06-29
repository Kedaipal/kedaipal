import { describe, expect, it } from "vitest";
import {
	buildOnboardingInviteLink,
	decodeOnboardingPrefill,
	encodeOnboardingPrefill,
	ONBOARDING_PREFILL_PARAM,
} from "./onboarding-link";

const ORIGIN = "https://kedaipal.com";

describe("onboarding invite token", () => {
	it("round-trips store, slug and WhatsApp through encode → decode", () => {
		const token = encodeOnboardingPrefill({
			storeName: "Mak Kuih",
			slug: "mak-kuih",
			waPhone: "60123456789",
		});
		expect(decodeOnboardingPrefill(token)).toEqual({
			store: "Mak Kuih",
			slug: "mak-kuih",
			wa: "60123456789",
		});
	});

	it("the token is URL-safe (no &, ?, =, % or padding to mangle in a redirect)", () => {
		const token = encodeOnboardingPrefill({
			storeName: "Kek & Kuih +60",
			slug: "kek-kuih",
			waPhone: "+60 12-345 6789",
		});
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
		// And it still decodes the exact values, special chars intact.
		expect(decodeOnboardingPrefill(token)).toEqual({
			store: "Kek & Kuih +60",
			slug: "kek-kuih",
			wa: "+60 12-345 6789",
		});
	});

	it("carries the founding flag when set, omits it otherwise", () => {
		const withFounding = decodeOnboardingPrefill(
			encodeOnboardingPrefill({ storeName: "Mak Kuih", founding: true }),
		);
		expect(withFounding?.founding).toBe(true);
		const without = decodeOnboardingPrefill(
			encodeOnboardingPrefill({ storeName: "Mak Kuih" }),
		);
		expect(without?.founding).toBeFalsy();
	});

	it("handles unicode store names", () => {
		const token = encodeOnboardingPrefill({ storeName: "Kuih Niçe 🍡" });
		expect(decodeOnboardingPrefill(token)).toEqual({ store: "Kuih Niçe 🍡" });
	});

	it("omits blank optional fields", () => {
		const token = encodeOnboardingPrefill({
			storeName: "Solo Store",
			slug: "   ",
			waPhone: "",
		});
		const decoded = decodeOnboardingPrefill(token);
		expect(decoded).toEqual({ store: "Solo Store" });
		expect(decoded?.slug).toBeUndefined();
		expect(decoded?.wa).toBeUndefined();
	});

	it("decodes garbage / missing tokens as no-prefill (organic signup)", () => {
		expect(decodeOnboardingPrefill(undefined)).toBeUndefined();
		expect(decodeOnboardingPrefill("")).toBeUndefined();
		expect(decodeOnboardingPrefill("not-base64!!!")).toBeUndefined();
		expect(decodeOnboardingPrefill("YWJj")).toBeUndefined(); // valid b64 "abc", not JSON
	});
});

describe("buildOnboardingInviteLink", () => {
	it("builds a single-param link on the onboarding route", () => {
		const link = buildOnboardingInviteLink(ORIGIN, {
			storeName: "Mak Kuih",
			slug: "mak-kuih",
			waPhone: "60123456789",
		});
		const url = new URL(link);
		expect(url.origin + url.pathname).toBe(`${ORIGIN}/onboarding`);
		// Exactly one query param, and it round-trips the full prefill.
		expect([...url.searchParams.keys()]).toEqual([ONBOARDING_PREFILL_PARAM]);
		const token = url.searchParams.get(ONBOARDING_PREFILL_PARAM);
		expect(decodeOnboardingPrefill(token ?? undefined)).toEqual({
			store: "Mak Kuih",
			slug: "mak-kuih",
			wa: "60123456789",
		});
	});

	it("returns an empty string when the store name is blank (gates the button)", () => {
		expect(buildOnboardingInviteLink(ORIGIN, { storeName: "   " })).toBe("");
	});

	it("points at the given origin", () => {
		const link = buildOnboardingInviteLink("http://localhost:3000", {
			storeName: "Test",
		});
		expect(link.startsWith("http://localhost:3000/onboarding?")).toBe(true);
	});
});
