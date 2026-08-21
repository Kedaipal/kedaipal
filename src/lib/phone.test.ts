/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { normalizeMobileDigits, toNationalPhoneInput } from "./phone";
import { waPhoneCheckoutSchema, waPhoneFormOptionalSchema } from "./schemas";

describe("normalizeMobileDigits — MY arm", () => {
	test("keeps an already-international number", () => {
		expect(normalizeMobileDigits("60123456789", "MY")).toBe("60123456789");
		expect(normalizeMobileDigits("+60 12-345 6789", "MY")).toBe("60123456789");
	});

	test("drops the trunk 0 from a local number", () => {
		expect(normalizeMobileDigits("012-345 6789", "MY")).toBe("60123456789");
		expect(normalizeMobileDigits("0123456789", "MY")).toBe("60123456789");
	});

	test("prepends 60 to the bare NSN the `+60` plate asks for", () => {
		expect(normalizeMobileDigits("12-345 6789", "MY")).toBe("60123456789");
		// 11-digit local prefixes (011/015) have a 9-digit NSN.
		expect(normalizeMobileDigits("11-5939 9791", "MY")).toBe("601159399791");
	});

	test("leaves a foreign number alone rather than making it Malaysian", () => {
		// +1 (US) is 11 digits — outside the 9–10 the NSN arm accepts, so it can't
		// be silently rewritten to `601…`. It just fails the shape check later.
		expect(normalizeMobileDigits("+1 555 234 5678", "MY")).toBe("15552345678");
		expect(normalizeMobileDigits("+65 8123 4567", "MY")).toBe("6581234567");
	});

	test("is empty-safe", () => {
		expect(normalizeMobileDigits("", "MY")).toBe("");
		expect(normalizeMobileDigits(undefined, "MY")).toBe("");
		expect(normalizeMobileDigits("+", "MY")).toBe("");
	});
});

describe("normalizeMobileDigits — SG arm (86eynw28q)", () => {
	test("keeps an already-international number", () => {
		expect(normalizeMobileDigits("6591234567", "SG")).toBe("6591234567");
		expect(normalizeMobileDigits("+65 9123 4567", "SG")).toBe("6591234567");
	});

	test("prepends 65 to the bare NSN the `+65` plate asks for (M4)", () => {
		// SG has no trunk 0 — the bare 8-digit mobile IS the local form.
		expect(normalizeMobileDigits("9123 4567", "SG")).toBe("6591234567");
		expect(normalizeMobileDigits("81234567", "SG")).toBe("6581234567");
	});

	test("leaves a foreign number alone rather than making it Singaporean", () => {
		// A full MY number typed at an SG store passes through as itself — it
		// then fails the SG shape check instead of being silently rewritten.
		expect(normalizeMobileDigits("+60 12-345 6789", "SG")).toBe("60123456789");
		expect(normalizeMobileDigits("+1 555 234 5678", "SG")).toBe("15552345678");
	});

	test("a bare 6… is never treated as an NSN", () => {
		// SG mobiles start 8/9; an 8-digit 6… is junk, not a foldable local
		// number — it passes through and fails validation.
		expect(normalizeMobileDigits("61234567", "SG")).toBe("61234567");
	});
});

describe("toNationalPhoneInput — MY plate", () => {
	test("peels the country code off a stored number so the +60 plate isn't doubled", () => {
		expect(toNationalPhoneInput("60123456789", "MY")).toBe("12-345 6789");
		expect(toNationalPhoneInput("601159399791", "MY")).toBe("11-5939 9791");
	});

	test("round-trips: what it renders is what the validator accepts", () => {
		const stored = "601159399791";
		const parsed = waPhoneCheckoutSchema.MY.safeParse(
			toNationalPhoneInput(stored, "MY"),
		);
		expect(parsed.success && parsed.data).toBe(stored);
	});

	test("shows a value from the OTHER country as bare digits instead of reshaping it", () => {
		// A row saved before the store switched country. It stays visible and
		// editable; the validator names the problem on save.
		expect(toNationalPhoneInput("6581234567", "MY")).toBe("6581234567");
	});

	test("is empty-safe", () => {
		expect(toNationalPhoneInput("", "MY")).toBe("");
		expect(toNationalPhoneInput(undefined, "MY")).toBe("");
	});
});

