import { describe, expect, test } from "vitest";
import {
	assertCountry,
	COUNTRIES,
	COUNTRY_CURRENCY,
	COUNTRY_LABELS,
	DEFAULT_COUNTRY,
	isCountry,
} from "./country";
import { isSupportedCurrency } from "./currency";

describe("country", () => {
	test("MY is the default (undefined rows read as MY everywhere)", () => {
		expect(DEFAULT_COUNTRY).toBe("MY");
		expect(COUNTRIES).toContain("MY");
		expect(COUNTRIES).toContain("SG");
	});

	test("isCountry / assertCountry accept the closed set only", () => {
		expect(isCountry("MY")).toBe(true);
		expect(isCountry("SG")).toBe(true);
		expect(isCountry("ID")).toBe(false);
		expect(isCountry("my")).toBe(false); // case-sensitive, like currency codes
		expect(assertCountry("SG")).toBe("SG");
		expect(() => assertCountry("TH")).toThrow(/Unsupported country/);
	});

	test("every country maps to a label and a supported birth currency", () => {
		for (const c of COUNTRIES) {
			expect(COUNTRY_LABELS[c].length).toBeGreaterThan(0);
			expect(isSupportedCurrency(COUNTRY_CURRENCY[c])).toBe(true);
		}
		expect(COUNTRY_CURRENCY.MY).toBe("MYR");
		expect(COUNTRY_CURRENCY.SG).toBe("SGD");
	});
});
