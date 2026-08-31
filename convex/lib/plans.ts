// Single source of truth for plan pricing + entitlement caps. Pure module (no
// Convex imports) so both server and client/tests can read it. Pricing locked per
// CLAUDE.md; founding members get a 30% lifetime discount (manual in v1). All
// money is in MINOR units (sen), consistent with orders. See
// docs/manual-subscription.md.
//
// The `Country` import is type-only, so this stays a pure module with no
// runtime dependency on `country.ts` (which does import `convex/values`).

import type { Country } from "./country";

export type Plan = "starter" | "pro" | "scale";
export type BillingCycle = "monthly" | "annual";

export const PLANS: Plan[] = ["starter", "pro", "scale"];

/** Plan currently selectable at signup. Scale is disabled ("Coming soon") for v1
 * — schema keeps it so future activation needs no migration. */
export function isPlanSelectable(plan: Plan): boolean {
	return plan === "starter" || plan === "pro";
}

/** Only Pro grants a Founding Member rank at v1 (Arif's 2026-05-28 decision —
 * Scale is disabled and grants no badge). */
export function planQualifiesForFounding(plan: Plan): boolean {
	return plan === "pro";
}

export type PlanCaps = {
	/** Monthly order cap. SOFT in v1 — drives a dashboard nudge, never blocks the
	 * public storefront. All tiers are finite (Arif's 2026-06-28 decision dropped
	 * Scale's "unlimited"). NOTE: the pricing page advertises the *decided*
	 * allowances 100/200/400 (caps ticket 86eye2ccu) ahead of enforcement. These
	 * constants still read Pro 500 / Scale 2,000 until 86eye2ccu ships the lower
	 * caps — and this is the value the shipped billing-tab order meter renders as
	 * its denominator — so the advertised copy and this constant deliberately
	 * diverge for BOTH Pro and Scale in the meantime. */
	orderCap: number;
	/** Hard cap on dashboard users. */
	userCap: number;
	/** Monthly broadcast quota (hard, seller-side). */
	broadcastQuota: number;
};

// Per CLAUDE.md pricing table.
export const PLAN_CAPS: Record<Plan, PlanCaps> = {
	starter: { orderCap: 100, userCap: 1, broadcastQuota: 0 },
	pro: { orderCap: 500, userCap: 2, broadcastQuota: 100 },
	scale: { orderCap: 2000, userCap: 5, broadcastQuota: 500 },
};

/** Boolean feature entitlements per plan — the pricing table's ✓/– rows for
 * features that are LIVE (coming-soon rows don't belong here until they ship).
 * Resolved onto `AccessState.features` by `resolveAccess`, which is the single
 * place allowed to read `plan` for gating — feature checks everywhere else read
 * the resolved descriptor, keeping room for per-retailer overrides later. */
export type PlanFeatures = {
	/** Customer database (CRM-lite): /app/customers list + detail + notes. */
	crm: boolean;
	/** Order Inbox (86expm4xx): buckets, search, filters, bulk actions, CSV
	 * export. The plain order list + status pipeline stays un-gated — that's
	 * the all-tier "Order pipeline" row. */
	orderInbox: boolean;
	/** Chargeable pickup locations (86ey5tywf): setting a flat per-location
	 * fee is a Pro fulfilment-configuration feature. Gates only the seller
	 * SETTING a fee — an order that already carries a frozen fee displays it
	 * on every tier (the fee is inherent to the order). */
	chargeablePickup: boolean;
	/** Product categories (86ey81n63): grouping products into storefront
	 * browse categories. Gates only the seller BUILDING the structure (create/
	 * edit/reorder categories + ADDING product assignments) — archiving a
	 * category and clearing assignments stay all-tier so a downgraded seller is
	 * never trapped, and the buyer-facing storefront always renders whatever
	 * categories exist. */
	categories: boolean;
	/** Seller Insights (86ey5tfrz): the /app/insights analytics page. Starter
	 * gets a locked teaser; the query returns `{ gated: true }` server-side. */
	insights: boolean;
	/** Radius-based delivery pricing (86extzdr8): distance bands from the
	 * seller's business address. Gates only SETTING a radius config — clearing
	 * it (or switching to the all-tier flat fee) stays un-gated so a downgraded
	 * seller is never trapped, and an order's frozen fee displays on every
	 * tier. The flat delivery fee is deliberately NOT a feature row — a wrong
	 * total is a correctness bug, so flat is all-tier. */
	radiusDelivery: boolean;
	/** Lalamove delivery (86eyb5hrf): enabling rider booking + the live
	 * provider-quote pricing mode. Gates only ENABLING/SETTING — disabling,
	 * clearing credentials and switching pricing away stay un-gated (never
	 * trap a downgraded seller), and buyer-side fee rendering + an order's
	 * frozen fee are all-tier (buyer flow never varies by seller plan). */
	delivery: boolean;
	/** HitPay online payments (86eyb6z3a): connecting the seller's own HitPay
	 * account so buyers get a hosted Pay-now checkout that auto-confirms
	 * payment. Gates only CONNECTING/ENABLING — disabling + clearing keys stay
	 * un-gated (downgrade never traps), and a connected store's buyer-facing
	 * Pay-now keeps working on every tier (buyer flow never varies by plan). */
	onlinePayments: boolean;
	/** Seller WhatsApp order alerts (86eyhw9zy): a WA template to the seller's
	 * own number on new order + payment claim. Pro because each alert is a
	 * billable Meta send (absorbed into the plan — decided 7 Aug 2026, no
	 * add-on SKU). Gates only ENABLING the toggle — disabling and clearing the
	 * number stay un-gated so a downgraded seller is never trapped. */
	waOrderAlerts: boolean;
};

