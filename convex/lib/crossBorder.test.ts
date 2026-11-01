import { describe, expect, test } from "vitest";
import { addressCountryLine } from "./address";
import {
	crossBorderPricingSummary,
	deliversToLabel,
	domesticReason,
	domesticOnlyCouriersDeliver,
	effectiveLanes,
	laneCountriesFor,
	laneHold,
	laneNeedsLiveQuote,
	lanePause,
	lanePauseFor,
	liveQuoteCourierNames,
	overseasFeeLabel,
	resolveCrossBorderQuote,
	sanitizeCrossBorderLanes,
	shipsAbroad,
	shipsFromLabel,
	shipsWithinLabel,
} from "./crossBorder";

// The cross-border rules (z8r3fdr5yy) — every door reads these, so a wrong
// answer here is a wrong answer at checkout, at the order door and on /stores.

const LANE = { country: "SG" as const, pricing: { kind: "flat" as const, fee: 2500 } };
const OPEN = {
	planAllows: true,
	offerDelivery: true,
	easyparcelQuotes: true,
};
const LIVE_LANE = { country: "SG" as const, pricing: { kind: "live" as const } };

describe("which lanes are live", () => {
	test("a lane is only ever to ANOTHER country", () => {
		expect(laneCountriesFor("MY")).toEqual(["SG"]);
		expect(laneCountriesFor("SG")).toEqual(["MY"]);
	});

	test("live with the plan and delivery on — whatever home delivery is priced by", () => {
		expect(
			effectiveLanes({ ...OPEN, lanes: [LANE], storeCountry: "MY" }),
		).toEqual([LANE]);
	});

	test("paused — never deleted — by plan or delivery off; home live pricing no longer pauses it", () => {
		expect(lanePause({ ...OPEN, planAllows: false })).toBe("plan");
		expect(lanePause({ ...OPEN, offerDelivery: false })).toBe("delivery_off");
		expect(lanePause(OPEN)).toBeNull();
		for (const facts of [
			{ ...OPEN, planAllows: false },
			{ ...OPEN, offerDelivery: false },
		]) {
			expect(
				effectiveLanes({ ...facts, lanes: [LANE], storeCountry: "MY" }),
			).toEqual([]);
		}
	});

	test("a new lane is HELD until its products are chosen — never offered before (Zaki, 30 Oct)", () => {
		const awaiting = { ...LANE, awaitingProducts: true };
		expect(laneHold(awaiting, OPEN)).toBe("awaiting_products");
		expect(
			effectiveLanes({ ...OPEN, lanes: [awaiting], storeCountry: "MY" }),
		).toEqual([]);
		// Absent = reviewed: every lane saved before the field existed.
		expect(laneHold(LANE, OPEN)).toBeNull();
	});

	test("an EasyParcel-priced lane is held while EasyParcel can't quote, and lives the moment it can", () => {
		const facts = { ...OPEN, easyparcelQuotes: false };
		expect(laneHold(LIVE_LANE, facts)).toBe("courier_unavailable");
		expect(
			effectiveLanes({ ...facts, lanes: [LIVE_LANE], storeCountry: "MY" }),
		).toEqual([]);
		// A seller-priced lane never waits on EasyParcel.
		expect(laneHold(LANE, facts)).toBeNull();
		expect(
			effectiveLanes({ ...OPEN, lanes: [LIVE_LANE], storeCountry: "MY" }),
		).toEqual([LIVE_LANE]);
		// The store-wide pause outranks the lane's own hold.
		expect(
			lanePauseFor({ ...facts, planAllows: false, lane: LIVE_LANE }),
		).toBe("plan");
		expect(lanePauseFor({ ...facts, lane: LIVE_LANE })).toBe(
			"courier_unavailable",
		);
	});

	test("a live lane asks for a quote until the cart earns its free-above", () => {
		const withFree = {
			...LIVE_LANE,
			pricing: { kind: "live" as const, freeAbove: 30000 },
		};
		expect(laneNeedsLiveQuote(withFree, 29999)).toBe(true);
		expect(laneNeedsLiveQuote(withFree, 30000)).toBe(false);
		expect(laneNeedsLiveQuote(LANE, 0)).toBe(false);
		// Reaching the pure resolver without a quote refuses, never invents.
		expect(
			resolveCrossBorderQuote({
				pricing: { kind: "live" },
				subtotal: 0,
				country: "SG",
			}),
		).toEqual({ kind: "blocked", reason: "unquotable" });
	});

	test("the live couriers named are the ones the store's country can connect", () => {
		// Derived from the booking registry: SG never hears "Delyva", and
		// EasyParcel bids at home only where it carries home parcels (SG).
		expect(liveQuoteCourierNames("MY")).toEqual(["Lalamove", "Delyva"]);
		expect(liveQuoteCourierNames("SG")).toEqual(["Lalamove", "EasyParcel"]);
		// "…within X only" never names EasyParcel, which also goes abroad.
		expect(domesticOnlyCouriersDeliver("MY")).toBe(
			"Lalamove and Delyva deliver",
		);
		expect(domesticOnlyCouriersDeliver("SG")).toBe("Lalamove delivers");
	});

	test("a store that switched country can't deliver 'abroad' to itself", () => {
		expect(
			effectiveLanes({ ...OPEN, lanes: [LANE], storeCountry: "SG" }),
		).toEqual([]);
	});
});

