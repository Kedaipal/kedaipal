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
 * Claim windows span 15 minutes to days, so above an hour the seconds are
 * noise: "23h 59m" ≥ 1h, "14:32" below it (the urgency zone, where a ticking
 * seconds column earns its place).
 */
export function formatClaimCountdown(remainingMs: number): string {
	const total = Math.max(0, Math.floor(remainingMs / 1000));
	if (total >= 3600) {
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		return `${h}h ${m}m`;
	}
	return formatCountdown(remainingMs);
}
