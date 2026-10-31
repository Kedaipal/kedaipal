// Cross-border delivery MY ↔ SG (ClickUp z8r3fdr5yy) — the one author of
// "can this store, this cart, this product go to the other country, and what
// does it cost". Pure: no Convex reads, so every rule unit-tests in isolation
// and the seller settings, the storefront, checkout and the three order doors
// all ask the same questions. See docs/cross-border.md.
//
// The model, decided with Zaki 28–29 Oct 2026:
//  - A LANE is "this store delivers to <country>" plus the SELLER'S OWN price
//    for that country. A lane never borrows the domestic price: a flat RM5 or
//    "free delivery" set up for Malaysia must never quietly cover a parcel to
//    Singapore. Free is its own explicit choice ("you pay the courier").
//  - Corridor, never "global": a lane's country is one of COUNTRIES and never
//    the store's own.
//  - The whole lane is Pro. It is gated at the ADDRESS, not the courier — so a
//    flat-fee or free store can't take a foreign address on Starter either.
//  - Only the store's own pricing modes carry a lane. Live courier pricing
//    (Lalamove / Delyva quotes) is domestic, so a store priced live has its
//    lane PAUSED — stored, shown as paused, never silently dropped.
//  - Products inherit the lane; a product can only opt OUT (`domesticOnly`).
//    Only a parcel can cross: services, events and bookings have no parcel leg.

import { v } from "convex/values";
import { COUNTRIES, type Country, COUNTRY_LABELS } from "./country";
import {
	COURIER_DESTINATIONS,
	type CourierProviderId,
	courierBookingAllowed,
} from "./courierProviders";
import {
	type CartWeightSummary,
	DELIVERY_BAND_KG_MAX,
	DELIVERY_BANDS_MAX,
	DELIVERY_FEE_MAX,
	DELIVERY_FREE_ABOVE_MAX,
	type DeliveryQuote,
	type WeightBand,
} from "./delivery";
import { effectiveKind } from "./productKind";

/** How the seller charges delivery to the other country. Every arm is a price
 * the buyer can always be shown — there is no "arrange": a lane never leaves a
 * buyer without a delivery price. The live arm is EasyParcel's own quote,
 * fetched at checkout; while EasyParcel can't quote, the lane is HELD (never
 * offered), so the buyer still never meets an unpriced option. */
export type CrossBorderPricing =
	| {
			kind: "flat";
			/** Fee per order (minor units). Always > 0 — free is its own arm. */
			fee: number;
			/** Subtotal at or above which delivery to this country is free. */
			freeAbove?: number;
	  }
	| {
			kind: "weight";
			/** Ascending weight bands — one card for the whole country (Singapore
			 * has no states; Malaysia is priced as one destination). */
			bands: WeightBand[];
			freeAbove?: number;
	  }
	| {
			/** The seller covers the courier on every order to this country —
			 * chosen on purpose, with its own acknowledgement in settings. */
			kind: "free";
	  }
	| {
			/** Priced live by EasyParcel at checkout — the same courier that
			 * carries the parcel, so the buyer pays what booking will cost. */
			kind: "live";
			freeAbove?: number;
	  };

export type CrossBorderLane = {
	country: Country;
	pricing: CrossBorderPricing;
	/** Set while the seller hasn't yet confirmed which products can go: the
	 * lane is saved but not offered, so frozen goods are never shown abroad
	 * before they're unticked (Zaki, 30 Oct). Absent = reviewed — every lane
	 * saved before this field existed was reviewed on its first save. */
	awaitingProducts?: boolean;
};

const weightBandValidator = v.object({ maxKg: v.number(), fee: v.number() });

export const crossBorderPricingValidator = v.union(
	v.object({
		kind: v.literal("flat"),
		fee: v.number(),
		freeAbove: v.optional(v.number()),
	}),
	v.object({
		kind: v.literal("weight"),
		bands: v.array(weightBandValidator),
		freeAbove: v.optional(v.number()),
	}),
	v.object({ kind: v.literal("free") }),
	v.object({ kind: v.literal("live"), freeAbove: v.optional(v.number()) }),
);

/** `retailers.crossBorderLanes` — a LIST so a third country is a new entry,
 * never a migration. v1 holds at most one lane (the other country). */
export const crossBorderLanesValidator = v.array(
	v.object({
		country: v.union(v.literal("MY"), v.literal("SG")),
		pricing: crossBorderPricingValidator,
		awaitingProducts: v.optional(v.boolean()),
	}),
);

/** The couriers that price a store's HOME deliveries live, by display name —
 * EasyParcel only where it carries domestic orders (an SG store); on a MY
 * store it's the overseas courier (`COURIER_DESTINATIONS`). */
