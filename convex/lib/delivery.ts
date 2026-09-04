// Delivery-charge resolution — pure module, no Convex imports, so the fee math
// unit-tests in isolation (same posture as order.ts / fulfilmentDate.ts). See
// docs/fulfilment.md ("Delivery charge").
//
// Seller-configurable fee modes (ClickUp 86extzdr8; radius spec from the
// 15 Jul 2026 Sue/Arif comment; weight/zone from 86eyeea1n):
//  - "flat":   one fee per delivery order, optional free-above-threshold.
//  - "radius": distance bands from the seller's business address, priced by
//    STRAIGHT-LINE (haversine) distance to the buyer's address — no routing
//    API, one Google-autocomplete geocode per checkout (already captured).
//    Out-of-range orders are either blocked or allowed with the charge
//    "arranged via WhatsApp" (→ orders.deliveryFeePending).
//  - "weight": the seller's parcel-courier rate card — named zones of Malaysian
//    states, each with ascending weight bands (band maxKg ≈ the courier's box
//    tier) and an optional per-zone free-above threshold. Priced from the
//    buyer's address STATE (already canonical on every delivery address) and
//    the cart's summed variant parcel weight — no coordinates required, so
//    manually-typed addresses price fine. Rates use actual weight only
//    (volumetric weight is out of scope; settings copy says so).
//
// All money is in MINOR units (sen). Self-collect orders never reach this
// module — the fee applies to deliveryMethod === "delivery" only.

import { MY_STATES } from "./address";
import type { Country } from "./country";

export type DeliveryBand = {
	/** Band upper bound in km, INCLUSIVE (distance == maxKm is inside). */
	maxKm: number;
	/** Fee for this band (sen). 0 = free within this band. */
	fee: number;
};

export type WeightBand = {
	/** Band upper bound in kg, INCLUSIVE (chargeable weight == maxKg is inside).
	 * Mirrors the courier's box tiers ("up to 5 kg = RM30"). */
	maxKg: number;
	/** Fee for this band (sen). 0 = free within this band. */
	fee: number;
};

export type DeliveryZone = {
	/** Seller-facing zone label ("West Malaysia") — frozen onto the order
	 * snapshot as the pricing audit trail. */
	name: string;
	/** Canonical MY_STATES values (convex/lib/address.ts). A state may live in
	 * at most ONE zone (sanitizer enforces); states in no zone are unserved. */
	states: string[];
	/** Ascending weight bands (sanitizer sorts + rejects duplicate bounds). */
	bands: WeightBand[];
	/** Subtotal (sen) at or above which delivery to this zone is free —
	 * "free shipping above RM150 to West MY" (86eyeea1n comment, the
	 * marketplace-parity lever). Checked BEFORE weight, so an earned threshold
	 * waives the fee even when the cart's weight is unknowable or beyond the
	 * bands — the promise is unconditional (settings copy says so). */
	freeAbove?: number;
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
	  }
	| {
			mode: "weight";
			/** ≥1 zone; a state appears in at most one zone. */
			zones: DeliveryZone[];
			/** Outside the rate card GEOGRAPHICALLY or PHYSICALLY — the buyer's
			 * state is in no zone, or the cart outweighs the zone's last band:
			 * "block" refuses the order, "arrange" accepts it with the charge to
			 * be confirmed by the seller on WhatsApp (→ orders.deliveryFeePending). */
			onOutOfBands: "block" | "arrange";
			/** The cart's weight can't be KNOWN — a non-custom item has no parcel
			 * weight set (seller config gap), or the cart holds a custom /
			 * price-on-quote line (weight unknowable by design, priced with the
			 * seller's quote). Same block/arrange semantics. */
			onUnpriceable: "block" | "arrange";
	  }
	| {
			mode: "lalamove";
			/** VESTIGIAL (27 Jul 2026, Zaki): lalamove mode now ALWAYS refuses an
			 * order without a live quote — a seller who picked Lalamove must never
			 * be handed fee homework, and the buyer must always see the real rider
			 * price before sending. The field stays so stored rows validate;
			 * `sanitizeDeliveryConfig` normalizes it to "block" on save and the
			 * resolver ignores it. */
			onUnquotable: "arrange" | "block";
	  };

