/**
 * Spotlight deep links — the `?spot=` search param on `/app/settings`.
 *
 * A What's-new note that says "Connect Delyva" and drops the seller at the top
 * of a six-card tab has done half the job: they still have to find the card.
 * This registry maps a stable key to the tab it lives on and the anchor id of
 * the exact card, so a note can send the seller to the thing and ring it in
 * the brand mint ("spotlight" in `highlightRingClass`) — the same scroll-and-
 * ring machinery the post-switch checklist uses via `?fix=` (86eyqgujv), with
 * a friendlier colour because nothing is wrong.
 *
 * Why a registry and not a raw anchor in the URL: a hand-typed `?spot=` must
 * never ring an arbitrary element, and the tab must always agree with the
 * anchor — `spotlightHref` builds both halves from one key so a note cannot
 * point at the right card on the wrong tab.
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

export const SPOTLIGHT_ANCHOR = {
	lalamove: { tab: "integrations", anchor: "settings-lalamove" },
	delyva: { tab: "integrations", anchor: "settings-delyva" },
	hitpay: { tab: "integrations", anchor: "settings-hitpay" },
	delivery_charge: { tab: "fulfilment", anchor: "settings-delivery-charge" },
	annual_billing: { tab: "billing", anchor: "settings-annual-billing" },
	invoice_history: { tab: "billing", anchor: "settings-invoice-history" },
	business_details: { tab: "store", anchor: "settings-business-details" },
	store_country: { tab: "store", anchor: "settings-country" },
} as const satisfies Record<string, { tab: SpotlightTab; anchor: string }>;

export type SpotlightKey = keyof typeof SPOTLIGHT_ANCHOR;

export function isSpotlightKey(value: unknown): value is SpotlightKey {
	// hasOwn, not `in`: `?spot=toString` must not walk the prototype into a
	// function-valued "anchor".
	return typeof value === "string" && Object.hasOwn(SPOTLIGHT_ANCHOR, value);
}

/** The `href` a release note carries: tab and spot from one key. */
export function spotlightHref(key: SpotlightKey): string {
	const { tab } = SPOTLIGHT_ANCHOR[key];
	return `/app/settings?tab=${tab}&spot=${key}`;
}
