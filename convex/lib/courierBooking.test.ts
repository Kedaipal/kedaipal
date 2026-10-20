/// <reference types="vite/client" />
import { afterEach, describe, expect, test } from "vitest";
import {
	delyvaBookingArmed,
	easyparcelBookingArmed,
	lalamoveBookingArmed,
	storeBooksCouriers,
} from "./courierBooking";
import { COUNTRY_COURIER_BOOKING } from "./courierProviders";

// Both registry rows allow MY and SG today, so the country gate is proven by
// closing one for the duration of a test — the predicates must read it, not
// assume it.
const RIDER_GATE = { ...COUNTRY_COURIER_BOOKING.lalamove };
const DELYVA_GATE = { ...COUNTRY_COURIER_BOOKING.delyva };
afterEach(() => {
	Object.assign(COUNTRY_COURIER_BOOKING.lalamove, RIDER_GATE);
	Object.assign(COUNTRY_COURIER_BOOKING.delyva, DELYVA_GATE);
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
		COUNTRY_COURIER_BOOKING.lalamove.SG = false;
		expect(
			lalamoveBookingArmed({ country: "SG", deliveryBooking: LALAMOVE_ON }),
		).toBe(false);
		expect(
			lalamoveBookingArmed({ country: "MY", deliveryBooking: LALAMOVE_ON }),
		).toBe(true);
	});

	test("a store with no stored country is judged as the default (MY)", () => {
		COUNTRY_COURIER_BOOKING.lalamove.MY = false;
		expect(lalamoveBookingArmed({ deliveryBooking: LALAMOVE_ON })).toBe(false);
	});
});

describe("delyvaBookingArmed", () => {
	test("connected (key + customer id) and switched on in an allowed country", () => {
		expect(delyvaBookingArmed({ delyva: DELYVA_CONNECTED })).toBe(true);
		// SG reads FALSE from the registry since EasyParcel became the SG
		// parcel lane (z8r3fdcje2 PR2) — the Delyva SG tenant ships an empty
		// service catalogue, so the surface is retired there.
		expect(
			delyvaBookingArmed({ country: "SG", delyva: DELYVA_CONNECTED }),
		).toBe(false);
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

	test("the country gate is read live, not baked in; no country reads as MY", () => {
		// Re-opening SG in the registry re-arms an SG store — proof the
		// predicate reads the table rather than a snapshot.
		COUNTRY_COURIER_BOOKING.delyva.SG = true;
		expect(
			delyvaBookingArmed({ country: "SG", delyva: DELYVA_CONNECTED }),
		).toBe(true);
		COUNTRY_COURIER_BOOKING.delyva.MY = false;
		expect(delyvaBookingArmed({ delyva: DELYVA_CONNECTED })).toBe(false);
	});
});

describe("easyparcelBookingArmed", () => {
	const EASYPARCEL_CONNECTED = { enabled: true, apiKey: "enc.v1.ciphertext" };

	test("connected and switched on, in SG only (MY is registry-closed)", () => {
		expect(
			easyparcelBookingArmed({ country: "SG", easyparcel: EASYPARCEL_CONNECTED }),
		).toBe(true);
		// MY is deliberately closed (frozen-prohibition finding, 29 Jul 2026);
		// an MY store with a pasted key stays un-armed until the cross-border
		// lane flips the registry.
		expect(
			easyparcelBookingArmed({ country: "MY", easyparcel: EASYPARCEL_CONNECTED }),
		).toBe(false);
		expect(easyparcelBookingArmed({ easyparcel: EASYPARCEL_CONNECTED })).toBe(
			false,
		);
	});

	test("switched on is not enough — it needs the key; off is off", () => {
		expect(
			easyparcelBookingArmed({
				country: "SG",
				easyparcel: { enabled: true, apiKey: "   " },
			}),
		).toBe(false);
		expect(
			easyparcelBookingArmed({
				country: "SG",
				easyparcel: { ...EASYPARCEL_CONNECTED, enabled: false },
			}),
		).toBe(false);
		expect(easyparcelBookingArmed({ country: "SG" })).toBe(false);
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

	test("any single provider armed is enough", () => {
		expect(storeBooksCouriers({ deliveryBooking: LALAMOVE_ON })).toBe(true);
		expect(storeBooksCouriers({ delyva: DELYVA_CONNECTED })).toBe(true);
		expect(
			storeBooksCouriers({
				country: "SG",
				easyparcel: { enabled: true, apiKey: "enc.v1.ciphertext" },
			}),
		).toBe(true);
		expect(
			storeBooksCouriers({
				deliveryBooking: LALAMOVE_ON,
				delyva: DELYVA_CONNECTED,
			}),
		).toBe(true);
	});
});
