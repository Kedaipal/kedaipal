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
	 * Scale's "unlimited"). Starter 100 / Pro 200 / Scale 400 — the allowances
	 * `/pricing` advertises (caps ticket 86eye2ccu; the numbers landed with the
	 * 30 Aug 2026 pricing reset, z8r3fday24, so the billing-tab meter's
	 * denominator and the page finally agree). Rows carry the cap denormalized,
	 * so a change here needs `migrations.resyncSubscriptionCaps` on prod.
	 *
	 * While a subscription is ON HOLD the EFFECTIVE cap is 0 (ordering off) —
	 * resolved by `resolveAccess`, never stored, so resuming needs no rewrite. */
	orderCap: number;
	/** Hard cap on dashboard users. */
	userCap: number;
	/** Monthly broadcast quota (hard, seller-side). */
	broadcastQuota: number;
};

// Per CLAUDE.md pricing table.
export const PLAN_CAPS: Record<Plan, PlanCaps> = {
	starter: { orderCap: 100, userCap: 1, broadcastQuota: 0 },
	pro: { orderCap: 200, userCap: 2, broadcastQuota: 100 },
	scale: { orderCap: 400, userCap: 5, broadcastQuota: 500 },
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

/** Fallback when nothing else has said which currency to bill in. Named here
 * rather than spelled at each call site: `src/lib/currency-literals.test.ts`
 * fails on a currency literal anywhere in `src/**`, and an allowlist entry
 * would license every FUTURE hardcoded "RM" in that file too. */
export const DEFAULT_BILLING_CURRENCY: BillingCurrency = "MYR";

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
// Starter/Pro: locked May 2026 (MYR) + the Aug 2026 SG pricing deck (SGD).
// Scale: RM399 / S$149 per the 30 Aug 2026 pricing reset (z8r3fday24 — Arif
// locked RM399 FINAL on 6 Sep after an RM299/RM300 wobble; earlier numbers are
// void). Scale is still "Coming soon", so nobody was repriced by the move.
export const PLAN_MONTHLY_PRICES: Record<
	BillingCurrency,
	Record<Plan, number>
> = {
	MYR: { starter: 7900, pro: 14900, scale: 39900 },
	SGD: { starter: 2900, pro: 5900, scale: 14900 },
};

// MYR shorthand for the table above.
export const PLAN_MONTHLY_PRICE: Record<Plan, number> = PLAN_MONTHLY_PRICES.MYR;

// Founding Member monthly price — 30% lifetime discount (manual v1), per
// billing currency, rounded DOWN to a whole unit the same way in each (MYR
// RM104.30 → RM104, RM279.30 → RM279; SGD S$41.30 → S$41, S$104.30 → S$104).
// Founding pricing was RETIRED for new signups in the 30 Aug 2026 reset — no
// public surface advertises it — but every claimed member keeps their rate, so
// the table stays in billing. Scale kept for when it activates.
export const FOUNDING_MONTHLY_PRICES: Record<
	BillingCurrency,
	Record<"pro" | "scale", number>
> = {
	MYR: { pro: 10400, scale: 27900 },
	SGD: { pro: 4100, scale: 10400 },
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
 * SGD S$18 is the number in the 30 Aug 2026 pricing reset artifact (confirmed
 * by Arif, 1 Sep — it replaced the S$19 ratio guess); MYR RM49 holds.
 */
export const OUTLET_ADDON_MONTHLY_PRICES: Record<BillingCurrency, number> = {
	MYR: 4900,
	SGD: 1800,
};

/**
 * Off-Season Hold — the monthly price of a PAUSED subscription (minor units).
 * RM19 / S$9 per the 30 Aug 2026 pricing reset (z8r3fday24).
 *
 * A hold is a subscription STATUS (`on_hold`), not a `Plan`: the seller keeps
 * their tier (`subscriptions.plan` is what they resume to), ordering switches
 * off, and the storefront / catalog / buyer list / order history stay live.
 * Not on `PLAN_MONTHLY_PRICES` on purpose — widening the `Plan` union would
 * drag a non-tier through every feature matrix and picker. Every surface that
 * quotes the hold price reads it from here (the `pricing-copy.test.ts`
 * currency-literal guard forbids spelling it into copy).
 */
export const HOLD_MONTHLY_PRICES: Record<BillingCurrency, number> = {
	MYR: 1900,
	SGD: 900,
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

// Annual billing = 10 months paid, 12 received. Framed to sellers as "2 months
// free", never as a percentage (Arif, 28 Jul + 9 Aug 2026) — a standing
// discount quoted as a % undercuts the flat-price posture the tiers are sold on.
export const ANNUAL_MONTHS_CHARGED = 10;

/** Months of service a seller receives for one annual payment. */
export const ANNUAL_MONTHS_RECEIVED = 12;

/** Months received free on the annual cycle — derived, so the "2 months free"
 * claim can never contradict what `planPrice` actually charges. */
export const ANNUAL_MONTHS_FREE = ANNUAL_MONTHS_RECEIVED - ANNUAL_MONTHS_CHARGED;

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

/**
 * Every money fact a surface needs to quote the annual cycle, in MINOR units.
 *
 * One author, because the surfaces disagreed. `/pricing` derived its yearly
 * total from the ROUNDED effective monthly — `floor(monthly x 10 / 12) x 10` —
 * so a Starter card advertised RM650/yr against an invoice that `planPrice`
 * puts at RM790. Two definitions of "annual", 17% apart, on the same product.
 * Anything that shows an annual number now reads it from here.
 */
export type AnnualQuote = {
	/** Monthly price for this plan + currency (what 1 month costs today). */
	monthly: number;
	/** What the seller is actually invoiced for the year. Identical to
	 * `planPrice(plan, "annual", founding, currency)` — that is the contract. */
	annualTotal: number;
	/** Cost per month spread across the 12 months RECEIVED. Display only, never
	 * billed — and rounded UP, so `effectiveMonthly × 12` is never less than the
	 * amount actually charged. `Math.round` understated it (MYR Starter: 6,583 ×
	 * 12 = 78,996 against a 79,000 charge), which is the same
	 * strictly-true-beats-tightest rule `starterPricePerDay` documents. */
	effectiveMonthly: number;
	/** 12 monthly invoices minus the annual total — the seller's saving. */
	saving: number;
	/** Months received free (mirrors ANNUAL_MONTHS_FREE; carried on the quote so
	 * a caller never has to import both). */
	monthsFree: number;
};

export function annualQuote(
	plan: Plan,
	founding = false,
	currency: BillingCurrency = "MYR",
): AnnualQuote {
	const monthly = planPrice(plan, "monthly", founding, currency);
	const annualTotal = planPrice(plan, "annual", founding, currency);
	return {
		monthly,
		annualTotal,
		effectiveMonthly: Math.ceil(annualTotal / ANNUAL_MONTHS_RECEIVED),
		saving: monthly * ANNUAL_MONTHS_RECEIVED - annualTotal,
		monthsFree: ANNUAL_MONTHS_FREE,
	};
}

/** Days in a billing cycle — the flat slabs `nextPeriodEnd` grants. */
export function cycleDays(cycle: BillingCycle): number {
	return cycle === "annual" ? 365 : 30;
}

/**
 * Extra days granted on the new plan for value the seller had already paid for
 * — the "credit as days" model for a mid-cycle change.
 *
 * The seller pays the ordinary full price for the new plan, so the invoice
 * stays a bog-standard service bill: the gateway amount check, the saved-method
 * consent guard, the PDF totals and the MRR figure all keep working untouched.
 * What they had left over comes back as TIME rather than as a discount.
 *
 *   valueLeft   = fromPrice × daysLeft / fromCycleDays
 *   carryover   = valueLeft ÷ (toPrice / toCycleDays)
 *
 * Day-rates rather than a naive price ratio, so crossing cycles is right too:
 * RM26 left on a monthly Starter buys 5 days of monthly Pro but only hours of
 * an annual Pro, because an annual plan's daily rate is far lower per ringgit
 * paid. Both prices are read at the seller's OWN founding rate and currency.
 *
 * Deliberately called at SETTLE, never at issue: on the manual rail a seller
 * can pay up to 14 days after the invoice is cut, and `daysLeft` must be the
 * days genuinely still unused when the money lands. Priced at issue, a
 * late-paid upgrade would buy days that had already elapsed — the flaw that
 * sank the charge-the-difference design.
 *
 * Applies to ANY invoice settled while a paid period is still running, not
 * just upgrades: the rule is simply that a seller never loses time they have
 * already bought. That also fixes early renewals, which used to forfeit the
 * remainder silently.
 *
 * Rounds to the nearest whole day (flooring quietly shaves up to a day of paid
 * value); returns 0 once the period has lapsed, so it can never resurrect a
 * period that had already run out.
 */
export type PlanChangeCarryover = {
	/** Whole days still unused on the plan being left. */
	daysLeft: number;
	/** What those days are worth, in minor units, at the OLD plan's rate. */
	valueLeftSen: number;
	/** What that value buys at the NEW plan's daily rate. */
	days: number;
};

export type PlanChangeCarryoverArgs = {
	fromPlan: Plan;
	fromCycle: BillingCycle;
	toPlan: Plan;
	toCycle: BillingCycle;
	founding: boolean;
	currency: BillingCurrency;
	/** The period the seller already paid for. */
	periodEnd: number | undefined;
	now: number;
};

/**
 * The same conversion as `planChangeCarryoverDays`, with its WORKING shown.
 *
 * The seller-facing copy needs all three numbers, not just the answer: told
 * only "16 days carry over" while their billing page says the plan runs
 * another 30, the natural reading is that 14 days were confiscated. What
 * actually carries is the MONEY — every sen of it — and the day count shrinks
 * only because the tier they are moving to costs more per day. Quoting the
 * days left and their value is what makes that land (Zaki, 13 Sep 2026).
 */
export function planChangeCarryover(
	args: PlanChangeCarryoverArgs,
): PlanChangeCarryover {
	const none: PlanChangeCarryover = { daysLeft: 0, valueLeftSen: 0, days: 0 };
	if (args.periodEnd === undefined) return none;
	const msLeft = args.periodEnd - args.now;
	if (msLeft <= 0) return none;
	const fromPrice = planPrice(
		args.fromPlan,
		args.fromCycle,
		args.founding,
		args.currency,
	);
	const toPrice = planPrice(
		args.toPlan,
		args.toCycle,
		args.founding,
		args.currency,
	);
	if (fromPrice <= 0 || toPrice <= 0) return none;
	const daysLeftExact = msLeft / DAY_MS;
	const valueLeft = (fromPrice * daysLeftExact) / cycleDays(args.fromCycle);
	const newDailyRate = toPrice / cycleDays(args.toCycle);
	return {
		// Both rounded from the SAME fractional remainder, so "N days, worth RM X"
		// always reconciles against the old plan's price.
		daysLeft: Math.round(daysLeftExact),
		valueLeftSen: Math.round(valueLeft),
		days: Math.round(valueLeft / newDailyRate),
	};
}

export function planChangeCarryoverDays(args: PlanChangeCarryoverArgs): number {
	return planChangeCarryover(args).days;
}

/** Tier order, low to high. Plan changes are classified by RANK, never by
 * price: a founding Pro (RM104) undercuts a list Starter… no it doesn't, but a
 * promo or a price reset could, and a seller on an ANNUAL Starter (RM790)
 * moving to a MONTHLY Pro (RM149) would read as a "downgrade" on price while
 * being an unmistakable tier upgrade. Rank is total and survives any repricing. */
export function planRank(plan: Plan): number {
	return PLANS.indexOf(plan);
}

/** True when `to` is a higher tier than `from` (the immediate, pay-now
 * direction); false for same-tier or lower (the scheduled direction). */
export function isPlanUpgrade(from: Plan, to: Plan): boolean {
	return planRank(to) > planRank(from);
}

/**
 * The free period's BACKSTOP, in days (start-when-you-sell, z8r3fday24). A new
 * store is free until its FIRST LIVE ORDER — any channel — or until this many
 * days pass, whichever comes first; that moment issues the first invoice
 * (`invoices.internalIssueFirstInvoice`). So this is no longer "the trial
 * length": most stores end their free period earlier, by selling. Copy calls it
 * "day 15" (the invoice lands the day after 14 full free days).
 */
export const TRIAL_DAYS = 14;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Founding cohort size — first 10 paying Pro retailers. */
export const FOUNDING_MEMBER_LIMIT = 10;

/**
 * Founding-benefit retention window (Zaki, 3 Sep 2026; unchanged z8r3fdfyw5):
 * founding benefits survive a subscription lapse of up to 3 months. Sit unpaid
 * longer and the daily pass REVOKES them for good
 * (`foundingMembers.internalRevokeLapsedBenefits`) — the rank and badge stay,
 * permanently, exactly as the agreement and the billing ribbon promise.
 * Surfaced on the billing tab's founding ribbon, its T-14 warning banner and
 * the plan picker — never enforced silently.
 *
 * CONFIRMED by Arif, 19 Sep 2026 (z8r3fdfyw5) — 90 days is the number. It had
 * existed only here and in docs/hitpay-recurring.md, from a verbal call, which
 * is why it was flagged: the signed agreement (86exq9kz9) still reads "RM104/mo
 * for life" with no lapse clause, so the code was the only record of the rule
 * it enforces. Change it here and the cron gate, the T-14 warning, the emails
 * and every surfaced date move together.
 */
export const FOUNDING_PRICE_LAPSE_MS = 90 * DAY_MS;

/** How long before benefits end the seller is warned (z8r3fdfyw5): one email +
 * one billing-tab banner, so nothing is taken without notice. */
export const FOUNDING_BENEFIT_WARNING_MS = 14 * DAY_MS;

export type FoundingEligibilityArgs = {
	isFoundingMember: boolean;
	foundingIntent: boolean;
	paidThrough: number | undefined;
	/** `retailers.foundingBenefitsRevokedAt` — set = benefits ended for good.
	 * REQUIRED, not optional: every caller must answer it, so a new pricing path
	 * cannot forget to and quietly re-grant a revoked discount. */
	benefitsRevokedAt: number | undefined;
	now: number;
};

/**
 * The instant a founding member's benefits end if they never pay: their
 * paid-through plus the window. The ONE author of that date — the cron's
 * revoke gate, the T-14 warning gate, the warning email and the billing-tab
 * banner all read it, so "ends 28 Oct" on the page cannot disagree with the
 * day the cron actually takes it. Undefined when there is no paid period to
 * measure from (a founding trial that never paid — nothing to lapse).
 */
export function foundingBenefitsEndAt(
	paidThrough: number | undefined,
): number | undefined {
	return paidThrough === undefined
		? undefined
		: paidThrough + FOUNDING_PRICE_LAPSE_MS;
}

/**
 * Whether this STORE is on founding pricing right now — for any tier that has
 * a founding price. Tier-agnostic on purpose: `planPrice` already confines the
 * discount to Pro/Scale, so the store-level answer is the one to hand to
 * anything that prices MORE than one tier (the billing page's plan cards, a
 * Starter → Pro carryover). Asking `foundingPricingApplies` with the store's
 * CURRENT plan instead answers "no" for a founding member sitting on Starter,
 * which then prices their move back up to Pro at list (z8r3fdfty4).
 *
 * Order matters: a CLAIMED member is judged on the lapse window even though
 * their `foundingIntent` flag is never cleared after the claim — intent alone
 * only covers the unclaimed first conversion, which has no lapse to measure.
 * `paidThrough` is the subscription's `currentPeriodEnd` (undefined = never
 * had a paid period → fail toward the promise).
 */
export function foundingPriceEligible(args: FoundingEligibilityArgs): boolean {
	// REVOKED OUTRANKS EVERYTHING, and is checked before the `foundingIntent`
	// fallback on purpose (z8r3fdfyw5). That fallback is the trap: a claimed
	// member's `foundingIntent` is never cleared, and it carries NO lapse check —
	// so any revocation that merely cleared `isFoundingMember` would drop through
	// to `return args.foundingIntent` and hand the store founding pricing
	// *forever*, the exact opposite of revoking it. Short-circuiting here makes
	// that unreachable by construction instead of by remembering to clear a
	// second flag. Mutation-tested: delete this line and plans.test.ts goes red.
	if (args.benefitsRevokedAt !== undefined) return false;
	if (args.isFoundingMember) {
		if (args.paidThrough === undefined) return true;
		return args.now - args.paidThrough <= FOUNDING_PRICE_LAPSE_MS;
	}
	return args.foundingIntent;
}

/**
 * Whether a NEW invoice for `plan` (renewal or self-serve) bills at the
 * founding price. One rule for every automated issuer — the admin issue form
 * keeps its explicit founding checkbox (Arif's judgment can override either
 * way). Store eligibility (`foundingPriceEligible`) narrowed to the tiers that
 * carry a founding price.
 */
export function foundingPricingApplies(
	args: FoundingEligibilityArgs & { plan: Plan },
): boolean {
	if (args.plan !== "pro" && args.plan !== "scale") return false;
	return foundingPriceEligible(args);
}

/** Everything the daily pass needs to judge one founding member's benefits. */
export type FoundingLapseGateArgs = {
	status: "trialing" | "active" | "past_due" | "cancelled" | "on_hold";
	/** A comped store isn't billed at all — there is no lapse to measure. */
	comped: boolean;
	/** The subscription's `currentPeriodEnd`. */
	paidThrough: number | undefined;
	benefitsRevokedAt: number | undefined;
	now: number;
};

/**
 * Should the daily pass revoke this member's founding benefits? The EXACT
 * complement of `foundingPriceEligible` for a claimed member, by construction:
 * eligibility survives while `now <= paidThrough + window`, so revocation needs
 * `now > paidThrough + window`. A day-90 boundary where both said "yes" would
 * revoke a member the billing page was still quoting the discount to, which is
 * the one inconsistency this pairing exists to make impossible (invariant-tested
 * in plans.test.ts).
 *
 * Four never-revoke cases, all of them a store that is square with us:
 *  - already revoked — revocation is once, and re-granting is Arif's to do;
 *  - `on_hold` — AN OFF-SEASON HOLD IS A PAYING STORE. Its monthly hold invoice
 *    advances `currentPeriodEnd` at settle, so paid-through protects it too;
 *    both guards are deliberate, and both are pinned by a test;
 *  - `active` — either mid-period, or a renewal invoice still inside its grace;
 *  - `comped`, or no paid period at all (`paidThrough` undefined — a founding
 *    trial that never paid: nothing has lapsed, so we fail toward the promise,
 *    exactly as `foundingPriceEligible` does).
 */
export function foundingBenefitsRevocable(args: FoundingLapseGateArgs): boolean {
	if (args.benefitsRevokedAt !== undefined) return false;
	if (args.comped) return false;
	if (args.status === "active" || args.status === "on_hold") return false;
	const endAt = foundingBenefitsEndAt(args.paidThrough);
	if (endAt === undefined) return false;
	return args.now > endAt;
}

/**
 * Should the T-14 "your founding price ends on {date}" notice go out? Same
 * never-touch cases as revocation, narrowed to the warning window and deduped
 * per PAID PERIOD rather than per member: `sentForPeriodEnd` holds the
 * `currentPeriodEnd` the last warning was about, so paying (which advances the
 * period) lets a future lapse warn again — no clearing logic to forget. The
 * window closes at `endAt`, which the daily cadence always reaches first: 14
 * daily runs sit between T-14 and T-0.
 */
export function foundingBenefitsWarningDue(
	args: FoundingLapseGateArgs & { sentForPeriodEnd: number | undefined },
): boolean {
	if (args.benefitsRevokedAt !== undefined) return false;
	if (args.comped) return false;
	if (args.status === "active" || args.status === "on_hold") return false;
	const endAt = foundingBenefitsEndAt(args.paidThrough);
	if (endAt === undefined) return false;
	if (args.sentForPeriodEnd === args.paidThrough) return false;
	return args.now >= endAt - FOUNDING_BENEFIT_WARNING_MS && args.now <= endAt;
}

/**
 * The one tier a store on founding pricing is billed for (Zaki, 17 Sep 2026).
 * Founding Members stay on Founding Pro: no plan change, no Starter. What they
 * CAN do is stop renewing (turn auto-renewal off). A subscription that then
 * lapses past `FOUNDING_PRICE_LAPSE_MS` has its benefits REVOKED (z8r3fdfyw5),
 * and from there the store is an ordinary seller again, free to pick any plan —
 * permanently, since the revocation outranks the read-time window. The lock
 * needs no code for that: it keys off `foundingPriceEligible`, so it opens the
 * moment revocation lands (pinned by a test). Scale joins when it becomes
 * purchasable (its founding row already exists).
 */
export const FOUNDING_PLAN = "pro" satisfies Plan;

/** True when a store on founding pricing asks to be billed for any tier but
 * Founding Pro — every self-serve plan path refuses it server-side, and the
 * billing page never offers it. */
export function foundingPlanLocked(plan: Plan, foundingEligible: boolean): boolean {
	return foundingEligible && plan !== FOUNDING_PLAN;
}

/**
 * The currency a store's renewals and mid-cycle plan changes bill in: its last
 * PAID invoice's (a one-off experiment or a void must not flip it), falling
 * back to its country. A brand-new self-serve subscription bills in the
 * country currency instead — there is no paid history to follow yet.
 */
export function renewalCurrency(args: {
	lastPaidCurrency: string | undefined;
	country: Country | undefined;
}): BillingCurrency {
	return args.lastPaidCurrency === "SGD" || args.lastPaidCurrency === "MYR"
		? args.lastPaidCurrency
		: BILLING_CURRENCY_FOR_COUNTRY[args.country ?? "MY"];
}

/** Everything the NEXT renewal bill will say — see `renewalQuote`. */
export type RenewalQuote = {
	/** A paused store renews the Off-Season Hold, not its tier. */
	kind: "plan" | "hold";
	/** The tier billed. A scheduled downgrade lands with the renewal, so this is
	 * the scheduled plan when there is one — except on a hold bill, where it is
	 * the tier the seller resumes to (the downgrade waits for the first tier
	 * bill after they resume), and for a store on founding pricing, whose
	 * scheduled downgrade is cancelled by the founding lock. */
	plan: Plan;
	/** A hold always bills one month. */
	billingCycle: BillingCycle;
	/** Never on a hold bill — the hold price is flat. */
	founding: boolean;
	currency: BillingCurrency;
	/** Minor units — exactly the `total` the renewal invoice is written with. */
	amount: number;
};

/**
 * What a store's next renewal bills: the ONE author of that answer. The cron's
 * renewal invoice, the pre-charge heads-up email, HitPay's authorisation page
 * and the seller's billing page all read it, so "RM104 on the page, RM149 on
 * the bill" cannot happen by construction (z8r3fdfty4).
 */
export function renewalQuote(args: {
	status: "trialing" | "active" | "past_due" | "cancelled" | "on_hold";
	plan: Plan;
	billingCycle: BillingCycle;
	pendingPlanChange: Plan | undefined;
	isFoundingMember: boolean;
	foundingIntent: boolean;
	paidThrough: number | undefined;
	/** `retailers.foundingBenefitsRevokedAt` — a revoked member's renewal is an
	 * ordinary Pro bill, and the scheduled-downgrade lock opens with it. */
	benefitsRevokedAt: number | undefined;
	lastPaidCurrency: string | undefined;
	country: Country | undefined;
	now: number;
}): RenewalQuote {
	const currency = renewalCurrency(args);
	if (args.status === "on_hold") {
		return {
			kind: "hold",
			plan: args.plan,
			billingCycle: "monthly",
			founding: false,
			currency,
			amount: HOLD_MONTHLY_PRICES[currency],
		};
	}
	// Founding Members stay on Founding Pro (Zaki, 17 Sep 2026): a downgrade
	// scheduled before the lock existed is CANCELLED here — never billed — and
	// the renewal issuer consumes the flag as it writes the Founding Pro bill.
	const scheduled =
		args.pendingPlanChange !== undefined &&
		!foundingPlanLocked(args.pendingPlanChange, foundingPriceEligible(args))
			? args.pendingPlanChange
			: undefined;
	const plan = scheduled ?? args.plan;
	const founding = foundingPricingApplies({ ...args, plan });
	return {
		kind: "plan",
		plan,
		billingCycle: args.billingCycle,
		founding,
		currency,
		amount: planPrice(plan, args.billingCycle, founding, currency),
	};
}

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
