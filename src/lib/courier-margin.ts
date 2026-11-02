/**
 * What one courier costs the seller against what the buyer paid for delivery
 * (z8r3fdx34j, Delyva caveat 9). The buyer never picks the courier — they
 * paid the store's own delivery fee — so an instant rider at RM 12 on a RM 8
 * fee comes out of the seller's margin, and the courier list says so beside
 * every price rather than leaving the seller to do the subtraction.
 */

import { formatPrice } from "./format";

export type CourierMargin = {
	/** Positive = the seller keeps it; negative = it comes out of margin. */
	deltaMinor: number;
	label: string;
	tone: "kept" | "even" | "loss";
};

export function courierMargin(
	priceMinor: number,
	buyerPaidMinor: number,
	currency: string,
): CourierMargin {
	const deltaMinor = buyerPaidMinor - priceMinor;
	if (deltaMinor > 0)
		return {
			deltaMinor,
			label: `+${formatPrice(deltaMinor, currency)} kept`,
			tone: "kept",
		};
	if (deltaMinor < 0)
		return {
			deltaMinor,
			label: `${formatPrice(-deltaMinor, currency)} from your margin`,
			tone: "loss",
		};
	return { deltaMinor, label: "Covered exactly", tone: "even" };
}
