import { describe, expect, it } from "vitest";
import { parseBuyerWaPhone } from "../../convex/lib/buyerPhone";
import { buyerPhoneRejection } from "./buyer-phone-rejection";

/**
 * The one "when does a buyer phone field complain" rule shared by the booking
 * checkout, the track page's number repair and the counter's manual bind
 * (z8r3fdh274).
 */
describe("buyerPhoneRejection", () => {
	const judge = (typed: string, touched: boolean) =>
		buyerPhoneRejection(parseBuyerWaPhone(typed, "MY"), typed, touched);

	it("stays quiet on a valid number", () => {
		expect(judge("12-345 6789", true)).toBeNull();
	});

	it("stays quiet on an empty field, even after a blur — the submit hint says 'enter'", () => {
		expect(judge("", true)).toBeNull();
		expect(judge("  ", true)).toBeNull();
	});

	it("stays quiet while the number is still being typed", () => {
		expect(judge("123", false)).toBeNull();
	});

	it("says why once the field has been left", () => {
		expect(judge("123", true)).toEqual({
			message:
				"Enter a Malaysian mobile number (e.g. 012-345 6789), or tap +60 to change the country",
		});
	});

	it("a foreign pick's reason names the country and where to change it", () => {
		const typed = "123";
		expect(
			buyerPhoneRejection(parseBuyerWaPhone(typed, "JP"), typed, true),
		).toEqual({
			message:
				"Enter a valid Japan mobile number, or tap +81 to change the country",
		});
	});

	it("surfaces the other country's one-tap fix at once — nothing to wait for", () => {
		expect(judge("9123 4567", false)).toEqual({
			message:
				"That looks like a Singapore mobile number — switch the country to +65",
			suggest: "SG",
		});
	});

	it("judges by the picked country, not the store's", () => {
		const typed = "90-1234-5678";
		expect(
			buyerPhoneRejection(parseBuyerWaPhone(typed, "JP"), typed, true),
		).toBeNull();
		expect(
			buyerPhoneRejection(parseBuyerWaPhone(typed, "MY"), typed, true),
		).not.toBeNull();
	});
});
