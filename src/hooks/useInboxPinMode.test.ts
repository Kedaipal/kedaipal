import { describe, expect, test } from "vitest";
import { parseStoredPinMode, resolvePinMode } from "./useInboxPinMode";

describe("resolvePinMode — URL wins, then what the seller last chose", () => {
	test("a mode named in the URL always wins, even over a contrary preference", () => {
		// A shared or bookmarked link opens the way it was sent.
		expect(resolvePinMode("only", "off")).toBe("only");
		expect(resolvePinMode("off", "top")).toBe("off");
	});

	test("no mode in the URL resumes the remembered one — the reported bug", () => {
		// An Insights drill-in builds a fresh search object, so `pin` is absent.
		// Before this, absent meant the "top" default and a seller who had turned
		// pinning off got it switched back on every time they drilled in.
		expect(resolvePinMode(undefined, "off")).toBe("off");
		expect(resolvePinMode(undefined, "top")).toBe("top");
	});

	test("a seller who has never chosen gets the default", () => {
		expect(resolvePinMode(undefined, null)).toBe("top");
	});
});

describe("parseStoredPinMode — storage is untrusted input", () => {
	test("accepts only the two remembered modes", () => {
		expect(parseStoredPinMode("top")).toBe("top");
		expect(parseStoredPinMode("off")).toBe("off");
	});

	test('refuses "only" — it is a filter, never a preference', () => {
		// Narrowing to pinned orders must not survive into the next visit, or it
		// would silently hide the results of the seller's next drill-in.
		expect(parseStoredPinMode("only")).toBeNull();
	});

	test("refuses junk and absence", () => {
		expect(parseStoredPinMode(null)).toBeNull();
		expect(parseStoredPinMode("")).toBeNull();
		expect(parseStoredPinMode("TOP")).toBeNull();
		expect(parseStoredPinMode("{}")).toBeNull();
	});
});
