import { describe, expect, it } from "vitest";
import { myWaPhoneCheckoutSchema } from "./schemas";

// Mirrors convex/lib/slug.ts assertValidMyWaPhone's normalization, then
// requires a Malaysian MOBILE shape — the checkout gate for the WABA
// confirmation push (86eyf1rck). The server re-validates on create.
describe("myWaPhoneCheckoutSchema", () => {
	it("normalizes local formats to the inbound (60…) form", () => {
		expect(myWaPhoneCheckoutSchema.parse("0123456789")).toBe("60123456789");
		expect(myWaPhoneCheckoutSchema.parse("012-345 6789")).toBe("60123456789");
		expect(myWaPhoneCheckoutSchema.parse("+60 12-345 6789")).toBe(
			"60123456789",
		);
		expect(myWaPhoneCheckoutSchema.parse("60123456789")).toBe("60123456789");
	});

	it("accepts 011-series numbers (one digit longer)", () => {
		expect(myWaPhoneCheckoutSchema.parse("011-2345 6789")).toBe(
			"601123456789",
		);
	});

	// The field renders a "+60" prefix badge (86eyfq04j), so a buyer who reads
	// it and types only the rest must be accepted — otherwise the badge tells
	// them to do the one thing the validator rejects.
	it("accepts a bare national number typed after the +60 badge", () => {
		expect(myWaPhoneCheckoutSchema.parse("123456789")).toBe("60123456789");
		expect(myWaPhoneCheckoutSchema.parse("12-345 6789")).toBe("60123456789");
		expect(myWaPhoneCheckoutSchema.parse("1123456789")).toBe("601123456789");
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
			const result = myWaPhoneCheckoutSchema.safeParse(bad);
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
