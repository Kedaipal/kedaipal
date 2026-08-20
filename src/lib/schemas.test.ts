import { describe, expect, it } from "vitest";
import { waPhoneCheckoutSchema } from "./schemas";

// Built from convex/lib/slug.ts's own patterns + normalizer, then requires the
// country's MOBILE shape — the checkout gate for the WABA confirmation push
// (86eyf1rck; per-country since SG-lite 86eynw28q). The server re-validates on
// create with the same country arm.
describe("waPhoneCheckoutSchema.MY", () => {
	it("normalizes local formats to the inbound (60…) form", () => {
		expect(waPhoneCheckoutSchema.MY.parse("0123456789")).toBe("60123456789");
		expect(waPhoneCheckoutSchema.MY.parse("012-345 6789")).toBe("60123456789");
		expect(waPhoneCheckoutSchema.MY.parse("+60 12-345 6789")).toBe(
			"60123456789",
		);
		expect(waPhoneCheckoutSchema.MY.parse("60123456789")).toBe("60123456789");
	});

	it("accepts 011-series numbers (one digit longer)", () => {
		expect(waPhoneCheckoutSchema.MY.parse("011-2345 6789")).toBe(
			"601123456789",
		);
	});

	// The field renders a "+60" prefix badge (86eyfq04j), so a buyer who reads
	// it and types only the rest must be accepted — otherwise the badge tells
	// them to do the one thing the validator rejects.
	it("accepts a bare national number typed after the +60 badge", () => {
		expect(waPhoneCheckoutSchema.MY.parse("123456789")).toBe("60123456789");
		expect(waPhoneCheckoutSchema.MY.parse("12-345 6789")).toBe("60123456789");
		expect(waPhoneCheckoutSchema.MY.parse("1123456789")).toBe("601123456789");
	});

	it("rejects non-mobile and non-MY numbers with the checkout copy", () => {
		for (const bad of [
			"12345", // junk
			"03-1234 5678", // MY landline (603…)
			"6512345678", // SG number
			"441234567890", // UK number
			"not a phone",
			"",
		]) {
			const result = waPhoneCheckoutSchema.MY.safeParse(bad);
			expect(result.success, `expected ${JSON.stringify(bad)} to fail`).toBe(
				false,
			);
			if (!result.success) {
				expect(result.error.issues[0].message).toContain(
					"Malaysian mobile number",
				);
			}
		}
	});
});

describe("waPhoneCheckoutSchema.SG (86eynw28q)", () => {
	it("normalizes local formats to the inbound (65…) form", () => {
		expect(waPhoneCheckoutSchema.SG.parse("9123 4567")).toBe("6591234567");
		expect(waPhoneCheckoutSchema.SG.parse("81234567")).toBe("6581234567");
		expect(waPhoneCheckoutSchema.SG.parse("+65 9123 4567")).toBe("6591234567");
		expect(waPhoneCheckoutSchema.SG.parse("6591234567")).toBe("6591234567");
	});

	it("rejects non-mobile and non-SG numbers with the SG copy", () => {
		for (const bad of [
			"9123", // junk
			"61234567", // 8 digits but not an 8/9 mobile range
			"60123456789", // MY number — no cross-accept between the arms
			"012-345 6789", // MY local form
			"not a phone",
			"",
		]) {
			const result = waPhoneCheckoutSchema.SG.safeParse(bad);
			expect(result.success, `expected ${JSON.stringify(bad)} to fail`).toBe(
				false,
			);
			if (!result.success) {
				expect(result.error.issues[0].message).toContain(
					"Singapore mobile number",
				);
			}
		}
	});
});
