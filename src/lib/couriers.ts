import type { Country } from "../../convex/lib/country";

/**
 * The couriers a Kedaipal seller can book from an order, as one config array
 * (landing v2, ClickUp z8r3fdegej). Adding or pulling a courier is a data edit
 * here, never a design pass in `delivery.tsx` — the same rule the payment
 * wall runs on (`payment-methods.ts`).
 *
 * SCOPE — this is the LANDING catalogue: what the integrations can book,
 * advertised as a fact about the product. It is deliberately NOT shared with
 * the dispatch card, which quotes only the services the seller's own Delyva
 * account returns for that order — a list promising a courier the account
 * can't reach would be a lie on the surface where a seller is about to book.
 *
 * MY rows are the couriers the app has actually booked or quoted (Delyva
 * fixtures + the manual-tracking registry in `convex/lib/couriers.ts`).
 * SG rows are the Delyva Singapore partners as they are enabled: the SG tenant
 * had no service providers behind it on 3 Sep 2026 (`docs/delivery-delyva.md`),
 * so every SG parcel row ships `visible: false` until Delyva confirms it and a
 * brand-approved mark lands — the section then falls back to the Lalamove row
 * plus a one-line "being enabled" note rather than an empty grid.
 *
 * MARKS — `src` is an official SVG under `public/img/courier/`, from the
 * courier's own brand kit (Delyva's partner logo pack, requested by Arif). No
 * mark yet ⇒ a neutral name chip; never a raster, never a logo pulled off a
 * search result (`couriers.test.ts` enforces SVG-and-exists and rejects a
 * base64 PNG in an SVG shell). Names are proper nouns and are not translated —
 * the name doubles as the accessible label in every locale.
 */

export type CourierGroup = "parcel" | "cold" | "sameday";

export interface Courier {
	/** Stable handle — React key and test anchor. */
	id: string;
	/** Brand name as the courier writes it. */
	name: string;
	country: Country;
	/** Parcel network, cold-chain lane, or on-demand rider. */
	group: CourierGroup;
	/** Official SVG mark under `public/img/courier/`; absent ⇒ name chip. */
	src?: string;
	/** Intrinsic-ratio classes for the mark (`h-N w-auto`). */
	markClass?: string;
	/**
	 * A representative quote for the landing mock, in the row's own currency
	 * (minor units). Illustrative — the real card quotes live. Rows without
	 * one never appear in the mock.
	 */
	mockQuote?: number;
	/** Whether the mock's meta line reads "Same-day" or "Next-day". */
	speed: "nextday" | "sameday";
	/** False keeps the row documented but off the page. */
	visible: boolean;
}

const LALAMOVE_MARK = "h-5 w-auto";

export const COURIERS: readonly Courier[] = [
	// ---- Malaysia — Delyva parcel network ----
	{ id: "jt-my", name: "J&T Express", country: "MY", group: "parcel", mockQuote: 690, speed: "nextday", visible: true },
	{ id: "ninjavan-my", name: "Ninja Van", country: "MY", group: "parcel", mockQuote: 760, speed: "nextday", visible: true },
	{ id: "pos-my", name: "Pos Malaysia", country: "MY", group: "parcel", speed: "nextday", visible: true },
	{ id: "dhl-my", name: "DHL eCommerce", country: "MY", group: "parcel", mockQuote: 740, speed: "nextday", visible: true },
	{ id: "citylink-my", name: "City-Link Express", country: "MY", group: "parcel", speed: "nextday", visible: true },
	{ id: "flash-my", name: "Flash Express", country: "MY", group: "parcel", speed: "nextday", visible: true },
	{ id: "lineclear-my", name: "Line Clear", country: "MY", group: "parcel", speed: "nextday", visible: true },
	// ---- Malaysia — cold chain (chilled / frozen lanes) ----
	{ id: "ninjacold-my", name: "Ninja Cold", country: "MY", group: "cold", mockQuote: 1850, speed: "nextday", visible: true },
	{ id: "chillfreshbox-my", name: "Chill Freshbox", country: "MY", group: "cold", speed: "nextday", visible: true },
	{ id: "ddexpress-my", name: "DD Express", country: "MY", group: "cold", speed: "nextday", visible: true },
	// ---- Malaysia — same-day rider ----
	{
		id: "lalamove-my",
		name: "Lalamove",
		country: "MY",
		group: "sameday",
		src: "/img/lalamove-logo.svg",
		markClass: LALAMOVE_MARK,
		speed: "sameday",
		visible: true,
	},
	// ---- Singapore — same-day rider (live) ----
	{
		id: "lalamove-sg",
		name: "Lalamove",
		country: "SG",
		group: "sameday",
		src: "/img/lalamove-logo.svg",
		markClass: LALAMOVE_MARK,
		mockQuote: 900,
		speed: "sameday",
		visible: true,
	},
	// ---- Singapore — Delyva parcel partners, hidden until enabled + marked ----
	{ id: "ninjavan-sg", name: "Ninja Van", country: "SG", group: "parcel", speed: "nextday", visible: false },
	{ id: "jt-sg", name: "J&T Express", country: "SG", group: "parcel", speed: "nextday", visible: false },
	{ id: "qxpress-sg", name: "Qxpress", country: "SG", group: "parcel", speed: "nextday", visible: false },
];

/** Display order of the groups on the landing (parcels, then cold, then rider). */
export const COURIER_GROUP_ORDER: readonly CourierGroup[] = ["parcel", "cold", "sameday"];

/** Visible couriers for a region, in group order then config order. */
export function couriersFor(country: Country): Courier[] {
	return COURIER_GROUP_ORDER.flatMap((group) =>
		COURIERS.filter((c) => c.visible && c.country === country && c.group === group),
	);
}

/** Whether the region has any Delyva parcel/cold lane live (vs rider only). */
export function hasParcelCouriers(country: Country): boolean {
	return couriersFor(country).some((c) => c.group !== "sameday");
}

/** A courier row that carries an illustrative quote. */
export type QuotedCourier = Courier & { mockQuote: number };

/**
 * The rows the quote-card mock shows: up to three visible couriers with an
 * illustrative quote, cheapest first — the order the real card sorts in.
 */
export function mockQuotes(country: Country): QuotedCourier[] {
	return couriersFor(country)
		.filter((c): c is QuotedCourier => typeof c.mockQuote === "number")
		.sort((a, b) => a.mockQuote - b.mockQuote)
		.slice(0, 3);
}
