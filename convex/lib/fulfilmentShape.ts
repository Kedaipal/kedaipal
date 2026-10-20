/**
 * What SHAPE a fulfilment is — which kind of handover it is, and whether that
 * handover names an hour at all (ClickUp `z8r3fdg9aa`).
 *
 * Shared, because both sides of the checkout ask it and they must agree. The
 * buyer's form asks it to decide whether to SHOW a time field; `orders.create`
 * and `orderClaims.commit` ask it to decide what a cart's prep window races —
 * closing time for a timed handover, midnight for a date-only one
 * (`prepFloorHours`). While the server instead asked "did a time arrive?", a
 * request that omitted a time the checkout would have required took the
 * lenient branch: a 9-to-6 store handed a 7 PM collection from a counter that
 * shut at 6. Same question, one author, no lenient branch to fall into.
 *
 * A missing time is still ACCEPTED — a date-only order is a legitimate shape
 * (every pickup was one before `z8r3fdff97`, and a seller can set an hour with
 * Reschedule). It is only judged honestly now.
 *
 * No Convex imports: pure, shared by the server and the client.
 */
import type { OpeningHours } from "./openingHours";

/** What the fulfilment is, as the buyer hears it — it picks every verb. */
export type FulfilmentKind = "delivery" | "collection" | "pickup";

export function fulfilmentKind(
	method: "delivery" | "self_collect",
	collectsFromCustomer: boolean,
): FulfilmentKind {
	if (method === "self_collect") return "pickup";
	return collectsFromCustomer ? "collection" : "delivery";
}

/**
 * Whether this fulfilment names an hour as well as a day.
 *
 * A delivery or collection always does — a rider at someone's door shouldn't
 * be an all-day window. A pickup does only when something makes the hour
 * matter: the store keeps opening hours, or the cart needs prep time. A store
 * using neither keeps the date-only pickup it always had (zero change), and a
 * drop-off meet-up never asks — the point's own schedule sets the hour, so the
 * store's shutters are not its deadline.
 */
export function asksForTime(args: {
	kind: FulfilmentKind;
	isDropOff: boolean;
	openingHours: OpeningHours | undefined;
	prepMinutes: number;
}): boolean {
	if (args.kind !== "pickup") return true;
	if (args.isDropOff) return false;
	return args.openingHours !== undefined || args.prepMinutes > 0;
}
