/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { toDisplayE164 } from "./phone";

describe("toDisplayE164", () => {
	test("prefixes a `+` onto a stored digits-only MY number", () => {
		expect(toDisplayE164("60123456789")).toBe("+60123456789");
	});

	test("passes through a value that already has a `+`", () => {
		expect(toDisplayE164("+60123456789")).toBe("+60123456789");
	});

	test("strips formatting before prefixing", () => {
		expect(toDisplayE164("60 12-345 6789")).toBe("+60123456789");
	});

	test("returns undefined for empty / whitespace / undefined input", () => {
		expect(toDisplayE164("")).toBeUndefined();
		expect(toDisplayE164("   ")).toBeUndefined();
		expect(toDisplayE164(undefined)).toBeUndefined();
	});

	test("returns undefined when there are no digits", () => {
		expect(toDisplayE164("+")).toBeUndefined();
	});
});
