/**
 * Customer display helpers for the dashboard.
 *
 * IMPORTANT: Keep in sync with `convex/lib/customer.ts`. Both files must stay
 * identical in logic — they exist separately because Convex functions bundle
 * from the `convex/` directory and the frontend bundles from `src/`.
 */

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
