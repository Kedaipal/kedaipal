import { describe, expect, it } from "vitest";
import { BOOKING_RECEIVED_LABEL as SERVER_LABEL } from "../../convex/lib/orderStatus";
import { BOOKING_RECEIVED_LABEL } from "./orderStatus";
import { trackFirstBeatLabel } from "./track-first-beat";

const base = {
	isBooking: true,
	locale: "en" as const,
	requestedLabel: "Awaiting Approval",
	pendingLabel: "Order Received",
};

describe("trackFirstBeatLabel — the timeline's first word is what happened", () => {
	it("a booking still waiting reads its request label", () => {
		expect(trackFirstBeatLabel({ ...base, status: "booking_requested" })).toBe(
			"Awaiting Approval",
		);
	});

	it("an instant-booked (or approved) booking never claims it waited", () => {
		expect(trackFirstBeatLabel({ ...base, status: "confirmed" })).toBe(
			"Booking Received",
		);
		expect(
			trackFirstBeatLabel({ ...base, status: "confirmed", locale: "ms" }),
		).toBe("Tempahan Diterima");
	});

	it("a declined or expired request keeps the request as its story", () => {
		expect(
			trackFirstBeatLabel({
				...base,
				status: "cancelled",
				bookingResolution: "declined",
			}),
		).toBe("Awaiting Approval");
	});

	it("an ordinary order reads Order Received", () => {
		expect(
			trackFirstBeatLabel({ ...base, isBooking: false, status: "confirmed" }),
		).toBe("Order Received");
	});

	it("an approval-gated RSVP waiting reads the request label too", () => {
		expect(
			trackFirstBeatLabel({
				...base,
				isBooking: false,
				status: "booking_requested",
			}),
		).toBe("Awaiting Approval");
	});
});

it("the mirrored label tables can't drift (src/lib ↔ convex/lib orderStatus)", () => {
	expect(BOOKING_RECEIVED_LABEL).toEqual(SERVER_LABEL);
});
