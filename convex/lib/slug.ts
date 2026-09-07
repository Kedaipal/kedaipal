/**
 * Server-side slug validation used by Convex mutations. Kept free of Convex
 * imports so it can be unit-tested in isolation and mirrors the client-side
 * logic in `src/lib/slug.ts`.
 *
 * IMPORTANT: Keep in sync with `src/lib/slug.ts`. Both files must stay
 * byte-identical in logic — they exist separately because Convex functions
 * bundle from the `convex/` directory.
 *
 * This module is also the ONE author of phone normalization (SG-lite,
 * 86eynw28q): the client (`src/lib/phone.ts`, `src/lib/schemas.ts`) imports
 * the per-country patterns, messages, and `normalizeMobileDigits` from here
 * rather than mirroring them, so checkout's client gate and the server
 * validator can never disagree about what a store accepts.
 */

import { COUNTRIES, type Country, COUNTRY_DIAL_CODE } from "./country";

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
	"_",
	"about",
	"admin",
	"api",
	"app",
	"assets",
	"blog",
	"docs",
	"favicon.ico",
	"help",
	"kedaipal",
	"login",
	"logout",
	"onboarding",
	"pricing",
	"public",
	"robots.txt",
	"settings",
	"sign-in",
	"sign-up",
	"signin",
	"signup",
	"sitemap.xml",
	"static",
	"support",
	"www",
]);

/**
 * Best-effort slugification of free text (store names, product names):
 * - strip diacritics (NFKD + combining-mark removal)
 * - lowercase
 * - non-alphanumeric → `-`
 * - collapse repeated dashes
 * - trim leading/trailing dashes
 * - truncate to 32 chars (dash-safe)
 * Mirrors `src/lib/slug.ts` exactly.
 */
export function slugify(input: string): string {
	const normalized = input
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");

	if (normalized.length <= 32) return normalized;
	return normalized.slice(0, 32).replace(/-$/, "");
}

export const SLUG_MIN = 3;
export const SLUG_MAX = 32;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function assertValidSlug(raw: string): string {
	const s = raw.trim().toLowerCase();
	if (s.length < SLUG_MIN) {
		throw new Error(`Slug must be at least ${SLUG_MIN} characters`);
	}
	if (s.length > SLUG_MAX) {
		throw new Error(`Slug must be at most ${SLUG_MAX} characters`);
	}
	if (!SLUG_PATTERN.test(s)) {
		throw new Error("Slug must use lowercase letters, numbers and single dashes");
	}
	if (RESERVED_SLUGS.has(s)) {
		throw new Error("This slug is reserved");
	}
	return s;
}

/**
 * Validate a CATEGORY slug — same shape/length rules as store slugs, but no
 * reserved-word list: category slugs live under `/$slug/c/…`, so they can never
 * collide with app routes the way a store slug could. Per-retailer uniqueness
 * is enforced separately at the mutation layer (categories.by_retailer_slug).
 */
export function assertValidCategorySlug(raw: string): string {
	const s = raw.trim().toLowerCase();
	if (s.length < SLUG_MIN) {
		throw new Error(`Slug must be at least ${SLUG_MIN} characters`);
	}
	if (s.length > SLUG_MAX) {
		throw new Error(`Slug must be at most ${SLUG_MAX} characters`);
	}
	if (!SLUG_PATTERN.test(s)) {
		throw new Error("Slug must use lowercase letters, numbers and single dashes");
	}
	return s;
}

export function assertValidStoreName(raw: string): string {
	const s = raw.trim();
	if (s.length < 2) throw new Error("Store name must be at least 2 characters");
	if (s.length > 60) throw new Error("Store name must be at most 60 characters");
	return s;
}

/**
 * Normalize and validate a WhatsApp phone number to E.164-ish digits.
 * Strips '+', spaces, dashes, parentheses. Requires 8–15 digits.
 *
 * The loose, country-agnostic shape. Since 86eyknr2r **no UI field uses it** —
 * every phone a human types into Kedaipal is Malaysian and goes through
 * `assertValidMyMobile`. What's left are the paths where the number arrives
 * from somewhere else and rejecting it would lose data: numbers Meta hands us
 * on an inbound message, the counter's store-QR scan, and the CRM row keyed off
 * them. Keep it permissive there.
 */
export function assertValidWaPhone(raw: string): string {
	const s = raw.replace(/[\s\-()+]/g, "");
	if (!/^\d{8,15}$/.test(s)) {
		throw new Error(
			"WhatsApp number must be 8–15 digits, with country code (e.g. 60123456789)",
		);
	}
	return s;
}

