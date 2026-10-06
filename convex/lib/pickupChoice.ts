import type { Doc } from "../_generated/dataModel";

/**
 * Which pickup points a BUYER may choose at checkout (`z8r3fdm32x`).
 *
 * One author, because two order doors ask it — `orders.create` and
 * `orderClaims.createOrderFromClaim` — and they each ask it TWICE: once as
 * "does this store offer pickup at all?", once as "is the point this buyer
 * sent still a legal choice?". Four call sites that must agree; the storefront
 * picker (`listActivePublicBySlug`) is the fifth and answers the same question.
 *
 * Two reasons a point is not choosable, and they are NOT the same reason:
 *
 * - `isActive === false` — retired. It was a checkout option and no longer is.
 * - `eventsOnly === true` — it hosts events. It is live and in use, the guest
 *   is simply SENT there by the event rather than choosing it, so it must not
 *   appear beside the points they can choose between.
 *
 * Getting the first half wrong is the dangerous one: if the "does this store
 * offer pickup?" probe counts event venues, a store whose only active points
 * are venues demands a `pickupLocationId` the buyer was never offered, and
 * checkout dead-ends with "Pick a pickup location to continue".
 */
export function isChoosablePickupPoint(
	location: Pick<Doc<"pickupLocations">, "isActive" | "eventsOnly">,
): boolean {
	return location.isActive && location.eventsOnly !== true;
}

/**
 * Why a buyer's chosen point was refused, or null when it is fine. The two
 * messages differ on purpose: "no longer available" is true of a retired
 * point and misleading about a venue, which is very much available — just not
 * as something to pick.
 */
export function pickupChoiceRefusal(
	location: Pick<Doc<"pickupLocations">, "isActive" | "eventsOnly">,
): string | null {
	if (location.eventsOnly === true) {
		return "That address only hosts events, so it can't be chosen as a pickup point.";
	}
	if (!location.isActive) {
		return "That pickup location is no longer available";
	}
	return null;
}
