/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	DELIVERY_BANDS_MAX,
	DELIVERY_FEE_MAX,
	DELIVERY_ZONES_MAX,
	type DeliveryConfig,
	haversineKm,
	resolveDeliveryQuote,
	sanitizeDeliveryConfig,
	summarizeCartWeight,
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

// --- Weight/zone mode (86eyeea1n) -------------------------------------------

const WEIGHT_ARRANGE: DeliveryConfig = {
	mode: "weight",
	zones: [
		{
			name: "West Malaysia",
			states: ["Selangor", "WP Kuala Lumpur", "Johor"],
			bands: [
				{ maxKg: 3, fee: 800 },
				{ maxKg: 10, fee: 2000 },
			],
		},
		{
			name: "East Malaysia",
			states: ["Sabah", "Sarawak"],
			bands: [{ maxKg: 5, fee: 6600 }],
			freeAbove: 30000,
		},
	],
	onOutOfBands: "arrange",
	onUnpriceable: "arrange",
};
const WEIGHT_BLOCK: DeliveryConfig = {
	...WEIGHT_ARRANGE,
	onOutOfBands: "block",
	onUnpriceable: "block",
};
const OK_2KG = { kind: "ok", grams: 2000 } as const;

describe("summarizeCartWeight", () => {
	test("sums grams × quantity across lines", () => {
		expect(
			summarizeCartWeight([
				{ parcelWeightG: 500, quantity: 2 },
				{ parcelWeightG: 1000, quantity: 1 },
			]),
		).toEqual({ kind: "ok", grams: 2000 });
	});

	test("one weightless non-custom line makes the WHOLE cart unpriceable", () => {
		expect(
			summarizeCartWeight([
				{ parcelWeightG: 500, quantity: 2 },
				{ parcelWeightG: 0, quantity: 1 },
			]),
		).toEqual({ kind: "missing_weights" });
	});

	test("a custom line wins over missing weights (the by-design reason)", () => {
		expect(
			summarizeCartWeight([
				{ parcelWeightG: 0, quantity: 1 },
				{ parcelWeightG: 0, quantity: 1, isCustom: true },
			]),
		).toEqual({ kind: "custom_item" });
	});

	test("an empty cart is unpriceable, and a negative quantity can't shrink the sum", () => {
		expect(summarizeCartWeight([])).toEqual({ kind: "missing_weights" });
		expect(
			summarizeCartWeight([
				{ parcelWeightG: 500, quantity: 2 },
				{ parcelWeightG: 800, quantity: -3 },
			]),
		).toEqual({ kind: "ok", grams: 1000 });
	});
});

