import type { BuyerPhoneParse } from "../../convex/lib/buyerPhone";
import type { Country } from "../../convex/lib/country";

/**
 * When a plain-state buyer phone field (`BuyerPhoneInput` — the booking
 * checkout, the track page's number repair, the counter's manual bind) shows
 * its rejection under itself (z8r3fdh274). One rule for all three, so the
 * same typo reads the same wherever it's typed:
 *
 *   - never while the field is empty — the submit's own hint says "enter";
 *   - never on the first keystrokes — "not a valid number" after one digit is
 *     noise, so it waits until the field is left (`touched`: blurred, or a
 *     submit was tried);
 *   - EXCEPT when the digits already fit the other supported country: that
 *     rejection carries its whole fix (the one-tap "Switch to Singapore
 *     (+65)"), so there is nothing to wait for.
 *
 * Null = stay quiet (valid, empty, or still being typed).
 */
export function buyerPhoneRejection(
	parsed: BuyerPhoneParse,
	typed: string,
	touched: boolean,
): { message: string; suggest?: Country } | null {
	if (parsed.ok || !/\d/.test(typed)) return null;
	if (!touched && parsed.suggest === undefined) return null;
	return { message: parsed.message, suggest: parsed.suggest };
}
