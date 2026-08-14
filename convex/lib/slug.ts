/**
 * Server-side slug validation used by Convex mutations. Kept free of Convex
 * imports so it can be unit-tested in isolation and mirrors the client-side
 * logic in `src/lib/slug.ts`.
 *
 * IMPORTANT: Keep in sync with `src/lib/slug.ts`. Both files must stay
 * byte-identical in logic — they exist separately because Convex functions
 * bundle from the `convex/` directory.
 */

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
 * Normalize a Malaysian-typed phone number to the SAME E.164-ish digits an
 * inbound WhatsApp message produces, so a cashier-keyed number keys identically
 * to a scan bind (customers are keyed by `(retailerId, waPhone)`; a mismatch
 * would fork a returning buyer into a duplicate CRM row and send to a bad
 * number). A cashier types a LOCAL number (`012-345 6789`), but Meta delivers
 * `60123456789` — so a bare `assertValidWaPhone` (which only strips separators)
 * is not enough for manual entry. This bridges that gap:
 *   - `0xx…`  → `60xx…`  (drop the trunk 0, prepend the MY country code)
 *   - `60xx…` / `+60xx…` → kept as-is (already international)
 *   - anything else → passed through and validated (assume it already carries a
 *     country code; the 8–15-digit rule still rejects junk)
 * Then `assertValidWaPhone` enforces the shared 8–15-digit shape. Malaysia-only
 * for v1 — when we add markets, take the retailer's country and branch here.
 */
export function assertValidMyWaPhone(raw: string): string {
	const digits = raw.replace(/\D/g, "");
	let candidate: string;
	if (digits.startsWith("60")) candidate = digits;
	else if (digits.startsWith("0")) candidate = `60${digits.slice(1)}`;
	else candidate = digits;
	return assertValidWaPhone(candidate);
}

/** A Malaysian mobile national significant number typed WITHOUT the trunk 0 —
 * `12-345 6789`, i.e. 9–10 digits starting with 1. See `assertValidMyMobile`. */
const MY_MOBILE_NSN = /^1\d{8,9}$/;

/**
 * Stricter sibling of `assertValidMyWaPhone` for numbers we intend to MESSAGE:
 * normalizes the same way, then requires a Malaysian **mobile** shape (`601X`
 * plus 8–9 digits). A landline (`03-…` → `60312345678`) satisfies the loose
 * 8–15-digit rule but can never receive WhatsApp, so accepting one guarantees a
 * failed confirmation push — better to reject it at the door with copy the
 * buyer can act on.
 *
 * Accepts one shape the loose normalizer doesn't: a bare NSN (`12-345 6789`,
 * no trunk 0, no country code). Checkout shows a `+60` prefix on the field, so
 * "type the rest" is exactly what that badge asks for — without this the buyer
 * who obeys the prefix gets rejected. Safe to fold in HERE and not in
 * `assertValidMyWaPhone`: the pattern is pinned to 9–10 digits starting with 1,
 * so a non-MY international number that happens to start with 1 (a US `+1`,
 * which is 11 digits) can't be captured and silently rewritten to a Malaysian
 * one. The loose normalizer stays untouched for the counter's manual bind,
 * where a cashier may legitimately key a foreign number.
 *
 * Mirrors `myWaPhoneCheckoutSchema` in `src/lib/schemas.ts` (same message, same
 * pattern); the client fails fast, this is the authority.
 *
 * **The validator behind the `+60` plate.** Every field in the app that renders
 * `MyPhoneInput` / `TextField prefix={<MyPhonePrefix />}` lands here — buyer
 * checkout and the buyer's number repair (86eyf1rck), the seller's alert number
 * (86eyhw9zy), and since 86eyknr2r the store's own contact `waPhone` (settings,
 * onboarding, admin create) plus a pickup point's manager contact. The plate is
 * a promise about what the field takes, so the two move together: never put the
 * plate on a field this doesn't guard.
 *
 * Seller-side numbers joined the strict rule because Kedaipal is Malaysia-only
 * in every direction that matters — the shared WABA is MY-verified, and a
 * Lalamove sender contact must be `+60`, with `waPhone` as its fallback, so a
 * non-MY value silently broke dispatch rather than being a supported case.
 *
 * Deliberately NOT applied to the counter's manual bind, where a cashier may
 * legitimately key an unusual number for a buyer standing in front of them.
 */
export const MY_MOBILE_MESSAGE =
	"Enter a Malaysian mobile number (e.g. 012-345 6789)";

export function assertValidMyMobile(raw: string): string {
	const digits = raw.replace(/\D/g, "");
	// One message, whatever the input. The loose normalizer throws its own
	// "8–15 digits, with country code" text on junk — advice that now directly
	// contradicts the `+60` plate the field is wearing, since the plate's whole
	// job is to say the country code is already handled.
	let normalized: string;
	try {
		normalized = MY_MOBILE_NSN.test(digits)
			? assertValidMyWaPhone(`60${digits}`)
			: assertValidMyWaPhone(raw);
	} catch {
		throw new Error(MY_MOBILE_MESSAGE);
	}
	if (!/^601\d{8,9}$/.test(normalized)) {
		throw new Error(MY_MOBILE_MESSAGE);
	}
	return normalized;
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