const LIVE_QUOTE_COURIERS = [
	{ id: "lalamove", name: "Lalamove" },
	{ id: "delyva", name: "Delyva" },
	{ id: "easyparcel", name: "EasyParcel" },
] as const satisfies ReadonlyArray<{ id: CourierProviderId; name: string }>;

/**
 * The live-pricing couriers a store in `country` can actually connect —
 * derived from the booking registry, so the copy that says "they only
 * deliver within Singapore" never names Delyva to an SG store that was never
 * offered it (found on the /test-code pass).
 */
export function liveQuoteCourierNames(country: Country): string[] {
	return LIVE_QUOTE_COURIERS.filter(
		(c) =>
			courierBookingAllowed(c.id, country) &&
			COURIER_DESTINATIONS[c.id][country] !== "abroad",
	).map((c) => c.name);
}

/** "Lalamove and Delyva deliver" / "Lalamove delivers" — the subject of the
 * "…within Malaysia only" sentence: the connectable couriers that ONLY carry
 * home parcels. Never EasyParcel, which also goes abroad — so an SG store's
 * help can't claim its overseas courier stays at home. */
export function domesticOnlyCouriersDeliver(country: Country): string {
	const names = LIVE_QUOTE_COURIERS.filter(
		(c) =>
			courierBookingAllowed(c.id, country) &&
			COURIER_DESTINATIONS[c.id][country] === "domestic",
	).map((c) => c.name);
	return names.length === 1
		? `${names[0]} delivers`
		: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} deliver`;
}

/** Countries a store in `store` may open a lane to. */
/**
 * The fewest days' notice an order going ABROAD needs, whatever the store's
 * own setting says. A parcel across the Causeway clears customs and rides a
 * line-haul; no courier delivers it the same afternoon, yet the checkout's
 * date picker offered "Today" for one (staging test, 31 Oct 2026) — a promise
 * the seller then had to break by hand. Folded into the same floor the
 * store's and the cart's notice already share, on the client and at the order
 * door, so it can't be bypassed by a stale tab. Said to the buyer under the
 * date, and to the seller on the Overseas delivery page.
 */
export const CROSS_BORDER_MIN_NOTICE_DAYS = 2;

export function laneCountriesFor(store: Country): Country[] {
	return COUNTRIES.filter((c) => c !== store);
}

/** "Malaysia" / "Singapore". */
export function countryName(country: Country): string {
	return COUNTRY_LABELS[country];
}

/** Why a lane isn't taking orders right now. `null` = it is. Ordered by what
 * the seller has to fix first. The store's own home pricing no longer pauses
 * a lane (Zaki, 30 Oct): a lane always carries its own price. */
export type LanePause =
	/** The plan doesn't include cross-border delivery (a downgrade). */
	| "plan"
	/** Delivery is switched off for the store — only pickup is offered. */
	| "delivery_off"
	/** Saved, but the seller hasn't confirmed which products can go yet. */
	| "awaiting_products"
	/** Priced live by EasyParcel, and EasyParcel can't quote right now
	 * (disconnected, booking off, no pickup address or store number, or an
	 * account in another currency) — so no buyer is offered it. */
	| "courier_unavailable";

/** The store-wide half: these pause every lane at once. */
export function lanePause(args: {
	planAllows: boolean;
	offerDelivery: boolean | undefined;
}): Extract<LanePause, "plan" | "delivery_off"> | null {
	if (!args.planAllows) return "plan";
	if (args.offerDelivery === false) return "delivery_off";
	return null;
}

/** The lane's own half. `easyparcelQuotes` = EasyParcel can price a checkout
 * for this store right now (`easyparcelQuotesAtCheckout`). */
export function laneHold(
	lane: CrossBorderLane,
	facts: { easyparcelQuotes: boolean },
): Extract<LanePause, "awaiting_products" | "courier_unavailable"> | null {
	if (lane.awaitingProducts === true) return "awaiting_products";
	if (lane.pricing.kind === "live" && !facts.easyparcelQuotes)
		return "courier_unavailable";
	return null;
}

/**
 * The lanes a store is ACTUALLY taking orders on: stored, not paused, and not
 * pointing at the store's own country (a store that switched country keeps
 * its old lane stored but can't deliver "abroad" to itself). Read-time, so a
 * downgrade or a pricing change collapses the lane without touching settings,
 * and an upgrade revives it untouched.
 */
export function effectiveLanes(args: {
	lanes: CrossBorderLane[] | undefined;
	storeCountry: Country;
	planAllows: boolean;
	offerDelivery: boolean | undefined;
	easyparcelQuotes: boolean;
}): CrossBorderLane[] {
	if (!args.lanes || args.lanes.length === 0) return [];
	if (lanePause(args) !== null) return [];
	return args.lanes.filter(
		(lane) => lane.country !== args.storeCountry && laneHold(lane, args) === null,
	);
}

/** The one pause a seller reads for their (v1: single) lane — store-wide
 * first, then the lane's own hold. */
export function lanePauseFor(args: {
	lane: CrossBorderLane | undefined;
	planAllows: boolean;
	offerDelivery: boolean | undefined;
	easyparcelQuotes: boolean;
}): LanePause | null {
	if (!args.lane) return null;
	return lanePause(args) ?? laneHold(args.lane, args);
}

/** A lane whose price comes from EasyParcel's checkout quote for THIS cart —
 * false once the cart has earned the lane's free-above threshold. */
export function laneNeedsLiveQuote(
	lane: CrossBorderLane,
	subtotal: number,
): boolean {
	if (lane.pricing.kind !== "live") return false;
	const { freeAbove } = lane.pricing;
	return freeAbove === undefined || subtotal < freeAbove;
}

export function laneFor(
	lanes: CrossBorderLane[],
	country: Country,
): CrossBorderLane | undefined {
	return lanes.find((lane) => lane.country === country);
}

/**
 * Does this product have a parcel leg at all? Judged on the fulfilment
 * reality, never on what it's called (house rule): a physical good without a
 * fixed event moment ships; a service is performed, an event is attended and
 * a booking is stayed, so none of them can cross a border.
 */
export function hasParcelLeg(product: {
	kind?: string;
	event?: unknown;
}): boolean {
	return effectiveKind(product.kind) === "physical" && product.event === undefined;
}

/** Can this product go to the other country, given the store has a lane? */
export function shipsAbroad(product: {
	kind?: string;
	event?: unknown;
	domesticOnly?: boolean;
}): boolean {
	return hasParcelLeg(product) && product.domesticOnly !== true;
}

/** Why a product can't go abroad — the sentence the buyer and seller read. */
export type DomesticReason = "seller_choice" | "no_parcel";

export function domesticReason(product: {
	kind?: string;
	event?: unknown;
	domesticOnly?: boolean;
}): DomesticReason | null {
	if (!hasParcelLeg(product)) return "no_parcel";
	if (product.domesticOnly === true) return "seller_choice";
	return null;
}

/** "Ships within Malaysia only" — the one spelling of the domestic label. */
export function shipsWithinLabel(storeCountry: Country): string {
	return `Ships within ${countryName(storeCountry)} only`;
}

/** "Delivers to Malaysia" — the storefront header line a visitor from a lane
 * country reads before browsing, so the store's reach isn't a checkout
 * surprise. */
export function deliversToLabel(destination: Country): string {
	return `Delivers to ${countryName(destination)}`;
}

/** The fee line's name on an OVERSEAS order — "Delivery to Malaysia" — one
 * spelling for checkout, the buyer's order page and the seller's, so the
 * three never drift (they did, on the /test-code pass). Undefined at home:
 * each surface keeps its own domestic word. */
export function overseasFeeLabel(
	destination: Country | undefined,
	storeCountry: Country,
): string | undefined {
	return destination !== undefined && destination !== storeCountry
		? `Delivery to ${countryName(destination)}`
		: undefined;
}

/** "Ships from Malaysia" — the marketplace chip on a store listed abroad. */
export function shipsFromLabel(storeCountry: Country): string {
	return `Ships from ${countryName(storeCountry)}`;
}

function assertFee(raw: number, label: string, min: number): number {
	if (!Number.isInteger(raw) || raw < min) {
		throw new Error(`${label} must be a whole, non-negative amount`);
	}
	if (raw > DELIVERY_FEE_MAX) {
		throw new Error(`${label} is unrealistically large — check the amount`);
	}
	return raw;
}

function sanitizeFreeAbove(raw: number | undefined): number | undefined {
	if (raw === undefined) return undefined;
	if (!Number.isInteger(raw) || raw <= 0) {
		throw new Error("Free-delivery threshold must be a positive amount");
	}
	if (raw > DELIVERY_FREE_ABOVE_MAX) {
		throw new Error(
			"Free-delivery threshold is unrealistically large — check the amount",
		);
	}
	return raw;
}

/** Validate + normalize a seller-submitted lane price. Throws a human
 * message (callers wrap in ConvexError). */
export function sanitizeCrossBorderPricing(
	raw: CrossBorderPricing,
	country: Country,
): CrossBorderPricing {
	const where = countryName(country);
	if (raw.kind === "free") return { kind: "free" };
	if (raw.kind === "live") {
		return { kind: "live", freeAbove: sanitizeFreeAbove(raw.freeAbove) };
	}
	if (raw.kind === "flat") {
		return {
			kind: "flat",
			fee: assertFee(raw.fee, `Delivery fee to ${where}`, 1),
			freeAbove: sanitizeFreeAbove(raw.freeAbove),
		};
	}
	if (raw.bands.length === 0) {
		throw new Error(`Add at least one weight band for ${where}`);
	}
	if (raw.bands.length > DELIVERY_BANDS_MAX) {
		throw new Error(`At most ${DELIVERY_BANDS_MAX} weight bands`);
	}
	const bands = raw.bands
		.map((b) => {
			if (!Number.isFinite(b.maxKg) || b.maxKg <= 0) {
				throw new Error("Each band needs a weight greater than 0 kg");
			}
			if (b.maxKg > DELIVERY_BAND_KG_MAX) {
				throw new Error(`Band weight can't exceed ${DELIVERY_BAND_KG_MAX} kg`);
			}
			return {
				maxKg: Math.round(b.maxKg * 10) / 10,
				fee: assertFee(b.fee, "Band fee", 0),
			};
		})
		.sort((a, b) => a.maxKg - b.maxKg);
	for (let i = 1; i < bands.length; i++) {
		if (bands[i].maxKg === bands[i - 1].maxKg) {
			throw new Error("Two bands share the same weight — merge them");
		}
	}
	return { kind: "weight", bands, freeAbove: sanitizeFreeAbove(raw.freeAbove) };
}

