/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	assertValidBuyerWaPhone,
	BUYER_PHONE_EMPTY_MESSAGE,
	dialCodeLabel,
	dialCountryName,
	NEARBY_DIAL_COUNTRIES,
	parseBuyerWaPhone,
	resolveBuyerDialCountry,
	UNKNOWN_DIAL_CODE_MESSAGE,
	UNKNOWN_DIAL_COUNTRY_MESSAGE,
} from "./buyerPhone";
import { COUNTRIES } from "./country";
import { isDialIso } from "./phoneDial";
import { assertValidMobileForCountry, MOBILE_MESSAGE } from "./slug";

/**
 * Ground truth: what libphonenumber-js 1.13.13 (`parsePhoneNumber`, max
 * metadata) normalises each national input to — the same E.164 digits Meta
 * delivers inbound as `from`, which is what the customer row keys on.
 */
const LIBPHONENUMBER_FIXTURES: [string, string, string][] = [
	["JP", "090-1234-5678", "819012345678"],
	["ID", "0812-3456-7890", "6281234567890"],
	["VN", "091 234 5678", "84912345678"],
	["KR", "010-1234-5678", "821012345678"],
	["GB", "07911 123456", "447911123456"],
	["US", "(415) 555-0132", "14155550132"],
	["US", "1 415 555 0132", "14155550132"],
	["RU", "8 912 345-67-89", "79123456789"],
	["CI", "07 07 12 34 56", "2250707123456"],
	["IT", "347 123 4567", "393471234567"],
	["TH", "081 234 5678", "66812345678"],
	["AU", "0412 345 678", "61412345678"],
	["IN", "98765 43210", "919876543210"],
	["BN", "712 3456", "6737123456"],
	["HU", "06 30 123 4567", "36301234567"],
];

describe("parseBuyerWaPhone — any country (z8r3fdh274)", () => {
	test.each(LIBPHONENUMBER_FIXTURES)(
		"%s %s → %s (matches libphonenumber)",
		(iso, typed, digits) => {
			if (!isDialIso(iso)) throw new Error(`fixture ISO ${iso} not in table`);
			expect(parseBuyerWaPhone(typed, iso)).toEqual({
				ok: true,
				digits,
				iso,
			});
		},
	);

	test("a trunk prefix is only stripped where the country HAS one (Italy keeps its 0)", () => {
		// Italy dials no trunk prefix: the 0 of 06… is part of the number and is
		// kept (libphonenumber: 390612345678). Lengths can't tell this Rome
		// landline from a mobile — a failed push is the backstop for that, and
		// the track page's number repair is how the buyer recovers.
		expect(assertValidBuyerWaPhone("06 1234 5678", "IT")).toBe("390612345678");
		// Côte d'Ivoire's leading 0 is part of the number (2021 renumbering).
		expect(assertValidBuyerWaPhone("0707123456", "CI")).toBe("2250707123456");
	});

	test("a trunk digit that is part of the number is kept (Russian 8 12 is not a trunk 8)", () => {
		// 10 digits starting 9: a mobile with no trunk prefix typed.
		expect(assertValidBuyerWaPhone("912 345 67 89", "RU")).toBe("79123456789");
	});

	test("the calling code typed without its + is peeled, not doubled", () => {
		expect(assertValidBuyerWaPhone("44 7911 123456", "GB")).toBe("447911123456");
		expect(assertValidBuyerWaPhone("81 90 1234 5678", "JP")).toBe("819012345678");
		// …including the "+44 (0)" habit.
		expect(assertValidBuyerWaPhone("+44 (0)7911 123456", "GB")).toBe(
			"447911123456",
		);
	});

	test("an explicit +CC / 00CC is honoured over the pick — typed, not sniffed", () => {
		expect(parseBuyerWaPhone("+81 90-1234-5678", "MY")).toEqual({
			ok: true,
			digits: "819012345678",
			iso: "JP",
		});
		expect(parseBuyerWaPhone("0081 90 1234 5678", "SG")).toEqual({
			ok: true,
			digits: "819012345678",
			iso: "JP",
		});
		// A supported country's code goes through its STRICT arm, landline
		// refusal included.
		expect(parseBuyerWaPhone("+65 9123 4567", "MY")).toEqual({
			ok: true,
			digits: "6591234567",
			iso: "SG",
		});
		expect(parseBuyerWaPhone("+60 3-1234 5678", "JP").ok).toBe(false);
	});

	test("a shared code keeps the pick when the pick answers to it", () => {
		expect(parseBuyerWaPhone("+1 416 555 0199", "CA")).toEqual({
			ok: true,
			digits: "14165550199",
			iso: "CA",
		});
		expect(parseBuyerWaPhone("+1 416 555 0199", "MY")).toMatchObject({
			ok: true,
			iso: "US",
		});
	});

	test("an unknown calling code is refused with its own copy", () => {
		expect(parseBuyerWaPhone("+999 123 4567", "MY")).toEqual({
			ok: false,
			message: UNKNOWN_DIAL_CODE_MESSAGE,
		});
	});

	test("a wrong length names the picked country and points at the picker", () => {
		const result = parseBuyerWaPhone("090-1234-567", "JP");
		expect(result).toEqual({
			ok: false,
			message:
				"Enter a valid Japan mobile number (+81), or change the country",
		});
	});

	test("never exceeds E.164's 15 digits", () => {
		// Indonesia's longest mobile NSN is 12 → 14 digits; anything longer fails.
		expect(parseBuyerWaPhone("0812 3456 7890 123", "ID").ok).toBe(false);
	});

	test("empty input asks for the number", () => {
		expect(parseBuyerWaPhone("  ", "MY")).toEqual({
			ok: false,
			message: BUYER_PHONE_EMPTY_MESSAGE,
		});
	});
});

