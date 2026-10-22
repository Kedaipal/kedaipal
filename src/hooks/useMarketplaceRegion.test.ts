import { describe, expect, it } from "vitest";
import { resolveMarketplaceRegion } from "./useMarketplaceRegion";

describe("resolveMarketplaceRegion — /stores' market, no switch", () => {
	it("the edge's geo answer wins over the device time zone", () => {
		// The border case the time zone gets wrong: an SG IP, a KL phone clock.
		expect(resolveMarketplaceRegion({ server: "SG", timeZone: "MY" })).toBe(
			"SG",
		);
		expect(resolveMarketplaceRegion({ server: "MY", timeZone: "SG" })).toBe(
			"MY",
		);
	});

	it("falls back to the time zone only where the edge had no answer", () => {
		expect(resolveMarketplaceRegion({ server: null, timeZone: "SG" })).toBe(
			"SG",
		);
	});

	it("defaults to MY when nothing speaks", () => {
		expect(resolveMarketplaceRegion({ server: null, timeZone: null })).toBe(
			"MY",
		);
	});
});