export type PlanFeature = keyof PlanFeatures;

export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
	starter: {
		crm: false,
		orderInbox: false,
		chargeablePickup: false,
		categories: false,
		insights: false,
		radiusDelivery: false,
		delivery: false,
		onlinePayments: false,
		waOrderAlerts: false,
	},
	pro: {
		crm: true,
		orderInbox: true,
		chargeablePickup: true,
		categories: true,
		insights: true,
		radiusDelivery: true,
		delivery: true,
		onlinePayments: true,
		waOrderAlerts: true,
	},
	scale: {
		crm: true,
		orderInbox: true,
		chargeablePickup: true,
		categories: true,
		insights: true,
		radiusDelivery: true,
		delivery: true,
		onlinePayments: true,
		waOrderAlerts: true,
	},
};

export function featuresForPlan(plan: Plan): PlanFeatures {
	return { ...PLAN_FEATURES[plan] };
}

/** Currencies Kedaipal itself invoices subscriptions in. Distinct from the
 * storefront `SUPPORTED_CURRENCIES` (lib/currency.ts) — a seller's shop can
 * trade in more currencies than we bill in. Exhaustive Records below make a
 * future billing currency a compile error, never a silent MYR fallback. */
export type BillingCurrency = "MYR" | "SGD";
export const BILLING_CURRENCIES: BillingCurrency[] = ["MYR", "SGD"];

/**
 * Which currency Kedaipal invoices a seller in, by the country they're in.
 *
 * Deliberately NOT `COUNTRY_CURRENCY` (lib/country.ts): that maps a country to
 * the full storefront `SupportedCurrency` union, which is wider than the set we
 * bill subscriptions in. One author here, because three public pricing surfaces
 * (landing teaser, /pricing, /cost) each had their own
 * `region === "SG" ? … : …` ternary.
 */
export const BILLING_CURRENCY_FOR_COUNTRY: Record<Country, BillingCurrency> = {
	MY: "MYR",
	SG: "SGD",
};

// Standard monthly price per billing currency (minor units — sen / cents).
// SGD numbers come from the Aug 2026 SG pricing deck (S$29 / S$59 / S$119).
export const PLAN_MONTHLY_PRICES: Record<
	BillingCurrency,
	Record<Plan, number>
> = {
	MYR: { starter: 7900, pro: 14900, scale: 29900 },
	SGD: { starter: 2900, pro: 5900, scale: 11900 },
};

// MYR shorthand for the table above.
export const PLAN_MONTHLY_PRICE: Record<Plan, number> = PLAN_MONTHLY_PRICES.MYR;

// Founding Member monthly price — 30% lifetime discount (manual v1), per
// billing currency, rounded DOWN to a whole unit the same way in each (MYR
// RM104.30 → RM104; SGD S$41.30 → S$41, S$83.30 → S$83). Only the Pro number
// is reachable at launch; Scale kept for when it activates.
export const FOUNDING_MONTHLY_PRICES: Record<
	BillingCurrency,
	Record<"pro" | "scale", number>
