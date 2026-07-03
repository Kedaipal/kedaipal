// Pure month-key helper for the subscription usage meter. Plan caps are
// "orders per MONTH", so usage rows are keyed by the MYT calendar month —
// deliberately NOT the billing period (`currentPeriodStart`), which can be a
// year long on annual billing and doesn't exist while trialing. Malaysia is
// UTC+8 with no DST (same convention as lib/fulfilmentDate.ts), so the month
// boundary is a fixed offset — drift-free integer math, no timezone library.

import { MYT_OFFSET_MS } from "./fulfilmentDate";

/**
 * Epoch-ms of MYT midnight on the 1st of the calendar month containing
 * `epoch`. Stable key for a retailer's usage row for that month.
 */
export function monthStartMyt(epoch: number): number {
	const shifted = new Date(epoch + MYT_OFFSET_MS);
	return (
		Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) -
		MYT_OFFSET_MS
	);
}
