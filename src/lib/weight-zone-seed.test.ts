import { describe, expect, it } from "vitest";
import { MY_STATES } from "../../convex/lib/address";
import {
	DELIVERY_BANDS_MAX,
	DELIVERY_ZONES_MAX,
	sanitizeDeliveryConfig,
} from "../../convex/lib/delivery";
import { jntSeedZones } from "./weight-zone-seed";

describe("jntSeedZones", () => {
	it("partitions all 16 states across the two zones with no overlap", () => {
		const zones = jntSeedZones();
		const assigned = zones.flatMap((z) => z.states);
		expect(new Set(assigned).size).toBe(assigned.length);
		expect([...assigned].sort()).toEqual([...MY_STATES].sort());
	});

	it("keeps bands ascending with ascending fees in every zone", () => {
		for (const zone of jntSeedZones()) {
			for (let i = 1; i < zone.bands.length; i++) {
				expect(zone.bands[i].maxKg).toBeGreaterThan(zone.bands[i - 1].maxKg);
				expect(zone.bands[i].fee).toBeGreaterThan(zone.bands[i - 1].fee);
			}
		}
	});

	it("survives the server sanitizer unchanged (the template must save as-is)", () => {
		const zones = jntSeedZones();
		expect(zones.length).toBeLessThanOrEqual(DELIVERY_ZONES_MAX);
		for (const zone of zones) {
			expect(zone.bands.length).toBeLessThanOrEqual(DELIVERY_BANDS_MAX);
		}
		const clean = sanitizeDeliveryConfig({
			mode: "weight",
			zones,
			onOutOfBands: "arrange",
			onUnpriceable: "arrange",
		});
		expect(clean).toEqual({
			mode: "weight",
			zones: zones.map((z) => ({ ...z, freeAbove: undefined })),
			onOutOfBands: "arrange",
			onUnpriceable: "arrange",
		});
	});
});
