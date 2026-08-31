/**
 * Status-quo cost calculator — pure logic for the `/cost` page.
 *
 * Quantifies what WhatsApp-only ordering costs a seller per month (missed-order
 * revenue + payment-chase labour) and contrasts it against Kedaipal's Founding
 * price. See ClickUp 86exqej55 for the formula and framing.
 *
 * Amounts are **major units** (e.g. 104 = RM 104.00, 41 = S$ 41.00). Rounding
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
	FOUNDING_MONTHLY_PRICES,
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
 * Founding Member monthly price — the comparison anchor, in major units.
 *
 * Derived from `FOUNDING_MONTHLY_PRICES` (minor units) rather than restated:
 * this file used to carry its own `104`, a second copy of the Pro founding
 * price that nothing stopped from drifting.
 */
export const FOUNDING_PRICE: Record<BillingCurrency, number> = {
	MYR: FOUNDING_MONTHLY_PRICES.MYR.pro / 100,
	SGD: FOUNDING_MONTHLY_PRICES.SGD.pro / 100,
};

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
 * - `below_price`— total status-quo cost ≤ Founding price; wouldn't pay for itself yet.
 */
export type DisqualifyReason = "no_missed" | "below_price" | null;

export interface CostResult {
	/** A — missed-order revenue per month. */
	missedRevenue: number;
	/** B — payment-chase labour cost per month. */
	chaseCost: number;
	/** C — total status-quo cost per month. */
	total: number;
	/** D — monthly savings vs the Founding price; negative when disqualified. */
	savings: number;
	/** total ÷ Founding price — "every RM104 covers RMx of leak". */
	ratio: number;
	/** True when an honest disqualification message should replace the pitch. */
	disqualified: boolean;
	disqualifyReason: DisqualifyReason;
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
 *   D. savings       = total − FOUNDING_PRICE
 *      ratio         = total ÷ FOUNDING_PRICE
 *
 * Disqualification (honest, not salesy):
 *   - M = 0           → `no_missed`  (takes priority; the core leak is dry)
 *   - total ≤ price   → `below_price`(wouldn't pay for itself yet)
 */
export function computeStatusQuoCost(
	inputs: CostInputs,
	currency: BillingCurrency,
): CostResult {
	const foundingPrice = FOUNDING_PRICE[currency];
	const missedRevenue = inputs.missedPerWeek * inputs.aov * WEEKS_PER_MONTH;
	const chaseCost =
		((inputs.ordersPerWeek * inputs.chaseMin) / 60) *
		WEEKS_PER_MONTH *
		LABOR_RATE_PER_HR[currency];
	const total = missedRevenue + chaseCost;

	let disqualifyReason: DisqualifyReason = null;
	if (inputs.missedPerWeek <= 0) {
		disqualifyReason = "no_missed";
	} else if (total <= foundingPrice) {
		disqualifyReason = "below_price";
	}

	return {
		missedRevenue,
		chaseCost,
		total,
		savings: total - foundingPrice,
		ratio: total / foundingPrice,
		disqualified: disqualifyReason !== null,
		disqualifyReason,
	};
}
