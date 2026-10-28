/**
 * Step 0 of the new-product wizard — "What are you selling?" (86eyj70z1
 * decision 5, regrouped in z8r3fdxt99). SIX cards in two groups, but only
 * THREE stored kinds:
 *
 * - **Buyers order it** — `food`, `physical`, `service`. Food is a ROUTER
 *   that lands as `physical` and re-words the preparation question; it is
 *   never a stored value.
 * - **Buyers book a date or a period** — `plan`, `stay`, `event`. Plan and
 *   Stay both store as `booking`: a plan's package length is REQUIRED (a meal
 *   plan or membership runs a set length from the start date the buyer picks),
 *   a stay's is optional (guests pick check-in and check-out; a "3D2N" deal
 *   sets one). Event routes to `physical` + `state.event.on`.
 *
 * The groups exist because step 0 used to ask two questions at once — WHAT is
 * sold (food, goods, a service) and HOW its date works (booked, RSVP'd) — and
 * a seller whose product is both (a meal plan is food AND a package) had to
 * guess which question won. A food seller picked Food and never found the
 * meal-plan flow that lived under a card captioned "Campsite, venue, homestay,
 * rental". The kind is immutable once published, so this is the one wizard
 * answer that can't be fixed later.
 *
 * Event is deliberately NOT a stored kind: kind answers WHAT is sold while the
 * event flag answers HOW its date works — and the flag is reversible where a
 * kind is immutable. `physical` is the underlying kind because every event
 * hands something over at the venue (a food set, a pack, a badge).
 *
 * Lives in `lib`, not beside the wizard, because it is also the contract of
 * `/app/products/new?card=` (`z8r3fdhkr7`): the route validates against it,
 * and links from other screens name a card without importing the wizard.
 */
export const KIND_CARDS = [
	"food",
	"physical",
	"service",
	"plan",
	"stay",
	"event",
] as const;
export type KindCard = (typeof KIND_CARDS)[number];

/** Guards a card value — a closed union, so a hand-typed value can never
 * select something step 0 doesn't render. */
export function isKindCard(value: unknown): value is KindCard {
	return (
		typeof value === "string" &&
		(KIND_CARDS as readonly string[]).includes(value)
	);
}

/**
 * Reads a `?card=` value. `booking` was a card until the Booking card split
 * into Plan and Stay (z8r3fdxt99); links already in the wild keep working and
 * land on **Stay**, the card's original meaning. Switching Stay ⇄ Plan costs
 * nothing (same stored kind, nothing rebuilt), so a link landing on the other
 * one is one tap from right. Anything else unknown is dropped.
 */
export function parseKindCard(value: unknown): KindCard | undefined {
	if (value === "booking") return "stay";
	return isKindCard(value) ? value : undefined;
}
