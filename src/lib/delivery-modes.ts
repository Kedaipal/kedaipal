import type { DeliveryConfig } from "../../convex/lib/delivery";

/**
 * How delivery pricing reads to a SELLER — the one author of each mode's
 * title and one-line description (86eye9xd4). The settings rail's glance, the
 * Fulfilment tab's Delivery card and the delivery-pricing page all read these,
 * so a mode can never be called two different things on one screen.
 *
 * (`DELIVERY_MODE_LABELS` in convex/lib/delivery.ts is the mid-sentence form
 * used inside copy — "your flat fee delivery pricing stops quoting".)
 */

/** Every mode the seller can pick. The stored legacy `"lalamove"` mode shows
 * as `"live"` — one tile has covered both since live courier pricing landed. */
export type PricingMode = "free" | "flat" | "radius" | "weight" | "live";

export function pricingModeOf(config: DeliveryConfig | undefined): PricingMode {
	if (!config) return "free";
	return config.mode === "lalamove" ? "live" : config.mode;
}

export const PRICING_MODE_UI: Record<
	PricingMode,
	{
		title: string;
		/** A rail/index glance has ~14 characters before it truncates. */
		short: string;
		/** The row's honest one-liner on the pricing page. */
		description: string;
		/** Who runs it — the built-in / partner grammar (z8r3fdcx5k). */
		source: "builtin" | "partner";
	}
> = {
	free: {
		title: "Free",
		short: "Free",
		description: "No delivery charge",
		source: "builtin",
	},
	flat: {
		title: "Flat fee",
		short: "Flat fee",
		description:
			"The same fee on every order, with an optional free-above threshold",
		source: "builtin",
	},
	weight: {
		title: "By weight & zone",
		short: "Weight & zone",
		description:
			"Your courier's rate card — price by the buyer's state and the parcel's weight. You book the courier.",
		source: "builtin",
	},
	radius: {
		title: "By distance",
		short: "By distance",
		description: "Radius bands from your address — you deliver it yourself",
		source: "builtin",
	},
	live: {
		title: "Live courier price",
		short: "Live price",
		description:
			"The real courier price at checkout and one-tap booking — on the account you connect under Integrations",
		source: "partner",
	},
};

/** Built-in modes in the order the page lists them (the default first,
 * Pro-gated last). Partner modes follow under their own label. */
export const BUILTIN_PRICING_MODES: ReadonlyArray<PricingMode> = [
	"free",
	"flat",
	"weight",
	"radius",
];

/**
 * The one-line summary of a saved config — "Flat fee · RM 8.00",
 * "By weight & zone · 2 zones". `formatMoney` is injected so this stays a
 * pure function the tests can drive without a currency fixture.
 */
export function pricingSummary(
	config: DeliveryConfig | undefined,
	formatMoney: (sen: number) => string,
): string {
	const mode = pricingModeOf(config);
	const title = PRICING_MODE_UI[mode].title;
	if (!config) return title;
	switch (config.mode) {
		case "flat":
			return `${title} · ${formatMoney(config.fee)}`;
		case "radius":
			return `${title} · ${config.bands.length} band${config.bands.length === 1 ? "" : "s"}`;
		case "weight":
			return `${title} · ${config.zones.length} zone${config.zones.length === 1 ? "" : "s"}`;
		default:
			return title;
	}
}
