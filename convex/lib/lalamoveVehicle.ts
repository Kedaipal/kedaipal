/**
 * Which Lalamove vehicle can actually carry this cart (25 Oct 2026).
 *
 * Lalamove prices by VEHICLE and distance, never by weight: the quotation's
 * optional `item.weight` exists only in Thailand, Vietnam and Hong Kong, and
 * there is no "overweight" refusal. So a store whose rider setting is
 * MOTORCYCLE was quoted a motorcycle for a 25 kg cart — a price for a trip
 * the rider can't make, which the seller found out at pickup and absorbed
 * when they rebooked a car.
 *
 * The limits are Lalamove's own, read from `GET /v3/cities` per market
 * (`services[].load`), never hardcoded: third-party guides disagree (a
 * Malaysian motorcycle is listed anywhere from 8 to 10 kg, a car from 20 to
 * 40 kg) and Lalamove changes them. A market lists several cities; the
 * SMALLEST load a vehicle has in any of them is the one used, because the
 * store's city isn't known in Lalamove's terms and quoting a car a cart the
 * motorcycle could have taken costs the buyer a little, while the reverse
 * strands the order.
 *
 * Pure — the rule is testable without a network or a database.
 */

import type { LalamoveVehicleType } from "./lalamove";

/** One vehicle's carrying limit in a market, in kilograms. */
export type VehicleLoad = { key: string; loadKg: number };

/** The vehicles a rider quote may use, smallest first. Only the two Kedaipal
 * surfaces (settings, the dispatch switch) — escalation never picks a
 * vehicle the seller can't see or book from the order. */
export const RIDER_VEHICLE_LADDER: readonly LalamoveVehicleType[] = [
	"MOTORCYCLE",
	"CAR",
];

/** How long a market's loads are trusted before a background refresh. */
export const VEHICLE_LOADS_TTL_MS = 24 * 60 * 60 * 1000;

const UNIT_TO_KG: Record<string, number> = { kg: 1, g: 0.001 };

/**
 * `GET /v3/cities` → the smallest load per vehicle key across the market's
 * cities. A list of pairs, never an object keyed by the vehicle name (the
 * house rule: no Convex value keyed by text we don't own). Entries with no
 * load, a unit we can't convert, or a non-positive value are skipped — an
 * unknown limit is "can't say", never zero.
 */
export function parseVehicleLoads(json: unknown): VehicleLoad[] {
	const cities = (json as { data?: unknown })?.data;
	if (!Array.isArray(cities)) return [];
	const min = new Map<string, number>();
	for (const city of cities) {
		const services = (city as { services?: unknown })?.services;
		if (!Array.isArray(services)) continue;
		for (const service of services) {
			const s = service as {
				key?: unknown;
				load?: { value?: unknown; unit?: unknown };
			};
			if (typeof s.key !== "string" || !s.key) continue;
			const value = Number(s.load?.value);
			const unit =
				typeof s.load?.unit === "string" ? s.load.unit.toLowerCase() : "";
			const factor = UNIT_TO_KG[unit];
			if (!factor || !Number.isFinite(value) || value <= 0) continue;
			const kg = value * factor;
			const prev = min.get(s.key);
			if (prev === undefined || kg < prev) min.set(s.key, kg);
		}
	}
	return [...min.entries()]
		.map(([key, loadKg]) => ({ key, loadKg }))
		.sort((a, b) => a.key.localeCompare(b.key));
}

export function loadOf(
	loads: readonly VehicleLoad[] | null,
	key: string,
): number | undefined {
	return loads?.find((l) => l.key === key)?.loadKg;
}

export type RiderVehicleChoice =
	| {
			kind: "fits";
			vehicle: LalamoveVehicleType;
			/** The seller's setting was too small and a bigger vehicle was
			 * picked — the dispatch card and the order say why. */
			escalatedFrom?: LalamoveVehicleType;
			/** The cart weight the choice was made on, kg. */
			cartKg?: number;
			/** The chosen vehicle's limit, when Lalamove published one. */
			loadKg?: number;
	  }
	| {
			/** Heavier than every vehicle on the ladder can carry. */
			kind: "too_heavy";
			cartKg: number;
			/** The biggest vehicle's limit — what the copy names. */
			maxKg: number;
	  };

/**
 * The smallest vehicle, starting from the seller's setting and only ever
 * going UP, that can carry `cartKg`. Never downgrades: a seller who set CAR
 * chose it for a reason we can't see.
 *
 * Fails OPEN everywhere it can't know: no cart weight, or no published load
 * for a vehicle, means that vehicle "fits" — the rule exists to stop a
 * motorcycle being quoted a cart it plainly can't carry, not to refuse
 * orders on missing data. An unweighed cart is priced at the one-kilo floor
 * upstream (`liveQuoteWeightKg`), so it never escalates.
 */
export function chooseRiderVehicle(args: {
	preferred: string;
	cartKg: number | null | undefined;
	loads: readonly VehicleLoad[] | null;
}): RiderVehicleChoice {
	const start = RIDER_VEHICLE_LADDER.indexOf(
		args.preferred as LalamoveVehicleType,
	);
	// An unknown setting (a market-only key) is quoted as set — we only
	// escalate along the ladder we own.
	if (start < 0)
		return {
			kind: "fits",
			vehicle: args.preferred as LalamoveVehicleType,
		};
	const preferred = RIDER_VEHICLE_LADDER[start];
	const cartKg = args.cartKg;
	if (cartKg === null || cartKg === undefined || !Number.isFinite(cartKg))
		return { kind: "fits", vehicle: preferred };
	for (const vehicle of RIDER_VEHICLE_LADDER.slice(start)) {
		const loadKg = loadOf(args.loads, vehicle);
		if (loadKg === undefined || cartKg <= loadKg) {
			return {
				kind: "fits",
				vehicle,
				escalatedFrom: vehicle === preferred ? undefined : preferred,
				cartKg,
				loadKg,
			};
		}
	}
	const biggest = RIDER_VEHICLE_LADDER[RIDER_VEHICLE_LADDER.length - 1];
	return {
		kind: "too_heavy",
		cartKg,
		maxKg: loadOf(args.loads, biggest) ?? 0,
	};
}

/** "10 kg" / "2.5 kg" — one spelling for every line of copy. */
export function formatKg(kg: number): string {
	const rounded = Math.round(kg * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} kg`;
}

/** "Motorcycle" / "Car" — the words the settings and dispatch already use. */
export function vehicleWord(vehicle: string): string {
	return vehicle === "CAR" ? "Car" : vehicle === "MOTORCYCLE" ? "Motorcycle" : vehicle;
}
