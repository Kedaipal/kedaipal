// Single source of truth for plan pricing + entitlement caps. Pure module (no
// Convex imports) so both server and client/tests can read it. Pricing locked per
// CLAUDE.md; founding members get a 30% lifetime discount (manual in v1). All
// money is in MINOR units (sen), consistent with orders. See
// docs/manual-subscription.md.

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
	 * Scale's "unlimited"; reaffirmed 2026-07-19 — Scale is the flat multi-outlet
	 * tier, no metering, and the hidden quote-based Enterprise sits above it). */
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
	},
	pro: {
		crm: true,
		orderInbox: true,
		chargeablePickup: true,
		categories: true,
		insights: true,
		radiusDelivery: true,
	},
	scale: {
		crm: true,
		orderInbox: true,
		chargeablePickup: true,
		categories: true,
		insights: true,
		radiusDelivery: true,
	},
};

export function featuresForPlan(plan: Plan): PlanFeatures {
	return { ...PLAN_FEATURES[plan] };
}

// Standard monthly price (minor units / sen).
export const PLAN_MONTHLY_PRICE: Record<Plan, number> = {
	starter: 7900,
	pro: 14900,
	scale: 29900,
};

// Founding Member monthly price — 30% lifetime discount (manual v1). Only the
// Pro number is reachable at launch; Scale kept for when it activates.
export const FOUNDING_MONTHLY_PRICE: Record<"pro" | "scale", number> = {
	pro: 10400, // RM104
	scale: 20900, // RM209
};

// Annual billing = 10 months paid, 12 received (~17% off), per CLAUDE.md.
export const ANNUAL_MONTHS_CHARGED = 10;

/** Plan price for a billing cycle (minor units). Annual = monthly × 10. */
export function planPrice(
	plan: Plan,
	cycle: BillingCycle,
	founding = false,
): number {
	const monthly =
		founding && (plan === "pro" || plan === "scale")
			? FOUNDING_MONTHLY_PRICE[plan]
			: PLAN_MONTHLY_PRICE[plan];
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