describe("resolveDeliveryQuote — weight mode", () => {
	test("state picks the zone; weight picks the band; audit fields frozen", () => {
		const quote = resolveDeliveryQuote({
			config: WEIGHT_ARRANGE,
			subtotal: 12000,
			origin: undefined,
			destination: undefined,
			state: "Selangor",
			cartWeight: { kind: "ok", grams: 2500 },
		});
		expect(quote).toEqual({
			kind: "fee",
			fee: 800,
			mode: "weight",
			zoneName: "West Malaysia",
			chargeableKg: 2.5,
			bandMaxKg: 3,
		});
	});

	test("prices with NO coordinates at all — a manual address's state is enough", () => {
		const quote = resolveDeliveryQuote({
			config: WEIGHT_ARRANGE,
			subtotal: 12000,
			origin: undefined,
			destination: undefined,
			state: "Sarawak",
			cartWeight: OK_2KG,
		});
		expect(quote.kind === "fee" && quote.fee).toBe(6600);
	});

	test("band bound is inclusive, compared in exact grams (no float noise)", () => {
		const config: DeliveryConfig = {
			...WEIGHT_ARRANGE,
			zones: [
				{
					name: "West",
					states: ["Selangor"],
					bands: [
						{ maxKg: 3.1, fee: 800 },
						{ maxKg: 10, fee: 2000 },
					],
				},
			],
		};
		const onBound = resolveDeliveryQuote({
			config,
			subtotal: 12000,
			origin: undefined,
			destination: undefined,
			state: "Selangor",
			cartWeight: { kind: "ok", grams: 3100 },
		});
		expect(onBound.kind === "fee" && onBound.fee).toBe(800);
		const over = resolveDeliveryQuote({
			config,
			subtotal: 12000,
			origin: undefined,
			destination: undefined,
			state: "Selangor",
			cartWeight: { kind: "ok", grams: 3101 },
		});
		expect(over.kind === "fee" && over.fee).toBe(2000);
	});

	test("heavier than the last band follows onOutOfBands", () => {
		const heavy = { kind: "ok", grams: 11_000 } as const;
		expect(
			resolveDeliveryQuote({
				config: WEIGHT_ARRANGE,
				subtotal: 12000,
				origin: undefined,
				destination: undefined,
				state: "Selangor",
				cartWeight: heavy,
			}),
		).toEqual({ kind: "pending", reason: "over_bands" });
		expect(
			resolveDeliveryQuote({
				config: WEIGHT_BLOCK,
				subtotal: 12000,
				origin: undefined,
				destination: undefined,
				state: "Selangor",
				cartWeight: heavy,
			}),
		).toEqual({ kind: "blocked", reason: "over_bands" });
	});

	test("a state in no zone follows onOutOfBands (unserved_state)", () => {
		expect(
			resolveDeliveryQuote({
				config: WEIGHT_ARRANGE,
				subtotal: 12000,
				origin: undefined,
				destination: undefined,
				state: "Kelantan",
				cartWeight: OK_2KG,
			}),
		).toEqual({ kind: "pending", reason: "unserved_state" });
		expect(
			resolveDeliveryQuote({
				config: WEIGHT_BLOCK,
				subtotal: 12000,
				origin: undefined,
				destination: undefined,
				state: "Kelantan",
				cartWeight: OK_2KG,
			}),
		).toEqual({ kind: "blocked", reason: "unserved_state" });
	});

	test("no state yet (quote preview) follows onUnpriceable (no_state)", () => {
		expect(
			resolveDeliveryQuote({
				config: WEIGHT_ARRANGE,
				subtotal: 12000,
				origin: undefined,
				destination: undefined,
				cartWeight: OK_2KG,
			}),
		).toEqual({ kind: "pending", reason: "no_state" });
		expect(
			resolveDeliveryQuote({
				config: WEIGHT_BLOCK,
				subtotal: 12000,
				origin: undefined,
				destination: undefined,
				cartWeight: OK_2KG,
			}),
		).toEqual({ kind: "blocked", reason: "no_state" });
	});

	test("missing weights / custom lines follow onUnpriceable with their own reasons", () => {
		expect(
			resolveDeliveryQuote({
				config: WEIGHT_ARRANGE,
				subtotal: 12000,
				origin: undefined,
				destination: undefined,
				state: "Selangor",
				cartWeight: { kind: "missing_weights" },
			}),
		).toEqual({ kind: "pending", reason: "missing_weights" });
		expect(
			resolveDeliveryQuote({
				config: WEIGHT_BLOCK,
				subtotal: 12000,
				origin: undefined,
				destination: undefined,
				state: "Selangor",
				cartWeight: { kind: "custom_item" },
			}),
		).toEqual({ kind: "blocked", reason: "custom_item" });
		// A caller that passed no cart at all reads as missing weights, never a
		// silent free ride.
		expect(
			resolveDeliveryQuote({
				config: WEIGHT_BLOCK,
				subtotal: 12000,
				origin: undefined,
				destination: undefined,
				state: "Selangor",
			}),
		).toEqual({ kind: "blocked", reason: "missing_weights" });
	});

	test("per-zone freeAbove is inclusive and UNCONDITIONAL — waives overweight and unweighable carts", () => {
		const at = resolveDeliveryQuote({
			config: WEIGHT_ARRANGE,
			subtotal: 30000,
			origin: undefined,
			destination: undefined,
			state: "Sabah",
			cartWeight: OK_2KG,
		});
		expect(at).toEqual({ kind: "free", reason: "threshold" });
		// Overweight but above the threshold → still free (the promise is
		// unconditional; settings copy says so).
		const heavyButFree = resolveDeliveryQuote({
			config: WEIGHT_ARRANGE,
			subtotal: 30000,
			origin: undefined,
			destination: undefined,
			state: "Sabah",
			cartWeight: { kind: "ok", grams: 99_000 },
		});
		expect(heavyButFree).toEqual({ kind: "free", reason: "threshold" });
		const unweighableButFree = resolveDeliveryQuote({
			config: WEIGHT_BLOCK,
			subtotal: 30000,
			origin: undefined,
			destination: undefined,
			state: "Sabah",
			cartWeight: { kind: "missing_weights" },
		});
		expect(unweighableButFree).toEqual({ kind: "free", reason: "threshold" });
		// Below the threshold the zone's bands rule as usual.
		const below = resolveDeliveryQuote({
			config: WEIGHT_ARRANGE,
			subtotal: 29999,
			origin: undefined,
			destination: undefined,
			state: "Sabah",
			cartWeight: OK_2KG,
		});
		expect(below.kind === "fee" && below.fee).toBe(6600);
	});

	test("freeAbove never applies to an UNSERVED state (zones declare coverage first)", () => {
		expect(
			resolveDeliveryQuote({
				config: WEIGHT_ARRANGE,
				subtotal: 999_999,
				origin: undefined,
				destination: undefined,
				state: "Kelantan",
				cartWeight: OK_2KG,
			}),
		).toEqual({ kind: "pending", reason: "unserved_state" });
	});

	test("a zero-fee band resolves FREE (one spelling of free)", () => {
		const config: DeliveryConfig = {
			...WEIGHT_ARRANGE,
			zones: [
				{
					name: "Local",
					states: ["Selangor"],
					bands: [
						{ maxKg: 2, fee: 0 },
						{ maxKg: 10, fee: 2000 },
					],
				},
			],
		};
		expect(
			resolveDeliveryQuote({
				config,
				subtotal: 12000,
				origin: undefined,
				destination: undefined,
				state: "Selangor",
				cartWeight: OK_2KG,
			}),
		).toEqual({ kind: "free" });
	});
});

