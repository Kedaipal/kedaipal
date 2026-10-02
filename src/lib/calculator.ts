/**
 * Status-quo cost calculator — pure logic for the `/cost` page.
 *
 * Quantifies what WhatsApp-only ordering costs a seller per month (missed-order
 * revenue + payment-chase labour) and contrasts it against what Kedaipal would
 * cost THEM: the cheapest plan-plus-top-ups whose credits cover their monthly
 * order volume (`recommendPlan`, Credits T5 z8r3fdfu31). See ClickUp
 * 86exqej55 for the formula and framing. The anchor was the Founding price,
 * then the Pro list price for everyone (30 Aug 2026 pricing reset, ClickUp
 * z8r3fday21); a flat Pro anchor told a 20-order-a-week seller Kedaipal costs
 * twice what Starter does, and told a 130-a-week seller Pro covers volume it
 * can't.
 *
 * Amounts are **major units** (e.g. 149 = RM 149.00, 59 = S$ 59.00). Rounding
 * for display happens at the edge (the calculator UI), not here.
 *
 * Everything a currency can change is an exhaustive `Record<BillingCurrency,…>`
 * and `computeStatusQuoCost` takes the currency as a REQUIRED argument, so a
 * third billing currency is a compile error rather than a silent Malaysian
 * fallback — the `Record<Country,…>` posture from SG-lite
 * (`docs/sg-lite.md`).
 */

import { z } from "zod";
import {
	type BillingCurrency,
	CREDIT_PACKS,
	type CreditPack,
	isPlanSelectable,
	PLAN_CREDIT_GRANT,
	PLAN_MONTHLY_PRICES,
	PLANS,
	type Plan,
	planRank,
} from "../../convex/lib/plans";

/** Weeks per month — task-locked constant (52 / 12). */
export const WEEKS_PER_MONTH = 4.33;

/**
 * Assumed hourly cost of the seller's time spent chasing payments.
 *
 * Not an FX conversion of the Malaysian figure — S$7/hr would read as
 * implausibly cheap labour to a Singaporean and would undercut the whole
 * calculator. S$15/hr is a defensible SG part-time retail/admin rate and stays
 * conservative for an owner's own time (Arif, 31 Aug 2026).
 */
export const LABOR_RATE_PER_HR: Record<BillingCurrency, number> = {
	MYR: 25,
	SGD: 15,
};

/**
 * Monthly order volume from the weekly slider: `ordersPerWeek × 52 / 12`,
 * rounded UP so the recommended plan always covers the estimate rather than
 * falling one order short of it. (52/12 exactly, not `WEEKS_PER_MONTH`'s 4.33:
 * the volume decides a plan boundary, so it takes the unrounded year.)
 */
export function monthlyOrdersFromWeekly(ordersPerWeek: number): number {
	return Math.ceil((ordersPerWeek * 52) / 12);
}

/** Top-up packs of one size in a recommendation — "2 × 50 credits". */
export interface PackCount {
	credits: number;
	count: number;
	/** Price of ONE pack, minor units. */
	priceMinor: number;
}

/** One way to cover the volume: a plan, plus whatever top-ups it needs. */
export interface PlanOption {
	plan: Plan;
	/** Credits the plan includes a month (`PLAN_CREDIT_GRANT`). */
	included: number;
	/** Top-ups a month on top of the plan, largest pack first. Empty = the
	 * plan's own credits cover it. */
	packs: PackCount[];
	/** Credits the top-ups add (can exceed the shortfall — packs are whole). */
	topUpCredits: number;
	/** Plan price + top-ups, minor units, per month. */
	monthlyMinor: number;
}

export interface PlanRecommendation {
	/** `monthlyOrdersFromWeekly` of the slider. */
	monthlyOrders: number;
	/** The cheapest option. */
	best: PlanOption;
	/** The cheapest option on a HIGHER tier than `best` — the honest answer to
	 * "why not the bigger plan?" when `best` leans on top-ups ("cheaper than
	 * Scale at RM399"). Always strictly dearer than `best`: a tie goes to the
	 * higher tier, so it would have BEEN `best`. Null at the top tier. A
	 * cheaper-or-equal lower tier is never the comparison — at 260 orders
	 * Starter + 1 × 200 ties Pro + 2 × 50 at RM239, and "cheaper than" it
	 * would be false. */
	nextTierUp: PlanOption | null;
}

