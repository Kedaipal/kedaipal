/**
 * Spotlight deep links — the `?spot=` search param a What's-new note carries.
 *
 * A What's-new note that says "Connect Delyva" and drops the seller at the top
 * of a six-card tab has done half the job: they still have to find the card.
 * This registry maps a stable key to the PAGE the thing lives on and the
 * anchor id of the exact card, so a note can send the seller to the thing and
 * ring it in the brand mint ("spotlight" in `highlightRingClass`) — the same
 * scroll-and-ring machinery the post-switch checklist uses via `?fix=`
 * (86eyqgujv), with a friendlier colour because nothing is wrong.
 *
 * Two destinations, one ring:
 *
 * - **`settings`** — one card on a Settings tab. `spotlightHref` renders
 *   `/app/settings?tab=<tab>&spot=<key>`; the route scrolls to the card.
 * - **`product`** — one card on a product's edit form. A note can't know
 *   WHICH product, so `spotlightHref` renders `/app/products?spot=<key>`:
 *   the list explains what the seller is looking for and every eligible row
 *   carries `spot` forward to `/app/products/<id>?spot=<key>`, where the form
 *   scrolls to the card and rings it. Two hops, because a deep link that
 *   guesses a product would land on the wrong one for every seller but one.
 *
 * Why a registry and not a raw anchor in the URL: a hand-typed `?spot=` must
 * never ring an arbitrary element, and the page must always agree with the
 * anchor — `spotlightHref` builds both halves from one key so a note cannot
 * point at the right card on the wrong page. Each page validates `spot`
 * against ITS OWN keys (`isSettingsSpotlightKey` / `isProductSpotlightKey`),
 * so a settings key pasted onto the products list is dropped, not rung.
 *
 * Adding a key: give the card an `id` (and thread `highlight` to it), add the
 * row here, and `spotlight.test.ts` checks the tab exists and the anchor is
 * rendered somewhere under `src/`.
 */

/** Mirrors the `SettingsTab` union in `app.settings.tsx`; pinned by test. */
export type SpotlightTab =
	| "store"
	| "billing"
	| "whatsapp"
	| "payments"
	| "fulfilment"
	| "integrations"
	| "bookings"
	| "order-status";

export type SpotlightTarget =
	| { page: "settings"; tab: SpotlightTab; anchor: string }
	| { page: "product"; anchor: string };

export const SPOTLIGHT_ANCHOR = {
	lalamove: {
		page: "settings",
		tab: "integrations",
		anchor: "settings-lalamove",
	},
	delyva: { page: "settings", tab: "integrations", anchor: "settings-delyva" },
	hitpay: { page: "settings", tab: "integrations", anchor: "settings-hitpay" },
	delivery_charge: {
		page: "settings",
		tab: "fulfilment",
		anchor: "settings-delivery-charge",
	},
	annual_billing: {
		page: "settings",
		tab: "billing",
		anchor: "settings-annual-billing",
	},
	invoice_history: {
		page: "settings",
		tab: "billing",
		anchor: "settings-invoice-history",
	},
	business_details: {
		page: "settings",
		tab: "store",
		anchor: "settings-business-details",
	},
	store_country: { page: "settings", tab: "store", anchor: "settings-country" },
	// The Pricing & capacity card of a stay listing — where the weekend rate
	// (S13, z8r3fddkp8) lives. The card, not the field: every spotlight rings
	// a card, and the field is its third row, labelled "Weekend rate".
	weekend_rate: { page: "product", anchor: "product-booking-pricing" },
} as const satisfies Record<string, SpotlightTarget>;

export type SpotlightKey = keyof typeof SPOTLIGHT_ANCHOR;

/** Keys whose card is on a Settings tab — the only ones `/app/settings` accepts. */
export type SettingsSpotlightKey = {
	[K in SpotlightKey]: (typeof SPOTLIGHT_ANCHOR)[K] extends { page: "settings" }
		? K
		: never;
}[SpotlightKey];

/** Keys whose card is on a product's edit form — accepted by `/app/products` and `/app/products/<id>`. */
export type ProductSpotlightKey = {
	[K in SpotlightKey]: (typeof SPOTLIGHT_ANCHOR)[K] extends { page: "product" }
		? K
		: never;
}[SpotlightKey];

export function isSpotlightKey(value: unknown): value is SpotlightKey {
	// hasOwn, not `in`: `?spot=toString` must not walk the prototype into a
	// function-valued "anchor".
	return typeof value === "string" && Object.hasOwn(SPOTLIGHT_ANCHOR, value);
}

export function isSettingsSpotlightKey(
	value: unknown,
): value is SettingsSpotlightKey {
	return isSpotlightKey(value) && SPOTLIGHT_ANCHOR[value].page === "settings";
}

export function isProductSpotlightKey(
	value: unknown,
): value is ProductSpotlightKey {
	return isSpotlightKey(value) && SPOTLIGHT_ANCHOR[value].page === "product";
}

/** The `href` a release note carries: page (and tab) and spot from one key. */
export function spotlightHref(key: SpotlightKey): string {
	const target = SPOTLIGHT_ANCHOR[key];
	if (target.page === "product") return `/app/products?spot=${key}`;
	return `/app/settings?tab=${target.tab}&spot=${key}`;
}
