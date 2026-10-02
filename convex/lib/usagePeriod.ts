// Pure month-key helpers for the subscription usage meter AND the credit
// ledger's usage period (Credits, 86eye2ccu). Plan caps and plan credits are
// "orders per MONTH", so usage rows and credit periods are keyed by the MYT
// calendar month — deliberately NOT the billing period (`currentPeriodStart`),
// which can be a year long on annual billing and doesn't exist while trialing.
// Malaysia is UTC+8 with no DST (same convention as lib/fulfilmentDate.ts), so
// the month boundary is a fixed offset — drift-free integer math, no timezone
// library. Singapore shares the offset, so an SG store's month turns at its
// own midnight too.

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

/**
 * Epoch-ms of MYT midnight on the 1st of the NEXT calendar month — the moment
 * plan credits refresh ("resets on 1 Nov").
 */
export function nextMonthStartMyt(epoch: number): number {
	const shifted = new Date(epoch + MYT_OFFSET_MS);
	return (
		Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1) -
		MYT_OFFSET_MS
	);
}

/**
 * The usage period a moment belongs to, as a sortable `YYYY-MM` string
 * ("2026-10"). Lexicographic order IS chronological order, so an index range
 * `periodKey < current` finds every account a month boundary has passed.
 */
export function usagePeriodKey(epoch: number): string {
	const shifted = new Date(epoch + MYT_OFFSET_MS);
	const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
	return `${shifted.getUTCFullYear()}-${month}`;
}

/**
 * `epoch` moved forward by `months` calendar months on the MYT wall clock —
 * "valid 12 months" means the same date next year, not 365 days. A day that
 * doesn't exist in the target month clamps to its last day (29 Feb → 28 Feb).
 */
export function addMonthsMyt(epoch: number, months: number): number {
	const shifted = new Date(epoch + MYT_OFFSET_MS);
	const year = shifted.getUTCFullYear();
	const month = shifted.getUTCMonth() + months;
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const day = Math.min(shifted.getUTCDate(), lastDay);
	return (
		Date.UTC(
			year,
			month,
			day,
			shifted.getUTCHours(),
			shifted.getUTCMinutes(),
			shifted.getUTCSeconds(),
			shifted.getUTCMilliseconds(),
		) - MYT_OFFSET_MS
	);
}
