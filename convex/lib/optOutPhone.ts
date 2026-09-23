/**
 * The admin opt-out panel's phone reader (86eyn25gu; any country since
 * z8r3fdh274). Pure, so the server (`convex/wabaProtection.ts`) and the panel
 * (`src/routes/app.admin.waba.tsx`) share the parse AND its rejection copy —
 * the panel used to hand-copy the message.
 *
 * The key must equal what the send gate checks — Meta's inbound `from` for a
 * STOP, the stored order number for a checkout — or an opt-out suppresses
 * nothing while the panel claims it does (PR #191 review). This is the one
 * phone field in the app with no store behind it and no picker beside it, so
 * the arms are tried in a fixed order, most specific first — on the typed
 * text after `cleanPhoneInput` (`./phoneDial`), the same cleaning every buyer
 * field gets, so a number pasted out of WhatsApp (wrapped in invisible bidi
 * marks) or written in another script's digits (`٠١٢…`, full-width `０１２…`)
 * keys exactly as it would at checkout instead of losing its `+` or its digits:
 *
 *   1. MY strict, 2. SG strict (`assertValidMobileForCountry`) — byte-identical
 *      to the MY/SG-only panel: every local spelling (`012-345 6789`,
 *      `9123 4567`, `60…`, `+65…`) keys as before and a landline is refused.
 *      The two are disjoint (MY mobiles start `1`, SG `8`/`9`).
 *   3. An explicit international prefix (`+44 …`, `0044 …`) → the buyer
 *      validator (`parseBuyerWaPhone`) under the TYPED code's country, so the
 *      key is exactly the digits a buyer's checkout stores and Meta delivers.
 *      A `+60`/`+65` lands back on the strict arm in there, which is why
 *      `+60 3-1234 5678` is still a landline.
 *   4. Bare digits that begin with a calling code other than MY's or SG's
 *      (`447911123456`) → parsed as if typed with a `+`. That is the form the
 *      register's copy button hands back, so a copied row round-trips.
 *
 * Arms 3–4 only run once 1–2 have refused, so they can never re-key a number
 * the panel already accepted. What they cost is the old "no input satisfies
 * two arms" guarantee: a mistyped number can now read as a real foreign one
 * (`61234567890` is an Australian mobile). The panel therefore names the
 * country it read before anything is registered — `readOptOutPhone` returns
 * it alongside the key.
 */

import { parseBuyerWaPhone } from "./buyerPhone";
import { COUNTRIES, DEFAULT_COUNTRY } from "./country";
import { cleanPhoneInput, type DialIso } from "./phoneDial";
import {
	assertValidMobileForCountry,
	MOBILE_EXAMPLE,
	MOBILE_KIND,
} from "./slug";

/** The foreign example the panel's placeholder and rejection copy show —
 * pinned by test to a value `readOptOutPhone` accepts. */
export const OPT_OUT_FOREIGN_EXAMPLE = "+44 7911 123456";

/**
 * Rejection copy for the panel: every supported store country's local form,
 * then the any-country rule. Built from `MOBILE_KIND`/`MOBILE_EXAMPLE` so the
 * examples can't drift from the strict validators that judge them.
 */
export const OPT_OUT_PHONE_MESSAGE = `Enter ${COUNTRIES.map(
	(country) => `a ${MOBILE_KIND[country]} (${MOBILE_EXAMPLE[country]})`,
).join(
	", ",
)}, or any other country's WhatsApp number with its country code (e.g. ${OPT_OUT_FOREIGN_EXAMPLE})`;

export type OptOutPhone = {
	/** The key `optOuts.waPhone` is stored and looked up under. */
	digits: string;
	/** The country the number was read as — shown by the panel, never stored. */
	iso: DialIso;
};

/**
 * Read an admin-typed buyer number through the arms above. Null on anything
 * none of them accepts — the status query runs per keystroke and must not
 * throw.
 */
export function readOptOutPhone(raw: string): OptOutPhone | null {
	// Cleaned BEFORE any arm: the strict arms strip every non-ASCII digit, so a
	// script digit would vanish there and a different number — or none — would
	// be keyed; and a bidi mark in front of a `00` would hide the international
	// prefix from the check below.
	const typed = cleanPhoneInput(raw).trim();
	for (const country of COUNTRIES) {
		try {
			return {
				digits: assertValidMobileForCountry(typed, country),
				iso: country,
			};
		} catch {
			// Not this country's local shape — try the next arm.
		}
	}
	// Arm 3 keeps the prefix that was typed; arm 4 reads bare digits as if a
	// `+` had been typed in front of them.
	const international =
		typed.startsWith("+") || typed.startsWith("00")
			? typed
			: `+${typed.replace(/\D/g, "")}`;
	// The typed code outranks the pick inside the parser, so the pick only
	// breaks a shared code's tie (→ its main country). A `60…`/`65…` routes back
	// to the strict arm that already refused it, so a landline stays refused.
	const parsed = parseBuyerWaPhone(international, DEFAULT_COUNTRY);
	return parsed.ok ? { digits: parsed.digits, iso: parsed.iso } : null;
}

/** The stored key for an admin-typed number, or null when it isn't one. */
export function canonicalOptOutPhone(raw: string): string | null {
	return readOptOutPhone(raw)?.digits ?? null;
}