> = {
	MYR: { pro: 10400, scale: 20900 },
	SGD: { pro: 4100, scale: 8300 },
};

// MYR shorthand for the founding table above.
export const FOUNDING_MONTHLY_PRICE: Record<"pro" | "scale", number> =
	FOUNDING_MONTHLY_PRICES.MYR;

/**
 * Price of each outlet beyond the three Scale includes (minor units).
 *
 * Display copy only — Scale is still "Coming soon" and the billing lever ships
 * with that build (docs/pricing.md). It lives here rather than inside the
 * message catalogs because the catalogs used to spell "RM49" into the sentence,
 * which quoted ringgit at a Singaporean reading S$ tier prices two lines above.
 *
 * SGD follows the tier ratio (SGD ≈ 0.4 × MYR across all three plans) and keeps
 * the same just-under-a-round-number shape. UNCONFIRMED — swap in a decided
 * number when Scale is priced for sale.
 */
export const OUTLET_ADDON_MONTHLY_PRICES: Record<BillingCurrency, number> = {
	MYR: 4900,
	SGD: 1900,
};

/**
 * What the metered/per-message competitors charge per month (minor units) —
 * the anchor the landing teaser prices Kedaipal against. A range, because it
 * spans several tools.
 *
 * SGD is the same band at the tier ratio, not an FX conversion of the ringgit
 * figures. UNCONFIRMED for Singapore in the way the MY band is not.
 */
export const COMPETITOR_MONTHLY_RANGE: Record<
	BillingCurrency,
	{ min: number; max: number }
> = {
	MYR: { min: 20000, max: 50000 },
	SGD: { min: 8000, max: 20000 },
};

/**
 * "Less than X a day" — the Starter price spread across a month. Derived, so
 * the claim can never contradict the tier card beside it (RM79/mo → RM3,
 * S$29/mo → S$1).
 *
 * `floor + 1`, not `ceil`: at a price that divides evenly (RM90 → exactly 3)
 * `ceil` returns the daily rate itself and "less than RM3 a day" becomes
 * false. Strictly-true beats tightest-possible for a public claim — the cost
 * is one unit of slack on prices that divide by 30, and neither of today's
 * does.
 */
export function starterPricePerDay(currency: BillingCurrency): number {
	return Math.floor(PLAN_MONTHLY_PRICES[currency].starter / 100 / 30) + 1;
}

// Annual billing = 10 months paid, 12 received (~17% off), per CLAUDE.md.
export const ANNUAL_MONTHS_CHARGED = 10;

/** Plan price for a billing cycle (minor units). Annual = monthly × 10. */
export function planPrice(
	plan: Plan,
	cycle: BillingCycle,
	founding = false,
	currency: BillingCurrency = "MYR",
): number {
	const monthly =
		founding && (plan === "pro" || plan === "scale")
			? FOUNDING_MONTHLY_PRICES[currency][plan]
			: PLAN_MONTHLY_PRICES[currency][plan];
	return cycle === "annual" ? monthly * ANNUAL_MONTHS_CHARGED : monthly;
}

export const TRIAL_DAYS = 14;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Founding cohort size — first 10 paying Pro retailers. */
export const FOUNDING_MEMBER_LIMIT = 10;

/** Caps to denormalize onto a subscription for a plan. Resolves `Infinity` to a
 * large sentinel so it survives Convex's number storage + JSON. */
export function capsForPlan(plan: Plan): PlanCaps {
	const caps = PLAN_CAPS[plan];
	return {
		orderCap: Number.isFinite(caps.orderCap) ? caps.orderCap : UNLIMITED,
		userCap: caps.userCap,
		broadcastQuota: Number.isFinite(caps.broadcastQuota)
			? caps.broadcastQuota
			: UNLIMITED,
	};
}

/** Sentinel for "unlimited" denormalized caps (Convex stores finite numbers;
 * `Infinity` isn't valid JSON). Any cap ≥ this is treated as unlimited. */
export const UNLIMITED = 1_000_000_000;

export function isUnlimited(cap: number): boolean {
	return cap >= UNLIMITED;
}
