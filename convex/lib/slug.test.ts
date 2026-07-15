/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { assertValidMyWaPhone, assertValidWaPhone } from "./slug";

describe("assertValidMyWaPhone", () => {
	test("converts a local 0-prefixed number to E.164 (drops trunk 0, adds 60)", () => {
		expect(assertValidMyWaPhone("0123456789")).toBe("60123456789");
	});

	test("strips separators a cashier types before normalizing", () => {
		expect(assertValidMyWaPhone("012-345 6789")).toBe("60123456789");
	});

	test("keeps an already-international 60 number unchanged", () => {
		expect(assertValidMyWaPhone("60123456789")).toBe("60123456789");
	});

	test("accepts a +60 number and strips the plus", () => {
		expect(assertValidMyWaPhone("+60 12-345 6789")).toBe("60123456789");
	});

	test("normalizes to the SAME digits an inbound scan produces (keying parity)", () => {
		// The scan path stores what Meta delivers (assertValidWaPhone on "60…"); a
		// cashier typing the local form must land on the identical customer key.
		expect(assertValidMyWaPhone("0123456789")).toBe(
			assertValidWaPhone("60123456789"),
		);
	});

	test("rejects a number that's too short to be valid", () => {
		expect(() => assertValidMyWaPhone("12345")).toThrow();
	});

	test("rejects non-numeric junk", () => {
		expect(() => assertValidMyWaPhone("not a phone")).toThrow();
	});
});