describe("parseBuyerWaPhone — MY/SG keep the strict arm byte for byte", () => {
	const SAME_AS_STRICT: [string, "MY" | "SG"][] = [
		["012-345 6789", "MY"],
		["12-345 6789", "MY"],
		["011-2345 6789", "MY"],
		["+60 12-345 6789", "MY"],
		["60123456789", "MY"],
		["9123 4567", "SG"],
		["+65 9123 4567", "SG"],
		["6591234567", "SG"],
	];
	test.each(SAME_AS_STRICT)("%s at %s", (typed, country) => {
		expect(assertValidBuyerWaPhone(typed, country)).toBe(
			assertValidMobileForCountry(typed, country),
		);
	});

	test("an MY landline is still refused with the MY copy", () => {
		expect(parseBuyerWaPhone("03-1234 5678", "MY")).toEqual({
			ok: false,
			message: MOBILE_MESSAGE.MY,
		});
	});

	test("bare digits of the OTHER supported country are refused — with a one-tap switch", () => {
		expect(parseBuyerWaPhone("9123 4567", "MY")).toEqual({
			ok: false,
			message:
				"That looks like a Singapore mobile number — switch the country to +65",
			suggest: "SG",
		});
		expect(parseBuyerWaPhone("012-345 6789", "SG")).toEqual({
			ok: false,
			message:
				"That looks like a Malaysian mobile number — switch the country to +60",
			suggest: "MY",
		});
	});

	test("a Malaysian number typed under a foreign pick suggests switching back", () => {
		expect(parseBuyerWaPhone("012-345 6789", "JP")).toMatchObject({
			ok: false,
			suggest: "MY",
		});
	});
});

describe("resolveBuyerDialCountry", () => {
	test("absent → the store's country (every legacy caller)", () => {
		expect(resolveBuyerDialCountry(undefined, "SG")).toBe("SG");
		expect(resolveBuyerDialCountry("", "MY")).toBe("MY");
	});
	test("a known ISO passes; an unknown one is refused, never defaulted", () => {
		expect(resolveBuyerDialCountry("JP", "MY")).toBe("JP");
		expect(() => resolveBuyerDialCountry("XX", "MY")).toThrow(
			UNKNOWN_DIAL_COUNTRY_MESSAGE,
		);
		// The WhatsApp-unreachable jurisdictions are not in the table at all.
		expect(() => resolveBuyerDialCountry("IR", "MY")).toThrow();
	});
});

describe("picker copy", () => {
	test("names and codes", () => {
		expect(dialCountryName("JP")).toBe("Japan");
		expect(dialCodeLabel("GB")).toBe("+44");
	});
	test("every nearby country is a real row and never the store itself", () => {
		for (const store of COUNTRIES) {
			for (const iso of NEARBY_DIAL_COUNTRIES[store]) {
				expect(isDialIso(iso)).toBe(true);
				expect(iso).not.toBe(store);
			}
		}
	});
});
