// The registry's whole point is that its pieces cannot drift apart. The type
// pins catch drift at compile time; these tests catch the runtime versions
// (a cast smuggled past the Record shape, a validator edited without the id
// list) — delete a registry arm and something here goes red.

import { describe, expect, it } from "vitest";
import { COUNTRIES } from "./country";
import {
	COUNTRY_COURIER_BOOKING,
	COURIER_PROVIDER_IDS,
	courierBookingAllowed,
	courierProviderValidator,
} from "./courierProviders";
import { delyvaBookingAllowed, riderBookingAllowed } from "./delivery";

describe("courier provider registry", () => {
	it("the schema validator accepts exactly the registered provider ids", () => {
		const literals = courierProviderValidator.members.map(
			(m) => (m as { value: string }).value,
		);
		expect([...literals].sort()).toEqual([...COURIER_PROVIDER_IDS].sort());
	});

	it("every provider decides booking for every country — no implicit default", () => {
		for (const id of COURIER_PROVIDER_IDS) {
			const row = COUNTRY_COURIER_BOOKING[id];
			expect(Object.keys(row).sort()).toEqual([...COUNTRIES].sort());
		}
	});

	it("the legacy per-provider wrappers read the registry, not a copy", () => {
		for (const country of COUNTRIES) {
			expect(riderBookingAllowed(country)).toBe(
				courierBookingAllowed("lalamove", country),
			);
			expect(delyvaBookingAllowed(country)).toBe(
				courierBookingAllowed("delyva", country),
			);
		}
	});
});
