// The money rule for live courier pricing (z8r3fdbvdy). Charging the wrong
// side of this costs the vendor real ringgit on every order, so the rule is
// pinned here rather than left to the action that calls it.
import { describe, expect, test } from "vitest";
import {
	cartItemType,
	sameQuotedLines,
	chooseLiveQuote,
	isColdItemType,
	LIVE_QUOTE_WEIGHT_FLOOR_G,
	liveQuoteWeightFacts,
	liveQuoteWeightKg,
	type ProviderQuote,
	weightGapStamp,
} from "./liveQuote";

const rider = (fee: number, currency = "MYR"): ProviderQuote => ({
	provider: "lalamove",
	status: "quoted",
	fee,
	currency,
	quotationId: "q-1",
	vehicleType: "MOTORCYCLE",
});

const courier = (fee: number, currency = "MYR"): ProviderQuote => ({
	provider: "delyva",
	status: "quoted",
	fee,
	currency,
	serviceCode: "NVMY",
	serviceName: "Ninja Van",
});

const failed = (
	provider: "lalamove" | "delyva",
	status: "out_of_range" | "no_cold_service" | "store_unavailable" | "unavailable",
): ProviderQuote => ({ provider, status }) as ProviderQuote;

describe("both providers quote — the higher one wins", () => {
	// The leak this ticket exists to close: collected RM4.00, dispatched at
	// RM4.75. Charging the higher means the fee covers either tool.
	test("charges the dearer of a rider and a courier", () => {
		const out = chooseLiveQuote({
			quotes: [rider(400), courier(475)],
			storeCurrency: "MYR",
			cold: false,
		});
		expect(out).toMatchObject({ kind: "quoted", provider: "delyva", fee: 475 });
	});

	test("…and the other way round", () => {
		const out = chooseLiveQuote({
			quotes: [rider(1200), courier(530)],
			storeCurrency: "MYR",
			cold: false,
		});
		expect(out).toMatchObject({
			kind: "quoted",
			provider: "lalamove",
			fee: 1200,
		});
	});

	test("keeps both figures as the audit trail", () => {
		const out = chooseLiveQuote({
			quotes: [rider(400), courier(475)],
			storeCurrency: "MYR",
			cold: false,
		});
		expect(out.kind === "quoted" && out.considered).toEqual([
			{ provider: "lalamove", fee: 400, currency: "MYR" },
			{ provider: "delyva", fee: 475, currency: "MYR" },
		]);
	});

	test("a tie is deterministic, not accidental", () => {
		const out = chooseLiveQuote({
			quotes: [rider(500), courier(500)],
			storeCurrency: "MYR",
			cold: false,
		});
		expect(out).toMatchObject({ provider: "lalamove", fee: 500 });
	});

	test("a free quote is a price, not a missing one", () => {
		// Delyva's sandbox really does return RM0.00 services; zero must not be
		// mistaken for "no answer" and drop the whole quote.
		const out = chooseLiveQuote({
			quotes: [courier(0)],
			storeCurrency: "MYR",
			cold: false,
		});
		expect(out).toMatchObject({ kind: "quoted", fee: 0 });
	});
});

describe("one provider armed — the single-provider case", () => {
	test("uses the only quote there is", () => {
		expect(
			chooseLiveQuote({
				quotes: [rider(650)],
				storeCurrency: "MYR",
				cold: false,
			}),
		).toMatchObject({ kind: "quoted", provider: "lalamove", fee: 650 });
	});

	test("one provider failing never blocks the other's price", () => {
		const out = chooseLiveQuote({
			quotes: [failed("lalamove", "out_of_range"), courier(530)],
			storeCurrency: "MYR",
			cold: false,
		});
		expect(out).toMatchObject({ kind: "quoted", provider: "delyva", fee: 530 });
	});
});

