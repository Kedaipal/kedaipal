import { effectiveKind } from "../../convex/lib/productKind";
import type { KindCard } from "./kind-card";
import type { ProductSpotlightKey } from "./spotlight";

/**
 * What the products LIST says when a What's-new note lands on it with a
 * `?spot=` for a card that lives on one product's edit form.
 *
 * A note can't know which product the seller means, so the list is the
 * first hop: it names what they are looking for, and every row the key
 * applies to carries `spot` on to `/app/products/<id>?spot=<key>`, where the
 * form scrolls to the card and rings it. Copy and eligibility live together
 * here, keyed by the registry, so adding a product-page spotlight key is a
 * compile error until this map has a row for it — a banner with nothing to
 * say, or a key no row forwards, is a deep link that dead-ends.
 */
export interface ProductSpotlightCopy {
	/** One line: what the seller is looking for. */
	title: string;
	/** What to do next, when at least one eligible listing exists. */
	body: string;
	/** What to do instead, when NO listing is eligible — never a dead end. */
	empty: string;
	/** The step-0 card "+ New product" opens on (`?card=`, z8r3fdhkr7) when
	 * only one card can carry the thing — a weekend rate needs a stay, so the
	 * wizard opens on Stay instead of asking the seller to find it. */
	createCard?: KindCard;
	/** Which rows carry the key forward (and so get the ring on their form). */
	applies: (product: { kind?: string }) => boolean;
}

export const PRODUCT_SPOTLIGHT: Record<
	ProductSpotlightKey,
	ProductSpotlightCopy
> = {
	weekend_rate: {
		title: "Weekend rate lives on each stay listing",
		body: "Open a stay listing below and we'll take you straight to its “Do weekend nights cost more?” question, open and ready to set.",
		empty:
			"You don't have a stay listing yet. + New product opens one on “A stay or rental”, and the weekend rate is in its Pricing step.",
		createCard: "stay",
		// Every stay, packaged or not: a package's row says the weekend rate
		// doesn't apply and why, which is the answer that seller came for.
		applies: (product) => effectiveKind(product.kind) === "booking",
	},
	prep_time: {
		title: "Prep time and the pickup note live on each product",
		body: "Open a product below and we'll take you straight to its “Any rules on how it’s ordered?” question, where prep time sits beside the minimum quantity. The pickup note is the question right under it.",
		empty:
			"You don't have a product yet. Create one, and both are questions under At checkout on its page.",
		// Everything but bookings: a booking listing's notice row carries only
		// the lead-time rule — prep time and the pickup note never render
		// there, so forwarding the key would ring a row missing the thing the
		// note announced.
		applies: (product) => effectiveKind(product.kind) !== "booking",
	},
	promo: {
		title: "A promotion runs on each product",
		body: "Open a product below and we'll take you straight to its “Is it on sale right now?” question, under the price, where the sale price, its dates and the flash-sale limits live.",
		empty:
			"You don't have a product yet. Create one and “Is it on sale right now?” sits right under the price.",
		// Every kind: the row renders on all of them. A booking or an event
		// shows the flash-sale extras' place with the reason they don't apply,
		// and the sale price itself still works there.
		applies: () => true,
	},
};
