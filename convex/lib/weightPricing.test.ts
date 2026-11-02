import { describe, expect, test } from "vitest";
import {
	formatFloorKg,
	pricesByWeight,
	unweighedRefusal,
	WEIGHT_REQUIRED_COPY,
	weightPricingOf,
} from "./weightPricing";

/**
 * "Does this store price delivery by weight?" (23 Oct 2026) — the one rule
 * behind the product form's required weight, the readiness notice, the bulk
 * fill and the arming gates. Mandos was a live store with Delyva armed and
 * every tee at 0 g; nothing asked for a weight because only the weight-zone
 * mode counted as pricing by weight.
 */

const delyva = {
	enabled: true,
	apiKey: "dx-key",
	apiSecret: "dx-secret",
	customerId: 1,
	pickupAddress: { address1: "x" },
};

describe("weightPricingOf", () => {
	test("the weight rate card prices by weight, whatever couriers are armed", () => {
		expect(weightPricingOf({ deliveryConfig: { mode: "weight" } })).toBe(
			"rate_card",
		);
		expect(
			weightPricingOf({ deliveryConfig: { mode: "weight" }, delyva }),
		).toBe("rate_card");
	});

	test("live pricing with Delyva armed prices by weight — the Mandos shape", () => {
		expect(weightPricingOf({ deliveryConfig: { mode: "live" }, delyva })).toBe(
			"courier",
		);
	});

	test("live pricing with riders alone does not — riders price by distance", () => {
		expect(
			weightPricingOf({
				deliveryConfig: { mode: "live" },
				deliveryBooking: { enabled: true },
			}),
		).toBeNull();
	});

	test("a connected-but-paused Delyva is not armed", () => {
		expect(
			weightPricingOf({
				deliveryConfig: { mode: "live" },
				delyva: { ...delyva, enabled: false },
			}),
		).toBeNull();
	});

	test("a Delyva without credentials is not armed, enabled or not", () => {
		expect(
			weightPricingOf({
				deliveryConfig: { mode: "live" },
				delyva: { enabled: true },
			}),
		).toBeNull();
	});

	test("a Delyva without a pickup address still counts — asked one step early, never one step late", () => {
		expect(
			weightPricingOf({
				deliveryConfig: { mode: "live" },
				delyva: { ...delyva, pickupAddress: undefined },
			}),
		).toBe("courier");
	});

	test("flat, radius, free and the legacy lalamove mode never price by weight", () => {
		for (const mode of ["flat", "radius", "lalamove"]) {
			expect(weightPricingOf({ deliveryConfig: { mode }, delyva })).toBeNull();
		}
		expect(weightPricingOf({ delyva })).toBeNull();
		expect(pricesByWeight({})).toBe(false);
	});
});

describe("the copy", () => {
	test("the courier store is never told its order can't be priced — that is the rate card's truth", () => {
		expect(WEIGHT_REQUIRED_COPY.courier.lead).not.toMatch(/can't be priced/);
		expect(WEIGHT_REQUIRED_COPY.courier.issue).not.toMatch(/can't be priced/);
		expect(WEIGHT_REQUIRED_COPY.courier.consequence).not.toMatch(
			/can't be priced/,
		);
		// And it names the floor instead, in one spelling.
		expect(formatFloorKg()).toBe("1 kg");
		expect(WEIGHT_REQUIRED_COPY.courier.lead).toContain("1 kg parcel");
		expect(WEIGHT_REQUIRED_COPY.courier.issue).toContain("1 kg parcel");
	});

	test("the rate card store is told the order can't be priced, never about a floor", () => {
		expect(WEIGHT_REQUIRED_COPY.rate_card.lead).toMatch(/can't be priced/);
		expect(WEIGHT_REQUIRED_COPY.rate_card.issue).not.toContain("1 kg");
	});

	test("the arming refusal counts, blames the right thing and names the fix", () => {
		expect(unweighedRefusal(1, "courier")).toBe(
			"1 product has no parcel weight — couriers price every order by weight. Set them under Products → Parcel weights first.",
		);
		expect(unweighedRefusal(3, "rate_card")).toContain(
			"3 products have no parcel weight — a rate card prices every order by weight.",
		);
	});
});