describe("sanitizeDeliveryConfig — weight mode", () => {
	const zone = (
		over: Partial<{
			name: string;
			states: string[];
			bands: { maxKg: number; fee: number }[];
			freeAbove: number;
		}> = {},
	) => ({
		name: "West",
		states: ["Selangor"],
		bands: [{ maxKg: 5, fee: 800 }],
		...over,
	});

	test("valid config passes through with bands sorted and kg rounded to 1dp", () => {
		const clean = sanitizeDeliveryConfig({
			mode: "weight",
			zones: [
				{
					name: "  West Malaysia ",
					states: ["Selangor", "Selangor", "Johor"],
					bands: [
						{ maxKg: 10, fee: 2000 },
						{ maxKg: 3.04, fee: 800 },
					],
					freeAbove: 15000,
				},
			],
			onOutOfBands: "arrange",
			onUnpriceable: "block",
		});
		expect(clean).toEqual({
			mode: "weight",
			zones: [
				{
					name: "West Malaysia",
					// Repeated state silently deduped (harmless), order preserved.
					states: ["Selangor", "Johor"],
					bands: [
						{ maxKg: 3, fee: 800 },
						{ maxKg: 10, fee: 2000 },
					],
					freeAbove: 15000,
				},
			],
			onOutOfBands: "arrange",
			onUnpriceable: "block",
		});
	});

	test("a state may live in only ONE zone", () => {
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "weight",
				zones: [
					zone({ name: "West", states: ["Selangor", "Johor"] }),
					zone({ name: "South", states: ["Johor"] }),
				],
				onOutOfBands: "arrange",
				onUnpriceable: "arrange",
			}),
		).toThrow(/one zone/);
	});

	test("zone names must be present and unique (case-insensitive)", () => {
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "weight",
				zones: [zone({ name: "  " })],
				onOutOfBands: "arrange",
				onUnpriceable: "arrange",
			}),
		).toThrow(/needs a name/);
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "weight",
				zones: [
					zone({ name: "West" }),
					zone({ name: "west", states: ["Johor"] }),
				],
				onOutOfBands: "arrange",
				onUnpriceable: "arrange",
			}),
		).toThrow(/both named/);
	});

	test("unknown states, empty zones and empty band lists are rejected", () => {
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "weight",
				zones: [zone({ states: ["Singapore"] })],
				onOutOfBands: "arrange",
				onUnpriceable: "arrange",
			}),
		).toThrow(/Unknown state/);
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "weight",
				zones: [zone({ states: [] })],
				onOutOfBands: "arrange",
				onUnpriceable: "arrange",
			}),
		).toThrow(/at least one state/);
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "weight",
				zones: [zone({ bands: [] })],
				onOutOfBands: "arrange",
				onUnpriceable: "arrange",
			}),
		).toThrow(/at least one weight band/);
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "weight",
				zones: [],
				onOutOfBands: "arrange",
				onUnpriceable: "arrange",
			}),
		).toThrow(/at least one delivery zone/);
	});

	test("band bounds: >0, ≤ cap, no duplicates after 1dp rounding; caps on zones", () => {
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "weight",
				zones: [zone({ bands: [{ maxKg: 0, fee: 100 }] })],
				onOutOfBands: "arrange",
				onUnpriceable: "arrange",
			}),
		).toThrow(/greater than 0/);
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "weight",
				zones: [
					zone({
						bands: [
							{ maxKg: 5.01, fee: 100 },
							{ maxKg: 5.04, fee: 200 },
						],
					}),
				],
				onOutOfBands: "arrange",
				onUnpriceable: "arrange",
			}),
		).toThrow(/same weight/);
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "weight",
				zones: Array.from({ length: DELIVERY_ZONES_MAX + 1 }, (_, i) =>
					zone({ name: `Zone ${i}`, states: [] }),
				),
				onOutOfBands: "arrange",
				onUnpriceable: "arrange",
			}),
		).toThrow(/At most/);
	});

	test("per-zone freeAbove bounds mirror the flat threshold rules", () => {
		expect(() =>
			sanitizeDeliveryConfig({
				mode: "weight",
				zones: [zone({ freeAbove: 0 })],
				onOutOfBands: "arrange",
				onUnpriceable: "arrange",
			}),
		).toThrow(/positive/);
	});
});
