import { COUNTRY_DIAL_CODE, type Country } from "../../convex/lib/country";
import { normalizeMobileDigits } from "../../convex/lib/slug";
import { formatMobile } from "./format";

/**
 * Client façade over the ONE phone-normalization author,
 * `normalizeMobileDigits` in `convex/lib/slug.ts` (pure, shared client+server
 * since SG-lite 86eynw28q — the schemas that fail fast in the UI and the
 * Convex validators that are the authority literally run the same function, so
 * the two sides can't disagree about what a store accepts).
 *
 * Per country, the way a local actually types:
 *   MY `012-345 6789` → `60123456789`   (local, trunk 0 dropped)
 *   MY `12-345 6789`  → `60123456789`   (bare NSN — what the `+60` plate asks for)
 *   SG `9123 4567`    → `6591234567`    (bare NSN — SG has no trunk 0)
 *   `+60 …` / `+65 …` → kept as digits  (already international)
 *
 * The shape is *not* checked here — this is only for comparison and for
 * feeding a validator, never for deciding a number is valid.
 */
export { normalizeMobileDigits };

/**
 * Bridge between the app's stored phone format (digits-only with the country
 * code, e.g. `601159399791` / `6591234567`) and what belongs to the RIGHT of
 * the field's fixed `+60`/`+65` plate (`11-5939 9791` / `9123 4567`).
 *
 * Seeding a plated field with the stored value verbatim would read `+60 |
 * 601159399791` — the country code twice — and a seller who "fixed" it by
 * deleting the visible `60` would be right to. So every `MyPhoneInput` seeded
 * from the DB goes through here, with the SAME country the plate renders.
 *
 * Grouped, not bare digits: this is the same typo-spotting grouping checkout
 * echoes back (`formatMobile`), and it costs nothing to hand the seller a
 * number shaped the way they'd read one aloud. Every accepting validator
 * strips separators first, so the grouped form round-trips unchanged.
 *
 * A value that isn't a mobile in the PLATE's country — a legacy row saved
 * before the seller-side fields became country-locked, or a number saved
 * before the store switched country — falls through as bare digits rather
 * than being silently reshaped. It stays visible and editable, and the
 * validator names the problem on save.
 */
export function toNationalPhoneInput(
	value: string | undefined,
	country: Country,
): string {
	if (!value) return "";
	const digits = value.replace(/\D/g, "");
	if (digits.length === 0) return "";
	const grouped = formatMobile(digits);
	// `formatMobile` returns `+60 …`/`+65 …` for a recognised mobile and
	// `+<digits>` for anything else; only a number in the plate's own country
	// has a national part to peel off.
	const plate = `+${COUNTRY_DIAL_CODE[country]} `;
	return grouped.startsWith(plate) ? grouped.slice(plate.length) : digits;
}
