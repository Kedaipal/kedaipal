// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearVoucherParam, readVoucherParam } from "./useVoucherParam";

/**
 * The hold that makes a `?voucher=` link work (`z8r3fdr617`).
 *
 * The link is sent on WhatsApp to a buyer with an EMPTY cart: they tap it,
 * land on "Your cart is empty · Browse the store", and in-store navigation
 * carries no params. Without the hold, the code the seller just gave them is
 * gone by the time they have something to buy — and nothing on screen says so.
 *
 * The capture hook itself needs a mounted component; these cover the storage
 * contract the hook and the checkout agree on.
 */

beforeEach(() => {
	sessionStorage.clear();
});

describe("the held code", () => {
	it("is nothing until something is held", () => {
		expect(readVoucherParam("sue-chef")).toBeUndefined();
	});

	it("is keyed per store — two shops in one browser can't cross-apply", () => {
		sessionStorage.setItem("kedaipal:voucher:sue-chef", "KP-7F3K-Q2WM");
		expect(readVoucherParam("sue-chef")).toBe("KP-7F3K-Q2WM");
		expect(readVoucherParam("other-shop")).toBeUndefined();
	});

	it("is forgotten once spent, so the next checkout doesn't re-apply it", () => {
		// A redeemed code re-applied in the same tab would be refused with no
		// visible reason — the buyer never typed it.
		sessionStorage.setItem("kedaipal:voucher:sue-chef", "KP-7F3K-Q2WM");
		clearVoucherParam("sue-chef");
		expect(readVoucherParam("sue-chef")).toBeUndefined();
	});

	it("never throws when storage is unavailable", () => {
		// Private modes throw on access; browsing and checkout must not break.
		const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
		Object.defineProperty(window, "sessionStorage", {
			configurable: true,
			get() {
				throw new Error("denied");
			},
		});
		expect(() => readVoucherParam("sue-chef")).not.toThrow();
		expect(readVoucherParam("sue-chef")).toBeUndefined();
		expect(() => clearVoucherParam("sue-chef")).not.toThrow();
		if (original) Object.defineProperty(window, "sessionStorage", original);
	});
});
