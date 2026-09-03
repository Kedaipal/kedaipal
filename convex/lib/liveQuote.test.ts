// The money rule for live courier pricing (z8r3fdbvdy). Charging the wrong
// side of this costs the vendor real ringgit on every order, so the rule is
// pinned here rather than left to the action that calls it.
import { describe, expect, test } from "vitest";
import {
	cartItemType,
	chooseLiveQuote,
	isColdItemType,
	type ProviderQuote,
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