describe("cold carts belong to the courier alone", () => {
	// A rider carries no temperature guarantee, so a cheaper rider quote must
	// never win a frozen cart — and must not stand in when Delyva has nothing.
	test("ignores a rider quote even when it is dearer", () => {
		const out = chooseLiveQuote({
			quotes: [rider(2000), courier(700)],
			storeCurrency: "MYR",
			cold: true,
		});
		expect(out).toMatchObject({ kind: "quoted", provider: "delyva", fee: 700 });
	});

	test("refuses rather than pricing a frozen cart as an ambient trip", () => {
		const out = chooseLiveQuote({
			quotes: [rider(800), failed("delyva", "no_cold_service")],
			storeCurrency: "MYR",
			cold: true,
		});
		expect(out).toEqual({ kind: "unquotable", reason: "no_cold_service" });
	});

	test("names the cold-chain gap ahead of a generic failure", () => {
		const out = chooseLiveQuote({
			quotes: [failed("delyva", "no_cold_service")],
			storeCurrency: "MYR",
			cold: true,
		});
		expect(out).toEqual({ kind: "unquotable", reason: "no_cold_service" });
	});
});

describe("a quote in the wrong currency is discarded, never converted", () => {
	// Reachable today: a Malaysian Delyva account attached to a Singapore
	// store prices in MYR. Charging an SGD buyer that ringgit number would be
	// a silent mispricing, and we hold no exchange rate.
	test("drops the foreign-currency quote and uses the one that matches", () => {
		const out = chooseLiveQuote({
			quotes: [courier(475, "MYR"), rider(900, "SGD")],
			storeCurrency: "SGD",
			cold: false,
		});
		expect(out).toMatchObject({
			kind: "quoted",
			provider: "lalamove",
			fee: 900,
		});
	});

	test("refuses when the only quote is in another currency", () => {
		const out = chooseLiveQuote({
			quotes: [courier(475, "MYR")],
			storeCurrency: "SGD",
			cold: false,
		});
		expect(out).toEqual({ kind: "unquotable", reason: "unavailable" });
	});
});

describe("when nothing can be priced, the reason is the actionable one", () => {
	test("out_of_range only when every provider says so", () => {
		expect(
			chooseLiveQuote({
				quotes: [
					failed("lalamove", "out_of_range"),
					failed("delyva", "out_of_range"),
				],
				storeCurrency: "MYR",
				cold: false,
			}),
		).toEqual({ kind: "unquotable", reason: "out_of_range" });
	});

	test("a mixed failure never blames the buyer's address", () => {
		// Telling a buyer to change a perfectly deliverable address because one
		// provider had an outage is the wrong instruction.
		expect(
			chooseLiveQuote({
				quotes: [
					failed("lalamove", "out_of_range"),
					failed("delyva", "unavailable"),
				],
				storeCurrency: "MYR",
				cold: false,
			}),
		).toEqual({ kind: "unquotable", reason: "unavailable" });
	});

	test("seller-side breakage outranks a generic failure", () => {
		expect(
			chooseLiveQuote({
				quotes: [
					failed("lalamove", "store_unavailable"),
					failed("delyva", "unavailable"),
				],
				storeCurrency: "MYR",
				cold: false,
			}),
		).toEqual({ kind: "unquotable", reason: "store_unavailable" });
	});

	test("no providers at all is unavailable, not out_of_range", () => {
		expect(
			chooseLiveQuote({ quotes: [], storeCurrency: "MYR", cold: false }),
		).toEqual({ kind: "unquotable", reason: "unavailable" });
	});

	test("a malformed fee is not a price", () => {
		expect(
			chooseLiveQuote({
				quotes: [
					{
						provider: "delyva",
						status: "quoted",
						fee: Number.NaN,
						currency: "MYR",
					},
				],
				storeCurrency: "MYR",
				cold: false,
			}),
		).toEqual({ kind: "unquotable", reason: "unavailable" });
	});
});

describe("cart item type (store default until per-item flags land)", () => {
	test("falls back to PARCEL for a store that never set one", () => {
		expect(cartItemType(undefined)).toBe("PARCEL");
	});

	test("carries the store's own default through", () => {
		expect(cartItemType("FROZEN")).toBe("FROZEN");
	});

	test("knows which types need a cold chain", () => {
		expect(isColdItemType("CHILLED")).toBe(true);
		expect(isColdItemType("FROZEN")).toBe(true);
		expect(isColdItemType("PARCEL")).toBe(false);
	});
});

