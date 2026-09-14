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
 * MY rows are Delyva Malaysia's public partner network (the couriers the app
 * quotes and books through the seller's own account) plus the two cold-chain
 * lanes sellers ask for by name. SG rows are the Delyva Singapore partners as
 * they are enabled: the SG tenant had no service providers behind it on 3 Sep
 * 2026 (`docs/delivery-delyva.md`), so every SG parcel row ships
 * `visible: false` until Delyva confirms it — the section then shows the
 * Lalamove row plus a one-line "being enabled" note rather than an empty grid.
 *
 * MARKS — `src` is the courier's own mark under `public/img/courier/`, each
 * row noting where it came from (the brand's site or press kit, or a Wikimedia
 * Commons file that reproduces the official mark). Marks are third-party
 * trademarks used to state a fact ("you can book X"), never to imply
 * endorsement. SVG wherever one exists; two couriers publish no vector
 * (Line Clear, DD Express), so those are small transparent PNGs — the only
 * rasters on the landing, capped by `couriers.test.ts`. A lane that has no
 * mark of its own (Ninja Cold) rides its parent network's mark with its own
 * name beside it, so nobody mistakes the lane for the network; Chill Freshbox
 * carries Line Clear's own FreshBox lockup. Names are proper nouns and are not
 * translated — the name doubles as the accessible label in every locale.
 *
 * PROVIDER — who actually books the row. Every Delyva partner is quoted and
 * booked through the seller's Delyva account (`docs/delivery-delyva.md`);
 * Lalamove is a separate BYO integration paid from the seller's own Lalamove
 * wallet (`docs/delivery-lalamove.md`), so the landing must never say
 * "Delyva credit" beside a Lalamove quote — the mock card and the rider-only
 * copy (Singapore today) read the provider off the row.
 */

export type CourierGroup = "parcel" | "cold" | "sameday";

/** The integration that quotes and books the row — see PROVIDER above. */
export type CourierProvider = "delyva" | "lalamove";

