/**
 * Pure customer helpers — name resolution, phone formatting, name validation,
 * and the denormalized search haystack. Reused from queries, mutations, and the
 * backfill migration. The only Convex dependency is `ConvexError` (a plain error
 * class) so validators surface a clean, user-facing message to the client.
 */

import { ConvexError } from "convex/values";

/** Min/max length for a buyer name — one rule for every capture point. */
export const MIN_CUSTOMER_NAME = 3;
export const MAX_CUSTOMER_NAME = 60;

/**
 * Trim + cap a buyer name. Returns undefined for a blank name (so "no name" has
 * one spelling). Length-agnostic — the min-length rule lives in the validators
 * below so an optional field can still be cleared.
 */
export function sanitizeCustomerName(raw: string | undefined): string | undefined {
	const s = raw?.trim();
	if (!s) return undefined;
	return s.slice(0, MAX_CUSTOMER_NAME);
}

/**
 * An OPTIONAL buyer name: undefined (cleared) or a name of at least
 * MIN_CUSTOMER_NAME chars. Throws for a 1–2 char name (a single letter isn't a
 * name). Used for the anonymous counter paths.
 */
export function normalizeOptionalCustomerName(
	raw: string | undefined,
): string | undefined {
	const s = sanitizeCustomerName(raw);
	if (s && s.length < MIN_CUSTOMER_NAME)
		throw new ConvexError(
			`Name must be at least ${MIN_CUSTOMER_NAME} characters`,
		);
	return s;
}

/**
 * A REQUIRED buyer name (≥ MIN_CUSTOMER_NAME chars). Used by the storefront
 * order create + the manual-phone counter bind, so the ≥3-char rule can't be
 * bypassed by a direct mutation call.
 */
export function requireCustomerName(raw: string | undefined): string {
	const s = normalizeOptionalCustomerName(raw);
	if (!s)
		throw new ConvexError(
			`Name must be at least ${MIN_CUSTOMER_NAME} characters`,
		);
	return s;
}

/** Minimal shape needed to resolve a customer's display name. */
export type DisplayableCustomer = {
	name?: string;
	waProfileName?: string;
	waPhone: string;
};

/**
 * Format a digits-only WhatsApp phone for display. Malaysian numbers (country
 * code 60) get a "+60 " prefix; everything else is prefixed with a bare "+".
 * Returns an empty string for empty input.
 */
export function formatPhone(waPhone: string): string {
	const digits = waPhone.replace(/\D/g, "");
	if (digits.length === 0) return "";
	if (digits.startsWith("60")) return `+60 ${digits.slice(2)}`;
	return `+${digits}`;
}

/**
 * Resolve the name shown in the dashboard. Precedence:
 *   retailer-edited name → WhatsApp pushname → formatted phone number.
 * Blank/whitespace values are treated as unset so they fall through.
 */
export function getDisplayName(customer: DisplayableCustomer): string {
	const name = customer.name?.trim();
	if (name) return name;
	const profile = customer.waProfileName?.trim();
	if (profile) return profile;
	return formatPhone(customer.waPhone);
}

/**
 * Label for the buyer on an ORDER (whose `customer` is a frozen `{name, waPhone}`
 * snapshot, not a `customers` row). Precedence: snapshot name → "Walk-in
 * customer" for an anonymous counter sale (no name AND no phone — the only orders
 * with neither, since every online/WhatsApp order captures a phone; 86ey8vqp6) →
 * `fallback` for a phone-only order with no name. Never returns blank/undefined,
 * so no display can crash on a missing name.
 */
export function orderCustomerLabel(
	customer: { name?: string; waPhone?: string },
	fallback = "Anonymous",
): string {
	const name = customer.name?.trim();
	if (name) return name;
	if (!customer.waPhone) return "Walk-in customer";
	return fallback;
}

/**
 * Build the lowercase, space-joined haystack indexed for full-text search.
 * Combines retailer name, WhatsApp pushname, and phone so a single search
 * query matches on any of them. Blank/undefined parts are omitted.
 */
export function buildSearchText(customer: {
	name?: string;
	waProfileName?: string;
	waPhone: string;
}): string {
	return [customer.name, customer.waProfileName, customer.waPhone]
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part))
		.join(" ")
		.toLowerCase();
}
