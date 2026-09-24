/**
 * "Can this number be a courier CONTACT?" — one answer for every provider
 * (Lalamove riders, Delyva couriers). Pure, dependency-free module: the client
 * bundle reaches it through `./lalamove`.
 *
 * Couriers book inside one country and only take a contact number from it
 * (Lalamove 422s a +65 number on a Malaysian booking). Buyers can type a
 * WhatsApp number from any country (z8r3fdh274), so every dispatch path asks
 * this and, when the buyer's number is foreign, hands the courier the STORE's
 * number and carries the buyer's real number in the booking notes. It is a
 * country check, not a mobile check: a rider can phone a landline.
 *
 * Its partner question — "does this store book couriers at all?" — lives in
 * `./courierBooking`. See docs/phone-numbers.md.
 */

import type { Country } from "./country";

/** A contact number's stored bare-digit shape per courier market. Lengths
 * INCLUDE the country code. MY: 60 + 9–11 digits (mobiles and landlines);
 * SG: 65 + exactly 8. */
const DOMESTIC_PHONE: Record<
	Country,
	{ prefix: string; minDigits: number; maxDigits: number }
> = {
	MY: { prefix: "60", minDigits: 11, maxDigits: 13 },
	SG: { prefix: "65", minDigits: 10, maxDigits: 10 },
};

/**
 * A stored number as the E.164 contact a courier booking in `country` will
 * accept (`+60…`), or null when it belongs to another country — the caller's
 * cue to fall back to the store's own number.
 */
export function toDomesticContactPhone(
	waPhone: string | undefined,
	country: Country,
): string | null {
	if (!waPhone) return null;
	const digits = waPhone.replace(/\D/g, "");
	const rule = DOMESTIC_PHONE[country];
	if (!digits.startsWith(rule.prefix)) return null;
	if (digits.length < rule.minDigits || digits.length > rule.maxDigits)
		return null;
	return `+${digits}`;
}
