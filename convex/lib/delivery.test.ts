/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	DELIVERY_BANDS_MAX,
	DELIVERY_FEE_MAX,
	type DeliveryConfig,
	haversineKm,
	resolveDeliveryQuote,
	sanitizeDeliveryConfig,
} from "./delivery";

// ~1 degree of latitude = 111.19 km on the R=6371 sphere — build test points
// by latitude offsets so distances are predictable to <0.1%.
const KM_PER_DEG_LAT = (6371 * Math.PI) / 180;
const ORIGIN = { latitude: 3.0, longitude: 101.5 };
function pointAtKm(km: number) {
	return { latitude: 3.0 + km / KM_PER_DEG_LAT, longitude: 101.5 };
}

const FLAT: DeliveryConfig = { mode: "flat", fee: 800, freeAbove: 10000 };
const RADIUS_ARRANGE: DeliveryConfig = {
	mode: "radius",
	bands: [
		{ maxKm: 5, fee: 500 },
		{ maxKm: 15, fee: 1500 },
	],
	outOfRange: "arrange",
};
const RADIUS_BLOCK: DeliveryConfig = { ...RADIUS_ARRANGE, outOfRange: "block" };

describe("haversineKm", () => {
	test("zero distance for identical points", () => {
		expect(haversineKm(ORIGIN, ORIGIN)).toBe(0);
	});

	test("1 degree of latitude ≈ 111.19 km", () => {
		const d = haversineKm(ORIGIN, { latitude: 4.0, longitude: 101.5 });
		expect(d).toBeGreaterThan(111);
		expect(d).toBeLessThan(111.4);
	});

	test("symmetric", () => {
		const a = ORIGIN;
		const b = { latitude: 3.2, longitude: 101.7 };
		expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
	});
});

describe("resolveDeliveryQuote", () => {
	test("no config → free (today's behaviour, zero change)", () => {
		expect(
			resolveDeliveryQuote({
				config: undefined,
				subtotal: 12000,
				origin: undefined,
				destination: undefined,
			}),
		).toEqual({ kind: "free" });
	});

	test("flat: fee below threshold; FREE at exactly the threshold (inclusive)", () => {
		const below = resolveDeliveryQuote({
			config: FLAT,
			subtotal: 9999,
			origin: undefined,
			destination: undefined,
		});
		expect(below).toEqual({ kind: "fee", fee: 800, mode: "flat" });
		// Boundary: subtotal exactly == freeAbove → free (ticket AC).
		const at = resolveDeliveryQuote({
			config: FLAT,
			subtotal: 10000,
			origin: undefined,
			destination: undefined,
		});
		expect(at).toEqual({ kind: "free", reason: "threshold" });
	});

	test("flat without a threshold always charges", () => {
		expect(
			resolveDeliveryQuote({
				config: { mode: "flat", fee: 800 },
				subtotal: 1_000_000,
				origin: undefined,
				destination: undefined,
			}),
		).toEqual({ kind: "fee", fee: 800, mode: "flat" });
	});

	test("radius: distance picks the band; band bound is inclusive", () => {
		const inFirst = resolveDeliveryQuote({
			config: RADIUS_ARRANGE,
			subtotal: 12000,
			origin: ORIGIN,
			destination: pointAtKm(4.9),
		});
		expect(inFirst.kind).toBe("fee");
		if (inFirst.kind === "fee") {
			expect(inFirst.fee).toBe(500);
			expect(inFirst.mode).toBe("radius");
			expect(inFirst.bandMaxKm).toBe(5);
			expect(inFirst.distanceKm).toBeCloseTo(4.9, 1);
		}

		const inSecond = resolveDeliveryQuote({
			config: RADIUS_ARRANGE,
			subtotal: 12000,
			origin: ORIGIN,
			destination: pointAtKm(11),
		});
		expect(inSecond.kind === "fee" && inSecond.fee).toBe(1500);

		// Exactly on a band bound → inside it (<= not <). Real coordinates never
		// land bit-exact on a round number, so pin the bound to the computed
		// haversine distance itself to exercise the equality branch.
		const dest = pointAtKm(5);
		const exact = haversineKm(ORIGIN, dest);
		const onBound = resolveDeliveryQuote({
			config: {
				mode: "radius",
				bands: [
					{ maxKm: exact, fee: 500 },
					{ maxKm: 15, fee: 1500 },
				],
				outOfRange: "block",
			},
			subtotal: 12000,
			origin: ORIGIN,
			destination: dest,
		});
		expect(onBound.kind === "fee" && onBound.fee).toBe(500);
	});

	test("radius: a zero-fee band resolves FREE (one spelling of free)", () => {
		const config: DeliveryConfig = {
			mode: "radius",
			bands: [
				{ maxKm: 3, fee: 0 },
				{ maxKm: 15, fee: 1000 },
			],
			outOfRange: "block",
		};
		expect(
			resolveDeliveryQuote({
				config,
				subtotal: 12000,
				origin: ORIGIN,
				destination: pointAtKm(2),
			}),
		).toEqual({ kind: "free" });
	});

	test("radius out of range: arrange → pending, block → blocked", () => {
		const far = pointAtKm(50);
		expect(
			resolveDeliveryQuote({
				config: RADIUS_ARRANGE,
				subtotal: 12000,
				origin: ORIGIN,
				destination: far,
			}),
		).toEqual({ kind: "pending", reason: "out_of_range" });
		expect(
			resolveDeliveryQuote({
				config: RADIUS_BLOCK,
				subtotal: 12000,
				origin: ORIGIN,
				destination: far,
			}),
		).toEqual({ kind: "blocked", reason: "out_of_range" });
	});

	test("radius with no buyer coordinates follows the out-of-range policy", () => {
		expect(
			resolveDeliveryQuote({
				config: RADIUS_ARRANGE,
				subtotal: 12000,
				origin: ORIGIN,
				destination: undefined,
			}),
		).toEqual({ kind: "pending", reason: "no_coords" });
		expect(
			resolveDeliveryQuote({
				config: RADIUS_BLOCK,
				subtotal: 12000,
				origin: ORIGIN,
				destination: undefined,
			}),
		).toEqual({ kind: "blocked", reason: "no_coords" });
	});

	test("radius with a missing origin FAILS OPEN to free (never blocks checkout)", () => {
		expect(
			resolveDeliveryQuote({
				config: RADIUS_BLOCK,
				subtotal: 12000,
				origin: undefined,
				destination: pointAtKm(2),
			}),
		).toEqual({ kind: "free" });
	});
});

