import { describe, expect, test } from "vitest";
import {
	ackableKeys,
	type CountrySetupInput,
	hasMoneyRisk,
	resolveCountrySetup,
} from "./countrySetup";

/** A clean SG store that switched from MY with nothing left to fix. */
function input(overrides: Partial<CountrySetupInput> = {}): CountrySetupInput {
	return {
		country: "SG",
		countryChangedAt: 1_700_000_000_000,
		acked: undefined,
		businessAddress: undefined,
		pickupLocations: [],
		deliveryConfigMode: undefined,
		deliveryBookingEnabled: false,
		waPhone: undefined,
		notifyWaPhone: undefined,
		hasPaymentMethods: false,
		hasHitpay: false,
		hasCustomCopy: false,
		...overrides,
	};
}

describe("resolveCountrySetup", () => {
	test("a store that never switched is never asked anything", () => {
		// The single most important case: this is every store. The query
		// short-circuits on the same condition before reading any other table.
		expect(
			resolveCountrySetup(
				input({ countryChangedAt: undefined, hasPaymentMethods: true }),
			),
		).toEqual([]);
	});

	test("a switched store with nothing carried over has an empty list", () => {
		expect(resolveCountrySetup(input())).toEqual([]);
	});

	test("money first, then what buyers see, then tidy-up", () => {
		// A seller reads the first row and maybe the second, so the order is the
		// feature — a wrong bank account must never sit under a phone-number
		// nit.
		const items = resolveCountrySetup(
			input({
				waPhone: "60123456789",
				businessAddress: { country: "MY" },
				hasPaymentMethods: true,
				deliveryBookingEnabled: true,
			}),
		);
		expect(items.map((i) => i.key)).toEqual([
			// delivery_booking is money-severity since z8r3fdch3r: wrong-market
			// keys fail at the point of SPEND, which outranks a cosmetic address.
			"payment_methods",
			"delivery_booking",
			"business_address",
			"wa_phone",
		]);
		expect(hasMoneyRisk(items)).toBe(true);
	});

	test("an UN-stamped address is treated as matching — fail open", () => {
		// Every address that exists today predates the stamp. Reading unknown as
		// "wrong" would accuse every Malaysian store of having a foreign
		// address the moment this shipped.
		expect(
			resolveCountrySetup(input({ businessAddress: {} })).map((i) => i.key),
		).toEqual([]);
	});

	test("a matching stamp raises nothing", () => {
		expect(
			resolveCountrySetup(input({ businessAddress: { country: "SG" } })),
		).toEqual([]);
	});

	test("pickup points are counted, and inactive ones don't count", () => {
		// An inactive point isn't offered at checkout, so no buyer can travel to
		// it — chasing the seller about it is noise.
		const items = resolveCountrySetup(
			input({
				pickupLocations: [
					{ country: "MY", isActive: true },
					{ country: "MY", isActive: true },
					{ country: "MY", isActive: false },
					{ country: "SG", isActive: true },
				],
			}),
		);
		const row = items.find((i) => i.key === "pickup_addresses");
		expect(row?.count).toBe(2);
	});

	test("a foreign pickup CONTACT is raised even on an inactive point", () => {
		// Unlike the address, this is about the seller's own records, not what a
		// buyer can act on — so it isn't scoped to active points.
		const items = resolveCountrySetup(
			input({
				pickupLocations: [
					{ country: "SG", managerWaPhone: "60123456789", isActive: false },
				],
			}),
		);
		expect(items.find((i) => i.key === "pickup_contacts")?.count).toBe(1);
	});

	test("an MY-only delivery mode is raised; a flat one is not", () => {
		expect(
			resolveCountrySetup(input({ deliveryConfigMode: "weight" })).map(
				(i) => i.key,
			),
		).toContain("delivery_mode");
		expect(
			resolveCountrySetup(input({ deliveryConfigMode: "flat" })).map(
				(i) => i.key,
			),
		).toEqual([]);
	});

	test("an MY store that switched BACK sees MY rules, not SG ones", () => {
		// The module reads the CURRENT country, so a round trip home clears
		// everything that only failed because the store was abroad — EXCEPT the
		// Lalamove-keys row (z8r3fdch3r): keys are per market and we can't see
		// which market a stored key belongs to, so any switch raises it and the
		// seller confirms. It is ackable for exactly that reason.
		const items = resolveCountrySetup(
			input({
				country: "MY",
				deliveryConfigMode: "weight",
				deliveryBookingEnabled: true,
				waPhone: "60123456789",
				businessAddress: { country: "MY" },
			}),
		);
		expect(items.map((i) => i.key)).toEqual(["delivery_booking"]);
		const acked = resolveCountrySetup(
			input({
				country: "MY",
				deliveryConfigMode: "weight",
				deliveryBookingEnabled: true,
				waPhone: "60123456789",
				businessAddress: { country: "MY" },
				acked: ["delivery_booking"],
			}),
		);
		expect(acked).toEqual([]);
	});
});

describe("acknowledgement can never hide a fact", () => {
	test("acking retires the unverifiable rows only", () => {
		const items = resolveCountrySetup(
			input({
				hasPaymentMethods: true,
				hasHitpay: true,
				hasCustomCopy: true,
				businessAddress: { country: "MY" },
				acked: ["payment_methods", "hitpay", "message_copy"],
			}),
		);
		expect(items.map((i) => i.key)).toEqual(["business_address"]);
	});

	test("acking a VERIFIABLE key does nothing — the fact outranks the tick", () => {
		// The integrity of the whole checklist. If a tick could clear a stamped
		// wrong-country address, the panel becomes something sellers learn to
		// dismiss, and the AWB keeps printing nothing with no explanation.
		const items = resolveCountrySetup(
			input({
				businessAddress: { country: "MY" },
				deliveryBookingEnabled: true,
				acked: ["business_address", "delivery_booking", "wa_phone"],
			}),
		);
		// delivery_booking became ackable with z8r3fdch3r (we can't verify a
		// key's market), so the tick retires it; the stamped address survives.
		expect(items.map((i) => i.key)).toEqual(["business_address"]);
	});

	test("ackableKeys never offers a verifiable key to the ack mutation", () => {
		const items = resolveCountrySetup(
			input({
				hasPaymentMethods: true,
				businessAddress: { country: "MY" },
				deliveryBookingEnabled: true,
			}),
		);
		// delivery_booking is ackable now (z8r3fdch3r) — key market is the
		// seller's knowledge, not ours; the stamped address stays off the list.
		expect(ackableKeys(items)).toEqual(["payment_methods", "delivery_booking"]);
	});

	test("money risk is gone once the money rows are confirmed", () => {
		const items = resolveCountrySetup(
			input({
				hasPaymentMethods: true,
				hasHitpay: true,
				waPhone: "60123456789",
				acked: ["payment_methods", "hitpay"],
			}),
		);
		expect(hasMoneyRisk(items)).toBe(false);
		expect(items.map((i) => i.key)).toEqual(["wa_phone"]);
	});
});