/** Validate a whole lane list for a store in `storeCountry`. */
export function sanitizeCrossBorderLanes(
	raw: CrossBorderLane[],
	storeCountry: Country,
): CrossBorderLane[] {
	const seen = new Set<Country>();
	return raw.map((lane) => {
		if (lane.country === storeCountry) {
			throw new Error(
				`Your store is in ${countryName(storeCountry)} — overseas delivery is to another country`,
			);
		}
		if (seen.has(lane.country)) {
			throw new Error(`${countryName(lane.country)} is listed twice`);
		}
		seen.add(lane.country);
		return {
			country: lane.country,
			pricing: sanitizeCrossBorderPricing(lane.pricing, lane.country),
		};
	});
}

/**
 * Price one cross-border order. Every outcome is a fee, free, or a BLOCK —
 * never "pending", because a lane promises the buyer a price up front. The
 * weight arm blocks a cart whose weight can't be known or that outweighs the
 * last band (the seller set that ceiling; the buyer is told why, and the
 * domestic address stays open). Fee `mode` reuses the domestic audit arms so
 * every existing fee renderer reads it unchanged.
 */
export function resolveCrossBorderQuote(args: {
	pricing: CrossBorderPricing;
	subtotal: number;
	cartWeight?: CartWeightSummary;
	country: Country;
}): DeliveryQuote {
	const { pricing, subtotal, cartWeight } = args;
	if (pricing.kind === "free") return { kind: "free" };
	if (pricing.freeAbove !== undefined && subtotal >= pricing.freeAbove) {
		return { kind: "free", reason: "threshold" };
	}
	// A live lane is priced by EasyParcel's checkout quote, never here — every
	// caller takes that path first (`laneNeedsLiveQuote`). Reaching this line
	// means no quote was taken, so it refuses rather than inventing a price.
	if (pricing.kind === "live") {
		return { kind: "blocked", reason: "unquotable" };
	}
	if (pricing.kind === "flat") {
		return { kind: "fee", fee: pricing.fee, mode: "flat" };
	}
	if (!cartWeight || cartWeight.kind === "missing_weights") {
		return { kind: "blocked", reason: "missing_weights" };
	}
	if (cartWeight.kind === "custom_item") {
		return { kind: "blocked", reason: "custom_item" };
	}
	for (const band of pricing.bands) {
		if (cartWeight.grams <= Math.round(band.maxKg * 1000)) {
			if (band.fee === 0) return { kind: "free" };
			return {
				kind: "fee",
				fee: band.fee,
				mode: "weight",
				zoneName: countryName(args.country),
				chargeableKg: Math.round(cartWeight.grams) / 1000,
				bandMaxKg: band.maxKg,
			};
		}
	}
	return { kind: "blocked", reason: "over_bands" };
}

/** One-line summary of a lane's price for settings rows. `money` formats
 * minor units in the store currency. */
export function crossBorderPricingSummary(
	pricing: CrossBorderPricing,
	money: (minor: number) => string,
): string {
	if (pricing.kind === "free") return "Free — you cover the courier";
	const free =
		pricing.freeAbove !== undefined
			? ` · free from ${money(pricing.freeAbove)}`
			: "";
	if (pricing.kind === "flat") return `${money(pricing.fee)} per order${free}`;
	if (pricing.kind === "live") return `Priced live by EasyParcel${free}`;
	const first = pricing.bands[0];
	const bands = pricing.bands.length;
	return `By weight · from ${money(first.fee)} (${bands} band${bands === 1 ? "" : "s"})${free}`;
}
