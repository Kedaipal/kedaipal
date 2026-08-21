/**
 * Currency / display formatters for the storefront and dashboard.
 *
 * IMPORTANT: Prices are stored in **minor units** (sen for MYR, cents for USD)
 * — see `convex/orders.test.ts` which uses `price: 12000` to mean RM 120.00.
 * Always divide by 100 before formatting for display.
 */

import { isRateLimitError } from "@convex-dev/rate-limiter";
import { ConvexError } from "convex/values";
import { COUNTRIES, type Country } from "../../convex/lib/country";
import { STORED_MOBILE_PATTERN } from "../../convex/lib/slug";

/**
 * Extract a clean error message from a Convex mutation error.
 * Convex wraps plain Error messages with a `[CONVEX M(...)] Uncaught Error:`
 * prefix. Using ConvexError on the backend and this helper on the frontend
 * ensures users see only the original message.
 */
export function convexErrorMessage(err: unknown): string {
	// Checked FIRST: the rate limiter throws a STRUCTURED payload ({kind, name,
	// retryAfter}), not a string, so the generic branch below would stringify it
	// to the literal "[object Object]" — which is what a buyer read when a busy
	// storefront throttled their checkout. Every gated mutation shares this
	// helper, so handling the shape here covers checkout, the address edit and
	// the counter alike. (The guard does its own ConvexError + shape test, and
	// running it ahead of the `instanceof` also keeps TS from narrowing the
	// payload union to `never`.)
	if (isRateLimitError(err)) {
		const wait = retryWait(err.data.retryAfter);
		// The daily order ceiling deserves its own words: "busy right now" blames
		// the system vaguely, when the truth a buyer can act on is that THIS
		// store is taking more orders than it can accept. (With the bucket's
		// continuous refill, one slot frees up every ~3 minutes at the ceiling,
		// so the wait shown is short and genuinely worth retrying.)
		if (err.data.name === "orderCreateDaily") {
			return `This store is getting a lot of orders right now and can't take more just yet — please try again in ${wait}. Nothing was submitted.`;
		}
		return `Busy right now — please try again in ${wait}. Nothing was submitted.`;
	}
	if (err instanceof ConvexError) {
		return typeof err.data === "string" ? err.data : String(err.data);
	}
	return (err as Error).message;
}

/**
 * `retryAfter` (ms) → words a person can act on. The burst limiter yields
 * seconds, but the daily order ceiling (`orderCreateDaily`) can yield HOURS —
 * and "try again in 5400s" is a number nobody converts under checkout stress.
 * Always rounds UP, so the message never invites a retry that will fail again.
 */
function retryWait(retryAfterMs: number): string {
	const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
	if (seconds < 90) return `${seconds}s`;
	const minutes = Math.ceil(seconds / 60);
	if (minutes < 90) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
	const hours = Math.ceil(minutes / 60);
	return hours === 1 ? "1 hour" : `${hours} hours`;
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
 * Per-country grouping of a stored mobile's digits, the way its owner reads
 * one aloud. MY: a 2-digit network prefix (1X) then the subscriber number,
 * split 3+4 (10-digit local) or 4+4 (11-digit local, e.g. 011/015). SG: the
 * flat 4+4 every SG surface uses (`9123 4567`).
 */
const MOBILE_GROUPING: Record<Country, (digits: string) => string> = {
	MY: (digits) => {
		const national = digits.slice(2);
		const prefix = national.slice(0, 2);
		const rest = national.slice(2);
		const split = rest.length === 8 ? 4 : 3;
		return `+60 ${prefix}-${rest.slice(0, split)} ${rest.slice(split)}`;
	},
	SG: (digits) => `+65 ${digits.slice(2, 6)} ${digits.slice(6)}`,
};

/**
 * Group a stored mobile (digits-only, `60…`/`65…`) the way its owner reads
 * one: `60123456789` → `+60 12-345 6789`, `6591234567` → `+65 9123 4567`.
 *
 * Purpose is **typo-spotting**, not decoration: checkout echoes the number back
 * to the buyer before they commit (86eyf1rck), and a transposed digit is only
 * catchable when the grouping matches how they typed it. Deliberately separate
 * from `formatPhone` (src/lib/customer.ts), which renders one ungrouped run
 * (`+60 1159399791`) and is mirrored into `convex/` for the seller dashboard —
 * regrouping that shared helper is a cross-surface change, not this field's job.
 *
 * Keys off the STORED digits, not a country parameter, on purpose: the input
 * validators must branch on the retailer's country (typed input is ambiguous),
 * but a stored number already carries its dialing code, so display can only be
 * truthful by reading it — e.g. an MY number a store saved before switching its
 * country to SG still renders as the MY number it is.
 *
 * Unrecognised shapes fall back to `+<digits>` rather than guessing.
 */
export function formatMobile(waPhone: string): string {
	const digits = waPhone.replace(/\D/g, "");
	if (digits.length === 0) return "";
	// Same accept patterns the plated fields validate against — exhaustive over
	// the supported countries, so a new country grows a grouping arm or fails to
	// compile.
	for (const country of COUNTRIES) {
		if (STORED_MOBILE_PATTERN[country].test(digits)) {
			return MOBILE_GROUPING[country](digits);
		}
	}
	return `+${digits}`;
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

/**
 * Currencies the `en-MY` Intl locale renders as the bare ISO code ("SGD 41.00")
 * instead of a human symbol. Pinned here to the same symbol the PDF renderer
 * uses (convex/lib/pdf/document.ts CURRENCY_PREFIX) so an order's web pages
 * and its receipt never disagree ("S$ 41.00" on both). MYR stays on the Intl
 * path untouched ("RM 1,234.50"); anything unmapped keeps the code prefix.
 */
const CURRENCY_SYMBOL_OVERRIDE: Record<string, string> = { SGD: "S$" };

// Non-breaking space — what Intl's en-MY currency style separates "RM" from the
// amount with; overridden symbols use the same so the two paths render alike.
const NBSP = " ";

export function formatPrice(minorUnits: number, currency: string): string {
	const major = minorUnits / 100;
	const symbol = CURRENCY_SYMBOL_OVERRIDE[currency];
	if (symbol) {
		const amount = new Intl.NumberFormat("en-MY", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(major);
		return `${symbol}${NBSP}${amount}`;
	}
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
	const digitOptions =
		major < 1_000_000
			? { maximumFractionDigits: 0 }
			: {
					notation: "compact" as const,
					// min 0 so round millions read "RM 1M", not "RM 1.00M" (the
					// currency default minimum of 2 leaks into compact notation).
					minimumFractionDigits: 0,
					maximumFractionDigits: 2,
				};
	const symbol = CURRENCY_SYMBOL_OVERRIDE[currency];
	if (symbol) {
		const amount = new Intl.NumberFormat("en-MY", digitOptions).format(major);
		return `${symbol}${NBSP}${amount}`;
	}
	try {
		return new Intl.NumberFormat("en-MY", {
			style: "currency",
			currency,
			...digitOptions,
		}).format(major);
	} catch {
		return `${currency} ${Math.round(major).toLocaleString("en-MY")}`;
	}
}
