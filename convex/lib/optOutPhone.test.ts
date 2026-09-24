import { describe, expect, test } from "vitest";
import { COUNTRIES } from "./country";
import {
	canonicalOptOutPhone,
	OPT_OUT_FOREIGN_EXAMPLE,
	OPT_OUT_PHONE_MESSAGE,
	readOptOutPhone,
} from "./optOutPhone";
import { MOBILE_EXAMPLE } from "./slug";

describe("readOptOutPhone — MY/SG arms stay byte-identical", () => {
	test.each([
		["012-345 6789", "60123456789"],
		["12-345 6789", "60123456789"],
		["60123456789", "60123456789"],
		["+60 12-345 6789", "60123456789"],
		["011-1222 333", "60111222333"],
		["9123 4567", "6591234567"],
		["+65 9123 4567", "6591234567"],
		["6591234567", "6591234567"],
	])("%s → %s", (typed, key) => {
		expect(canonicalOptOutPhone(typed)).toBe(key);
	});

	test("reports the supported country it read", () => {
		expect(readOptOutPhone("012-345 6789")).toEqual({
			digits: "60123456789",
			iso: "MY",
		});
		expect(readOptOutPhone("9123 4567")).toEqual({
			digits: "6591234567",
			iso: "SG",
		});
	});

	test("an MY landline stays refused in every spelling", () => {
		expect(canonicalOptOutPhone("03-1234 5678")).toBeNull();
		expect(canonicalOptOutPhone("+60 3-1234 5678")).toBeNull();
		expect(canonicalOptOutPhone("0060 3-1234 5678")).toBeNull();
		// Bare international digits of a landline: the `60` code is MY's, so the
		// bare-digits arm must not pick it up as "some foreign number".
		expect(canonicalOptOutPhone("60312345678")).toBeNull();
	});

	test("the 00 international prefix reaches the strict MY arm too", () => {
		expect(canonicalOptOutPhone("0060 12-345 6789")).toBe("60123456789");
	});
});

describe("readOptOutPhone — any other country (z8r3fdh274)", () => {
	test("an explicit +CC keys on the digits Meta delivers", () => {
		expect(readOptOutPhone("+44 7911 123456")).toEqual({
			digits: "447911123456",
			iso: "GB",
		});
	});

	test("every spelling of the same foreign number agrees on one key", () => {
		for (const typed of [
			"+44 7911 123456",
			"0044 7911 123456",
			"447911123456",
			"+44 (0)7911 123456",
		]) {
			expect(canonicalOptOutPhone(typed)).toBe("447911123456");
		}
	});

	test("bare digits with a foreign code round-trip (the register's copy button)", () => {
		expect(readOptOutPhone("14155550123")).toEqual({
			digits: "14155550123",
			iso: "US",
		});
	});

	test("a foreign number with its trunk 0 but no code stays refused — the country is unknowable", () => {
		// `07911 123456` is a UK local form, but nothing says it is British.
		expect(canonicalOptOutPhone("07911 123456")).toBeNull();
	});

	test("a wrong-length foreign number is refused, not stored as typed", () => {
		expect(canonicalOptOutPhone("+44 7911 1234")).toBeNull();
	});

	test("junk is refused without throwing", () => {
		expect(canonicalOptOutPhone("not-a-phone")).toBeNull();
		expect(canonicalOptOutPhone("")).toBeNull();
		expect(canonicalOptOutPhone("+")).toBeNull();
		expect(canonicalOptOutPhone("+999 1234 5678")).toBeNull();
	});
});

// The admin pastes numbers out of WhatsApp and the register. The input gets
// the same cleaning as every buyer field (`cleanPhoneInput`), before ANY arm —
// the strict MY/SG arms included — so the key can't depend on invisible marks
// or on which script the digits were written in.
describe("readOptOutPhone — pasted and non-ASCII input keys like typed input", () => {
	test("bidi marks from a WhatsApp/contacts copy are ignored", () => {
		for (const [pasted, key] of [
			["\u202A+44 7911 123456\u202C", "447911123456"],
			// A mark in front of `00` hid the international prefix: the bare
			// digits then read as `+0044…`, which no calling code starts.
			["\u202A0044 7911 123456\u202C", "447911123456"],
			["\u2066+65 9123 4567\u2069", "6591234567"],
			["\u200E012-345 6789", "60123456789"],
		] as const) {
			expect(canonicalOptOutPhone(pasted), JSON.stringify(pasted)).toBe(key);
		}
	});

	test("script and full-width digits read as the same number — on the strict arms too", () => {
		// Arabic-Indic, Devanagari and full-width forms of numbers the ASCII tests
		// above key. Unmapped, the strict arms' non-digit strip DROPS them.
		expect(readOptOutPhone("٠١٢-٣٤٥ ٦٧٨٩")).toEqual({
			digits: "60123456789",
			iso: "MY",
		});
		expect(readOptOutPhone("९१२३ ४५६७")).toEqual({
			digits: "6591234567",
			iso: "SG",
		});
		expect(readOptOutPhone("＋４４ ７９１１ １２３４５６")).toEqual({
			digits: "447911123456",
			iso: "GB",
		});
		// Read, then judged like any other input: a landline stays refused.
		expect(canonicalOptOutPhone("٠٣-١٢٣٤ ٥٦٧٨")).toBeNull();
	});
});

describe("OPT_OUT_PHONE_MESSAGE", () => {
	// Copy that demonstrates a format the save then refuses is worse than none.
	test("every example it shows is one the panel accepts", () => {
		for (const country of COUNTRIES) {
			expect(OPT_OUT_PHONE_MESSAGE).toContain(MOBILE_EXAMPLE[country]);
			expect(canonicalOptOutPhone(MOBILE_EXAMPLE[country])).not.toBeNull();
		}
		expect(OPT_OUT_PHONE_MESSAGE).toContain(OPT_OUT_FOREIGN_EXAMPLE);
		expect(canonicalOptOutPhone(OPT_OUT_FOREIGN_EXAMPLE)).not.toBeNull();
	});

	test("names the any-country rule", () => {
		expect(OPT_OUT_PHONE_MESSAGE).toBe(
			"Enter a Malaysian mobile (012-345 6789), a Singapore mobile (9123 4567), or any other country's WhatsApp number with its country code (e.g. +44 7911 123456)",
		);
	});
});
