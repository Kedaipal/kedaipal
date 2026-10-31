import { describe, expect, test } from "vitest";
import { storablePendingReason } from "./delivery";
import {
	chooseRiderVehicle,
	formatKg,
	parseVehicleLoads,
	type VehicleLoad,
} from "./lalamoveVehicle";

/**
 * Which Lalamove vehicle can carry the cart (25 Oct 2026). Lalamove prices by
 * vehicle, not weight, and never refuses an overweight trip — so a
 * motorcycle store was quoted a motorcycle for 25 kg.
 */

const MY: VehicleLoad[] = [
	{ key: "CAR", loadKg: 40 },
	{ key: "MOTORCYCLE", loadKg: 10 },
];

describe("parseVehicleLoads — Lalamove's own limits from GET /v3/cities", () => {
	test("takes the SMALLEST load per vehicle across the market's cities", () => {
		const json = {
			data: [
				{
					locode: "MY KUL",
					services: [
						{ key: "MOTORCYCLE", load: { value: "10", unit: "kg" } },
						{ key: "CAR", load: { value: "40", unit: "kg" } },
					],
				},
				{
					locode: "MY PEN",
					services: [
						{ key: "MOTORCYCLE", load: { value: "8", unit: "kg" } },
						{ key: "CAR", load: { value: "50", unit: "kg" } },
					],
				},
			],
		};
		expect(parseVehicleLoads(json)).toEqual([
			{ key: "CAR", loadKg: 40 },
			{ key: "MOTORCYCLE", loadKg: 8 },
		]);
	});

	test("converts grams, and skips what it can't read — unknown is never zero", () => {
		const json = {
			data: [
				{
					services: [
						{ key: "MOTORCYCLE", load: { value: "9000", unit: "g" } },
						{ key: "CAR" },
						{ key: "VAN", load: { value: "0", unit: "kg" } },
						{ key: "TRUCK", load: { value: "2", unit: "tonne" } },
						{ load: { value: "5", unit: "kg" } },
					],
				},
			],
		};
		expect(parseVehicleLoads(json)).toEqual([{ key: "MOTORCYCLE", loadKg: 9 }]);
	});

	test("a malformed body is no loads, not a throw", () => {
		expect(parseVehicleLoads(null)).toEqual([]);
		expect(parseVehicleLoads({ data: "nope" })).toEqual([]);
	});
});

describe("chooseRiderVehicle", () => {
	test("a cart the motorcycle can carry stays on the motorcycle", () => {
		expect(
			chooseRiderVehicle({ preferred: "MOTORCYCLE", cartKg: 10, loads: MY }),
		).toEqual({ kind: "fits", vehicle: "MOTORCYCLE", cartKg: 10, loadKg: 10 });
	});

	test("a cart over the motorcycle's load is quoted on a car, and says why", () => {
		expect(
			chooseRiderVehicle({ preferred: "MOTORCYCLE", cartKg: 25, loads: MY }),
		).toEqual({
			kind: "fits",
			vehicle: "CAR",
			escalatedFrom: "MOTORCYCLE",
			cartKg: 25,
			loadKg: 40,
		});
	});

	test("over the car's load too, no rider can take it", () => {
		expect(
			chooseRiderVehicle({ preferred: "MOTORCYCLE", cartKg: 41, loads: MY }),
		).toEqual({ kind: "too_heavy", cartKg: 41, maxKg: 40 });
	});

	test("never downgrades a seller who chose a car", () => {
		expect(
			chooseRiderVehicle({ preferred: "CAR", cartKg: 1, loads: MY }),
		).toMatchObject({ kind: "fits", vehicle: "CAR" });
		expect(
			chooseRiderVehicle({ preferred: "CAR", cartKg: 1, loads: MY }),
		).not.toHaveProperty("escalatedFrom", "MOTORCYCLE");
	});

	test("fails open on missing data — no weight, no loads, or an unpublished vehicle", () => {
		expect(
			chooseRiderVehicle({ preferred: "MOTORCYCLE", cartKg: null, loads: MY }),
		).toEqual({ kind: "fits", vehicle: "MOTORCYCLE" });
		expect(
			chooseRiderVehicle({ preferred: "MOTORCYCLE", cartKg: 500, loads: null }),
		).toMatchObject({ kind: "fits", vehicle: "MOTORCYCLE" });
		// Lalamove published a motorcycle limit but not a car one: the car is
		// "can't say", so it is quoted rather than refused.
		expect(
			chooseRiderVehicle({
				preferred: "MOTORCYCLE",
				cartKg: 25,
				loads: [{ key: "MOTORCYCLE", loadKg: 10 }],
			}),
		).toMatchObject({ kind: "fits", vehicle: "CAR", escalatedFrom: "MOTORCYCLE" });
	});

	test("an unweighed cart is quoted at the one-kilo floor upstream, so it never escalates", () => {
		expect(
			chooseRiderVehicle({ preferred: "MOTORCYCLE", cartKg: 1, loads: MY }),
		).toMatchObject({ kind: "fits", vehicle: "MOTORCYCLE" });
	});

	test("a vehicle key we don't surface is quoted as set", () => {
		expect(
			chooseRiderVehicle({ preferred: "VAN", cartKg: 900, loads: MY }),
		).toEqual({ kind: "fits", vehicle: "VAN" });
	});
});

test("formatKg", () => {
	expect(formatKg(10)).toBe("10 kg");
	expect(formatKg(2.45)).toBe("2.5 kg");
});

test("a too-heavy refusal can never be stored as a fee-pending order — it refuses checkout", () => {
	expect(storablePendingReason("too_heavy")).toBeUndefined();
	expect(storablePendingReason("no_cold_service")).toBeUndefined();
	expect(storablePendingReason("over_bands")).toBe("over_bands");
});
