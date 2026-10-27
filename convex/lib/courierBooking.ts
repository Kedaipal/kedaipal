/**
 * "Does this store book couriers?" — one answer for the dispatch cards and the
 * public storefront read (z8r3fdh274). The storefront exposes it as the
 * one-bit `booksCouriers`, behind the checkout's overseas-number delivery
 * note: only when a courier will actually be handed the buyer's contact is it
 * worth telling a buyer with a foreign number that the rider will call the
 * store instead of them. Contact numbers themselves: `./courierContact`.
 */

import { type Country, DEFAULT_COUNTRY } from "./country";
import {
	COURIER_PROVIDER_IDS,
	courierBookingAllowed,
	type CourierProviderId,
} from "./courierProviders";
import { delyvaBookingAllowed, riderBookingAllowed } from "./delivery";
import { resolveDelyvaCredentials } from "./delyva";
import { resolveEasyparcelCredentials } from "./easyparcel";

/** The slice of a retailer row the booking predicates read. */
export type CourierRetailer = {
	country?: Country;
	deliveryBooking?: { enabled?: boolean };
	delyva?: {
		enabled?: boolean;
		apiKey?: string;
		apiSecret?: string;
		customerId?: number;
		pickupAddress?: unknown;
	};
	easyparcel?: {
		enabled?: boolean;
		apiKey?: string;
	};
};

/** Lalamove rider booking is switched on and allowed in the store's country —
 * the same bit the dispatch card's `bookingEnabled` reports. */
export function lalamoveBookingArmed(retailer: CourierRetailer): boolean {
	return (
		retailer.deliveryBooking?.enabled === true &&
		riderBookingAllowed(retailer.country ?? DEFAULT_COUNTRY)
	);
}

/** Delyva courier booking is connected, switched on and allowed in the
 * store's country — the same bit the Delyva card's `bookingEnabled` reports. */
export function delyvaBookingArmed(retailer: CourierRetailer): boolean {
	return (
		resolveDelyvaCredentials(retailer.delyva) !== null &&
		retailer.delyva?.enabled === true &&
		delyvaBookingAllowed(retailer.country ?? DEFAULT_COUNTRY)
	);
}

/** EasyParcel parcel booking is connected, switched on and allowed in the
 * store's country — the same bit the EasyParcel card's `bookingEnabled`
 * reports. */
export function easyparcelBookingArmed(retailer: CourierRetailer): boolean {
	return (
		resolveEasyparcelCredentials(retailer.easyparcel) !== null &&
		retailer.easyparcel?.enabled === true &&
		courierBookingAllowed("easyparcel", retailer.country ?? DEFAULT_COUNTRY)
	);
}

/**
 * Delyva will actually BID on a live checkout quote: armed, and with the
 * pickup address an instantQuote needs (without it the call is a 400, so an
 * account half-way through connecting simply doesn't bid). This is the one
 * condition `getLiveQuoteContext` arms Delyva on, exported so the public
 * `delivery.quote` can tell the checkout which providers can price the
 * address — "by rider" copy on a store whose courier reaches the whole
 * country was a lie (`/test-code` on PR #415).
 */
export function delyvaBidsAtCheckout(retailer: CourierRetailer): boolean {
	return (
		delyvaBookingArmed(retailer) && retailer.delyva?.pickupAddress !== undefined
	);
}

/**
 * One armed predicate per provider — the registry shape (Record over
 * `CourierProviderId`) is what turns "forgot to wire the new provider into
 * the storefront's booksCouriers bit" into a compile error.
 */
const PROVIDER_BOOKING_ARMED: Record<
	CourierProviderId,
	(retailer: CourierRetailer) => boolean
> = {
	lalamove: lalamoveBookingArmed,
	delyva: delyvaBookingArmed,
	easyparcel: easyparcelBookingArmed,
};

/**
 * Whether a delivery order at this store may be handed to a courier. Plan
 * gating is deliberately not read (it would cost the hot public storefront
 * read a subscription lookup); a lapsed store with booking still switched on
 * reads true, which only means a buyer sees a note that turns out moot.
 */
export function storeBooksCouriers(retailer: CourierRetailer): boolean {
	return COURIER_PROVIDER_IDS.some((id) =>
		PROVIDER_BOOKING_ARMED[id](retailer),
	);
}