/**
 * Delivery pricing modes a store COUNTRY may use (SG-lite, 86eynw29u).
 * "Free" is spelled as no config, so it's implicitly allowed everywhere.
 * SG stores are flat-fee-only for now: radius/weight zone geography and the
 * Lalamove integration (whose market gate is COUNTRY_RIDER_BOOKING) are all
 * Malaysia-shaped today, so
 * storing one of those modes on an SG store would strand every order as
 * fee-pending or block checkout outright. One author for three enforcement
 * points: `retailers.updateSettings` (the write gate), `orders.create`'s
 * resolver and the public `delivery.quote` (belt-and-braces read guards).
 */
export const COUNTRY_DELIVERY_MODES: Record<
	Country,
	ReadonlyArray<DeliveryConfig["mode"]>
> = {
	MY: ["flat", "radius", "weight", "lalamove"],
	SG: ["flat"],
};

export function deliveryModeAllowed(
	country: Country,
	mode: DeliveryConfig["mode"],
): boolean {
	return COUNTRY_DELIVERY_MODES[country].includes(mode);
}

/**
 * Whether a store COUNTRY may run Lalamove RIDER BOOKING (`deliveryBooking`).
 *
 * Deliberately its own table rather than derived from `COUNTRY_DELIVERY_MODES`,
 * because pricing and booking are independent by design (a flat-fee store can
 * still dispatch riders — the `pricing ⊥ booking` rule). Derive one from the
 * other and the next country's decision gets made silently by a mode list.
 *
 * SG went TRUE with z8r3fdch3r. The blockers were ours, and each was closed
 * with evidence, not hope: the Market header now follows the store
 * (`lalamoveMarketForCountry`), `toLalamoveContactPhone` accepts each
 * market's own numbers, SGD's one-decimal amounts already parse correctly,
 * SG shares UTC+8 so the MYT helpers hold, and our two hardcoded
 * serviceTypes (MOTORCYCLE, CAR) appear verbatim in Lalamove's own published
 * SG catalogue (developers.lalamove.com specialRequests SG sheet — SG's full
 * set is MOTORCYCLE/CAR/MINIVAN/MPV/VAN/TRUCK330/TRUCK550). What remains
 * unproven is only a live end-to-end run on an SG key, and every failure on
 * that path already surfaces with named reasons rather than dead ends.
 *
 * It is enforced in a different place from the mode list: the
 * country-switch guard in `retailers.updateSettings`. Without it an MY store on
 * FLAT pricing with booking on switched to SG cleanly and kept Book-a-rider and
 * prompt-book-on-packed armed, so every quote failed at the point of spend
 * (the 86eypncfy lesson: a broken Lalamove state must be visible BEFORE a
 * seller reaches for it, never after).
 */
export const COUNTRY_RIDER_BOOKING: Record<Country, boolean> = {
	MY: true,
	SG: true,
};

export function riderBookingAllowed(country: Country): boolean {
	return COUNTRY_RIDER_BOOKING[country];
}

/**
 * Whether a store COUNTRY may connect Delyva courier booking (86eyjpv6z).
 * Its own table for the same reason as COUNTRY_RIDER_BOOKING above — booking
 * capabilities are decided per provider, never derived from a pricing-mode
 * list. Note this is the one place the two providers DISAGREE: Lalamove is
 * MY-only, Delyva serves both, and deriving either from the other would have
 * made that impossible to express.
 */