describe("liveQuoteWeightKg — an unweighed item never blocks the quote (Mandos, 23 Oct)", () => {
	// Before: one product stored at 0 g meant Delyva didn't bid, and on a
	// store whose rider couldn't reach the address the buyer was refused
	// with "pricing isn't working for this store". The weight field is
	// optional, so blank is a normal state — the courier is asked to price a
	// one-kilo parcel and the seller is told, not the buyer.
	test("a fully weighed cart sums weight × quantity, with no floor", () => {
		expect(
			liveQuoteWeightKg([
				{ parcelWeightG: 400, quantity: 3 },
				{ parcelWeightG: 250, quantity: 1 },
			]),
		).toBeCloseTo(1.45);
		// Under a kilo stays under a kilo: the seller answered, we don't
		// second-guess it.
		expect(liveQuoteWeightKg([{ parcelWeightG: 300, quantity: 1 }])).toBe(
			0.3,
		);
	});

	test("an unweighed item is quoted at the one-kilo floor", () => {
		expect(liveQuoteWeightKg([{ parcelWeightG: 0, quantity: 1 }])).toBe(
			LIVE_QUOTE_WEIGHT_FLOOR_G / 1000,
		);
		// Three of them are still one parcel at the floor — counting each as a
		// kilo would overcharge the buyer for a rule they never saw.
		expect(liveQuoteWeightKg([{ parcelWeightG: 0, quantity: 3 }])).toBe(1);
	});

	test("a custom line counts as unweighed, not as zero", () => {
		expect(
			liveQuoteWeightKg([{ parcelWeightG: 0, quantity: 1, isCustom: true }]),
		).toBe(1);
	});

	test("a weighed cart with one unweighed line keeps its sum — floored, never zeroed", () => {
		// Heavier than the floor already: the known weight stands, the unknown
		// line adds nothing (the seller absorbs the drift at dispatch).
		expect(
			liveQuoteWeightKg([
				{ parcelWeightG: 2500, quantity: 1 },
				{ parcelWeightG: 0, quantity: 1 },
			]),
		).toBe(2.5);
		// Lighter than the floor: the floor lifts it.
		expect(
			liveQuoteWeightKg([
				{ parcelWeightG: 300, quantity: 1 },
				{ parcelWeightG: 0, quantity: 1 },
			]),
		).toBe(1);
	});

	test("an empty cart is no cart — still unpriceable", () => {
		expect(liveQuoteWeightKg([])).toBeNull();
	});
});

describe("weightGapStamp — what a won quote records about weight it couldn't see", () => {
	test("PR #416 review: 1.5 kg weighed + 5 unweighed tees is NOT floored, and is still stamped", () => {
		const facts = liveQuoteWeightFacts([
			{ parcelWeightG: 1500, quantity: 1 },
			{ parcelWeightG: 0, quantity: 5 },
		]);
		expect(facts).toEqual({ kg: 1.5, floored: false, unweighedLines: 1 });
		expect(
			weightGapStamp({
				provider: "delyva",
				weightFloored: false,
				unweighedLines: 5,
			}),
		).toEqual({ unweighedLines: 5 });
	});

	test("a floored cart stamps both, a custom-only floor stamps the floor with zero lines", () => {
		expect(
			weightGapStamp({ provider: "delyva", weightFloored: true, unweighedLines: 2 }),
		).toEqual({ weightFloored: true, unweighedLines: 2 });
		expect(
			weightGapStamp({ provider: "delyva", weightFloored: true, unweighedLines: 0 }),
		).toEqual({ weightFloored: true, unweighedLines: 0 });
	});

	test("a fully weighed cart stamps nothing", () => {
		expect(
			weightGapStamp({ provider: "delyva", weightFloored: false, unweighedLines: 0 }),
		).toEqual({});
	});

	test("a rider's price never used the weight, so it never carries a stamp", () => {
		expect(
			weightGapStamp({ provider: "lalamove", weightFloored: true, unweighedLines: 3 }),
		).toEqual({});
	});
});

