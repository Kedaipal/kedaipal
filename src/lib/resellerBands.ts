// Single source of truth for the Scale tier's active-reseller pricing bands
// (ClickUp 86ey4gaju). Presentation-only: these mirror the ticketed band table
// and are consumed by both the /pricing page and the landing pricing teaser so
// the numbers never drift between the two surfaces.
//
// The real active-reseller counting + banded billing is a separate Scale build
// task; until it ships, Scale renders "Coming soon" and these bands are purely
// display. Prices here are display strings (RM-prefixed) — NOT billing amounts.
// The billing amount lives in convex/lib/plans.ts (PLAN_MONTHLY_PRICE.scale),
// which equals the lowest band (RM299) today.

export type ResellerBandLabel = "upTo10" | "11to30" | "31to75" | "75plus";

export interface ResellerBand {
	/** i18n key suffix — the active-reseller count column resolves via
	 * `m.pricingpage_band_<labelKey>()`. */
	labelKey: ResellerBandLabel;
	/** Display price for the month, RM-prefixed. `null` = custom (talk to us). */
	price: string | null;
}

export const RESELLER_BANDS: ResellerBand[] = [
	{ labelKey: "upTo10", price: "RM299" },
	{ labelKey: "11to30", price: "RM499" },
	{ labelKey: "31to75", price: "RM799" },
	{ labelKey: "75plus", price: null },
];

/** Lowest band price (RM), shown as the "from RM299" anchor on the Scale card. */
export const SCALE_FROM_PRICE = 299;