/**
 * A mobile national significant number typed WITHOUT any country code — what a
 * buyer types after reading the plate's `+60`/`+65` badge. MY: 9–10 digits
 * starting with 1 (`12-345 6789`). SG: exactly 8 digits starting 8 or 9
 * (`9123 4567` — SG has no trunk 0 and no non-mobile 8/9 ranges we'd swallow).
 * Both windows are pinned tight so a foreign international number can never be
 * captured and silently rewritten (a US `+1…` is 11 digits; a UK `+44…` never
 * matches either shape).
 */
const MOBILE_NSN: Record<Country, RegExp> = {
	MY: /^1\d{8,9}$/,
	SG: /^[89]\d{7}$/,
};

/**
 * The stored (inbound-Meta) mobile shape per country: dial code + mobile NSN.
 * The single accept pattern behind every plated phone field — imported by the
 * client schemas so the two sides can't drift.
 */
export const STORED_MOBILE_PATTERN: Record<Country, RegExp> = {
	MY: /^601\d{8,9}$/,
	SG: /^65[89]\d{7}$/,
};

/**
 * The noun the phone copy leads with — "Malaysian mobile", not "Malaysia
 * mobile", so it can't be derived from COUNTRY_LABELS. One author for every
 * surface that names the kind: the messages below, the settings cards' helper
 * lines, and the cross-country rejection copy.
 */
export const MOBILE_KIND: Record<Country, string> = {
	MY: "Malaysian mobile",
	SG: "Singapore mobile",
};

/**
 * The example each rejection shows — shaped the way a local writes one, and
 * (pinned by test) a value that country's own validator accepts, so the copy
 * can never demonstrate a format the save then refuses.
 */
export const MOBILE_EXAMPLE: Record<Country, string> = {
	MY: "012-345 6789",
	SG: "9123 4567",
};

/**
 * One rejection message per country — referenced by the server validators AND
 * the client schemas/fallback copy, so the wording exists in exactly one place.
 */
export const MOBILE_MESSAGE: Record<Country, string> = {
	MY: `Enter a ${MOBILE_KIND.MY} number (e.g. ${MOBILE_EXAMPLE.MY})`,
	SG: `Enter a ${MOBILE_KIND.SG} number (e.g. ${MOBILE_EXAMPLE.SG})`,
};

/**
 * Loose per-country bridging of a locally-typed number to international digits.
 *
 * MY keeps the historical arm byte-identical: drop the trunk 0, keep `60…`,
 * pass everything else through (a cashier may key a foreign number that
 * already carries its country code — see `assertValidWaPhoneForCountry`).
 * Deliberately NO bare-NSN fold here: a 9–10-digit number starting with 1
 * could plausibly be a mis-keyed foreign number, so only the strict validator
 * (whose field wears the `+60` plate) folds it.
 *
 * SG folds its bare NSN (`[89]` + 7 digits) even in the loose arm — the M3
 * CRM-fork fix: SG has no trunk 0, so `81234567` is the natural way an SG
 * cashier keys a local buyer, and an 8-digit string carries no country code
 * for the pass-through posture to preserve. Unprefixed it would be stored as
 * `81234567` while Meta delivers the same buyer inbound as `6581234567`,
 * forking the `(retailerId, waPhone)` customer row and sending to a dead
 * number.
 */
const LOOSE_NORMALIZE: Record<Country, (digits: string) => string> = {
	MY: (digits) => {
		if (digits.startsWith("60")) return digits;
		if (digits.startsWith("0")) return `60${digits.slice(1)}`;
		return digits;
	},
	SG: (digits) => {
		if (digits.startsWith("65")) return digits;
		if (MOBILE_NSN.SG.test(digits)) return `65${digits}`;
		return digits;
	},
};

/**
 * Normalize a locally-typed phone number to the SAME E.164-ish digits an
 * inbound WhatsApp message produces, so a cashier-keyed number keys identically
 * to a scan bind (customers are keyed by `(retailerId, waPhone)`; a mismatch
 * would fork a returning buyer into a duplicate CRM row and send to a bad
 * number). A cashier types a LOCAL number (`012-345 6789` / `9123 4567`), but
 * Meta delivers `60123456789` / `6591234567` — so a bare `assertValidWaPhone`
 * (which only strips separators) is not enough for manual entry. The
 * per-country bridging lives in `LOOSE_NORMALIZE`; anything unbridged is
 * passed through and validated (assume it already carries a country code —
 * the 8–15-digit rule still rejects junk). Which arm applies is driven by the
 * RETAILER's country, never by sniffing the number — sniffing is how a typo in
 * one country's shape gets silently accepted as the other's.
 */
