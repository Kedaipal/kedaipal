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
 * Three destinations, one ring:
 *
 * - **`home`** — one section on the Home page. `spotlightHref` renders
 *   `/app?spot=<key>`; Home scrolls to the section and rings its card. Added
 *   for the Refer-a-kedai card (z8r3fdfp97), which sits LAST on Home — a note
 *   that dropped the seller at the top of Home would have announced a card
 *   below the fold.
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
	| { page: "home"; anchor: string }
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
	// The three cards the 30 Aug 2026 pricing reset added (z8r3fday24 +
	// 86eyb6z4r). Each is one card on the Billing tab, so a note about the
	// free period, the hold or a mid-cycle switch lands on the control rather
	// than the top of the tab.
	plan_change: {
		page: "settings",
		tab: "billing",
		anchor: "settings-plan-change",
	},
	seasonal_hold: {
		page: "settings",
		tab: "billing",
		anchor: "settings-seasonal-hold",
	},
	auto_renewal: {
		page: "settings",
		tab: "billing",
		anchor: "settings-auto-renewal",
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
	// The credit balance card (Credits T3, z8r3fdf8hy), directly under the plan
	// — the number a seller checks most. Reuses the anchor the out-of-credits
	// banner's "See credits" link already carries (`#credits`), rather than
	// minting a second id for the same card; both now read it from here and
	// spotlight.test.ts pins the agreement.
	credit_balance: { page: "settings", tab: "billing", anchor: "credits" },
	store_country: { page: "settings", tab: "store", anchor: "settings-country" },
	// The Business address card — the post-switch checklist already anchors it
	// (`?fix=business_address`), so this key reuses that exact id, as the
	// hitpay/delivery_charge precedent does. Added for the v2026.09.6 unit-line
	// note (z8r3fdff8r): the field is on this card and the pickup dialog both,
	// and the card is the one a note can land on.
	business_address: {
		page: "settings",
		tab: "fulfilment",
		anchor: "settings-business-address",
	},
	// The Opening hours card (z8r3fdff8r) — where the second daily window
	// lives. The card, not the editor: the ring answers "where are my hours?",
	// and the split is inside Edit.
	opening_hours: {
		page: "settings",
		tab: "fulfilment",
		anchor: "settings-opening-hours",
	},
	// The Closed dates card (z8r3fdhpm7), directly under Opening hours — the
	// booking calendar's "manage closed dates" link and a release note both
	// land on it.
	closed_dates: {
		page: "settings",
		tab: "fulfilment",
		anchor: "settings-closed-dates",
	},
	// The Pickup points card (z8r3fdjgvd) — where an event venue is picked and
	// where the "guests aren't charged the fee" line now sits. Reuses the
	// post-switch checklist's own anchor rather than minting a second id for
	// the same card; the agreement is pinned in spotlight.test.ts.
	pickup_points: {
		page: "settings",
		tab: "fulfilment",
		anchor: "settings-pickup",
	},
	// The Event venues card (z8r3fdm32x), directly after Pickup and NOT inside
	// it — a venue no longer masquerades as a deactivated pickup point, so it
	// has a card of its own, and the v2026.10.2 note lands on it rather than
	// on the Pickup card above. It renders on a plan with events or for a store
	// that already has a venue; anywhere else the link opens Fulfilment with
	// nothing to ring, and the note names the plan.
	event_venues: {
		page: "settings",
		tab: "fulfilment",
		anchor: "settings-event-venues",
	},
	// The store on/off switch (z8r3fdudf7) — FIRST on the Store tab, full
	// width above the columns: whether the store takes orders at all.
	store_status: {
		page: "settings",
		tab: "store",
		anchor: "settings-store-status",
	},
	// "How buyers pay" (86eye9xd4, 8A) — the top of the Payments tab, where
	// HitPay is switched on as the one way buyers pay, or off again.
	how_buyers_pay: {
		page: "settings",
		tab: "payments",
		anchor: "settings-how-buyers-pay",
	},
	// The Store listing card (z8r3fdkmyp), right under the store description the
	// public directory builds its card from — where the area line is typed and
	// where a seller takes the shop off /stores.
	store_listing: {
		page: "settings",
		tab: "store",
		anchor: "settings-marketplace",
	},
	// The Refer-a-kedai section (z8r3fdfp97) — the last thing on Home, with
	// the seller's referral link and what each side earns. The id sits on the
	// section so the scroll lands on its heading; the ring goes on its card.
	refer: { page: "home", anchor: "home-refer" },
	// Product-page anchors are QUESTION ROWS since z8r3fdv1z2: the form scrolls
	// to the row, rings it and opens it, so the seller lands on the field.
	// The "Do weekend nights cost more?" row of a stay listing (S13,
	// z8r3fddkp8).
	weekend_rate: { page: "product", anchor: "product-weekend-rate" },
	// The "Any rules on how it's ordered?" row of a non-booking product
	// (z8r3fdff97) — prep time beside the minimum quantity and notice rules it
	// composes with; the pickup note is the row right under it.
	prep_time: { page: "product", anchor: "product-order-rules" },
	// "Is it on sale right now?" (z8r3fdcw72), directly under the price on
	// every kind of product — the sale price, its window and the flash extras.
	promo: { page: "product", anchor: "product-promo" },
} as const satisfies Record<string, SpotlightTarget>;

export type SpotlightKey = keyof typeof SPOTLIGHT_ANCHOR;

/** Keys whose section is on Home — the only ones `/app` accepts. */
export type HomeSpotlightKey = {
	[K in SpotlightKey]: (typeof SPOTLIGHT_ANCHOR)[K] extends { page: "home" }
		? K
		: never;
}[SpotlightKey];

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

export function isHomeSpotlightKey(value: unknown): value is HomeSpotlightKey {
	return isSpotlightKey(value) && SPOTLIGHT_ANCHOR[value].page === "home";
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
	if (target.page === "home") return `/app?spot=${key}`;
	if (target.page === "product") return `/app/products?spot=${key}`;
	return `/app/settings?tab=${target.tab}&spot=${key}`;
}
