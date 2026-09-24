/// <reference types="vite/client" />
import { afterEach, describe, expect, test } from "vitest";
import {
	delyvaBookingArmed,
	lalamoveBookingArmed,
	storeBooksCouriers,
} from "./courierBooking";
import { COUNTRY_DELYVA_BOOKING, COUNTRY_RIDER_BOOKING } from "./delivery";

// Both market tables allow MY and SG today, so the country gate is proven by
// closing one for the duration of a test — the predicates must read it, not
// assume it.
const RIDER_GATE = { ...COUNTRY_RIDER_BOOKING };
const DELYVA_GATE = { ...COUNTRY_DELYVA_BOOKING };
afterEach(() => {
	Object.assign(COUNTRY_RIDER_BOOKING, RIDER_GATE);
	Object.assign(COUNTRY_DELYVA_BOOKING, DELYVA_GATE);
});

const LALAMOVE_ON = { enabled: true };
const DELYVA_CONNECTED = {
	enabled: true,
	apiKey: "enc:v1:ciphertext",
	customerId: 4321,
};

describe("lalamoveBookingArmed", () => {
	test("booking switched on in an allowed country", () => {
		expect(lalamoveBookingArmed({ deliveryBooking: LALAMOVE_ON })).toBe(true);
		expect(
			lalamoveBookingArmed({ country: "SG", deliveryBooking: LALAMOVE_ON }),
		).toBe(true);
	});

	test("switched off, or never configured, is not armed", () => {
		expect(lalamoveBookingArmed({ deliveryBooking: { enabled: false } })).toBe(
			false,
		);
		expect(lalamoveBookingArmed({})).toBe(false);
	});

	test("a country the rider market is closed in is not armed", () => {
		COUNTRY_RIDER_BOOKING.SG = false;
		expect(
			lalamoveBookingArmed({ country: "SG", deliveryBooking: LALAMOVE_ON }),
		).toBe(false);
		expect(
			lalamoveBookingArmed({ country: "MY", deliveryBooking: LALAMOVE_ON }),
		).toBe(true);
	});

	test("a store with no stored country is judged as the default (MY)", () => {
		COUNTRY_RIDER_BOOKING.MY = false;
		expect(lalamoveBookingArmed({ deliveryBooking: LALAMOVE_ON })).toBe(false);
	});
});

describe("delyvaBookingArmed", () => {
	test("connected (key + customer id) and switched on in an allowed country", () => {
		expect(delyvaBookingArmed({ delyva: DELYVA_CONNECTED })).toBe(true);
		expect(
			delyvaBookingArmed({ country: "SG", delyva: DELYVA_CONNECTED }),
		).toBe(true);
	});

	test("switched on is not enough — it needs the credentials", () => {
		expect(
			delyvaBookingArmed({ delyva: { ...DELYVA_CONNECTED, apiKey: undefined } }),
		).toBe(false);
		expect(
			delyvaBookingArmed({ delyva: { ...DELYVA_CONNECTED, apiKey: "   " } }),
		).toBe(false);
		expect(
			delyvaBookingArmed({
				delyva: { ...DELYVA_CONNECTED, customerId: undefined },
			}),
		).toBe(false);
	});

	test("connected but switched off is not armed", () => {
		expect(
			delyvaBookingArmed({ delyva: { ...DELYVA_CONNECTED, enabled: false } }),
		).toBe(false);
		expect(delyvaBookingArmed({})).toBe(false);
	});

	test("a country Delyva is closed in is not armed; no country reads as MY", () => {
		COUNTRY_DELYVA_BOOKING.SG = false;
		expect(
			delyvaBookingArmed({ country: "SG", delyva: DELYVA_CONNECTED }),
		).toBe(false);
		COUNTRY_DELYVA_BOOKING.MY = false;
		expect(delyvaBookingArmed({ delyva: DELYVA_CONNECTED })).toBe(false);
	});
});

describe("storeBooksCouriers — either provider armed", () => {
	test("neither armed", () => {
		expect(storeBooksCouriers({})).toBe(false);
		expect(
			storeBooksCouriers({
				deliveryBooking: { enabled: false },
				delyva: { ...DELYVA_CONNECTED, enabled: false },
			}),
		).toBe(false);
	});

	test("Lalamove alone, Delyva alone, or both", () => {
		expect(storeBooksCouriers({ deliveryBooking: LALAMOVE_ON })).toBe(true);
		expect(storeBooksCouriers({ delyva: DELYVA_CONNECTED })).toBe(true);
		expect(
			storeBooksCouriers({
				deliveryBooking: LALAMOVE_ON,
				delyva: DELYVA_CONNECTED,
			}),
		).toBe(true);
	});
});