export function assertValidWaPhoneForCountry(
	raw: string,
	country: Country,
): string {
	const digits = raw.replace(/\D/g, "");
	return assertValidWaPhone(LOOSE_NORMALIZE[country](digits));
}

/** MY-fixed alias kept for the callers that predate SG-lite (86eynw28q) and
 * genuinely mean Malaysia. New country-aware paths take the retailer's country
 * and call `assertValidWaPhoneForCountry` instead. */
export function assertValidMyWaPhone(raw: string): string {
	return assertValidWaPhoneForCountry(raw, "MY");
}

/**
 * Non-throwing sibling of `assertValidMobileForCountry`'s normalization — the
 * client's "has this changed?" checks and Zod schemas run this, then test
 * `STORED_MOBILE_PATTERN` themselves. The shape is *not* checked here, so this
 * is only for comparison and for feeding a validator, never for deciding a
 * number is valid. Folds the bare NSN for BOTH countries (these callers sit
 * behind the plate, where "type the rest" is exactly what the badge asks for).
 */
export function normalizeMobileDigits(
	value: string | undefined,
	country: Country,
): string {
	const digits = (value ?? "").replace(/\D/g, "");
	if (MOBILE_NSN[country].test(digits))
		return `${COUNTRY_DIAL_CODE[country]}${digits}`;
	return LOOSE_NORMALIZE[country](digits);
}

/**
 * Which OTHER supported country would accept this value as a mobile, if any —
 * input to better rejection copy, never to acceptance (z8r3fdbmc9).
 *
 * Sniffing a country from digits is deliberately banned for VALIDATION (see
 * `assertValidWaPhoneForCountry` — sniffing is how a typo in one country's
 * shape gets silently accepted as the other's). Error copy is the one place
 * it's safe: the value is rejected either way, and naming what it looks like
 * turns a dead end into a fix. The case that matters is a store sitting on the
 * wrong country (a missed onboarding default): the seller types their own
 * number, and "enter a Singapore mobile" describes the symptom while "that
 * looks like a Malaysian mobile" names the cause.
 */
export function otherCountryMobile(
	raw: string,
	country: Country,
): Country | null {
	for (const candidate of COUNTRIES) {
		if (candidate === country) continue;
		if (
			STORED_MOBILE_PATTERN[candidate].test(
				normalizeMobileDigits(raw, candidate),
			)
		) {
			return candidate;
		}
	}
	return null;
}

/**
 * The neutral cross-country rejection line — audience-safe, because the same
 * schemas serve buyer checkout, the track-page repair, and the seller's alert
 * and pickup-contact fields: it names what the number looks like and what this
 * store takes, with no fix path only one side could follow. Surfaces with a
 * country control in reach (onboarding, the settings contact card) layer their
 * own pointed copy on top.
 */
export function crossCountryMobileMessage(
	store: Country,
	typed: Country,
): string {
	return `That looks like a ${MOBILE_KIND[typed]} number (+${COUNTRY_DIAL_CODE[typed]}) — this store takes ${MOBILE_KIND[store]} numbers (e.g. ${MOBILE_EXAMPLE[store]})`;
}

/**
 * What a refused value's rejection SAYS — the cross-country line when the
 * digits cleanly match the other supported country, the store's own
 * `MOBILE_MESSAGE` otherwise. Acceptance is untouched; both the server
 * authority below and the client schemas built from these pieces route their
 * message through here so the copy can't drift between the two sides.
 */
export function mobileRejectionMessage(raw: string, country: Country): string {
	const other = otherCountryMobile(raw, country);
	return other
		? crossCountryMobileMessage(country, other)
		: MOBILE_MESSAGE[country];
}

