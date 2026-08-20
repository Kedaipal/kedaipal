/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	assertValidMobileForCountry,
	assertValidMyMobile,
	assertValidMyWaPhone,
	assertValidWaPhone,
	assertValidWaPhoneForCountry,
	normalizeMobileDigits,
} from "./slug";

describe("assertValidMyWaPhone", () => {
	test("converts a local 0-prefixed number to E.164 (drops trunk 0, adds 60)", () => {
		expect(assertValidMyWaPhone("0123456789")).toBe("60123456789");
	});

	test("strips separators a cashier types before normalizing", () => {
		expect(assertValidMyWaPhone("012-345 6789")).toBe("60123456789");
	});

	test("keeps an already-international 60 number unchanged", () => {
		expect(assertValidMyWaPhone("60123456789")).toBe("60123456789");
	});

	test("accepts a +60 number and strips the plus", () => {
		expect(assertValidMyWaPhone("+60 12-345 6789")).toBe("60123456789");
	});

	test("normalizes to the SAME digits an inbound scan produces (keying parity)", () => {
		// The scan path stores what Meta delivers (assertValidWaPhone on "60…"); a
		// cashier typing the local form must land on the identical customer key.
		expect(assertValidMyWaPhone("0123456789")).toBe(
			assertValidWaPhone("60123456789"),
		);
	});

	test("rejects a number that's too short to be valid", () => {
		expect(() => assertValidMyWaPhone("12345")).toThrow();
	});

	test("rejects non-numeric junk", () => {
		expect(() => assertValidMyWaPhone("not a phone")).toThrow();
	});
});

describe("assertValidMyMobile", () => {
	test("normalizes the same shapes as assertValidMyWaPhone", () => {
		expect(assertValidMyMobile("012-345 6789")).toBe("60123456789");
		expect(assertValidMyMobile("60123456789")).toBe("60123456789");
		expect(assertValidMyMobile("+60 12-345 6789")).toBe("60123456789");
	});

	// Checkout renders a "+60" badge on the field (86eyfq04j), so "type the
	// rest" is exactly what it asks for. Before this, a buyer who obeyed the
	// badge was rejected — the number fell through both normalizer arms.
	test("accepts a bare national number typed after the +60 badge", () => {
		expect(assertValidMyMobile("123456789")).toBe("60123456789");
		expect(assertValidMyMobile("1234567890")).toBe("601234567890");
		expect(assertValidMyMobile("12-345 6789")).toBe("60123456789");
	});

	test("does not swallow a foreign number that merely starts with 1", () => {
		// A US "+1 415 555 0123" is 11 digits — outside the 9–10-digit MY mobile
		// NSN window, so it is never rewritten to a Malaysian number. It fails the
		// MY-mobile check instead, which is the honest answer on a MY-only path.
		expect(() => assertValidMyMobile("14155550123")).toThrow(
			/malaysian mobile/i,
		);
	});

	test("still rejects a landline, which can never receive WhatsApp", () => {
		expect(() => assertValidMyMobile("03-1234 5678")).toThrow(
			/malaysian mobile/i,
		);
	});
});

// --- SG arms (SG-lite, 86eynw28q/86eynw2dy) --------------------------------
// The MY suites above double as the byte-identity pin for the MY arm — the
// legacy names now delegate to the country-parameterized validators.

describe("assertValidWaPhoneForCountry — SG loose arm", () => {
	test("prefixes a bare 8-digit mobile with 65 (the M3 CRM-fork fix)", () => {
		// A cashier at an SG counter keys the natural local form. Unprefixed it
		// would be stored as "81234567" while Meta delivers the same buyer
		// inbound as "6581234567" — forking the (retailerId, waPhone) customer.
		expect(assertValidWaPhoneForCountry("81234567", "SG")).toBe("6581234567");
		expect(assertValidWaPhoneForCountry("9123 4567", "SG")).toBe("6591234567");
	});

	test("keeps an already-international 65 number unchanged", () => {
		expect(assertValidWaPhoneForCountry("6591234567", "SG")).toBe(
			"6591234567",
		);
		expect(assertValidWaPhoneForCountry("+65 9123 4567", "SG")).toBe(
			"6591234567",
		);
	});

	test("SG has no trunk 0 — a 0-prefixed number is NOT rewritten", () => {
		// Stays loose: passed through (assume it carries meaning we can't infer)
		// and judged only by the 8–15-digit rule.
		expect(assertValidWaPhoneForCountry("0123456789", "SG")).toBe(
			"0123456789",
		);
	});

	test("a bare 6… 8-digit string is not treated as a local mobile", () => {
		expect(assertValidWaPhoneForCountry("61234567", "SG")).toBe("61234567");
	});

	test("passes a foreign number through for a walk-in from anywhere", () => {
		expect(assertValidWaPhoneForCountry("60123456789", "SG")).toBe(
			"60123456789",
		);
	});

	test("normalizes to the SAME digits an inbound scan produces (keying parity)", () => {
		expect(assertValidWaPhoneForCountry("81234567", "SG")).toBe(
			assertValidWaPhone("6581234567"),
		);
	});

	test("rejects junk", () => {
		expect(() => assertValidWaPhoneForCountry("not a phone", "SG")).toThrow();
		expect(() => assertValidWaPhoneForCountry("9123", "SG")).toThrow();
	});
});

describe("assertValidMobileForCountry — SG strict arm", () => {
	test("normalizes every accepted SG shape to the stored 65… form", () => {
		expect(assertValidMobileForCountry("9123 4567", "SG")).toBe("6591234567");
		expect(assertValidMobileForCountry("81234567", "SG")).toBe("6581234567");
		expect(assertValidMobileForCountry("+65 9123 4567", "SG")).toBe(
			"6591234567",
		);
		expect(assertValidMobileForCountry("6591234567", "SG")).toBe("6591234567");
	});

	test("rejects an MY mobile with the SG copy — no cross-accept", () => {
		expect(() => assertValidMobileForCountry("012-345 6789", "SG")).toThrow(
			/singapore mobile/i,
		);
		expect(() => assertValidMobileForCountry("60123456789", "SG")).toThrow(
			/singapore mobile/i,
		);
	});

	test("rejects non-mobile SG-length numbers", () => {
		// 8 digits but outside the 8/9 mobile ranges (e.g. a 6-prefixed fixed
		// line) — can never receive WhatsApp.
		expect(() => assertValidMobileForCountry("61234567", "SG")).toThrow(
			/singapore mobile/i,
		);
	});

	test("the MY arm keeps rejecting SG numbers symmetrically", () => {
		expect(() => assertValidMobileForCountry("+65 9123 4567", "MY")).toThrow(
			/malaysian mobile/i,
		);
	});
});

describe("normalizeMobileDigits", () => {
	test("MY arm matches the strict validator's bridging", () => {
		expect(normalizeMobileDigits("012-345 6789", "MY")).toBe(
			assertValidMyMobile("012-345 6789"),
		);
		expect(normalizeMobileDigits("12-345 6789", "MY")).toBe(
			assertValidMyMobile("12-345 6789"),
		);
	});

	test("SG arm matches the strict validator's bridging", () => {
		expect(normalizeMobileDigits("9123 4567", "SG")).toBe(
			assertValidMobileForCountry("9123 4567", "SG"),
		);
	});

	test("never throws — invalid shapes fall through as digits", () => {
		expect(normalizeMobileDigits("not a phone", "MY")).toBe("");
		expect(normalizeMobileDigits(undefined, "SG")).toBe("");
	});
});
