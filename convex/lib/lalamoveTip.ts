/**
 * Lalamove tip rules (86eye9xd4) — import-free so the dashboard can read the
 * same steps and cap the server enforces without bundling the API client.
 */
import type { LalamoveMarket } from "./lalamove";

/**
 * Tip (Lalamove's priority fee) for a booking still waiting for a rider
 * (86eye9xd4). Fixed steps rather than a free amount — a fat-fingered "50"
 * on a phone would cost real money — and a per-booking cap, so tipping can
 * never quietly double a fare. Minor units in the market's currency.
 */
export const TIP_OPTIONS: Record<
	LalamoveMarket,
	{ amounts: readonly number[]; cap: number }
> = {
	MY: { amounts: [200, 500, 1000], cap: 2000 },
	SG: { amounts: [100, 200, 500], cap: 1000 },
};

/** Lalamove takes the fee as a major-unit decimal string ("5.00"). */
export function priorityFeeWire(amount: number): string {
	return (amount / 100).toFixed(2);
}