/**
 * The cheapest whole-pack combination adding at least `shortfall` credits.
 * Exhaustive over the counts of every pack size but the smallest, which then
 * fills the rest — cheap at today's two sizes and any shortfall the slider can
 * reach. Ties go to fewer credits bought, then fewer packs.
 */
export function cheapestTopUp(
	shortfall: number,
	packs: readonly CreditPack[],
): { packs: PackCount[]; credits: number; priceMinor: number } {
	if (shortfall <= 0 || packs.length === 0)
		return { packs: [], credits: 0, priceMinor: 0 };
	const sizes = [...packs].sort((a, b) => b.credits - a.credits);
	type Combo = { counts: number[]; credits: number; priceMinor: number };
	let best: Combo | null = null;
	const better = (a: Combo, b: Combo | null): boolean => {
		if (!b) return true;
		if (a.priceMinor !== b.priceMinor) return a.priceMinor < b.priceMinor;
		if (a.credits !== b.credits) return a.credits < b.credits;
		const packsA = a.counts.reduce((n, c) => n + c, 0);
		const packsB = b.counts.reduce((n, c) => n + c, 0);
		return packsA < packsB;
	};
	const walk = (
		i: number,
		counts: number[],
		credits: number,
		price: number,
	) => {
		const remaining = shortfall - credits;
		const pack = sizes[i];
		if (i === sizes.length - 1) {
			const n = Math.max(0, Math.ceil(remaining / pack.credits));
			const combo: Combo = {
				counts: [...counts, n],
				credits: credits + n * pack.credits,
				priceMinor: price + n * pack.priceMinor,
			};
			if (better(combo, best)) best = combo;
			return;
		}
		const most = Math.max(0, Math.ceil(remaining / pack.credits));
		for (let n = 0; n <= most; n++) {
			walk(
				i + 1,
				[...counts, n],
				credits + n * pack.credits,
				price + n * pack.priceMinor,
			);
		}
	};
	walk(0, [], 0, 0);
	const found = best as Combo | null;
	if (!found) return { packs: [], credits: 0, priceMinor: 0 };
	return {
		packs: sizes
			.map((pack, i) => ({
				credits: pack.credits,
				count: found.counts[i],
				priceMinor: pack.priceMinor,
			}))
			.filter((p) => p.count > 0),
		credits: found.credits,
		priceMinor: found.priceMinor,
	};
}

/**
 * Which plan this seller would actually be on, and what it costs them a month:
 * for every purchasable tier, its price plus the cheapest top-ups covering the
 * rest of the volume — then the cheapest of those. So Starter covers up to its
 * grant, and above it the answer is whichever is honestly cheaper: the next
 * tier, or staying put and topping up ("Pro + 2 × 50 credits" beats Scale at
 * 260 orders a month in both currencies).
 *
 * A tie goes to the HIGHER tier — the same money buys more credits built in
 * and fewer top-ups to remember (MYR at 260 orders: Starter + 1 × 200 and
 * Pro + 2 × 50 both cost RM239; Pro wins).
 */
export function recommendPlan(
	ordersPerWeek: number,
	currency: BillingCurrency,
): PlanRecommendation {
	const monthlyOrders = monthlyOrdersFromWeekly(ordersPerWeek);
	const options: PlanOption[] = PLANS.filter(isPlanSelectable).map((plan) => {
		const included = PLAN_CREDIT_GRANT[plan];
		const topUp = cheapestTopUp(
			monthlyOrders - included,
			CREDIT_PACKS[currency],
		);
		return {
			plan,
			included,
			packs: topUp.packs,
			topUpCredits: topUp.credits,
			monthlyMinor: PLAN_MONTHLY_PRICES[currency][plan] + topUp.priceMinor,
		};
	});
	options.sort(
		(a, b) =>
			a.monthlyMinor - b.monthlyMinor || planRank(b.plan) - planRank(a.plan),
	);
	const [best, ...rest] = options;
	return {
		monthlyOrders,
		best,
		nextTierUp:
			rest.find((o) => planRank(o.plan) > planRank(best.plan)) ?? null,
	};
}

