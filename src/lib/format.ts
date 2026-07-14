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

/**
 * Compact absolute stamp for an order's placed-at time, so a seller reads WHEN an
 * order arrived at a glance (not just "3h ago"). Shows the date + 12-hour time,
 * dropping the year when it's the current year: "12 Jul, 3:45 PM" (or
 * "12 Jul 2025, 3:45 PM"). Malaysia locale/timezone via the runtime default.
 */
export function formatOrderTimestamp(
	epochMs: number,
	now = Date.now(),
): string {
	const d = new Date(epochMs);
	const sameYear = d.getFullYear() === new Date(now).getFullYear();
	const date = d.toLocaleDateString("en-MY", {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
	});
	const time = d.toLocaleTimeString("en-MY", {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});
	return `${date}, ${time}`;
}

/** Absolute date like "2 May 2026". */
export function formatShortDate(epochMs: number): string {
	return new Date(epochMs).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

/** Strip everything but digits — for whole-number inputs (stock, quantity). */
export function sanitizeIntInput(v: string): string {
	return v.replace(/\D/g, "");
}

/**
 * Parse a user-typed price string into a non-negative number, or `null` if it
 * isn't a clean price.
 *
 * Unlike `Number.parseFloat` — which stops at the first non-numeric char and
 * silently truncates, so a comma typed on a MY/intl decimal keyboard is misread
 * ("1,50" → 1, "1,200" → 1) into the wrong saved price — this normalizes the
 * separators first, then **rejects** anything that still isn't a plain decimal.
 *
 * Separator handling (MY/en convention, "." is the decimal point):
 * - `"1,200"` / `"1,234,567"` → thousands commas, stripped     → `1200` / `1234567`
 * - `"1,200.50"`              → "." decimal, commas stripped    → `1200.5`
 * - `"1,50"` / `"1,5"`        → a single trailing `",NN"` is read as a decimal comma → `1.5`
 * - letters, stray symbols, `"1 200"`, negatives               → `null`
 */
export function parsePriceInput(v: string): number | null {
	const t = v.trim();
	if (t === "") return null;
	let cleaned: string;
	if (t.includes(".")) {
		// "." is the decimal point; any commas are thousands separators.
		cleaned = t.replace(/,/g, "");
	} else if (/^\d+,\d{1,2}$/.test(t)) {
		// A single trailing ",NN" (1–2 digits) — a decimal comma, not thousands.
		cleaned = t.replace(",", ".");
	} else {
		// No decimal point → any commas are thousands grouping.
		cleaned = t.replace(/,/g, "");
	}
	// Reject anything that didn't reduce to a plain non-negative decimal rather
	// than letting a bad value through (the `-` sign fails this too).
	if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
	const n = Number(cleaned);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Normalize a typed price string to 2 decimal places (sen precision) for on-blur
 * formatting — "12.999" → "13.00", "12.5" → "12.50", "1,50" → "1.50". Blank
 * stays blank; an unparseable or negative value is returned unchanged so form
 * validation can surface it. Converts the *display* string only; the integer-sen
 * conversion still happens at submit via `Math.round(value * 100)`.
 */
export function normalizePriceInput(v: string): string {
	const t = v.trim();
	if (t === "") return "";
	const n = parsePriceInput(t);
	if (n === null) return t; // unparseable/negative — surface as-is for validation
	return n.toFixed(2);
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

/**
 * Price for tight display slots (stat tiles, list edges) where a lifetime
 * figure like "RM 2,225,481.50" physically doesn't fit. Precision degrades
 * only as magnitude grows — sen matter on an order, not on a lifetime total:
 *   < RM 10,000    → full, with sen ("RM 1,240.50")
 *   < RM 1,000,000 → whole ringgit ("RM 37,720")
 *   ≥ RM 1,000,000 → compact ("RM 2.23M")
 * Pair with a `title` attr carrying the full formatPrice value where hover
 * exists. Exact amounts (order totals, amounts to pay) keep formatPrice.
 */
export function formatPriceCompact(
	minorUnits: number,
	currency: string,
): string {
	const major = minorUnits / 100;
	if (major < 10_000) return formatPrice(minorUnits, currency);
	try {
		return new Intl.NumberFormat("en-MY", {
			style: "currency",
			currency,
			...(major < 1_000_000
				? { maximumFractionDigits: 0 }
				: {
						notation: "compact" as const,
						// min 0 so round millions read "RM 1M", not "RM 1.00M" (the
						// currency default minimum of 2 leaks into compact notation).
						minimumFractionDigits: 0,
						maximumFractionDigits: 2,
					}),
		}).format(major);
	} catch {
		return `${currency} ${Math.round(major).toLocaleString("en-MY")}`;
	}
}