describe("toNationalPhoneInput — SG plate (86eynw2dy)", () => {
	test("peels the country code off a stored number so the +65 plate isn't doubled (M5)", () => {
		expect(toNationalPhoneInput("6591234567", "SG")).toBe("9123 4567");
		expect(toNationalPhoneInput("6581234567", "SG")).toBe("8123 4567");
	});

	test("round-trips: what it renders is what the validator accepts", () => {
		const stored = "6591234567";
		const parsed = waPhoneCheckoutSchema.SG.safeParse(
			toNationalPhoneInput(stored, "SG"),
		);
		expect(parsed.success && parsed.data).toBe(stored);
	});

	test("shows a stored MY number as bare digits instead of peeling the wrong plate", () => {
		expect(toNationalPhoneInput("60123456789", "SG")).toBe("60123456789");
	});
});

describe("waPhoneCheckoutSchema.MY — the validator behind the +60 plate", () => {
	test.each([
		["bare NSN, as the plate asks", "12-345 6789"],
		["local with trunk 0", "012-345 6789"],
		["full international", "60123456789"],
		["international with separators", "+60 12-345 6789"],
	])("accepts %s", (_label, input) => {
		const parsed = waPhoneCheckoutSchema.MY.safeParse(input);
		expect(parsed.success && parsed.data).toBe("60123456789");
	});

	test.each([
		["a landline — 8-15 digits but never reaches WhatsApp", "03-1234 5678"],
		["a Singapore mobile", "+65 8123 4567"],
		["a US number that merely starts with 1", "+1 555 234 5678"],
		["too short", "12-345"],
		["empty", ""],
	])("rejects %s", (_label, input) => {
		expect(waPhoneCheckoutSchema.MY.safeParse(input).success).toBe(false);
	});
});

describe("waPhoneCheckoutSchema.SG — the validator behind the +65 plate", () => {
	test.each([
		["bare NSN, as the plate asks", "9123 4567"],
		["full international", "6591234567"],
		["international with separators", "+65 9123 4567"],
	])("accepts %s", (_label, input) => {
		const parsed = waPhoneCheckoutSchema.SG.safeParse(input);
		expect(parsed.success && parsed.data).toBe("6591234567");
	});

	test.each([
		["a Malaysian mobile — the MY arm's accept is this arm's reject", "+60 12-345 6789"],
		["a bare MY local number", "012-345 6789"],
		["an 8-digit number starting 6 (not an SG mobile range)", "61234567"],
		["too short", "9123"],
		["empty", ""],
	])("rejects %s", (_label, input) => {
		expect(waPhoneCheckoutSchema.SG.safeParse(input).success).toBe(false);
	});

	test("rejects with the SG copy, not the Malaysian message", () => {
		const result = waPhoneCheckoutSchema.SG.safeParse("012-345 6789");
		expect(!result.success && result.error.issues[0].message).toBe(
			"Enter a Singapore mobile number (e.g. 9123 4567)",
		);
	});
});

describe("waPhoneFormOptionalSchema", () => {
	test("allows blank — the field is optional (both countries)", () => {
		expect(waPhoneFormOptionalSchema.MY.safeParse("").success).toBe(true);
		expect(waPhoneFormOptionalSchema.SG.safeParse("   ").success).toBe(true);
	});

	test("still enforces the country's mobile shape once something is typed", () => {
		expect(waPhoneFormOptionalSchema.MY.safeParse("12-345 6789").success).toBe(
			true,
		);
		expect(waPhoneFormOptionalSchema.MY.safeParse("03-1234 5678").success).toBe(
			false,
		);
		expect(waPhoneFormOptionalSchema.SG.safeParse("9123 4567").success).toBe(
			true,
		);
		expect(waPhoneFormOptionalSchema.SG.safeParse("12-345 6789").success).toBe(
			false,
		);
	});

	test("does not transform — a form field's value stays what the user typed", () => {
		// TanStack Form validates without replacing state, so the schema must be
		// string-in/string-out or the field's type stops matching its value.
		const parsed = waPhoneFormOptionalSchema.MY.safeParse("12-345 6789");
		expect(parsed.success && parsed.data).toBe("12-345 6789");
	});
});
