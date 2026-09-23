/**
 * Step 0 of the new-product wizard — "What are you selling?" (86eyj70z1
 * decision 5). FIVE cards but only THREE stored kinds: Food and Event are
 * ROUTERS that land as `physical` and re-shape the questions, never stored
 * values. The card is tracked (not just the derived kind) so the Food card
 * stays lit for a food seller instead of silently jumping to "Physical goods".
 *
 * "Event" (`z8r3fdff9u` round 4) routes to `physical` + `state.event.on` and
 * walks its own step sequence (When is it? → choices → price → caps). It is
 * deliberately NOT a stored kind: kind answers WHAT is sold (food vs a
 * service) while the event flag answers HOW its date works — two orthogonal
 * axes (a breakfast is food AND an event), and the flag is reversible where a
 * kind is immutable. `physical` is the underlying kind because every event
 * hands something over at the venue (a food set, a pack, a badge) and
 * physical's semantics are the superset; the choice is near-invisible while
 * the event is on (delivery, prep and notice are all suppressed).
 *
 * Lives in `lib`, not beside the wizard, because it is also the contract of
 * `/app/products/new?card=` (`z8r3fdhkr7`): the route validates against it,
 * and links from other screens name a card without importing the wizard.
 */
export const KIND_CARDS = [
	"food",
	"physical",
	"service",
	"booking",
	"event",
] as const;
export type KindCard = (typeof KIND_CARDS)[number];

/** Guards `?card=` on `/app/products/new` (`z8r3fdhkr7`) — a closed union, so
 * a hand-typed value can never select something step 0 doesn't render. */
export function isKindCard(value: unknown): value is KindCard {
	return (
		typeof value === "string" && (KIND_CARDS as readonly string[]).includes(value)
	);
}
