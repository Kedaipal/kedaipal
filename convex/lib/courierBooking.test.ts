/// <reference types="vite/client" />
import { afterEach, describe, expect, test } from "vitest";
import {
	delyvaBookingArmed,
	easyparcelBookingArmed,
	lalamoveBookingArmed,
	storeBooksCouriers,
	servesOrderDestination,
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
	// The summary `loadEasyparcelArming` hands in — the grant itself lives in
	// its own table, never on the retailer row.
	const EASYPARCEL_CONNECTED = { connected: true, enabled: true };

	test("connected and switched on, in either country", () => {
		expect(
			easyparcelBookingArmed({ country: "SG", easyparcel: EASYPARCEL_CONNECTED }),
		).toBe(true);
		// MY opened for the cross-border lane (z8r3fdr5yy). WHICH orders it may
		// book is the destination rule's job (`servesOrderDestination` below) —
		// armed only says the account is usable.
		expect(
			easyparcelBookingArmed({ country: "MY", easyparcel: EASYPARCEL_CONNECTED }),
		).toBe(true);
		expect(easyparcelBookingArmed({ easyparcel: EASYPARCEL_CONNECTED })).toBe(
			true,
		);
	});

	test("which orders each provider carries is judged by the address's country", () => {
		const domestic = { deliveryAddress: { country: "MY" as const } };
		const toSg = { deliveryAddress: { country: "SG" as const } };
		const legacy = { deliveryAddress: {} };
		const my = { country: "MY" as const };
		const sg = { country: "SG" as const };
		// A MY store's EasyParcel carries overseas orders only — Delyva stays
		// the domestic courier (cold chain + the commission).
		expect(servesOrderDestination("easyparcel", toSg, my)).toBe(true);
		expect(servesOrderDestination("easyparcel", domestic, my)).toBe(false);
		expect(servesOrderDestination("easyparcel", legacy, my)).toBe(false);
		// An SG store's EasyParcel is its whole parcel lane.
		expect(servesOrderDestination("easyparcel", { deliveryAddress: { country: "SG" as const } }, sg)).toBe(true);
		expect(servesOrderDestination("easyparcel", domestic, sg)).toBe(true);
		// Riders and Delyva never cross the border.
		expect(servesOrderDestination("lalamove", toSg, my)).toBe(false);
		expect(servesOrderDestination("delyva", toSg, my)).toBe(false);
		expect(servesOrderDestination("delyva", domestic, my)).toBe(true);
		// An order from before the stamp is domestic.
		expect(servesOrderDestination("lalamove", legacy, my)).toBe(true);
	});

	test("a dead grant, a paused switch, or an unloaded summary is not armed", () => {
		expect(
			easyparcelBookingArmed({
				country: "SG",
				easyparcel: { connected: false, enabled: true },
			}),
		).toBe(false);
		expect(
			easyparcelBookingArmed({
				country: "SG",
				easyparcel: { connected: true, enabled: false },
			}),
		).toBe(false);
		// Not loaded = not armed: the caller forgot to pass it, and failing
		// closed is the safe direction.
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
				easyparcel: { connected: true, enabled: true },
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