/**
 * Stricter sibling of `assertValidWaPhoneForCountry` for numbers we intend to
 * MESSAGE: normalizes the same way, then requires the country's **mobile**
 * shape (`STORED_MOBILE_PATTERN`). An MY landline (`03-…` → `60312345678`)
 * satisfies the loose 8–15-digit rule but can never receive WhatsApp, so
 * accepting one guarantees a failed confirmation push — better to reject it at
 * the door with copy the buyer can act on.
 *
 * Accepts one shape the loose MY normalizer doesn't: a bare NSN (`12-345
 * 6789`, no trunk 0, no country code). The field wears a `+60`/`+65` prefix,
 * so "type the rest" is exactly what that badge asks for — without this the
 * buyer who obeys the prefix gets rejected. Safe to fold in HERE: `MOBILE_NSN`
 * windows are pinned per country, so a non-local international number can't be
 * captured and silently rewritten.
 *
 * The client fails fast via `src/lib/schemas.ts` (which imports this module's
 * patterns + messages, so the two can't drift); this is the authority.
 *
 * **The validator behind the plate.** Every field in the app that renders
 * `MyPhoneInput` / `TextField prefix={<MyPhonePrefix />}` lands here — buyer
 * checkout and the buyer's number repair (86eyf1rck), the seller's alert number
 * (86eyhw9zy), and since 86eyknr2r the store's own contact `waPhone` (settings,
 * onboarding, admin create) plus a pickup point's manager contact. The plate is
 * a promise about what the field accepts, so the two move together: the plate's
 * country and this validator's country both come from the retailer row, and a
 * field must never wear a plate this doesn't guard.
 *
 * Which arm applies is the RETAILER's country (SG-lite, 86eynw28q/86eynw2dy) —
 * never a permissive both-countries regex. Cross-country numbers are rejected
 * on purpose — an SG store's checkout refuses a `+60` buyer and vice versa,
 * keeping each side's typo protection exactly as strict as it was when the
 * app was MY-only — but the rejection copy names the mismatch when the digits
 * cleanly match the other country (`mobileRejectionMessage`, z8r3fdbmc9),
 * because "enter a Singapore mobile" is a dead end when the real problem is a
 * store on the wrong country.
 *
 * Deliberately NOT applied to the counter's manual bind, where a cashier may
 * legitimately key an unusual number for a buyer standing in front of them
 * (that path uses `assertValidWaPhoneForCountry`).
 */
export function assertValidMobileForCountry(
	raw: string,
	country: Country,
): string {
	const digits = raw.replace(/\D/g, "");
	// One message, whatever the input. The loose normalizer throws its own
	// "8–15 digits, with country code" text on junk — advice that directly
	// contradicts the plate the field is wearing, since the plate's whole job
	// is to say the country code is already handled.
	let normalized: string;
	try {
		normalized = MOBILE_NSN[country].test(digits)
			? assertValidWaPhoneForCountry(
					`${COUNTRY_DIAL_CODE[country]}${digits}`,
					country,
				)
			: assertValidWaPhoneForCountry(raw, country);
	} catch {
		throw new Error(mobileRejectionMessage(raw, country));
	}
	if (!STORED_MOBILE_PATTERN[country].test(normalized)) {
		throw new Error(mobileRejectionMessage(raw, country));
	}
	return normalized;
}

/** MY-fixed alias, kept so Kedaipal's own always-Malaysian numbers (the
 * platform support line in `./contact.ts`) don't have to spell out a country
 * that is not data-driven. Seller/buyer paths resolve the retailer's country
 * and call `assertValidMobileForCountry`. */
export function assertValidMyMobile(raw: string): string {
	return assertValidMobileForCountry(raw, "MY");
}

/**
 * Non-throwing canonicalization of a WhatsApp number to bare digits — the form
 * Meta delivers inbound (`from`) and the form `assertValidWaPhone` produces on
 * write. Use for MATCHING two numbers that may differ only in formatting (leading
 * '+', spaces, dashes) without rejecting an odd input. Strips every non-digit;
 * returns "" for a non-numeric string. The global opt-out keys on this so a
 * buyer's STOP suppresses later sends regardless of how the stored number is
 * formatted — opt-out compliance must not silently depend on every write path
 * having normalized first.
 */
export function normalizeWaPhone(raw: string): string {
	return raw.replace(/\D/g, "");
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

/**
 * Normalize and validate an email address. Trims whitespace, lowercases,
 * and applies a deliberately loose pattern — we don't try to out-validate
 * the receiving MTA, just reject obvious typos.
 */
export function assertValidEmail(raw: string): string {
	const s = raw.trim().toLowerCase();
	if (s.length === 0) throw new Error("Email is required");
	if (s.length > EMAIL_MAX) {
		throw new Error(`Email must be at most ${EMAIL_MAX} characters`);
	}
	if (!EMAIL_PATTERN.test(s)) {
		throw new Error("Email must look like name@example.com");
	}
	return s;
}