export interface Courier {
	/** Stable handle — React key and test anchor. */
	id: string;
	/** Brand name as the courier writes it. */
	name: string;
	country: Country;
	/** Parcel network, cold-chain lane, or on-demand rider. */
	group: CourierGroup;
	/** Whose account the booking runs on: the seller's Delyva or Lalamove. */
	provider: CourierProvider;
	/** The courier's mark under `public/img/courier/`; absent ⇒ name chip. */
	src?: string;
	/** Intrinsic-ratio classes for the mark (`h-N w-auto`). */
	markClass?: string;
	/**
	 * The parent network whose mark this lane rides (Ninja Cold on Ninja Van's).
	 * The chip then shows the lane's own name beside the mark — the mark alone
	 * would read as the parent.
	 */
	borrowsMarkFrom?: string;
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

/** Most wordmarks sit well at the chip's 20px; squarer marks get a little more. */
const MARK = "h-5 w-auto";
const MARK_TALL = "h-6 w-auto";
/** Lock-ups whose wordmark is small beside a mascot or emblem. */
const MARK_XL = "h-7 w-auto";
const LALAMOVE_MARK = "h-5 w-auto";

export const COURIERS: readonly Courier[] = [
	// ---- Malaysia — Delyva parcel network ----
	// source: https://commons.wikimedia.org/wiki/File:J%26T_Express_logo.svg
	{
		id: "jt-my",
		name: "J&T Express",
		country: "MY",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/jt.svg",
		markClass: MARK,
		mockQuote: 690,
		speed: "nextday",
		visible: true,
	},
	// source: https://commons.wikimedia.org/wiki/File:Ninjavan.svg
	{
		id: "ninjavan-my",
		name: "Ninja Van",
		country: "MY",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/ninjavan.svg",
		markClass: MARK,
		mockQuote: 760,
		speed: "nextday",
		visible: true,
	},
	// source: https://www.pos.com.my/ (site header, assets.pos.com.my/pos-corporate/images/pos_logo.svg)
	{
		id: "pos-my",
		name: "Pos Malaysia",
		country: "MY",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/pos.svg",
		markClass: MARK_TALL,
		speed: "nextday",
		visible: true,
	},
	// source: https://commons.wikimedia.org/wiki/File:DHL_Logo.svg
	{
		id: "dhl-my",
		name: "DHL eCommerce",
		country: "MY",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/dhl.svg",
		markClass: MARK,
		mockQuote: 740,
		speed: "nextday",
		visible: true,
	},
	// source: https://www.citylinkexpress.com/ (wp-content/uploads/2020/11/City-link-Logo.svg)
	{
		id: "citylink-my",
		name: "City-Link Express",
		country: "MY",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/citylink.svg",
		markClass: MARK_XL,
		speed: "nextday",
		visible: true,
	},
	// source: https://commons.wikimedia.org/wiki/File:Flash_Express_Logo.svg
	{
		id: "flash-my",
		name: "Flash Express",
		country: "MY",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/flash.svg",
		markClass: MARK,
		speed: "nextday",
		visible: true,
	},
	// source: https://lineclearexpress.com/my/aboutus (site header PNG; no vector published)
	{
		id: "lineclear-my",
		name: "Line Clear",
		country: "MY",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/lineclear.png",
		markClass: MARK,
		speed: "nextday",
		visible: true,
	},
	// source: https://commons.wikimedia.org/wiki/File:Pickupp_logo_.svg
	{
		id: "pickupp-my",
		name: "Pickupp",
		country: "MY",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/pickupp.svg",
		markClass: MARK,
		speed: "nextday",
		visible: true,
	},
	// source: https://www.teleport.it/media-library (press kit, "Teleport Logo TM Black.svg")
	{
		id: "teleport-my",
		name: "Teleport",
		country: "MY",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/teleport.svg",
		markClass: MARK,
		speed: "nextday",
		visible: true,
	},
	// source: https://commons.wikimedia.org/wiki/File:Aramex_logo.svg
	{
		id: "aramex-my",
		name: "Aramex",
		country: "MY",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/aramex.svg",
		markClass: MARK,
		speed: "nextday",
		visible: true,
	},
	// source: https://zh.wikipedia.org/wiki/File:SFExpress_logo_SC.svg (official emblem + wordmark)
	{
		id: "sf-my",
		name: "SF Express",
		country: "MY",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/sf.svg",
		markClass: MARK_XL,
		speed: "nextday",
		visible: true,
	},
	// ---- Malaysia — cold chain (chilled / frozen lanes) ----
	// Ninja Cold is Ninja Van's cold-chain lane and publishes no mark of its own.
	{
		id: "ninjacold-my",
		name: "Ninja Cold",
		country: "MY",
		group: "cold",
		provider: "delyva",
		src: "/img/courier/ninjavan.svg",
		markClass: MARK,
		borrowsMarkFrom: "ninjavan-my",
		mockQuote: 1850,
		speed: "nextday",
		visible: true,
	},
	// Chill Freshbox is Delyva's label for Line Clear's FreshBox chilled lane; the
	// mark is Line Clear's own FreshBox lockup (lineclearexpress.com rate brochure).
	{
		id: "chillfreshbox-my",
		name: "Chill Freshbox",
		country: "MY",
		group: "cold",
		provider: "delyva",
		src: "/img/courier/freshbox.svg",
		markClass: MARK_TALL,
		speed: "nextday",
		visible: true,
	},
	// source: https://dd.express/ (site logo PNG; the consumer brand now reads "DD ColdChain")
	{
		id: "ddexpress-my",
		name: "DD Express",
		country: "MY",
		group: "cold",
		provider: "delyva",
		src: "/img/courier/ddexpress.png",
		markClass: MARK,
		speed: "nextday",
		visible: true,
	},
	// ---- Malaysia — same-day riders ----
	{
		id: "lalamove-my",
		name: "Lalamove",
		country: "MY",
		group: "sameday",
		provider: "lalamove",
		src: "/img/lalamove-logo.svg",
		markClass: LALAMOVE_MARK,
		speed: "sameday",
		visible: true,
	},
	// source: https://merchant.grab.com/en-my/brand-centre/grab (GrabExpress uses the Grab wordmark)
	{
		id: "grabexpress-my",
		name: "GrabExpress",
		country: "MY",
		group: "sameday",
		provider: "delyva",
		src: "/img/courier/grab.svg",
		markClass: MARK,
		speed: "sameday",
		visible: true,
	},
	// source: https://pandago.my/ (img-assets/logos/pandago_logo_pink.svg)
	{
		id: "pandago-my",
		name: "pandago",
		country: "MY",
		group: "sameday",
		provider: "delyva",
		src: "/img/courier/pandago.svg",
		markClass: MARK,
		speed: "sameday",
		visible: true,
	},
	// ---- Singapore — same-day rider (live) ----
	{
		id: "lalamove-sg",
		name: "Lalamove",
		country: "SG",
		group: "sameday",
		provider: "lalamove",
		src: "/img/lalamove-logo.svg",
		markClass: LALAMOVE_MARK,
		mockQuote: 900,
		speed: "sameday",
		visible: true,
	},
	// ---- Singapore — Delyva parcel partners, hidden until enabled ----
	{
		id: "ninjavan-sg",
		name: "Ninja Van",
		country: "SG",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/ninjavan.svg",
		markClass: MARK,
		speed: "nextday",
		visible: false,
	},
	{
		id: "jt-sg",
		name: "J&T Express",
		country: "SG",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/jt.svg",
		markClass: MARK,
		speed: "nextday",
		visible: false,
	},
	// Qxpress (Qoo10's courier) became TracX Logis in Nov 2024 — the old name would date the page.
	// source: https://www.tracxlogis.com/ (site logo SVG)
	{
		id: "tracx-sg",
		name: "TracX Logis",
		country: "SG",
		group: "parcel",
		provider: "delyva",
		src: "/img/courier/tracx.svg",
		markClass: MARK,
		speed: "nextday",
		visible: false,
	},
];

/** Display order of the groups on the landing (parcels, then cold, then rider). */
export const COURIER_GROUP_ORDER: readonly CourierGroup[] = [
	"parcel",
	"cold",
	"sameday",
];

/** Visible couriers for a region, in group order then config order. */
export function couriersFor(country: Country): Courier[] {
	return COURIER_GROUP_ORDER.flatMap((group) =>
		COURIERS.filter(
			(c) => c.visible && c.country === country && c.group === group,
		),
	);
}

/**
 * Whether the region has any Delyva parcel/cold lane live (vs rider only).
 * False flips the Delivery section to its rider-only copy — heading, sub and
 * first bullet name Lalamove, the cold-chain bullet drops — because a headline
 * promising "cold chain included" above a one-courier catalogue is a lie.
 */
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