describe("sanitizeDeliveryConfig", () => {
	test("flat: positive integer fee required; 0 is rejected (free = no config)", () => {
		expect(sanitizeDeliveryConfig({ mode: "flat", fee: 800 })).toEqual({
			mode: "flat",
			fee: 800,
			freeAbove: undefined,
		});
		expect(() => sanitizeDeliveryConfig({ mode: "flat", fee: 0 })).toThrow();
		expect(() => sanitizeDeliveryConfig({ mode: "flat", fee: 8.5 })).toThrow();
		expect(() =>
			sanitizeDeliveryConfig({ mode: "flat", fee: DELIVERY_FEE_MAX + 1 }),
		).toThrow(/large/);
		expect(() =>
			sanitizeDeliveryConfig({ mode: "flat", fee: 800, freeAbove: 0 }),
		).toThrow(/threshold/);
	});

	test("radius: bands are sorted ascending; duplicates and empties are rejected", () => {
		const clean = sanitizeDeliveryConfig({
			mode: "radius",
			bands: [
				{ maxKm: 15, fee: 1500 },
				{ maxKm: 5, fee: 500 },
			],
			outOfRange: "arrange",
		});
		expect(clean.mode === "radius" && clean.bands.map((b) => b.maxKm)).toEqual([
			5, 15,
		]);
		expect(() =>
			sanitizeDeliveryConfig({ mode: "radius", bands: [], outOfRange: "block" }),
		).toThrow(/at least one/);
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "radius",
				bands: [
					{ maxKm: 5, fee: 500 },
					{ maxKm: 5, fee: 900 },
				],
				outOfRange: "block",
			}),
		).toThrow(/same distance/);
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "radius",
				bands: Array.from({ length: DELIVERY_BANDS_MAX + 1 }, (_, i) => ({
					maxKm: i + 1,
					fee: 100,
				})),
				outOfRange: "block",
			}),
		).toThrow(/At most/);
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "radius",
				bands: [{ maxKm: 0, fee: 100 }],
				outOfRange: "block",
			}),
		).toThrow(/greater than 0/);
	});

	test("radius: band fee of 0 is allowed (free inner zone); km rounds to 1dp", () => {
		const clean = sanitizeDeliveryConfig({
			mode: "radius",
			bands: [{ maxKm: 5.04, fee: 0 }],
			outOfRange: "arrange",
		});
		expect(clean.mode === "radius" && clean.bands[0]).toEqual({
			maxKm: 5,
			fee: 0,
		});
	});
});
