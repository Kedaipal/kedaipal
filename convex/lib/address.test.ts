import { describe, expect, test } from "vitest";
import {
	assertValidAddress,
	formatBusinessAddress,
	formatPickupAddress,
	formatPremiseAddress,
	sanitizeUnitLine,
	SG_STATE_LABEL,
	UNIT_LINE_MAX_LENGTH,
} from "./address";

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


// ---------------------------------------------------------------------------
// Seller premises — the unit/floor line (z8r3fdff8r)
// ---------------------------------------------------------------------------

describe("sanitizeUnitLine", () => {
	test("undefined and blank both mean 'no unit' — one spelling", () => {
		expect(sanitizeUnitLine(undefined)).toEqual({ ok: true, value: undefined });
		expect(sanitizeUnitLine("")).toEqual({ ok: true, value: undefined });
		expect(sanitizeUnitLine("   ")).toEqual({ ok: true, value: undefined });
		expect(sanitizeUnitLine("\n\t ")).toEqual({ ok: true, value: undefined });
	});

	test("collapses newlines and runs of space — this prints on ONE line", () => {
		expect(sanitizeUnitLine("Unit 3-1,\nBlock  B\r\nLevel 2")).toEqual({
			ok: true,
			value: "Unit 3-1, Block B Level 2",
		});
		expect(sanitizeUnitLine("  Unit 3-1  ")).toEqual({
			ok: true,
			value: "Unit 3-1",
		});
	});

	test("refuses a line past the cap, measured AFTER trimming", () => {
		expect(sanitizeUnitLine("a".repeat(UNIT_LINE_MAX_LENGTH))).toEqual({
			ok: true,
			value: "a".repeat(UNIT_LINE_MAX_LENGTH),
		});
		expect(sanitizeUnitLine("a".repeat(UNIT_LINE_MAX_LENGTH + 1))).toEqual({
			ok: false,
		});
		// Padding alone never tips it over.
		expect(
			sanitizeUnitLine(`  ${"a".repeat(UNIT_LINE_MAX_LENGTH)}  `),
		).toEqual({ ok: true, value: "a".repeat(UNIT_LINE_MAX_LENGTH) });
	});
});

describe("formatPremiseAddress", () => {
	test("no unit → byte-identical to the label alone", () => {
		expect(formatPremiseAddress("12 Jln Mawar", undefined)).toBe(
			"12 Jln Mawar",
		);
		expect(formatPremiseAddress("12 Jln Mawar", "")).toBe("12 Jln Mawar");
		expect(formatPremiseAddress("12 Jln Mawar", "  ")).toBe("12 Jln Mawar");
	});

	test("the unit leads — it is what the rider needs last and reads first", () => {
		expect(formatPremiseAddress("12 Jln Mawar", "Unit 3-1")).toBe(
			"Unit 3-1, 12 Jln Mawar",
		);
	});

	test("both premise flavours compose the same way", () => {
		expect(
			formatBusinessAddress({ label: "12 Jln Mawar", unit: "Lot 5" }),
		).toBe("Lot 5, 12 Jln Mawar");
		expect(formatBusinessAddress({ label: "12 Jln Mawar" })).toBe(
			"12 Jln Mawar",
		);
		expect(
			formatPickupAddress({ address: "Pasar Tani Seksyen 7", unit: "Stall 12" }),
		).toBe("Stall 12, Pasar Tani Seksyen 7");
		expect(formatPickupAddress({ address: "Pasar Tani Seksyen 7" })).toBe(
			"Pasar Tani Seksyen 7",
		);
	});
});
