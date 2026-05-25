/**
 * Status-quo cost calculator — pure logic for the `/cost` page.
 *
 * Quantifies what WhatsApp-only ordering costs a seller per month (missed-order
 * revenue + payment-chase labour) and contrasts it against Kedaipal's Founding
 * price. See ClickUp 86exqej55 for the formula and framing.
 *
 * All RM amounts are **major units** (e.g. 104 = RM 104.00). Rounding for
 * display happens at the edge (the calculator UI), not here.
 */

import { z } from "zod";

/** Weeks per month — task-locked constant (52 / 12). */
export const WEEKS_PER_MONTH = 4.33;
/** Assumed hourly cost of the seller's time spent chasing payments. */
export const LABOR_RATE_RM_PER_HR = 25;
/** Founding Member monthly price — the comparison anchor (RM/mo). */
export const FOUNDING_PRICE_RM = 104;
/** Default minutes spent per payment chase when the seller doesn't specify. */
export const DEFAULT_CHASE_MIN = 5;

/**
 * Slider bounds — single source of truth shared by the UI controls and the
 * input schema, so validation and the sliders can never drift apart.
 */
export const BOUNDS = {
	ordersPerWeek: { min: 0, max: 200, step: 1 },
	aov: { min: 0, max: 500, step: 5 },
	missedPerWeek: { min: 0, max: 50, step: 1 },
	chaseMin: { min: 0, max: 20, step: 1 },
} as const;

export interface CostInputs {
	/** W — orders per week. */
	ordersPerWeek: number;
	/** Average order value in RM. */
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
	/** A — missed-order revenue per month (RM). */
	missedRevenue: number;
	/** B — payment-chase labour cost per month (RM). */
	chaseCost: number;
	/** C — total status-quo cost per month (RM). */
	total: number;
	/** D — monthly savings vs the Founding price (RM); negative when disqualified. */
	savings: number;
	/** total ÷ Founding price — "every RM104 covers RMx of leak". */
	ratio: number;
	/** True when an honest disqualification message should replace the pitch. */
	disqualified: boolean;
	disqualifyReason: DisqualifyReason;
}

/** Sensible starting point for the sliders before the seller touches them. */
export const DEFAULT_INPUTS: CostInputs = {
	ordersPerWeek: 40,
	aov: 35,
	missedPerWeek: 4,
	chaseMin: DEFAULT_CHASE_MIN,
};

export const costInputsSchema = z.object({
	ordersPerWeek: z
		.number()
		.min(BOUNDS.ordersPerWeek.min)
		.max(BOUNDS.ordersPerWeek.max),
	aov: z.number().min(BOUNDS.aov.min).max(BOUNDS.aov.max),
	missedPerWeek: z
		.number()
		.min(BOUNDS.missedPerWeek.min)
		.max(BOUNDS.missedPerWeek.max),
	chaseMin: z.number().min(BOUNDS.chaseMin.min).max(BOUNDS.chaseMin.max),
});

/** Clamp a value into a [min, max] range; non-finite input falls back to min. */
export function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

/**
 * Compute the monthly status-quo cost of WhatsApp-only ordering and whether the
 * result honestly disqualifies the seller from needing Kedaipal yet.
 *
 *   A. missedRevenue = M × AOV × WEEKS_PER_MONTH
 *   B. chaseCost     = (W × chaseMin / 60) × WEEKS_PER_MONTH × LABOR_RATE_RM_PER_HR
 *   C. total         = A + B
 *   D. savings       = total − FOUNDING_PRICE_RM
 *      ratio         = total ÷ FOUNDING_PRICE_RM
 *
 * Disqualification (honest, not salesy):
 *   - M = 0           → `no_missed`  (takes priority; the core leak is dry)
 *   - total ≤ price   → `below_price`(wouldn't pay for itself yet)
 */
export function computeStatusQuoCost(inputs: CostInputs): CostResult {
	const missedRevenue = inputs.missedPerWeek * inputs.aov * WEEKS_PER_MONTH;
	const chaseCost =
		((inputs.ordersPerWeek * inputs.chaseMin) / 60) *
		WEEKS_PER_MONTH *
		LABOR_RATE_RM_PER_HR;
	const total = missedRevenue + chaseCost;

	let disqualifyReason: DisqualifyReason = null;
	if (inputs.missedPerWeek <= 0) {
		disqualifyReason = "no_missed";
	} else if (total <= FOUNDING_PRICE_RM) {
		disqualifyReason = "below_price";
	}

	return {
		missedRevenue,
		chaseCost,
		total,
		savings: total - FOUNDING_PRICE_RM,
		ratio: total / FOUNDING_PRICE_RM,
		disqualified: disqualifyReason !== null,
		disqualifyReason,
	};
}
