import { describe, expect, it } from "vitest";
import { centsToRm, rmToCents } from "./counter-price";

describe("rmToCents", () => {
	it("parses a ringgit amount to integer sen", () => {
		expect(rmToCents("25")).toBe(2500);
		expect(rmToCents("25.50")).toBe(2550);
		// Float noise must never leak into sen: 0.1 + 0.2 territory.
		expect(rmToCents("9.95")).toBe(995);
	});

	it("accepts RM0 — a free line is a real price at the counter", () => {
		expect(rmToCents("0")).toBe(0);
		expect(rmToCents("0.00")).toBe(0);
	});

	it("is NaN when blank — nothing typed is not RM0", () => {
		// `Number("")` is 0, so a blank field must be guarded explicitly or the
		// custom-line Add button would add a free line the seller never priced.
		expect(rmToCents("")).toBeNaN();
		expect(rmToCents("   ")).toBeNaN();
	});

	it("is NaN for a negative or non-numeric amount", () => {
		expect(rmToCents("-1")).toBeNaN();
		expect(rmToCents("abc")).toBeNaN();
		expect(rmToCents("Infinity")).toBeNaN();
	});
});

describe("centsToRm", () => {
	it("formats sen as a two-decimal ringgit string for the input", () => {
		expect(centsToRm(2500)).toBe("25.00");
		expect(centsToRm(0)).toBe("0.00");
		expect(centsToRm(995)).toBe("9.95");
	});
});
