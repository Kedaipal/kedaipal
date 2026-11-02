import { describe, expect, it } from "vitest";
import {
	courierBookingGlance,
	easyparcelBookingOn,
} from "./courier-booking-section";

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

describe("EasyParcel in the glance (z8r3fdcje2)", () => {
	const base = {
		riderBookingAvailable: true,
		lalamoveArmed: true,
		lalamovePricing: false,
		delyvaArmed: false,
	};

	it("is listed after the riders when armed", () => {
		expect(courierBookingGlance({ ...base, easyparcelArmed: true })).toBe(
			"Lalamove riders · EasyParcel",
		);
	});

	const on = {
		available: true,
		connected: true,
		enabled: true,
		needsReconnect: false,
	};

	it("counts as armed only when every condition the order page needs holds", () => {
		expect(easyparcelBookingOn(on)).toBe(true);
		expect(easyparcelBookingOn(undefined)).toBe(false);
		expect(easyparcelBookingOn({ ...on, enabled: false })).toBe(false);
		expect(easyparcelBookingOn({ ...on, connected: false })).toBe(false);
		// Signed out at EasyParcel's end: the switch is still on, booking isn't.
		expect(easyparcelBookingOn({ ...on, needsReconnect: true })).toBe(false);
		// Connected in a country it doesn't serve (store switched country).
		expect(easyparcelBookingOn({ ...on, available: false })).toBe(false);
	});
});
