/**
 * Currency / display formatters for the storefront and dashboard.
 *
 * IMPORTANT: Prices are stored in **minor units** (sen for MYR, cents for USD)
 * — see `convex/orders.test.ts` which uses `price: 12000` to mean RM 120.00.
 * Always divide by 100 before formatting for display.
 */

import { ConvexError } from "convex/values";

/**
 * Extract a clean error message from a Convex mutation error.
 * Convex wraps plain Error messages with a `[CONVEX M(...)] Uncaught Error:`
 * prefix. Using ConvexError on the backend and this helper on the frontend
 * ensures users see only the original message.
 */
export function convexErrorMessage(err: unknown): string {
	if (err instanceof ConvexError) {
		return typeof err.data === "string" ? err.data : String(err.data);
	}
	return (err as Error).message;
}

/**
 * Compact "time ago" label (e.g. "just now", "5m ago", "3h ago", "2d ago").
 * Falls back to an absolute date once older than ~a month.
 */
export function formatRelativeTime(epochMs: number): string {
	const diff = Date.now() - epochMs;
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (diff < minute) return "just now";
	if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
	if (diff < day) return `${Math.floor(diff / hour)}h ago`;
	const days = Math.floor(diff / day);
	if (days < 31) return `${days}d ago`;
	return formatShortDate(epochMs);
}

/** Absolute date like "2 May 2026". */
export function formatShortDate(epochMs: number): string {
	return new Date(epochMs).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function formatPrice(minorUnits: number, currency: string): string {
	const major = minorUnits / 100;
	try {
		return new Intl.NumberFormat("en-MY", {
			style: "currency",
			currency,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(major);
	} catch {
		// Unknown currency code — fall back to a plain number with the code prefix.
		return `${currency} ${major.toFixed(2)}`;
	}
}