export const COUNTRY_DELYVA_BOOKING: Record<Country, boolean> = {
	MY: true,
	// SG is supported because the API takes SG addresses unchanged — verified
	// 2 Sep 2026: a country:"SG" quote with a 6-digit postal code returns a
	// well-formed 200.
	//
	// It is NOT, however, "the only courier automation an SG store can have" —
	// the original justification here, now known to be wrong on both halves
	// (corrected 4 Sep):
	//   · Lalamove DOES serve Singapore (Market: "SG"); our own
	//     COUNTRY_RIDER_BOOKING.SG gate is what hides it, not their coverage.
	//     Un-hardcoding the MY market is ticket z8r3fdch3r — and since Lalamove
	//     is intra-city and in Singapore the city IS the country, it would
	//     cover every SG→SG delivery.
	//   · Delyva SG is bring-your-own-courier in practice: the tenant is real
	//     (sg.delyva.app, +65) but ships an EMPTY service catalogue, there is
	//     no SG sandbox, and delyva.com/sg now redirects away. An SG store can
	//     connect it and quote nothing.
	// So this stays true — it costs nothing and works for a seller who brings
	// their own courier — but no SG launch should depend on it.
	SG: true,
};

export function delyvaBookingAllowed(country: Country): boolean {
	return COUNTRY_DELYVA_BOOKING[country];
}

/**
 * Human names for the pricing modes, for copy that has to tell a seller which
 * one is in their way (the country card's blocked-switch explanation). Lives
 * beside the allowlist so the rule and its wording can't drift apart.
 */
export const DELIVERY_MODE_LABELS: Record<DeliveryConfig["mode"], string> = {
	flat: "flat fee",
	radius: "distance-based",
	weight: "weight-zone",
	lalamove: "Lalamove live-quote",
};

export type Coordinates = { latitude: number; longitude: number };

/**
 * Why a quote resolved "pending" (fee to be confirmed by the seller) or
 * "blocked" (checkout refused). The first three are the radius/lalamove
 * causes; the rest are weight-mode's (86eyeea1n):
 *  - "no_state":        no delivery state yet — quote-preview before the buyer
 *                       has entered an address (an order always has a state).
 *  - "unserved_state":  the buyer's state is in none of the seller's zones.
 *  - "over_bands":      the cart outweighs the zone's heaviest band.
 *  - "missing_weights": a non-custom cart item has no parcel weight set.
 *  - "custom_item":     the cart holds a custom / price-on-quote line, so its
 *                       weight is unknowable by design.
 */
export type DeliveryQuoteReason =
	| "out_of_range"
	| "no_coords"
	| "unquotable"
	| "no_state"
	| "unserved_state"
	| "over_bands"
	| "missing_weights"
	| "custom_item";

/**
 * Resolution result. "free" carries an optional reason so the storefront can
 * celebrate an earned threshold ("FREE — order above RM100"). "pending" maps
 * to orders.deliveryFeePending (seller confirms the charge later); "blocked"
 * refuses checkout. `distanceKm`/`bandMaxKm` (radius) and
 * `zoneName`/`chargeableKg`/`bandMaxKg` (weight) are for the ORDER SNAPSHOT and
 * seller surfaces only — the public quote strips them (see convex/delivery.ts).
 */
export type DeliveryQuote =
	| { kind: "free"; reason?: "threshold" }
	| {
			kind: "fee";
			fee: number;
			mode: "flat" | "radius" | "weight" | "lalamove";
			distanceKm?: number;
			bandMaxKm?: number;
			/** Weight-mode audit trail (mode "weight" only). */
			zoneName?: string;
			chargeableKg?: number;
			bandMaxKg?: number;
			/** Provider-quote audit trail (mode "lalamove" only) — frozen onto the
			 * order snapshot; dispatch always re-quotes, so never a booking input. */
			quotationId?: string;
			vehicleType?: string;
			quotedAt?: number;
	  }
	| { kind: "pending"; reason: DeliveryQuoteReason }
	| { kind: "blocked"; reason: DeliveryQuoteReason };

