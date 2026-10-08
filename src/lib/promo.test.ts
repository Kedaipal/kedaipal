import { describe, expect, test } from "vitest";
import {
	cartItemSubtotal,
	effectivePriceFrom,
	effectiveVariantPrice,
	type PromoState,
	promoLive,
	promoPercentOff,
	repricedCartLines,
} from "./promo";

/**
 * The storefront half of promotions (z8r3fdcw72). The server decides WHETHER a
 * promotion applies; these rules only own the clock and the display, so the
 * tests that matter are the ones about a page left open.
 */

const NOW = 1_760_000_000_000;
const MIN = 60_000;

const live: PromoState = {
	phase: "live",
	label: "Raya",
	endsAt: NOW + 10 * MIN,
};

describe("promoLive", () => {
	test("no state, or a scheduled teaser, is not live", () => {
		expect(promoLive(undefined, NOW)).toBe(false);
		expect(
			promoLive(
				{ phase: "scheduled", label: "Raya", startsAt: NOW + MIN },
				NOW,
			),
		).toBe(false);
	});

	test("a window that closes under an open page stops being live at once", () => {
		expect(promoLive(live, NOW)).toBe(true);
		expect(promoLive(live, NOW + 10 * MIN)).toBe(false);
	});

	test("an open-ended promotion stays live", () => {
		expect(promoLive({ phase: "live", label: "Clearance" }, NOW)).toBe(true);
	});

	test("a capped sale with nothing left is over, whatever the clock says", () => {
		expect(promoLive({ ...live, unitCap: 30, unitsLeft: 0 }, NOW)).toBe(false);
		expect(promoLive({ ...live, unitCap: 30, unitsLeft: 1 }, NOW)).toBe(true);
	});
});

describe("effectiveVariantPrice", () => {
	const variant = { price: 4500, promoPrice: 3150 };

	test("quotes the sale price while the sale is in force", () => {
		expect(effectiveVariantPrice(variant, live, NOW)).toBe(3150);
	});

	test("reverts the moment the window closes — no refetch needed", () => {
		expect(effectiveVariantPrice(variant, live, NOW + 10 * MIN)).toBe(4500);
	});

	test("no sale price, or a nonsense one, is the list price", () => {
		expect(effectiveVariantPrice({ price: 4500 }, live, NOW)).toBe(4500);
		expect(
			effectiveVariantPrice({ price: 4500, promoPrice: 4500 }, live, NOW),
		).toBe(4500);
		expect(
			effectiveVariantPrice({ price: 4500, promoPrice: 0 }, live, NOW),
		).toBe(4500);
	});

	test("a quote line (price 0) can never discount", () => {
		expect(effectiveVariantPrice({ price: 0, promoPrice: 0 }, live, NOW)).toBe(
			0,
		);
	});
});

describe("effectivePriceFrom", () => {
	test("returns the discounted from-price only while live", () => {
		const product = { promoState: live, priceFrom: 4500, promoPriceFrom: 3150 };
		expect(effectivePriceFrom(product, NOW)).toBe(3150);
		expect(effectivePriceFrom(product, NOW + 10 * MIN)).toBe(4500);
	});

	test("with nothing discounted it returns the list from-price unchanged, so callers can compare", () => {
		expect(effectivePriceFrom({ promoState: live, priceFrom: 4500 }, NOW)).toBe(
			4500,
		);
	});
});

describe("promoPercentOff", () => {
	test("rounds to whole percent", () => {
		expect(promoPercentOff(4500, 3150)).toBe(30);
		expect(promoPercentOff(2800, 2240)).toBe(20);
	});

	test("refuses to render a 0% or negative badge", () => {
		expect(promoPercentOff(4500, 4500)).toBeNull();
		expect(promoPercentOff(4500, 5000)).toBeNull();
		// 0.4% off rounds to 0 — no badge beats "−0%".
		expect(promoPercentOff(10000, 9980)).toBeNull();
		expect(promoPercentOff(0, 0)).toBeNull();
	});
});

describe("repricedCartLines", () => {
	const line = (variantId: string, price: number, quantity = 1) => ({
		variantId,
		price,
		quantity,
	});

	test("names the lines whose price moved while they sat in the cart", () => {
		const items = [line("v1", 3150, 2), line("v2", 2800)];
		const changed = repricedCartLines(
			items,
			(id) =>
				id === "v1"
					? {
							variant: { price: 4500, promoPrice: 3150 },
							promoState: undefined,
						}
					: { variant: { price: 2800 } },
			NOW,
		);
		// v1 was added on promo; the promo is gone, so it is back to 4500.
		expect(changed).toEqual([{ line: items[0], was: 3150, now: 4500 }]);
	});

	test("a sale that STARTED while items sat there is reported too — never silently overcharged", () => {
		const items = [line("v1", 4500)];
		const changed = repricedCartLines(
			items,
			() => ({ variant: { price: 4500, promoPrice: 3150 }, promoState: live }),
			NOW,
		);
		expect(changed[0]).toMatchObject({ was: 4500, now: 3150 });
	});

	test("a line whose product has vanished from the catalogue is left alone", () => {
		// Stock and availability are other gates' jobs; repricing has nothing
		// to say about a line it can't price.
		expect(
			repricedCartLines([line("gone", 100)], () => undefined, NOW),
		).toEqual([]);
	});

	test("nothing changed is an empty list", () => {
		expect(
			repricedCartLines(
				[line("v1", 4500)],
				() => ({ variant: { price: 4500 } }),
				NOW,
			),
		).toEqual([]);
	});
});

describe("cartItemSubtotal", () => {
	test("is the figure the order door compares expectedSubtotal against", () => {
		expect(
			cartItemSubtotal([
				{ price: 3150, quantity: 2 },
				{ price: 2240, quantity: 1 },
			]),
		).toBe(8540);
		expect(cartItemSubtotal([])).toBe(0);
	});
});
