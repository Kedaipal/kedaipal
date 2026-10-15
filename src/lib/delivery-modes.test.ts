import { describe, expect, it } from "vitest";
import {
	BUILTIN_PRICING_MODES,
	PRICING_MODE_UI,
	pricingModeOf,
	pricingSummary,
} from "./delivery-modes";

const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

describe("delivery pricing modes", () => {
	it("reads no config as Free and the legacy lalamove mode as Live courier price", () => {
		expect(pricingModeOf(undefined)).toBe("free");
		expect(
			pricingModeOf({ mode: "lalamove", onUnquotable: "block" } as never),
		).toBe("live");
	});

	it("summarises each mode in one line with its key number", () => {
		expect(pricingSummary(undefined, rm)).toBe("Free");
		expect(pricingSummary({ mode: "flat", fee: 800 } as never, rm)).toBe(
			"Flat fee · RM 8.00",
		);
		expect(
			pricingSummary(
				{
					mode: "weight",
					zones: [{}, {}],
					onOutOfBands: "arrange",
					onUnpriceable: "arrange",
				} as never,
				rm,
			),
		).toBe("By weight & zone · 2 zones");
		expect(
			pricingSummary(
				{ mode: "radius", bands: [{}], outOfRange: "arrange" } as never,
				rm,
			),
		).toBe("By distance · 1 band");
	});

	it("labels exactly one partner mode, and lists every built-in one", () => {
		const partner = Object.entries(PRICING_MODE_UI)
			.filter(([, ui]) => ui.source === "partner")
			.map(([mode]) => mode);
		expect(partner).toEqual(["live"]);
		expect(new Set(BUILTIN_PRICING_MODES)).toEqual(
			new Set(["free", "flat", "weight", "radius"]),
		);
	});
});
