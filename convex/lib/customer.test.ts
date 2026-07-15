/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	buildSearchText,
	formatPhone,
	getDisplayName,
	orderCustomerLabel,
} from "./customer";

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
	test("prefers retailer-edited name over everything", () => {
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

	test("treats a blank/whitespace name as unset", () => {
		expect(
			getDisplayName({
				name: "   ",
				waProfileName: "Aisha Cakes",
				waPhone: "60123456789",
			}),
		).toBe("Aisha Cakes");
	});
});

describe("orderCustomerLabel", () => {
	test("prefers the snapshot name", () => {
		expect(orderCustomerLabel({ name: "Aisha", waPhone: "60123456789" })).toBe(
			"Aisha",
		);
	});

	test("no name AND no phone = anonymous walk-in", () => {
		expect(orderCustomerLabel({})).toBe("Walk-in customer");
	});

	test("phone but no name falls back (default 'Anonymous')", () => {
		expect(orderCustomerLabel({ waPhone: "60123456789" })).toBe("Anonymous");
	});

	test("a custom fallback is used for a phone-only order", () => {
		expect(orderCustomerLabel({ waPhone: "60123456789" }, "")).toBe("");
	});

	test("blank name is treated as unset", () => {
		expect(orderCustomerLabel({ name: "   " })).toBe("Walk-in customer");
	});
});

describe("buildSearchText", () => {
	test("lowercases and joins name, profile name, and phone", () => {
		expect(
			buildSearchText({
				name: "Aisha",
				waProfileName: "Aisha Cakes",
				waPhone: "60123456789",
			}),
		).toBe("aisha aisha cakes 60123456789");
	});

	test("omits undefined and blank parts", () => {
		expect(buildSearchText({ name: "  ", waPhone: "60123456789" })).toBe(
			"60123456789",
		);
	});
});