/** Default minutes spent per payment chase when the seller doesn't specify. */
export const DEFAULT_CHASE_MIN = 5;

interface Bound {
	min: number;
	max: number;
	step: number;
}

/** Bounds that count things, not money — identical in every currency. */
const COUNT_BOUNDS = {
	ordersPerWeek: { min: 0, max: 200, step: 1 },
	missedPerWeek: { min: 0, max: 50, step: 1 },
	chaseMin: { min: 0, max: 20, step: 1 },
} as const satisfies Record<string, Bound>;

/**
 * The average-order-value slider is the one control whose shape is a currency
 * question: an S$500 ceiling stepping in 5s is wrong at both ends for the SG
 * cohort, so SG gets a roughly FX-equivalent ceiling and a finer step that
 * keeps the smaller numbers steerable (Arif, 31 Aug 2026).
 */
const AOV_BOUNDS: Record<BillingCurrency, Bound> = {
	MYR: { min: 0, max: 500, step: 5 },
	SGD: { min: 0, max: 200, step: 2 },
};

export interface CostBounds {
	ordersPerWeek: Bound;
	aov: Bound;
	missedPerWeek: Bound;
	chaseMin: Bound;
}

/**
 * Slider bounds per billing currency — single source of truth shared by the UI
 * controls, the route's search-param clamping and the input schema, so
 * validation and the sliders can never drift apart.
 */
export const BOUNDS_FOR: Record<BillingCurrency, CostBounds> = {
	MYR: { ...COUNT_BOUNDS, aov: AOV_BOUNDS.MYR },
	SGD: { ...COUNT_BOUNDS, aov: AOV_BOUNDS.SGD },
};

export interface CostInputs {
	/** W — orders per week. */
	ordersPerWeek: number;
	/** Average order value, in the billing currency's major units. */
	aov: number;
	/** M — missed orders per week ("your guess"). */
	missedPerWeek: number;
	/** Minutes spent per payment chase. */
	chaseMin: number;
}

/**
 * Why the calculator declined to show a savings pitch:
 * - `no_missed`  — M = 0, so there's no leak to plug.
 * - `below_price`— total status-quo cost ≤ what their plan would cost; wouldn't
 *   pay for itself yet.
 */
export type DisqualifyReason = "no_missed" | "below_price" | null;

export interface CostResult {
	/** A — missed-order revenue per month. */
	missedRevenue: number;
	/** B — payment-chase labour cost per month. */
	chaseCost: number;
	/** C — total status-quo cost per month. */
	total: number;
	/** What Kedaipal costs this seller a month, major units — the
	 * recommendation's plan plus top-ups. The anchor for D and the ratio. */
	kedaipalMonthly: number;
	/** D — monthly savings vs `kedaipalMonthly`; negative when disqualified. */
	savings: number;
	/** total ÷ `kedaipalMonthly` — "every RM149 covers RMx of leak". */
	ratio: number;
	/** True when an honest disqualification message should replace the pitch. */
	disqualified: boolean;
	disqualifyReason: DisqualifyReason;
	/** The plan (and top-ups) the seller's volume puts them on. */
	recommendation: PlanRecommendation;
}

/**
 * Sensible starting point for the sliders before the seller touches them —
 * per currency, because the AOV default is a money figure.
 */
export const DEFAULT_INPUTS_FOR: Record<BillingCurrency, CostInputs> = {
	MYR: {
		ordersPerWeek: 40,
		aov: 35,
		missedPerWeek: 4,
		chaseMin: DEFAULT_CHASE_MIN,
	},
	SGD: {
		ordersPerWeek: 40,
		aov: 15,
		missedPerWeek: 4,
		chaseMin: DEFAULT_CHASE_MIN,
	},
};