/** A live Lalamove quote already fetched (and server-recorded) by the checkout
 * action — resolveDeliveryQuote only TRUSTS it, it never fetches. */
export type LiveProviderQuote = {
	fee: number;
	quotationId: string;
	vehicleType: string;
	quotedAt: number;
};

/** One cart line's weight facts (weight mode). `parcelWeightG` is the
 * variant's parcel weight in grams (0 = unset). */
export type CartWeightItem = {
	parcelWeightG: number;
	quantity: number;
	/** Custom / price-on-quote line — weight unknowable by design. */
	isCustom?: boolean;
};

export type CartWeightSummary =
	| { kind: "ok"; grams: number }
	| { kind: "custom_item" }
	| { kind: "missing_weights" };

/**
 * Sum a cart's chargeable parcel weight (weight mode). NEVER silently
 * underweighs (86eyeea1n edge case): one custom line or one weightless
 * non-custom item makes the WHOLE cart unpriceable — a partial sum would
 * quote a fee the courier won't honour. Custom wins over missing when both
 * apply (it's the by-design reason; the seller card asks nothing of the
 * seller's product config for it).
 */
export function summarizeCartWeight(
	items: CartWeightItem[],
): CartWeightSummary {
	if (items.length === 0) return { kind: "missing_weights" };
	if (items.some((i) => i.isCustom)) return { kind: "custom_item" };
	let grams = 0;
	for (const item of items) {
		if (!Number.isFinite(item.parcelWeightG) || item.parcelWeightG <= 0) {
			return { kind: "missing_weights" };
		}
		// A non-positive quantity can't reach an order (create validates), but a
		// defensive clamp keeps a malformed quote call from shrinking the sum.
		grams += Math.round(item.parcelWeightG) * Math.max(0, item.quantity);
	}
	return { kind: "ok", grams };
}

/** Fee ceiling (sen) — RM10,000, same sanity bound as the pickup fee. */
export const DELIVERY_FEE_MAX = 1_000_000;
/** Max radius bands per store / weight bands per zone — enough for any
 * realistic rate table. */
export const DELIVERY_BANDS_MAX = 10;
/** Band radius ceiling (km) — generously covers domestic Malaysia. */
export const DELIVERY_BAND_KM_MAX = 3_000;
/** Free-above threshold ceiling (sen) — RM1,000,000; a typo guard, not policy. */
export const DELIVERY_FREE_ABOVE_MAX = 100_000_000;
/** Max zones per store — 16 states split into realistic courier zones needs
 * far fewer (West/East is the common card); 8 is a typo guard, not policy. */
