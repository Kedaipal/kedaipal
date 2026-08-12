import { formatMyMobile } from "./format";

/**
 * Normalize a Malaysian number the way a Malaysian actually types it, to the
 * stored `60…` form. Mirrors `assertValidMyMobile` (`convex/lib/slug.ts`)
 * without the assertion — the shape is *not* checked here, so this is only for
 * comparison and for feeding a validator, never for deciding a number is valid.
 *
 *   `012-345 6789` → `60123456789`   (local, trunk 0 dropped)
 *   `12-345 6789`  → `60123456789`   (bare NSN — what the `+60` plate asks for)
 *   `+60 12-345 6789` → `60123456789` (already international)
 *
 * `myWaPhoneCheckoutSchema` runs this and then asserts the mobile shape, so a
 * "has this changed?" check and the validator can't disagree about what the
 * user typed.
 */
export function normalizeMyDigits(value: string | undefined): string {
	const digits = (value ?? "").replace(/\D/g, "");
	if (digits.startsWith("60")) return digits;
	if (digits.startsWith("0")) return `60${digits.slice(1)}`;
	if (/^1\d{8,9}$/.test(digits)) return `60${digits}`;
	return digits;
}

/**
 * Bridge between the app's stored phone format (digits-only with the country
 * code, e.g. `601159399791`) and what belongs to the RIGHT of a fixed `+60`
 * plate (`11-5939 9791`).
 *
 * Seeding a plated field with the stored value verbatim would read `+60 |
 * 601159399791` — the country code twice — and a seller who "fixed" it by
 * deleting the visible `60` would be right to. So every `MyPhoneInput` seeded
 * from the DB goes through here.
 *
 * Grouped, not bare digits: this is the same typo-spotting grouping checkout
 * echoes back (`formatMyMobile`), and it costs nothing to hand the seller a
 * number shaped the way they'd read one aloud. Every accepting validator
 * (`myWaPhoneCheckoutSchema`, `assertValidMyMobile`) strips separators first,
 * so the grouped form round-trips unchanged.
 *
 * A value that isn't a MY mobile — a legacy row saved before the seller-side
 * fields became MY-only — falls through as bare digits rather than being
 * silently reshaped. It stays visible and editable, and the validator names the
 * problem on save.
 */
export function toMyNationalInput(value: string | undefined): string {
	if (!value) return "";
	const digits = value.replace(/\D/g, "");
	if (digits.length === 0) return "";
	const grouped = formatMyMobile(digits);
	// `formatMyMobile` returns `+60 11-5939 9791` for a MY mobile and `+<digits>`
	// for anything else; only the former has a national part to peel off.
	return grouped.startsWith("+60 ") ? grouped.slice(4) : digits;
}
