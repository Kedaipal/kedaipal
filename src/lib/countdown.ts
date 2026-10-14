/**
 * Shared countdown formatting — the Lalamove quote clock ("Price locked for
 * 4:32", book-delivery-card) and the claim-link timer (86eyq0epn) render from
 * the same rules so a deadline never reads two ways.
 */

/** "4:32" — minutes:seconds, floored at 0:00. For sub-hour countdowns. */
export function formatCountdown(remainingMs: number): string {
	const total = Math.max(0, Math.floor(remainingMs / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * The house "time left" format, shared by every countdown surface. Windows
 * span minutes to days, so above an hour the seconds are noise: "23h 59m"
 * ≥ 1h, "14:32" below it (the urgency zone, where a ticking seconds column
 * earns its place).
 *
 * Named for the claim bar it was written for, back when 15 minutes was the
 * only window in the product. A promotion can run for a DAY (z8r3fdcw72) and
 * the raw `formatCountdown` printed that as "1439:59" — so this is what any
 * countdown shows a human, and `formatCountdown` is the minutes-and-seconds
 * primitive underneath it.
 */
export function formatTimeLeft(remainingMs: number): string {
	const total = Math.max(0, Math.floor(remainingMs / 1000));
	if (total >= 3600) {
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		return `${h}h ${m}m`;
	}
	return formatCountdown(remainingMs);
}

/** Urgency stage of a running countdown: colours the bar and the digits. */
export type CountdownStage = "ok" | "low" | "critical";

const LOW_FRACTION = 0.25;
const LOW_CAP_MS = 10 * 60_000;
const CRITICAL_FRACTION = 0.1;
const CRITICAL_CAP_MS = 60_000;

/**
 * One rule for every countdown surface (claim bar today, flash-sale bar next —
 * z8r3fdcw72): "low" at 25% of the window left, "critical" at 10%, but each
 * threshold is CAPPED in absolute time (10 min / 60 s). The cap is the point:
 * a 24-hour claim window must not sit amber all afternoon — urgency colours
 * key on time remaining, never on fraction alone. A malformed zero window
 * falls back to the absolute caps.
 */
export function countdownStage(
	remainingMs: number,
	totalMs: number,
): CountdownStage {
	const lowAt =
		totalMs > 0 ? Math.min(totalMs * LOW_FRACTION, LOW_CAP_MS) : LOW_CAP_MS;
	const criticalAt =
		totalMs > 0
			? Math.min(totalMs * CRITICAL_FRACTION, CRITICAL_CAP_MS)
			: CRITICAL_CAP_MS;
	if (remainingMs <= criticalAt) return "critical";
	if (remainingMs <= lowAt) return "low";
	return "ok";
}
