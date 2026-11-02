import { describe, expect, it } from "vitest";
import {
	PARCEL_NO_PHOTO_NOTE,
	parcelDeliveredCopy,
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
