import { describe, expect, it } from "vitest";
import {
	describeEasyparcelService,
	type EasyparcelRate,
} from "../../convex/lib/easyparcel";
import { DAY_MS, todayMytMidnight } from "../../convex/lib/fulfilmentDate";
import {
	defaultRateId,
	filterRates,
	rateDateFit,
	rateFilterCounts,
} from "./easyparcel-rates";

/** Built from the REAL service names a Singapore quote returned on 28 Oct
 * 2026 (z8r3fdcje2 /test-code) — price-sorted, as the parser hands them over. */
function rate(
	id: string,
	serviceName: string,
	priceMinor: number,
): EasyparcelRate {
	return {
		serviceId: id,
		serviceName,
		courierName: "Courier",
		isPickup: /\(Pick Up\)/i.test(serviceName),
		isDropoff: /\(Drop[-\s]?Off\)/i.test(serviceName),
		priceMinor,
		currency: "SGD",
		...describeEasyparcelService(serviceName),
	};
}

const QUOTE: EasyparcelRate[] = [
	rate(
		"pnp-p2p",
		"Park N Parcel - Paperless [1-3 Days] (Drop Off) (From Point to Point)",
		324,
	),
	rate(
		"sp-esaver",
		"Speedpost - E-Saver [1-3 Days] (Drop Off) (From Point to Door OR to Point)",
		339,
	),
	rate(
		"jt-pudo",
		"J&T Express - PUDO [1-3 Days] (Drop Off) (From Point to Door)",
		374,
	),
	rate(
		"ninja-std",
		"Ninja - Standard [1-3 Days] (Pick Up) (From Door to Door | 5 MOQ)",
		424,
	),
	rate(
		"jt-next",
		"J&T Express - Next-Day Priority [1-2 Days] (Pick Up) (From Door to Door)",
		514,
	),
	rate(
		"sp-priority",
		"Speedpost - Priority [Same-Day] (Pick Up) (From Door to Door)",
		1359,
	),
];

const NOW = Date.UTC(2026, 9, 28, 2, 0); // 28 Oct, 10:00 MYT
const inDays = (n: number) => todayMytMidnight(NOW) + n * DAY_MS;

describe("defaultRateId — the cheapest that KEEPS the order's promise (F9)", () => {
	it("never pre-selects a point-to-point service for a delivery order", () => {
		// The run that found it: Park N Parcel point-to-point was cheapest.
		expect(defaultRateId(QUOTE, undefined, NOW)).toBe("sp-esaver");
	});

	it("skips a service that needs more parcels than one order has (F11)", () => {
		const doorOnly = QUOTE.filter((r) => r.deliversTo !== "point");
		const withMoqFirst = [
			QUOTE[3], // Ninja 5 MOQ — made cheapest here
			...doorOnly.filter((r) => r.serviceId !== "ninja-std"),
		];
		expect(defaultRateId(withMoqFirst, undefined, NOW)).not.toBe("ninja-std");
	});

	it("prefers a service that makes the buyer's date (F13)", () => {
		// Due TOMORROW: every 1–3 day service may miss it; next-day priority's
		// slow end (2 days) may too; only same-day is safe.
		expect(defaultRateId(QUOTE, inDays(1), NOW)).toBe("sp-priority");
		// Plenty of time: back to the cheapest door service.
		expect(defaultRateId(QUOTE, inDays(5), NOW)).toBe("sp-esaver");
	});

	it("falls back to the cheapest door service when none makes the date", () => {
		const slow = QUOTE.filter((r) => r.serviceId !== "sp-priority");
		expect(defaultRateId(slow, inDays(0), NOW)).toBe("sp-esaver");
	});

	it("falls back to the cheapest of all when only points remain", () => {
		expect(defaultRateId([QUOTE[0]], undefined, NOW)).toBe("pnp-p2p");
		expect(defaultRateId([], undefined, NOW)).toBeNull();
	});
});

describe("rateDateFit (F13)", () => {
	const oneToThree = { transit: { minDays: 1, maxDays: 3 } };

	it("says nothing without a date or a transit — no data is no claim", () => {
		expect(rateDateFit(oneToThree, undefined, NOW)).toBeUndefined();
		expect(rateDateFit({ transit: undefined }, inDays(1), NOW)).toBeUndefined();
	});

	it("maybe-late when only the slow end misses; late when even the fastest does", () => {
		expect(rateDateFit(oneToThree, inDays(2), NOW)).toBe("maybe_late");
		expect(rateDateFit(oneToThree, inDays(0), NOW)).toBe("late");
		expect(rateDateFit(oneToThree, inDays(3), NOW)).toBeUndefined();
	});
});

describe("door vs point filter (F10)", () => {
	it("counts and splits a mixed quote; an unknown destination reads as door", () => {
		const unknown = rate("x", "Mystery Courier", 999);
		expect(unknown.deliversTo).toBeUndefined();
		const all = [...QUOTE, unknown];
		expect(rateFilterCounts(all)).toEqual({ door: 6, point: 1 });
		expect(filterRates(all, "point").map((r) => r.serviceId)).toEqual([
			"pnp-p2p",
		]);
		expect(filterRates(all, "door")).toHaveLength(6);
	});
});
