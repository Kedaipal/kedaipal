/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	assertValidMyMobile,
	assertValidMyWaPhone,
	assertValidWaPhone,
} from "./slug";

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

describe("assertValidMyMobile", () => {
	test("normalizes the same shapes as assertValidMyWaPhone", () => {
		expect(assertValidMyMobile("012-345 6789")).toBe("60123456789");
		expect(assertValidMyMobile("60123456789")).toBe("60123456789");
		expect(assertValidMyMobile("+60 12-345 6789")).toBe("60123456789");
	});

	// Checkout renders a "+60" badge on the field (86eyfq04j), so "type the
	// rest" is exactly what it asks for. Before this, a buyer who obeyed the
	// badge was rejected — the number fell through both normalizer arms.
	test("accepts a bare national number typed after the +60 badge", () => {
		expect(assertValidMyMobile("123456789")).toBe("60123456789");
		expect(assertValidMyMobile("1234567890")).toBe("601234567890");
		expect(assertValidMyMobile("12-345 6789")).toBe("60123456789");
	});

	test("does not swallow a foreign number that merely starts with 1", () => {
		// A US "+1 415 555 0123" is 11 digits — outside the 9–10-digit MY mobile
		// NSN window, so it is never rewritten to a Malaysian number. It fails the
		// MY-mobile check instead, which is the honest answer on a MY-only path.
		expect(() => assertValidMyMobile("14155550123")).toThrow(
			/malaysian mobile/i,
		);
	});

	test("still rejects a landline, which can never receive WhatsApp", () => {
		expect(() => assertValidMyMobile("03-1234 5678")).toThrow(
			/malaysian mobile/i,
		);
	});
});