function buildSchema(bounds: CostBounds) {
	return z.object({
		ordersPerWeek: z
			.number()
			.min(bounds.ordersPerWeek.min)
			.max(bounds.ordersPerWeek.max),
		aov: z.number().min(bounds.aov.min).max(bounds.aov.max),
		missedPerWeek: z
			.number()
			.min(bounds.missedPerWeek.min)
			.max(bounds.missedPerWeek.max),
		chaseMin: z.number().min(bounds.chaseMin.min).max(bounds.chaseMin.max),
	});
}

/** Input schemas, built once per currency at module load. */
export const COST_INPUTS_SCHEMA_FOR: Record<
	BillingCurrency,
	ReturnType<typeof buildSchema>
> = {
	MYR: buildSchema(BOUNDS_FOR.MYR),
	SGD: buildSchema(BOUNDS_FOR.SGD),
};

/** Clamp a value into a [min, max] range; non-finite input falls back to min. */
export function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

/**
 * Fit a set of inputs inside a currency's slider ranges.
 *
 * Needed because the region is switchable *after* numbers are entered: an
 * RM 400 basket has no position on the S$ slider, and a control rendered
 * outside its own bounds is a control the visitor can't put back.
 */
export function clampInputs(
	inputs: CostInputs,
	bounds: CostBounds,
): CostInputs {
	return {
		ordersPerWeek: clamp(
			inputs.ordersPerWeek,
			bounds.ordersPerWeek.min,
			bounds.ordersPerWeek.max,
		),
		aov: clamp(inputs.aov, bounds.aov.min, bounds.aov.max),
		missedPerWeek: clamp(
			inputs.missedPerWeek,
			bounds.missedPerWeek.min,
			bounds.missedPerWeek.max,
		),
		chaseMin: clamp(inputs.chaseMin, bounds.chaseMin.min, bounds.chaseMin.max),
	};
}

/**
 * Compute the monthly status-quo cost of WhatsApp-only ordering and whether the
 * result honestly disqualifies the seller from needing Kedaipal yet.
 *
 *   A. missedRevenue = M × AOV × WEEKS_PER_MONTH
 *   B. chaseCost     = (W × chaseMin / 60) × WEEKS_PER_MONTH × LABOR_RATE_PER_HR
 *   C. total         = A + B
 *   D. savings       = total − kedaipalMonthly
 *      ratio         = total ÷ kedaipalMonthly
 *
 * `kedaipalMonthly` is `recommendPlan(W, currency)` — the price of the plan
 * (plus top-ups) their volume actually needs, not a fixed tier.
 *
 * Disqualification (honest, not salesy):
 *   - M = 0           → `no_missed`  (takes priority; the core leak is dry)
 *   - total ≤ price   → `below_price`(wouldn't pay for itself yet)
 */
export function computeStatusQuoCost(
	inputs: CostInputs,
	currency: BillingCurrency,
): CostResult {
	const recommendation = recommendPlan(inputs.ordersPerWeek, currency);
	const kedaipalMonthly = recommendation.best.monthlyMinor / 100;
	const missedRevenue = inputs.missedPerWeek * inputs.aov * WEEKS_PER_MONTH;
	const chaseCost =
		((inputs.ordersPerWeek * inputs.chaseMin) / 60) *
		WEEKS_PER_MONTH *
		LABOR_RATE_PER_HR[currency];
	const total = missedRevenue + chaseCost;

	let disqualifyReason: DisqualifyReason = null;
	if (inputs.missedPerWeek <= 0) {
		disqualifyReason = "no_missed";
	} else if (total <= kedaipalMonthly) {
		disqualifyReason = "below_price";
	}

	return {
		missedRevenue,
		chaseCost,
		total,
		kedaipalMonthly,
		savings: total - kedaipalMonthly,
		ratio: total / kedaipalMonthly,
		disqualified: disqualifyReason !== null,
		disqualifyReason,
		recommendation,
	};
}