describe("which products can go", () => {
	test("a physical good inherits; the seller can only opt it OUT", () => {
		expect(shipsAbroad({})).toBe(true);
		expect(shipsAbroad({ domesticOnly: true })).toBe(false);
		expect(domesticReason({ domesticOnly: true })).toBe("seller_choice");
	});

	test("no parcel, no border — judged on fulfilment, never on the name", () => {
		expect(shipsAbroad({ kind: "service" })).toBe(false);
		expect(shipsAbroad({ kind: "booking" })).toBe(false);
		expect(shipsAbroad({ event: { date: 1 } })).toBe(false);
		expect(domesticReason({ kind: "service" })).toBe("no_parcel");
	});

	test("one spelling of each label", () => {
		expect(shipsWithinLabel("MY")).toBe("Ships within Malaysia only");
		expect(shipsFromLabel("SG")).toBe("Ships from Singapore");
		expect(deliversToLabel("MY")).toBe("Delivers to Malaysia");
	});

	test("the overseas fee line has one spelling everywhere; home keeps its own word", () => {
		// Checkout, the buyer's order page and the seller's all read this —
		// they disagreed on the /test-code pass.
		expect(overseasFeeLabel("MY", "SG")).toBe("Delivery to Malaysia");
		expect(overseasFeeLabel("SG", "SG")).toBeUndefined();
		// Orders from before the stamp are domestic.
		expect(overseasFeeLabel(undefined, "MY")).toBeUndefined();
	});
});

describe("pricing a cross-border order", () => {
	test("flat: the fee, free above the threshold", () => {
		const pricing = { kind: "flat" as const, fee: 2500, freeAbove: 30000 };
		expect(
			resolveCrossBorderQuote({ pricing, subtotal: 10000, country: "SG" }),
		).toEqual({ kind: "fee", fee: 2500, mode: "flat" });
		expect(
			resolveCrossBorderQuote({ pricing, subtotal: 30000, country: "SG" }),
		).toEqual({ kind: "free", reason: "threshold" });
	});

	test("weight: the band the cart lands in, blocked — never pending — beyond it", () => {
		const pricing = {
			kind: "weight" as const,
			bands: [
				{ maxKg: 1, fee: 1800 },
				{ maxKg: 3, fee: 3200 },
			],
		};
		const quote = (grams: number) =>
			resolveCrossBorderQuote({
				pricing,
				subtotal: 0,
				cartWeight: { kind: "ok", grams },
				country: "SG",
			});
		expect(quote(1000)).toMatchObject({ kind: "fee", fee: 1800, mode: "weight" });
		expect(quote(1001)).toMatchObject({ kind: "fee", fee: 3200 });
		expect(quote(3500)).toEqual({ kind: "blocked", reason: "over_bands" });
		expect(
			resolveCrossBorderQuote({
				pricing,
				subtotal: 0,
				cartWeight: { kind: "missing_weights" },
				country: "SG",
			}),
		).toEqual({ kind: "blocked", reason: "missing_weights" });
	});

	test("free: always free", () => {
		expect(
			resolveCrossBorderQuote({
				pricing: { kind: "free" },
				subtotal: 0,
				country: "SG",
			}),
		).toEqual({ kind: "free" });
	});

	test("the settings summary reads like the seller would say it", () => {
		const money = (minor: number) => `RM${(minor / 100).toFixed(2)}`;
		expect(
			crossBorderPricingSummary({ kind: "flat", fee: 2500 }, money),
		).toBe("RM25.00 per order");
		expect(crossBorderPricingSummary({ kind: "live" }, money)).toBe(
			"Priced live by EasyParcel",
		);
		expect(crossBorderPricingSummary({ kind: "free" }, money)).toBe(
			"Free — you cover the courier",
		);
	});
});

describe("validating a saved lane", () => {
	test("sorts bands and refuses what's ambiguous", () => {
		const [lane] = sanitizeCrossBorderLanes(
			[
				{
					country: "SG",
					pricing: {
						kind: "weight",
						bands: [
							{ maxKg: 3, fee: 3200 },
							{ maxKg: 1, fee: 1800 },
						],
					},
				},
			],
			"MY",
		);
		expect(lane.pricing).toEqual({
			kind: "weight",
			bands: [
				{ maxKg: 1, fee: 1800 },
				{ maxKg: 3, fee: 3200 },
			],
			freeAbove: undefined,
		});
		expect(() =>
			sanitizeCrossBorderLanes(
				[
					{
						country: "SG",
						pricing: {
							kind: "weight",
							bands: [
								{ maxKg: 1, fee: 100 },
								{ maxKg: 1, fee: 200 },
							],
						},
					},
				],
				"MY",
			),
		).toThrow(/same weight/);
		expect(() =>
			sanitizeCrossBorderLanes([LANE, LANE], "MY"),
		).toThrow(/listed twice/);
	});
});

describe("the country line on an overseas address", () => {
	test("printed only abroad, and never when the city already says it", () => {
		const kl = { city: "Kuala Lumpur", country: "MY" as const };
		expect(addressCountryLine(kl, "SG")).toBe("Malaysia");
		expect(addressCountryLine(kl, "MY")).toBeUndefined();
		expect(
			addressCountryLine({ city: "Singapore", country: "SG" }, "MY"),
		).toBeUndefined();
		// Orders from before the stamp are domestic.
		expect(addressCountryLine({ city: "Ipoh" }, "MY")).toBeUndefined();
	});
});
