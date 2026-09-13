import { effectiveKind } from "../../convex/lib/productKind";
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
	/** Which rows carry the key forward (and so get the ring on their form). */
	applies: (product: { kind?: string }) => boolean;
}

export const PRODUCT_SPOTLIGHT: Record<
	ProductSpotlightKey,
	ProductSpotlightCopy
> = {
	weekend_rate: {
		title: "Weekend rate lives on each stay listing",
		body: "Open a stay listing below and we'll take you straight to its Pricing & capacity card, where the weekend rate sits under the nightly price.",
		empty:
			"You don't have a stay listing yet. Create one with the Booking kind and the weekend rate is in its Pricing step.",
		// Every stay, packaged or not: a package's form shows the weekend
		// rate's place with the reason it doesn't apply, which is the
		// answer that seller came for.
		applies: (product) => effectiveKind(product.kind) === "booking",
	},
};
