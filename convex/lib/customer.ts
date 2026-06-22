/**
 * Pure customer helpers — name resolution, phone formatting, and the
 * denormalized search haystack. Kept free of Convex imports so they can be
 * unit-tested in isolation and reused from queries, mutations, and the
 * backfill migration.
 */

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
