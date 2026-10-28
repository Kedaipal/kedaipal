import { describe, expect, it } from "vitest";
import { easyparcelCardShown, integrationsGlance } from "./integrations-glance";

describe("integrationsGlance — the Integrations row's N of M", () => {
	const none = {
		lalamoveConnected: false,
		hitpayConnected: false,
		delyva: undefined,
		easyparcel: undefined,
	};

	it("an SG store counts EasyParcel, not Delyva (z8r3fdcje2 F1)", () => {
		expect(
			integrationsGlance({
				...none,
				delyva: { countryAllowed: false, connected: false },
				easyparcel: { available: true, connected: true },
			}),
		).toEqual({ connected: 1, total: 3 });
	});

	it("a MY store counts Delyva, not EasyParcel", () => {
		expect(
			integrationsGlance({
				...none,
				lalamoveConnected: true,
				delyva: { countryAllowed: true, connected: true },
				easyparcel: { available: false, connected: false },
			}),
		).toEqual({ connected: 2, total: 3 });
	});

	it("a connected EasyParcel in a country it doesn't serve still counts — its card still shows", () => {
		expect(
			integrationsGlance({
				...none,
				easyparcel: { available: false, connected: true },
			}),
		).toEqual({ connected: 1, total: 3 });
	});

	it("courier settings still loading count as absent, never as zero-of-more", () => {
		expect(integrationsGlance({ ...none, hitpayConnected: true })).toEqual({
			connected: 1,
			total: 2,
		});
	});
});

describe("easyparcelCardShown — the card and the count share it", () => {
	it("shows where offered, or wherever something is connected", () => {
		expect(easyparcelCardShown({ available: true, connected: false })).toBe(
			true,
		);
		expect(easyparcelCardShown({ available: false, connected: true })).toBe(
			true,
		);
		expect(easyparcelCardShown({ available: false, connected: false })).toBe(
			false,
		);
		expect(easyparcelCardShown(undefined)).toBe(false);
	});
});
