import { describe, expect, it } from "vitest";
import { courierBookingGlance } from "./courier-booking-section";

describe("courierBookingGlance — the Fulfilment row's summary", () => {
	const base = {
		riderBookingAvailable: true,
		lalamoveArmed: false,
		lalamovePricing: false,
		delyvaArmed: false,
	};

	it("lists what's armed, in the section's order", () => {
		expect(
			courierBookingGlance({ ...base, lalamoveArmed: true, delyvaArmed: true }),
		).toBe("Lalamove riders · Delyva");
		expect(courierBookingGlance({ ...base, delyvaArmed: true })).toBe("Delyva");
	});

	it("live Lalamove pricing arms riders by itself", () => {
		expect(courierBookingGlance({ ...base, lalamovePricing: true })).toBe(
			"Lalamove riders",
		);
	});

	it("a country without riders never claims them", () => {
		expect(
			courierBookingGlance({
				...base,
				riderBookingAvailable: false,
				lalamoveArmed: true,
			}),
		).toBe("Off");
	});

	it("nothing armed reads Off", () => {
		expect(courierBookingGlance(base)).toBe("Off");
	});
});
