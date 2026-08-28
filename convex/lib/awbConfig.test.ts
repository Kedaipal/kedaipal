import { describe, expect, test } from "vitest";
import {
	AWB_DEFAULTS,
	AWB_FOOTER_MAX,
	resolveAwbConfig,
	sanitizeAwbConfig,
	type StoredAwbConfig,
} from "./awbConfig";

describe("resolveAwbConfig", () => {
	test("an unset config is every default", () => {
		expect(resolveAwbConfig(undefined)).toEqual(AWB_DEFAULTS);
	});

	test("A4 4-up is the default paper — every seller owns an A4 printer", () => {
		expect(AWB_DEFAULTS.paperSize).toBe("a4-4up");
	});

	test("contents are OFF by default (a packing list rides on the outside)", () => {
		expect(AWB_DEFAULTS.showItems).toBe(false);
	});

	test("a stored `false` beats the `true` default", () => {
		expect(resolveAwbConfig({ showCod: false }).showCod).toBe(false);
		// Untouched fields still fall back.
		expect(resolveAwbConfig({ showCod: false }).showWeight).toBe(true);
	});
});

describe("sanitizeAwbConfig", () => {
	test("null resets to the defaults (stored as unset)", () => {
		expect(sanitizeAwbConfig(null)).toBeUndefined();
	});

	test("an all-default object normalises back to unset — one spelling", () => {
		expect(sanitizeAwbConfig({ ...AWB_DEFAULTS })).toBeUndefined();
		expect(sanitizeAwbConfig({})).toBeUndefined();
	});

	test("stores only the fields that differ from the defaults", () => {
		expect(sanitizeAwbConfig({ ...AWB_DEFAULTS, showItems: true })).toEqual({
			showItems: true,
		});
		expect(sanitizeAwbConfig({ ...AWB_DEFAULTS, paperSize: "a6" })).toEqual({
			paperSize: "a6",
		});
	});

	test("round-trips: sanitize → resolve gives back what was asked for", () => {
		const wanted = {
			paperSize: "a6",
			showLogo: false,
			showItems: true,
			showCod: false,
			showWeight: false,
			showNote: false,
			footerText: "Returns: 012-345 6789",
		} satisfies StoredAwbConfig;
		expect(resolveAwbConfig(sanitizeAwbConfig(wanted))).toEqual(wanted);
	});

	test("is stable — sanitizing its own output changes nothing", () => {
		const once = sanitizeAwbConfig({ ...AWB_DEFAULTS, showItems: true });
		expect(sanitizeAwbConfig(once ?? null)).toEqual(once);
	});

	test("collapses footer whitespace and drops an empty one", () => {
		expect(
			sanitizeAwbConfig({ footerText: "  Thank   you!  " })?.footerText,
		).toBe("Thank you!");
		expect(sanitizeAwbConfig({ footerText: "   " })).toBeUndefined();
	});

	test("rejects a footer past the cap rather than silently truncating", () => {
		expect(() =>
			sanitizeAwbConfig({ footerText: "x".repeat(AWB_FOOTER_MAX + 1) }),
		).toThrow(/characters or fewer/i);
		expect(
			sanitizeAwbConfig({ footerText: "x".repeat(AWB_FOOTER_MAX) })?.footerText,
		).toHaveLength(AWB_FOOTER_MAX);
	});

	test("rejects an unknown paper size", () => {
		expect(() =>
			sanitizeAwbConfig({ paperSize: "a3" as never }),
		).toThrow(/supported label size/i);
	});
});
