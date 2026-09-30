import { describe, expect, it } from "vitest";
import { CREDIT_PACKS } from "../../convex/lib/plans";
import { afterTopUpLine, packOffers, wholePrice } from "./credit-packs";

describe("packOffers — what each pack is worth, side by side", () => {
	it("MYR: the 200 pack is the better value and says what it saves against 4 × 50", () => {
		const [small, big] = packOffers(CREDIT_PACKS.MYR);
		expect(small).toMatchObject({
			credits: 50,
			perCreditMinor: 90, // RM 45 / 50
			bestValue: false,
			saving: null,
		});
		expect(big).toMatchObject({
			credits: 200,
			perCreditMinor: 80, // RM 160 / 200
			bestValue: true,
			// 4 × RM 45 = RM 180, the 200 pack is RM 160.
			saving: { minor: 2000, versus: { count: 4, credits: 50 } },
		});
	});

	it("SGD: a fractional per-credit price rounds to the cent, the saving doesn't", () => {
		const [small, big] = packOffers(CREDIT_PACKS.SGD);
		expect(small.perCreditMinor).toBe(44); // S$ 22 / 50
		expect(big.perCreditMinor).toBe(38); // S$ 75 / 200 = 37.5
		// 4 × S$ 22 = S$ 88, the 200 pack is S$ 75.
		expect(big.saving).toEqual({
			minor: 1300,
			versus: { count: 4, credits: 50 },
		});
		expect(big.bestValue).toBe(true);
	});

	it("packs that cost the same per credit claim no best value and no saving", () => {
		const offers = packOffers([
			{ id: "a", credits: 50, priceMinor: 5000, currency: "MYR" },
			{ id: "b", credits: 100, priceMinor: 10000, currency: "MYR" },
		]);
		expect(offers.every((o) => !o.bestValue && o.saving === null)).toBe(true);
	});

	it("credits that don't divide evenly still show the saving, without a count", () => {
		const [, odd] = packOffers([
			{ id: "a", credits: 50, priceMinor: 5000, currency: "MYR" },
			{ id: "b", credits: 120, priceMinor: 10000, currency: "MYR" },
		]);
		expect(odd.saving).toEqual({ minor: 2000, versus: null });
	});

	it("one pack: nothing to compare", () => {
		const [only] = packOffers([
			{ id: "a", credits: 50, priceMinor: 4500, currency: "MYR" },
		]);
		expect(only).toMatchObject({ bestValue: false, saving: null });
	});
});

describe("wholePrice — the way /pricing quotes a price", () => {
	it("drops cents only when there are none", () => {
		expect(wholePrice(2200, "SGD")).toBe(wholePrice(2200, "SGD").trim());
		expect(wholePrice(2200, "SGD")).toMatch(/22$/);
		expect(wholePrice(2200, "SGD")).not.toMatch(/\.00/);
		expect(wholePrice(38, "SGD")).toMatch(/0\.38$/);
		expect(wholePrice(16000, "MYR")).toMatch(/^RM\s?160$/);
	});
});

describe("afterTopUpLine — the result of the tap, before the tap", () => {
	it("adds to what's left", () => {
		expect(afterTopUpLine(10, 50)).toBe("After this top-up: 60 orders left.");
		expect(afterTopUpLine(0, 50)).toBe("After this top-up: 50 orders left.");
	});

	it("pays a debt first, and says so", () => {
		expect(afterTopUpLine(-15, 50)).toBe(
			"Covers the 15 owed and leaves 35 orders.",
		);
		expect(afterTopUpLine(-49, 50)).toBe(
			"Covers the 49 owed and leaves 1 order.",
		);
		expect(afterTopUpLine(-50, 50)).toBe("Covers the 50 owed exactly.");
		expect(afterTopUpLine(-80, 50)).toBe(
			"Covers 50 of the 80 owed — 30 still owed after it.",
		);
	});
});
