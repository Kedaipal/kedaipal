// Delivery-charge resolution — pure module, no Convex imports, so the fee math
// unit-tests in isolation (same posture as order.ts / fulfilmentDate.ts). See
// docs/fulfilment.md ("Delivery charge").
//
// Two seller-configurable fee modes (ClickUp 86extzdr8, radius spec from the
// 15 Jul 2026 Sue/Arif comment):
//  - "flat":   one fee per delivery order, optional free-above-threshold.
//  - "radius": distance bands from the seller's business address, priced by
//    STRAIGHT-LINE (haversine) distance to the buyer's address — no routing
//    API, one Google-autocomplete geocode per checkout (already captured).
//    Out-of-range orders are either blocked or allowed with the charge
//    "arranged via WhatsApp" (→ orders.deliveryFeePending).
//
// All money is in MINOR units (sen). Self-collect orders never reach this
// module — the fee applies to deliveryMethod === "delivery" only.

export type DeliveryBand = {
	/** Band upper bound in km, INCLUSIVE (distance == maxKm is inside). */
	maxKm: number;
	/** Fee for this band (sen). 0 = free within this band. */
	fee: number;
};

export type DeliveryConfig =
	| {
			mode: "flat";
			/** Fee per delivery order (sen). Always > 0 — "free delivery" is
			 * spelled as NO config, never a zero fee. */
			fee: number;
			/** Subtotal (sen) at or above which delivery is free. Boundary is
			 * inclusive: subtotal === freeAbove → free. */
			freeAbove?: number;
	  }
	| {
			mode: "radius";
			/** Ascending, non-overlapping bands (sanitizer sorts + dedupes). */
			bands: DeliveryBand[];
			/** What happens beyond the last band (or when the buyer's address has
			 * no coordinates): "block" refuses the order, "arrange" accepts it with
			 * the charge to be confirmed by the seller on WhatsApp. */
			outOfRange: "block" | "arrange";
	  };

export type Coordinates = { latitude: number; longitude: number };

/**
 * Resolution result. "free" carries an optional reason so the storefront can
 * celebrate an earned threshold ("FREE — order above RM100"). "pending" maps
 * to orders.deliveryFeePending (seller confirms the charge later); "blocked"
 * refuses checkout. `distanceKm`/`bandMaxKm` are for the ORDER SNAPSHOT and
 * seller surfaces only — the public quote strips them (see convex/delivery.ts).
 */
export type DeliveryQuote =
	| { kind: "free"; reason?: "threshold" }
	| {
			kind: "fee";
			fee: number;
			mode: "flat" | "radius";
			distanceKm?: number;
			bandMaxKm?: number;
	  }
	| { kind: "pending"; reason: "out_of_range" | "no_coords" }
	| { kind: "blocked"; reason: "out_of_range" | "no_coords" };

/** Fee ceiling (sen) — RM10,000, same sanity bound as the pickup fee. */
export const DELIVERY_FEE_MAX = 1_000_000;
/** Max radius bands per store — enough for any realistic zone table. */
export const DELIVERY_BANDS_MAX = 10;
/** Band radius ceiling (km) — generously covers domestic Malaysia. */
export const DELIVERY_BAND_KM_MAX = 3_000;
/** Free-above threshold ceiling (sen) — RM1,000,000; a typo guard, not policy. */
export const DELIVERY_FREE_ABOVE_MAX = 100_000_000;

const EARTH_RADIUS_KM = 6_371;

/** Great-circle (straight-line) distance in km between two WGS84 points. */
export function haversineKm(a: Coordinates, b: Coordinates): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(b.latitude - a.latitude);
	const dLng = toRad(b.longitude - a.longitude);
	const lat1 = toRad(a.latitude);
	const lat2 = toRad(b.latitude);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Resolve the delivery charge for one checkout. Single source of truth —
 * called by the public quote query (live checkout display), `orders.create`
 * (the authoritative snapshot), and the address re-price, so the number the
 * buyer sees is the number the order stores.
 *
 * Fail-open rule: a misconfigured radius store (config set but the business
 * address was somehow lost) resolves to FREE, never a blocked storefront —
 * "never block checkout on seller misconfig" (ticket edge case). Callers log.
 */
