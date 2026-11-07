import { describe, expect, it } from "vitest";
import {
	courierReturnedBuyerStatus,
	delyvaSupportUrl,
	PARCEL_NO_PHOTO_NOTE,
	parcelDeliveredCopy,
	returnedCopy,
} from "./parcel-courier-copy";

describe("parcel courier delivery copy (z8r3fdytmq)", () => {
	it("says delivery is a scan, not a photo, before the seller connects", () => {
		expect(PARCEL_NO_PHOTO_NOTE).toMatch(/tracking scan, not a photo/);
	});

	it("points at the Track parcel link only when the order has one", () => {
		expect(parcelDeliveredCopy(true)).toMatch(/Track parcel shows it\.$/);
		expect(parcelDeliveredCopy(false)).toMatch(
			/the courier's tracking page shows it\.$/,
		);
	});

	it("never claims the buyer was messaged — one WhatsApp per order", () => {
		for (const copy of [
			parcelDeliveredCopy(true),
			parcelDeliveredCopy(false),
		]) {
			expect(copy).not.toMatch(/notified|messaged|WhatsApp/i);
			expect(copy).toMatch(/order page shows it/);
		}
	});
});

describe("returned, and where Delyva's humans are (z8r3fe11y8)", () => {
	it("the returned explainer follows the order — Shipped before the mark, Packed after", () => {
		expect(returnedCopy("J&T Express", "Returned to you")).toBe(
			"J&T Express brought this parcel back instead of delivering it. The order still reads Shipped until you mark it returned.",
		);
		expect(returnedCopy("J&T Express", "Returned to you", true)).toMatch(
			/back at Packed — book a courier again below, or cancel it\.$/,
		);
		expect(returnedCopy("J&T Express", "Returned to you", true)).not.toMatch(
			/still reads Shipped/,
		);
		// A reason that adds something is kept; the pill's own words are not.
		expect(returnedCopy(undefined, "Failed to return")).toMatch(
			/^The courier brought this parcel back instead of delivering it \(Failed to return\)\./,
		);
	});

	it("the buyer's status word is true whether the order reads Shipped or Packed", () => {
		expect(courierReturnedBuyerStatus("IndoMart")).toBe("Returned to IndoMart");
	});

	it("the live-chat link lands on the account that holds the booking", () => {
		expect(delyvaSupportUrl(false)).toBe("https://my.delyva.app");
		expect(delyvaSupportUrl(true)).toBe("https://demo.delyva.app");
	});
});
