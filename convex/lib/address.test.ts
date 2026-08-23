import { describe, expect, test } from "vitest";
import { assertValidAddress, SG_STATE_LABEL } from "./address";

const myAddress = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

const sgAddress = {
	line1: "12 Bedok North Ave 3",
	city: "Singapore",
	state: "Singapore",
	postcode: "238859",
};

describe("assertValidAddress — MY arm (the default)", () => {
	test("accepts the classic MY shape with no country argument", () => {
		const result = assertValidAddress(myAddress);
		expect(result.state).toBe("Selangor");
		expect(result.postcode).toBe("47301");
	});

	test("explicit MY behaves identically to the default", () => {
		expect(assertValidAddress(myAddress, "MY")).toEqual(
			assertValidAddress(myAddress),
		);
	});

	test("rejects a 6-digit postcode", () => {
		expect(() =>
			assertValidAddress({ ...myAddress, postcode: "238859" }),
		).toThrow(/Postcode must be 5 digits/);
	});

	test("rejects an SG-shaped state", () => {
		expect(() =>
			assertValidAddress({ ...myAddress, state: "Singapore" }),
		).toThrow(/Unknown state/);
	});
});

describe("assertValidAddress — SG arm (86eynw29u)", () => {
	test("accepts a 6-digit postal code with the Singapore state literal", () => {
		const result = assertValidAddress(sgAddress, "SG");
		expect(result.state).toBe(SG_STATE_LABEL);
		expect(result.postcode).toBe("238859");
	});

	test("normalizes a case-variant state to the canonical literal", () => {
		for (const variant of ["singapore", "SINGAPORE", " Singapore "]) {
			expect(assertValidAddress({ ...sgAddress, state: variant }, "SG").state)
				.toBe(SG_STATE_LABEL);
		}
	});

	test("rejects a 5-digit postcode with SG copy", () => {
		expect(() =>
			assertValidAddress({ ...sgAddress, postcode: "47301" }, "SG"),
		).toThrow(/Postal code must be 6 digits/);
	});

	test("rejects an MY state on an SG address", () => {
		expect(() =>
			assertValidAddress({ ...sgAddress, state: "Selangor" }, "SG"),
		).toThrow(/Singapore/);
	});

	test("shared field rules still apply (line1 length)", () => {
		expect(() => assertValidAddress({ ...sgAddress, line1: "ab" }, "SG"))
			.toThrow(/at least 3 characters/);
	});
});
