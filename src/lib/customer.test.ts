import { describe, expect, test } from "vitest";
import { formatPhone, getDisplayName } from "./customer";

describe("formatPhone", () => {
	test("formats a Malaysian number with +60 prefix", () => {
		expect(formatPhone("60123456789")).toBe("+60 123456789");
	});

	test("strips non-digit characters before formatting", () => {
		expect(formatPhone("+60 12-345 6789")).toBe("+60 123456789");
	});

	test("prefixes a bare + for non-MY numbers", () => {
		expect(formatPhone("6551234567")).toBe("+6551234567");
	});

	test("returns empty string for empty input", () => {
		expect(formatPhone("")).toBe("");
	});
});

describe("getDisplayName", () => {
	test("prefers retailer-edited name", () => {
		expect(
			getDisplayName({
				name: "Aisha (VIP)",
				waProfileName: "Aisha Cakes",
				waPhone: "60123456789",
			}),
		).toBe("Aisha (VIP)");
	});

	test("falls back to waProfileName when name is unset", () => {
		expect(
			getDisplayName({ waProfileName: "Aisha Cakes", waPhone: "60123456789" }),
		).toBe("Aisha Cakes");
	});

	test("falls back to formatted phone when name and profile name are unset", () => {
		expect(getDisplayName({ waPhone: "60123456789" })).toBe("+60 123456789");
	});

	test("treats a blank name as unset", () => {
		expect(getDisplayName({ name: "  ", waPhone: "60123456789" })).toBe(
			"+60 123456789",
		);
	});
});
