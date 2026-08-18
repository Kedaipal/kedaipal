import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SUPPORT_WA_NUMBER, resolveSupportWaNumber } from "./contact";

describe("resolveSupportWaNumber", () => {
	it("falls back to the built-in number when unset or blank", () => {
		expect(resolveSupportWaNumber(undefined)).toBe(DEFAULT_SUPPORT_WA_NUMBER);
		expect(resolveSupportWaNumber("")).toBe(DEFAULT_SUPPORT_WA_NUMBER);
		expect(resolveSupportWaNumber("   ")).toBe(DEFAULT_SUPPORT_WA_NUMBER);
	});

	it("normalizes however an operator types the number", () => {
		// wa.me takes digits only, so every accepted spelling lands on one form.
		for (const raw of [
			"60184735095",
			"+60184735095",
			"+60 18-473 5095",
			"018-473 5095",
			"0184735095",
			" 60184735095 ",
		]) {
			expect(resolveSupportWaNumber(raw)).toBe("60184735095");
		}
	});

	it("keeps a changed number, so ops can repoint support without a deploy", () => {
		expect(resolveSupportWaNumber("012-345 6789")).toBe("60123456789");
	});

	it("falls back and warns on a value that isn't a MY mobile", () => {
		// A typo must degrade to a working link, never a dead one: this CTA is
		// often the seller's only route to us.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		for (const bad of ["not a number", "03-1234 5678", "12345", "+1 415 555"]) {
			expect(resolveSupportWaNumber(bad)).toBe(DEFAULT_SUPPORT_WA_NUMBER);
		}
		expect(warn).toHaveBeenCalledTimes(4);
		warn.mockRestore();
	});
});