export function resolveDeliveryQuote(args: {
	config: DeliveryConfig | undefined;
	/** Order line-item subtotal (sen) — drives the flat free-above threshold. */
	subtotal: number;
	/** Seller's business address coordinates (radius mode origin). */
	origin: Coordinates | undefined;
	/** Buyer's delivery address coordinates — undefined when they typed a
	 * free-form address without picking a Google suggestion. */
	destination: Coordinates | undefined;
}): DeliveryQuote {
	const { config, subtotal, origin, destination } = args;
	if (!config) return { kind: "free" };

	if (config.mode === "flat") {
		if (config.freeAbove !== undefined && subtotal >= config.freeAbove) {
			return { kind: "free", reason: "threshold" };
		}
		return { kind: "fee", fee: config.fee, mode: "flat" };
	}

	// radius
	if (!origin) return { kind: "free" }; // misconfig — fail open, caller logs
	if (!destination) {
		return config.outOfRange === "block"
			? { kind: "blocked", reason: "no_coords" }
			: { kind: "pending", reason: "no_coords" };
	}
	const distanceKm = haversineKm(origin, destination);
	for (const band of config.bands) {
		if (distanceKm <= band.maxKm) {
			if (band.fee === 0) return { kind: "free" };
			return {
				kind: "fee",
				fee: band.fee,
				mode: "radius",
				// 2dp (~10m) is plenty for an audit trail and avoids storing
				// float noise on the order snapshot.
				distanceKm: Math.round(distanceKm * 100) / 100,
				bandMaxKm: band.maxKm,
			};
		}
	}
	return config.outOfRange === "block"
		? { kind: "blocked", reason: "out_of_range" }
		: { kind: "pending", reason: "out_of_range" };
}

function assertFeeSen(raw: number, label: string, min: number): number {
	if (!Number.isInteger(raw) || raw < min) {
		throw new Error(`${label} must be a whole, non-negative amount`);
	}
	if (raw > DELIVERY_FEE_MAX) {
		throw new Error(`${label} is unrealistically large — check the amount`);
	}
	return raw;
}

/**
 * Validate + normalize a seller-submitted delivery config. Throws plain
 * `Error` with a human message (callers wrap in ConvexError). Normalizations:
 * bands sorted ascending by maxKm; duplicate band bounds rejected (ambiguous).
 * "Free delivery" has exactly one spelling — a CLEARED config — so a flat fee
 * of 0 is rejected rather than stored.
 */
export function sanitizeDeliveryConfig(raw: DeliveryConfig): DeliveryConfig {
	if (raw.mode === "flat") {
		const fee = assertFeeSen(raw.fee, "Delivery fee", 1);
		let freeAbove: number | undefined;
		if (raw.freeAbove !== undefined) {
			if (!Number.isInteger(raw.freeAbove) || raw.freeAbove <= 0) {
				throw new Error("Free-delivery threshold must be a positive amount");
			}
			if (raw.freeAbove > DELIVERY_FREE_ABOVE_MAX) {
				throw new Error(
					"Free-delivery threshold is unrealistically large — check the amount",
				);
			}
			freeAbove = raw.freeAbove;
		}
		return { mode: "flat", fee, freeAbove };
	}

	if (raw.bands.length === 0) {
		throw new Error("Add at least one distance band");
	}
	if (raw.bands.length > DELIVERY_BANDS_MAX) {
		throw new Error(`At most ${DELIVERY_BANDS_MAX} distance bands`);
	}
	const bands = raw.bands
		.map((b) => {
			if (!Number.isFinite(b.maxKm) || b.maxKm <= 0) {
				throw new Error("Each band needs a distance greater than 0 km");
			}
			if (b.maxKm > DELIVERY_BAND_KM_MAX) {
				throw new Error(
					`Band distance can't exceed ${DELIVERY_BAND_KM_MAX} km`,
				);
			}
			return {
				// 1dp is the finest the settings UI offers; rounding here keeps
				// stored bounds stable however they arrive.
				maxKm: Math.round(b.maxKm * 10) / 10,
				fee: assertFeeSen(b.fee, "Band fee", 0),
			};
		})
		.sort((a, b) => a.maxKm - b.maxKm);
	for (let i = 1; i < bands.length; i++) {
		if (bands[i].maxKm === bands[i - 1].maxKm) {
			throw new Error("Two bands share the same distance — merge them");
		}
	}
	return { mode: "radius", bands, outOfRange: raw.outOfRange };
}
