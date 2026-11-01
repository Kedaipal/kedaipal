/**
 * "Does this store's delivery charge depend on parcel weight?" — ONE answer
 * for every surface that asks (the product form, the setup wizard, the
 * readiness notice, the bulk weight fill, the arming gates).
 *
 * Two ways a store prices by weight, and the copy differs because the
 * CONSEQUENCE of a blank weight differs:
 *
 *  - `rate_card` — `deliveryConfig.mode === "weight"`: the seller's own
 *    zone × weight rate card. A cart holding an unweighed item can't be
 *    priced at all (`summarizeCartWeight` → `missing_weights`), so the order
 *    strands fee-pending or is refused per the store's policy.
 *  - `courier` — `mode === "live"` with Delyva armed: parcel couriers quote
 *    by weight, and an unweighed item is quoted at the one-kilo floor
 *    (`liveQuoteWeightKg`). The buyer is never refused; a heavier parcel
 *    UNDER-collects from the seller when they book. Mandos (prod, 23 Oct
 *    2026) stored every tee at 0 g and nobody was told.
 *
 * Lalamove riders price by distance, so a live store with riders alone does
 * not price by weight — and a flat/radius/free store never does, UNLESS its
 * cross-border lane (z8r3fdr5yy) is priced by weight bands: that card refuses
 * an unweighed cart exactly like the domestic rate card, so it answers
 * `rate_card` too. Read off the STORED lane, not the effective one — a paused
 * lane comes back on with its card intact, and asking early costs nothing.
 *
 * "Delyva armed" here is `delyvaBookingArmed` (credentials + the Courier
 * booking toggle on + country allowed), the same bit the dispatch card
 * reports — deliberately a hair WIDER than `getLiveQuoteContext`'s bidding
 * condition, which also needs a pickup address. A seller half-way through
 * Delyva setup is about to price by weight, and asking for weights one step
 * early costs nothing; asking one step late is the incident this exists to
 * prevent.
 */

import {
	type CourierRetailer,
	delyvaBookingArmed,
	easyparcelBookingArmed,
} from "./courierBooking";
import { COURIER_DESTINATIONS } from "./courierProviders";
import { DEFAULT_COUNTRY } from "./country";
import { LIVE_QUOTE_WEIGHT_FLOOR_G } from "./liveQuote";

export type WeightPricing = "rate_card" | "courier";

/** The slice of a retailer row the rule reads. */
export type WeightPricingRetailer = CourierRetailer & {
	deliveryConfig?: { mode?: string };
	crossBorderLanes?: ReadonlyArray<{ pricing: { kind: string } }>;
};

/**
 * Why this store prices by weight, or `null` when it doesn't. The rate card
 * wins when both would apply, because its consequence (an unpriceable
 * order) is the harder one.
 */
export function weightPricingOf(
	retailer: WeightPricingRetailer,
): WeightPricing | null {
	const mode = retailer.deliveryConfig?.mode;
	if (mode === "weight") return "rate_card";
	if (retailer.crossBorderLanes?.some((lane) => lane.pricing.kind === "weight"))
		return "rate_card";
	// An EasyParcel-priced lane quotes by the cart's weight (z8r3fdr5yy).
	if (retailer.crossBorderLanes?.some((lane) => lane.pricing.kind === "live"))
		return "courier";
	if (mode === "live" && delyvaBookingArmed(retailer)) return "courier";
	// EasyParcel bids on home deliveries only where it carries them (an SG
	// store) — read only when the caller loaded its arming (`easyparcel`).
	if (
		mode === "live" &&
		easyparcelBookingArmed(retailer) &&
		COURIER_DESTINATIONS.easyparcel[retailer.country ?? DEFAULT_COUNTRY] !==
			"abroad"
	)
		return "courier";
	return null;
}

export function pricesByWeight(retailer: WeightPricingRetailer): boolean {
	return weightPricingOf(retailer) !== null;
}

/** "1 kg" — the live-quote floor, spelt once for every line of copy. */
export function formatFloorKg(): string {
	return `${LIVE_QUOTE_WEIGHT_FLOOR_G / 1000} kg`;
}

/**
 * Every sentence the seller reads about a required weight, keyed by WHY the
 * store needs it — so the live-courier store is never told its order "can't
 * be priced" (that is the rate card's truth, not the courier's).
 */
export const WEIGHT_REQUIRED_COPY: Record<
	WeightPricing,
	{
		/** Short cause, for a headline or a badge: "Your couriers price by weight". */
		cause: string;
		/** What follows the cause — a full sentence of its own, so the bulk fill
		 * can lead with the cause as a headline and this as the body. */
		detail: string;
		/** The promoted field's explainer on the product form: cause + detail. */
		lead: string;
		/** The inline refusal on a buyable choice saved with no weight. */
		issue: string;
		/** What a blank weight does to an order — the readiness notice's tail. */
		consequence: string;
	}
> = {
	rate_card: {
		cause: "Your rate card prices delivery by weight",
		detail:
			"Checkout charges each item's parcel weight × quantity, so every choice buyers can order needs one. An item without a weight can't be priced automatically.",
		get lead() {
			return `${this.cause} — ${this.detail[0].toLowerCase()}${this.detail.slice(1)}`;
		},
		issue:
			"Enter the parcel weight — your rate card prices delivery by weight, so this item can't be priced without one.",
		consequence: "those orders can't be priced.",
	},
	courier: {
		cause: "Your couriers price by weight",
		detail: `Every choice buyers can order needs one. Until an item is weighed, couriers quote it as a ${formatFloorKg()} parcel — and a heavier one costs you the difference when you book.`,
		get lead() {
			return `${this.cause}, so ${this.detail[0].toLowerCase()}${this.detail.slice(1)}`;
		},
		issue: `Enter the parcel weight — your couriers price by weight, and until it's weighed this item is quoted as a ${formatFloorKg()} parcel.`,
		consequence: `couriers quote those orders as a ${formatFloorKg()} parcel, and a heavier one costs you the difference when you book.`,
	},
};

/** How many of a store's products the bulk fill may list — the product cap,
 * imported here so the page and the mutation agree with the catalogue. */
export const PARCEL_WEIGHTS_BATCH_MAX = 200;

/**
 * The one sentence an arming gate refuses with: switching on something that
 * prices by weight while buyable choices are unweighed. The seller is told
 * the count and the one page that fixes it.
 */
export function unweighedRefusal(count: number, reason: WeightPricing): string {
	const noun = count === 1 ? "product has" : "products have";
	const what =
		reason === "rate_card"
			? "a rate card prices every order by weight"
			: "couriers price every order by weight";
	return `${count} ${noun} no parcel weight — ${what}. Set them under Products → Parcel weights first.`;
}
