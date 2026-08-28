import { describe, expect, it } from "vitest";
import { priceDelta } from "./price-delta";

describe("priceDelta", () => {
	it("reports a cut when the price is below catalog", () => {
		// RM 5.00 vs RM 11.70 catalog — the exact case seen live in dev.
		expect(priceDelta(500, 1170)).toEqual({ pct: 57, isCut: true });
	});

	it("reports a bump when the price is above catalog", () => {
		expect(priceDelta(1500, 1170)).toEqual({ pct: 28, isCut: false });
	});

	it("returns null when the price equals catalog", () => {
		expect(priceDelta(1170, 1170)).toBeNull();
	});

	it("returns null when the delta rounds to 0%", () => {
		// 1 sen off a RM 1000 catalog price rounds to 0% — no pill, the
		// strikethrough alone still marks the line as adjusted.
		expect(priceDelta(99999, 100000)).toBeNull();
	});

	it("rounds to the nearest whole percent", () => {
		// 1/3 off → 33.33...% cut, rounds to 33%.
		expect(priceDelta(200, 300)).toEqual({ pct: 33, isCut: true });
	});

	it("returns null for a non-positive catalog price", () => {
		expect(priceDelta(500, 0)).toBeNull();
	});

	it("reports a full 100% cut for a free adjustment", () => {
		expect(priceDelta(0, 1170)).toEqual({ pct: 100, isCut: true });
	});
});