export const DELIVERY_ZONES_MAX = 8;
/** Zone-name display cap. */
export const DELIVERY_ZONE_NAME_MAX = 40;
/** Band weight ceiling (kg) — far beyond any parcel courier; a typo guard. */
export const DELIVERY_BAND_KG_MAX = 1_000;

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
	/** Buyer's delivery state — a CANONICAL MY_STATES value or undefined
	 * (callers normalize; an unrecognized value must arrive as undefined so it
	 * resolves "no_state", never "unserved_state"). Weight mode's zone key. */
	state?: string;
	/** Cart parcel-weight summary (weight mode) — from summarizeCartWeight.
	 * Undefined when the caller had no cart lines to sum. */
	cartWeight?: CartWeightSummary;
	/** Live Lalamove quote (mode "lalamove" only), pre-fetched by the checkout
	 * action and loaded server-side from its deliveryQuotes row. Undefined when
	 * none was obtainable — resolves per config.onUnquotable. */
	liveQuote?: LiveProviderQuote;
}): DeliveryQuote {
	const { config, subtotal, origin, destination, state, cartWeight, liveQuote } =
		args;
	if (!config) return { kind: "free" };

	if (config.mode === "lalamove") {
		if (liveQuote) {
			// A zero-fee provider quote doesn't exist in practice; treat 0 as
			// free rather than storing a zero-fee snapshot (one spelling of free).
			if (liveQuote.fee === 0) return { kind: "free" };
			return {
				kind: "fee",
				fee: liveQuote.fee,
				mode: "lalamove",
				quotationId: liveQuote.quotationId,
				vehicleType: liveQuote.vehicleType,
				quotedAt: liveQuote.quotedAt,
			};
		}
		// No live quote → ALWAYS refuse (27 Jul, Zaki — `onUnquotable` ignored):
		// a Lalamove seller must never be handed fee homework, and the buyer must
		// always see the real rider price before sending. The checkout requires a
		// pinned, quotable address; the trade-off (a Lalamove outage refuses
		// delivery checkout until it recovers) is accepted and copy says "try
		// again shortly".
		return {
			kind: "blocked",
			reason: destination ? "unquotable" : "no_coords",
		};
	}

	if (config.mode === "flat") {
		if (config.freeAbove !== undefined && subtotal >= config.freeAbove) {
			return { kind: "free", reason: "threshold" };
		}
		return { kind: "fee", fee: config.fee, mode: "flat" };
	}

	if (config.mode === "weight") {
		const hold = (
			policy: "block" | "arrange",
			reason: DeliveryQuoteReason,
		): DeliveryQuote =>
			policy === "block"
				? { kind: "blocked", reason }
				: { kind: "pending", reason };

		// No state yet = the quote-preview before an address exists. An ORDER
		// always has a canonical state (assertValidAddress), so this reason
		// never reaches a snapshot.
		if (!state) return hold(config.onUnpriceable, "no_state");
		const zone = config.zones.find((z) => z.states.includes(state));
		if (!zone) return hold(config.onOutOfBands, "unserved_state");
		// Threshold BEFORE weight — deliberately (see DeliveryZone.freeAbove):
		// "free shipping above RM150" is an unconditional promise, so an earned
		// threshold waives the fee even for unknowable/overweight carts.
		if (zone.freeAbove !== undefined && subtotal >= zone.freeAbove) {
			return { kind: "free", reason: "threshold" };
		}
		if (!cartWeight || cartWeight.kind === "missing_weights") {
			return hold(config.onUnpriceable, "missing_weights");
		}
		if (cartWeight.kind === "custom_item") {
			return hold(config.onUnpriceable, "custom_item");
		}
		for (const band of zone.bands) {
			// Compare in integer grams — maxKg is 1dp-sanitized, so maxKg*1000 is
			// exact and "3.1 kg cart vs up-to-3.1 kg band" can't lose to float
			// noise. Boundary inclusive, consistent with radius maxKm.
			if (cartWeight.grams <= Math.round(band.maxKg * 1000)) {
				if (band.fee === 0) return { kind: "free" };
				return {
					kind: "fee",
					fee: band.fee,
					mode: "weight",
					zoneName: zone.name,
					// Gram precision (3dp) — the audit trail shows what was weighed,
					// not a rounded approximation of it.
					chargeableKg: Math.round(cartWeight.grams) / 1000,
					bandMaxKg: band.maxKg,
				};
			}
		}
		return hold(config.onOutOfBands, "over_bands");
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
	if (raw.mode === "lalamove") {
		// Nothing numeric to normalize — the fee is always provider-quoted live.
		// `onUnquotable` is vestigial (always-block behavior); normalize stored
		// rows to "block" on save so the data reads truthfully.
		return { mode: "lalamove", onUnquotable: "block" };
	}
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

	if (raw.mode === "weight") {
		return sanitizeWeightConfig(raw);
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

const MY_STATE_SET: ReadonlySet<string> = new Set(MY_STATES);

/** Weight/zone arm of sanitizeDeliveryConfig (86eyeea1n). Same posture as the
 * radius arm: normalize where unambiguous (sort bands, dedupe repeated states
 * within a zone, trim names), throw a human message where ambiguous (duplicate
 * band bounds, one state in two zones, duplicate zone names). */
function sanitizeWeightConfig(
	raw: Extract<DeliveryConfig, { mode: "weight" }>,
): DeliveryConfig {
	if (raw.zones.length === 0) {
		throw new Error("Add at least one delivery zone");
	}
	if (raw.zones.length > DELIVERY_ZONES_MAX) {
		throw new Error(`At most ${DELIVERY_ZONES_MAX} delivery zones`);
	}
	const seenNames = new Set<string>();
	const claimedStates = new Map<string, string>(); // state → zone name
	const zones = raw.zones.map((zone) => {
		const name = zone.name.trim();
		if (name.length === 0) {
			throw new Error("Every zone needs a name");
		}
		if (name.length > DELIVERY_ZONE_NAME_MAX) {
			throw new Error(
				`Zone names can't exceed ${DELIVERY_ZONE_NAME_MAX} characters`,
			);
		}
		const nameKey = name.toLowerCase();
		if (seenNames.has(nameKey)) {
			throw new Error(`Two zones are both named "${name}" — rename one`);
		}
		seenNames.add(nameKey);

		const states: string[] = [];
		for (const state of zone.states) {
			if (!MY_STATE_SET.has(state)) {
				throw new Error(`Unknown state: ${state}`);
			}
			if (states.includes(state)) continue; // harmless repeat — dedupe
			const claimedBy = claimedStates.get(state);
			if (claimedBy !== undefined) {
				throw new Error(
					`${state} is in both "${claimedBy}" and "${name}" — a state can only be in one zone`,
				);
			}
			claimedStates.set(state, name);
			states.push(state);
		}
		if (states.length === 0) {
			throw new Error(`Zone "${name}" needs at least one state`);
		}

		if (zone.bands.length === 0) {
			throw new Error(`Zone "${name}" needs at least one weight band`);
		}
		if (zone.bands.length > DELIVERY_BANDS_MAX) {
			throw new Error(
				`At most ${DELIVERY_BANDS_MAX} weight bands per zone ("${name}")`,
			);
		}
		const bands = zone.bands
			.map((b) => {
				if (!Number.isFinite(b.maxKg) || b.maxKg <= 0) {
					throw new Error(
						`Each band in "${name}" needs a weight greater than 0 kg`,
					);
				}
				if (b.maxKg > DELIVERY_BAND_KG_MAX) {
					throw new Error(
						`Band weight can't exceed ${DELIVERY_BAND_KG_MAX} kg ("${name}")`,
					);
				}
				return {
					// 1dp is the finest the settings UI offers (courier tiers are
					// 0.5/1 kg steps); rounding keeps stored bounds stable and makes
					// the resolver's grams comparison exact.
					maxKg: Math.round(b.maxKg * 10) / 10,
					fee: assertFeeSen(b.fee, "Band fee", 0),
				};
			})
			.sort((a, b) => a.maxKg - b.maxKg);
		for (let i = 1; i < bands.length; i++) {
			if (bands[i].maxKg === bands[i - 1].maxKg) {
				throw new Error(
					`Two bands in "${name}" share the same weight — merge them`,
				);
			}
		}

		let freeAbove: number | undefined;
		if (zone.freeAbove !== undefined) {
			if (!Number.isInteger(zone.freeAbove) || zone.freeAbove <= 0) {
				throw new Error(
					`Free-delivery threshold for "${name}" must be a positive amount`,
				);
			}
			if (zone.freeAbove > DELIVERY_FREE_ABOVE_MAX) {
				throw new Error(
					`Free-delivery threshold for "${name}" is unrealistically large — check the amount`,
				);
			}
			freeAbove = zone.freeAbove;
		}

		return { name, states, bands, freeAbove };
	});

	return {
		mode: "weight",
		zones,
		onOutOfBands: raw.onOutOfBands,
		onUnpriceable: raw.onUnpriceable,
	};
}