describe("liveQuoteWeightFacts — the stamp the order carries (23 Oct 2026)", () => {
	test("a floored cart says so, and counts the lines a product weight would have priced", () => {
		expect(
			liveQuoteWeightFacts([
				{ parcelWeightG: 0, quantity: 2 },
				{ parcelWeightG: 300, quantity: 1 },
				{ parcelWeightG: 0, quantity: 1 },
			]),
		).toEqual({ kg: 1, floored: true, unweighedLines: 2 });
	});

	test("a custom line floors the quote but is not something the seller can weigh", () => {
		expect(
			liveQuoteWeightFacts([
				{ parcelWeightG: 0, quantity: 1, isCustom: true },
				{ parcelWeightG: 200, quantity: 1 },
			]),
		).toEqual({ kg: 1, floored: true, unweighedLines: 0 });
	});

	test("an unweighed line in a cart already over a kilo is unweighed but NOT floored — the sum stood", () => {
		expect(
			liveQuoteWeightFacts([
				{ parcelWeightG: 0, quantity: 1 },
				{ parcelWeightG: 1500, quantity: 1 },
			]),
		).toEqual({ kg: 1.5, floored: false, unweighedLines: 1 });
	});

	test("a fully weighed light cart keeps its sum and is not floored", () => {
		expect(
			liveQuoteWeightFacts([{ parcelWeightG: 250, quantity: 2 }]),
		).toEqual({ kg: 0.5, floored: false, unweighedLines: 0 });
	});

	test("an empty cart has no facts", () => {
		expect(liveQuoteWeightFacts([])).toBeNull();
	});
});

describe("sameQuotedLines — a quote is bound to the cart it priced", () => {
	// Delyva bids on summed weight, so redeeming a light cart's quote against
	// a heavy cart buys a cheaper courier band (PR #253 review, MEDIUM).
	test("same lines in any order, even split, are the same cart", () => {
		expect(
			sameQuotedLines(
				[
					{ variantId: "a", quantity: 2 },
					{ variantId: "b", quantity: 1 },
				],
				[
					{ variantId: "b", quantity: 1 },
					{ variantId: "a", quantity: 1 },
					{ variantId: "a", quantity: 1 },
				],
			),
		).toBe(true);
	});

	test("a changed quantity is a different cart", () => {
		expect(
			sameQuotedLines(
				[{ variantId: "a", quantity: 1 }],
				[{ variantId: "a", quantity: 3 }],
			),
		).toBe(false);
	});

	test("an added or swapped variant is a different cart", () => {
		expect(
			sameQuotedLines(
				[{ variantId: "a", quantity: 1 }],
				[
					{ variantId: "a", quantity: 1 },
					{ variantId: "b", quantity: 1 },
				],
			),
		).toBe(false);
		expect(
			sameQuotedLines(
				[{ variantId: "a", quantity: 1 }],
				[{ variantId: "b", quantity: 1 }],
			),
		).toBe(false);
	});

	test("custom/legacy lines without a variantId are ignored on both sides", () => {
		// They were never summable into the quote's weight, so they can't
		// invalidate it either.
		expect(
			sameQuotedLines(
				[{ variantId: "a", quantity: 1 }],
				[
					{ variantId: "a", quantity: 1 },
					{ quantity: 5 },
				],
			),
		).toBe(true);
	});
})

describe("too heavy for a rider (25 Oct 2026)", () => {
	test("a courier that priced it wins — the rider's refusal costs the buyer nothing", () => {
		expect(
			chooseLiveQuote({
				quotes: [
					{ provider: "lalamove", status: "too_heavy" },
					{ provider: "delyva", status: "quoted", fee: 5377, currency: "MYR" },
				],
				storeCurrency: "MYR",
				cold: false,
			}),
		).toMatchObject({ kind: "quoted", provider: "delyva", fee: 5377 });
	});

	test("alone, it is the reason the buyer sees", () => {
		expect(
			chooseLiveQuote({
				quotes: [{ provider: "lalamove", status: "too_heavy" }],
				storeCurrency: "MYR",
				cold: false,
			}),
		).toEqual({ kind: "unquotable", reason: "too_heavy" });
	});

	test("beside a coverage refusal it still wins — the address may be fine, the ORDER is too big", () => {
		expect(
			chooseLiveQuote({
				quotes: [
					{ provider: "lalamove", status: "too_heavy" },
					{ provider: "delyva", status: "out_of_range" },
				],
				storeCurrency: "MYR",
				cold: false,
			}),
		).toEqual({ kind: "unquotable", reason: "too_heavy" });
	});

	test("a cold cart's missing cold courier still outranks it — riders never carry cold", () => {
		expect(
			chooseLiveQuote({
				quotes: [
					{ provider: "lalamove", status: "too_heavy" },
					{ provider: "delyva", status: "no_cold_service" },
				],
				storeCurrency: "MYR",
				cold: true,
			}),
		).toEqual({ kind: "unquotable", reason: "no_cold_service" });
	});
});
