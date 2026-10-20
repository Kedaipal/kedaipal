/**
 * "Does this store book couriers?" — one answer for the dispatch cards and the
 * public storefront read (z8r3fdh274). The storefront exposes it as the
 * one-bit `booksCouriers`, behind the checkout's overseas-number delivery
 * note: only when a courier will actually be handed the buyer's contact is it
 * worth telling a buyer with a foreign number that the rider will call the
 * store instead of them. Contact numbers themselves: `./courierContact`.
 */

import { type Country, DEFAULT_COUNTRY } from "./country";
import { delyvaBookingAllowed, riderBookingAllowed } from "./delivery";
import { resolveDelyvaCredentials } from "./delyva";

/** The slice of a retailer row the booking predicates read. */
type CourierRetailer = {
	country?: Country;
	deliveryBooking?: { enabled?: boolean };
	delyva?: {
		enabled?: boolean;
		apiKey?: string;
		apiSecret?: string;
		customerId?: number;
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

/**
 * Whether a delivery order at this store may be handed to a courier. Plan
 * gating is deliberately not read (it would cost the hot public storefront
 * read a subscription lookup); a lapsed store with booking still switched on
 * reads true, which only means a buyer sees a note that turns out moot.
 */
export function storeBooksCouriers(retailer: CourierRetailer): boolean {
	return lalamoveBookingArmed(retailer) || delyvaBookingArmed(retailer);
}
