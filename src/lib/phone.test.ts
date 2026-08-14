/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { myWaPhoneCheckoutSchema, myWaPhoneFormOptionalSchema } from "./schemas";
import { normalizeMyDigits, toMyNationalInput } from "./phone";

describe("normalizeMyDigits", () => {
	test("keeps an already-international number", () => {
		expect(normalizeMyDigits("60123456789")).toBe("60123456789");
		expect(normalizeMyDigits("+60 12-345 6789")).toBe("60123456789");
	});

	test("drops the trunk 0 from a local number", () => {
		expect(normalizeMyDigits("012-345 6789")).toBe("60123456789");
		expect(normalizeMyDigits("0123456789")).toBe("60123456789");
	});

	test("prepends 60 to the bare NSN the `+60` plate asks for", () => {
		expect(normalizeMyDigits("12-345 6789")).toBe("60123456789");
		// 11-digit local prefixes (011/015) have a 9-digit NSN.
		expect(normalizeMyDigits("11-5939 9791")).toBe("601159399791");
	});

	test("leaves a foreign number alone rather than making it Malaysian", () => {
		// +1 (US) is 11 digits — outside the 9–10 the NSN arm accepts, so it can't
		// be silently rewritten to `601…`. It just fails the shape check later.
		expect(normalizeMyDigits("+1 555 234 5678")).toBe("15552345678");
		expect(normalizeMyDigits("+65 8123 4567")).toBe("6581234567");
	});

	test("is empty-safe", () => {
		expect(normalizeMyDigits("")).toBe("");
		expect(normalizeMyDigits(undefined)).toBe("");
		expect(normalizeMyDigits("+")).toBe("");
	});
});

describe("toMyNationalInput", () => {
	test("peels the country code off a stored number so the +60 plate isn't doubled", () => {
		expect(toMyNationalInput("60123456789")).toBe("12-345 6789");
		expect(toMyNationalInput("601159399791")).toBe("11-5939 9791");
	});

	test("round-trips: what it renders is what the validator accepts", () => {
		const stored = "601159399791";
		const parsed = myWaPhoneCheckoutSchema.safeParse(toMyNationalInput(stored));
		expect(parsed.success && parsed.data).toBe(stored);
	});

	test("shows a non-MY legacy value as bare digits instead of reshaping it", () => {
		// A row saved before the seller-side fields became MY-only. It stays
		// visible and editable; the validator names the problem on save.
		expect(toMyNationalInput("6581234567")).toBe("6581234567");
	});

	test("is empty-safe", () => {
		expect(toMyNationalInput("")).toBe("");
		expect(toMyNationalInput(undefined)).toBe("");
	});
});

describe("myWaPhoneCheckoutSchema — the validator behind the +60 plate", () => {
	test.each([
		["bare NSN, as the plate asks", "12-345 6789"],
		["local with trunk 0", "012-345 6789"],
		["full international", "60123456789"],
		["international with separators", "+60 12-345 6789"],
	])("accepts %s", (_label, input) => {
		const parsed = myWaPhoneCheckoutSchema.safeParse(input);
		expect(parsed.success && parsed.data).toBe("60123456789");
	});

	test.each([
		["a landline — 8-15 digits but never reaches WhatsApp", "03-1234 5678"],
		["a Singapore mobile", "+65 8123 4567"],
		["a US number that merely starts with 1", "+1 555 234 5678"],
		["too short", "12-345"],
		["empty", ""],
	])("rejects %s", (_label, input) => {
		expect(myWaPhoneCheckoutSchema.safeParse(input).success).toBe(false);
	});
});

describe("myWaPhoneFormOptionalSchema", () => {
	test("allows blank — the field is optional", () => {
		expect(myWaPhoneFormOptionalSchema.safeParse("").success).toBe(true);
		expect(myWaPhoneFormOptionalSchema.safeParse("   ").success).toBe(true);
	});

	test("still enforces the MY mobile shape once something is typed", () => {
		expect(myWaPhoneFormOptionalSchema.safeParse("12-345 6789").success).toBe(
			true,
		);
		expect(myWaPhoneFormOptionalSchema.safeParse("03-1234 5678").success).toBe(
			false,
		);
	});

	test("does not transform — a form field's value stays what the user typed", () => {
		// TanStack Form validates without replacing state, so the schema must be
		// string-in/string-out or the field's type stops matching its value.
		const parsed = myWaPhoneFormOptionalSchema.safeParse("12-345 6789");
		expect(parsed.success && parsed.data).toBe("12-345 6789");
	});
});
