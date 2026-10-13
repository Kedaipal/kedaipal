// Voucher primitives (ClickUp `z8r3fdr617`, docs/vouchers.md). No Convex
// imports — the code generator, the discount maths, the status rule and every
// refusal sentence live here so the server, the storefront preview, the
// counter panel and the claim ticket can never disagree about what a code is
// worth or why it was turned down.
//
// A voucher is the BUYER-SPECIFIC discount lever: one row = one unique code =
// one redemption, deducted from ONE order. The product-level lever (promo
// price / flash sale) changes the LINE PRICE and is a deliberately separate
// mechanism — they stack, and neither knows about the other. See
// docs/vouchers.md.

import { DAY_MS, ymdFromEpoch } from "./fulfilmentDate";

/**
 * Code alphabet — the `generateShortId` alphabet, for the same reason: a
 * voucher code is read down a phone line, keyed off a buyer's screenshot at a
 * stall, and typed on a mobile keyboard, so O/0/I/1 must never be PRINTED.
 * Because no real code can contain them, a typed O or 1 is simply an error —
 * there is deliberately no "fold 0 to O" repair, which would map two distinct
 * codes onto one and hand a buyer somebody else's voucher.
 */
const VOUCHER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** `KP-XXXX-XXXX` — the platform prefix makes a stray code recognisable in a
 * WhatsApp thread months later, and anchors the "is this one of ours?" check. */
export const VOUCHER_CODE_PREFIX = "KP";

/** 8 random symbols over a 32-symbol alphabet = 40 bits. Not a capability
 * token (see `generateTrackingToken` for that posture) — a voucher is worth
 * one order's discount, is rate-limited per store at both doors, and dies on
 * first use. 40 bits puts blind guessing far beyond the limiter's reach while
 * keeping the code short enough to read aloud. */
const VOUCHER_BODY_LENGTH = 8;
const VOUCHER_GROUP = 4;

/** Crypto-random code in canonical `KP-XXXX-XXXX` form. Uses Web Crypto
 * (`crypto.getRandomValues`), available in both Convex runtimes — `Math.random`
 * would make a store's whole batch predictable from one issued code. */
export function generateVoucherCode(): string {
	const bytes = new Uint8Array(VOUCHER_BODY_LENGTH);
	crypto.getRandomValues(bytes);
	let body = "";
	for (let i = 0; i < VOUCHER_BODY_LENGTH; i++) {
		body += VOUCHER_ALPHABET[bytes[i] % VOUCHER_ALPHABET.length];
	}
	return formatVoucherCode(body);
}

/** Group a bare 8-symbol body into the printed shape. */
function formatVoucherCode(body: string): string {
	return `${VOUCHER_CODE_PREFIX}-${body.slice(0, VOUCHER_GROUP)}-${body.slice(
		VOUCHER_GROUP,
	)}`;
}

/**
 * Fold whatever the human typed onto the canonical code, or `null` if it can't
 * be one of ours.
 *
 * Accepts the code as a buyer realistically produces it: lowercase, with or
 * without the `KP-` prefix, dashes, spaces or an accidental tab from a
 * copy-paste. Everything else is rejected rather than guessed — see
 * `VOUCHER_ALPHABET` on why there is no character repair.
 *
 * Used at EVERY door (storefront field, `?voucher=` link, counter panel, claim
 * send) and inside the redeem mutation, so a code only ever has one spelling
 * in the database and a lookup can never miss on punctuation.
 */
export function normalizeVoucherCode(input: string): string | null {
	const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
	// Strip the prefix only when what's left is a whole body. Unconditional
	// stripping refused the BARE form of any code whose body happens to begin
	// `KP` — about 1 in 1024 of them — because `KPABCDEF` lost two characters
	// and came back six long (PR #357 review).
	//
	// This reads both ways without ever guessing: a body is exactly
	// `VOUCHER_BODY_LENGTH`, so an input of that length can only BE a body,
	// and one of prefix+body length can only be prefixed. The two readings are
	// never both valid, which is what keeps this a parse and not the character
	// repair `VOUCHER_ALPHABET` forbids — nothing here can map two distinct
	// codes onto one.
	const unprefixed = stripped.startsWith(VOUCHER_CODE_PREFIX)
		? stripped.slice(VOUCHER_CODE_PREFIX.length)
		: null;
	const body =
		unprefixed?.length === VOUCHER_BODY_LENGTH ? unprefixed : stripped;
	if (body.length !== VOUCHER_BODY_LENGTH) return null;
	for (const ch of body) if (!VOUCHER_ALPHABET.includes(ch)) return null;
	return formatVoucherCode(body);
}

// ---------------------------------------------------------------------------
// Value
// ---------------------------------------------------------------------------

export type VoucherKind = "fixed" | "percent";

/** The terms of a voucher — what it is worth, independent of any order.
 * FROZEN onto the order at redemption (`orders.voucherSnapshot`) so a row that
 * is later voided, or a code reused by a future feature, can never restate a
 * placed order's discount. */
export type VoucherTerms = {
	kind: VoucherKind;
	/** `fixed`: minor units (sen). `percent`: whole percent, 1–100. */
	value: number;
};

/**
 * The terms PLUS the code, which is what gets frozen onto an order or a claim
 * (`orders.voucherSnapshot`). The code rides along for the same reason the
 * pickup note does: it is what the buyer was told, and the receipt, the
 * tracking page and the seller's inbox all want to print it without a join.
 */
export type VoucherSnapshot = VoucherTerms & { code: string };

/** Ceiling on a fixed-amount voucher (minor units) — RM5,000 / S$5,000. Not a
 * business rule, a fat-finger guard: an extra zero on a giveaway code is the
 * kind of mistake that is only visible after someone has spent it. */
export const VOUCHER_FIXED_MAX = 500_000;

/** A percentage voucher is capped at 100 — "free" is the most anything can
 * take off, and the clamp below means 100% still never eats a delivery fee. */
export const VOUCHER_PERCENT_MAX = 100;

/** Longest private label a seller writes on a voucher ("Raya giveaway",
 * "Apology — late order #ORD-7F3K"). Never shown to the buyer. */
export const VOUCHER_NOTE_MAX = 80;

/** Most vouchers one "create" can mint. Sized for a real giveaway run (a
 * market-day stack of printed codes) while keeping the mutation inside one
 * Convex transaction's write budget. */
export const VOUCHER_BATCH_MAX = 50;

/**
 * What this voucher takes off, given the order's ITEM SUBTOTAL.
 *
 * Two rules, and both are the doc's guard rails rather than implementation
 * detail:
 *
 *  1. The base is the item subtotal ALONE — never fees, never a deposit. A
 *     voucher is a discount on the goods; it must not quietly pay the courier
 *     or hand back refundable money.
 *  2. The result is CLAMPED to that subtotal. That single clamp is also what
 *     keeps the order total at or above zero: every other term the total
 *     carries is additive and non-negative, so `subtotal - min(d, subtotal)`
 *     can never drive it negative. A RM50 code on a RM30 basket takes RM30 and
 *     the buyer still pays delivery.
 *
 * Percentages round to the nearest sen (`Math.round`) — a 15% voucher on
 * RM33.33 is RM5.00, not RM4.9995. Rounding happens HERE, once, so the
 * storefront preview and the stored total agree to the sen.
 */
export function voucherDiscountFor(
	terms: VoucherTerms,
	itemSubtotal: number,
): number {
	const base = finiteNonNegative(itemSubtotal);
	const raw =
		terms.kind === "percent"
			? Math.round((base * clampPercent(terms.value)) / 100)
			: Math.floor(finiteNonNegative(terms.value));
	return Math.min(raw, base);
}

/**
 * Floor to 0, and treat a non-finite number as 0.
 *
 * `Math.max(0, NaN)` is NaN, not 0 — so a plain floor would carry a NaN
 * straight into `total` and write an unreadable order (caught by
 * `vouchers.test.ts`, which is why it is a named helper rather than an inline
 * `Math.max`). `voucherValueError` already refuses a non-finite value at
 * issue, so this is defence in depth on money arithmetic: nothing that reaches
 * these numbers can make a voucher ADD to a total.
 */
function finiteNonNegative(value: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clampPercent(value: number): number {
	return Math.min(VOUCHER_PERCENT_MAX, Math.round(finiteNonNegative(value)));
}

/** Is this a value a seller is allowed to issue? Shared by the create
 * mutation and the issue form's disabled-with-reason button, so the form can
 * never offer a value the server will refuse. */
export function voucherValueError(terms: VoucherTerms): string | null {
	if (!Number.isFinite(terms.value) || !Number.isInteger(terms.value))
		return "Enter a whole amount";
	if (terms.value <= 0) return "A voucher has to be worth something";
	if (terms.kind === "percent" && terms.value > VOUCHER_PERCENT_MAX)
		return "A voucher can't take off more than 100%";
	if (terms.kind === "fixed" && terms.value > VOUCHER_FIXED_MAX)
		return `That's over the ${VOUCHER_FIXED_MAX / 100} limit — check the amount`;
	return null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** What a seller (and the buyer's error message) sees. `expired` is NOT
 * stored — see `resolveVoucherStatus`. */
export type VoucherStatus = "active" | "redeemed" | "voided" | "expired";

/** The three states a row can actually be IN. */
export type StoredVoucherStatus = "active" | "redeemed" | "voided";

/** The voucher fields the status rule reads — a subset of the doc. */
export type VoucherStatusFields = {
	status: StoredVoucherStatus;
	/** MYT midnight of the LAST day the code works (the `fulfilmentDate`
	 * convention). The voucher dies when that day ends, not when it begins. */
	expiresAt?: number;
};

/**
 * The live status. `expired` is judged at READ time against the clock and is
 * never written: no cron flips vouchers, so there is no window in which the
 * database and the truth disagree, and a store that changes nothing still sees
 * its codes lapse on the right day.
 *
 * Deliberately one-way — a redeemed or voided voucher keeps that status past
 * its expiry date, because what happened to it is more useful to the seller
 * than the calendar ("used on #ORD-7F3K" beats "expired").
 */
export function resolveVoucherStatus(
	voucher: VoucherStatusFields,
	now: number,
): VoucherStatus {
	if (voucher.status !== "active") return voucher.status;
	return isVoucherExpired(voucher.expiresAt, now) ? "expired" : "active";
}

/** The expiry rule in one place: a voucher dated the 20th works all through
 * the 20th in store time and dies at midnight. `expiresAt` holds MYT midnight
 * of that day, so the deadline is the END of it. */
export function isVoucherExpired(
	expiresAt: number | undefined,
	now: number,
): boolean {
	if (expiresAt === undefined) return false;
	return now >= expiresAt + DAY_MS;
}

/** Can a code be spent right now? The ONE predicate every door asks. */
export function isVoucherRedeemable(
	voucher: VoucherStatusFields,
	now: number,
): boolean {
	return resolveVoucherStatus(voucher, now) === "active";
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * Why a code was turned down. A NAMED reason rather than one "invalid code",
 * because the buyer's next move differs in every case: a typo is retyped, an
 * expired code is worth asking the seller about, and "already used on
 * #ORD-7F3K" is the one that stops a buyer insisting the discount is owed.
 */
export type VoucherRefusal =
	| "malformed"
	| "not_found"
	| "expired"
	| "voided"
	| "redeemed"
	/**
	 * The STORE can't redeem vouchers right now — it has dropped below the
	 * plan that carries the feature (`z8r3fdr617`). A property of the shop,
	 * not of the code: the voucher row is still `active`, and re-upgrading
	 * makes it spendable again, exactly as a promo price returns.
	 */
	| "store_ineligible"
	| "already_on_order";

/** The buyer- and seller-facing sentence for each refusal. One author, so the
 * storefront field, the counter panel, the claim page and the server's thrown
 * error all say the same thing. */
export function voucherRefusalMessage(
	refusal: VoucherRefusal,
	opts: { usedOnOrder?: string } = {},
): string {
	switch (refusal) {
		case "malformed":
			return "That doesn't look like a voucher code — they read KP-XXXX-XXXX.";
		case "not_found":
			// Covers a code that belongs to ANOTHER store too: naming that would
			// confirm the code exists somewhere, and "not for this store" is not
			// a distinction the buyer can act on.
			return "This code isn't valid for this store.";
		case "expired":
			return "This voucher has expired.";
		case "voided":
			return "This voucher is no longer valid.";
		case "redeemed":
			return opts.usedOnOrder
				? `This voucher was already used on ${opts.usedOnOrder}.`
				: "This voucher has already been used.";
		case "store_ineligible":
			// Neutral, and it never mentions a plan: the store's billing is not
			// the buyer's business, and "they downgraded" invites the buyer to
			// judge a shop for something between the shop and us. Mirrors the
			// payments-paused copy, the house precedent for this exact shape.
			return "This store isn't accepting vouchers right now.";
		case "already_on_order":
			return "One voucher per order — remove the current one first.";
	}
}

/**
 * Typed `ConvexError` payload for a refused code — the `CreditLockErrorData`
 * pattern. A plain thrown string would reach the storefront as a toast; this
 * lets each door put the sentence where the buyer is actually looking (under
 * the voucher field, not over the page) and keep the rest of the checkout
 * untouched, which matters because a bad code must never cost the order.
 */
export type VoucherRefusalErrorData = {
	kind: "voucher_refused";
	refusal: VoucherRefusal;
	message: string;
	/** The order the code was already spent on, when that's why. */
	usedOnOrder?: string;
};

export function voucherRefusalErrorData(
	refusal: VoucherRefusal,
	opts: { usedOnOrder?: string } = {},
): VoucherRefusalErrorData {
	return {
		kind: "voucher_refused",
		refusal,
		message: voucherRefusalMessage(refusal, opts),
		usedOnOrder: opts.usedOnOrder,
	};
}

/** Is this `ConvexError` payload a voucher refusal? */
export function isVoucherRefusalErrorData(
	data: unknown,
): data is VoucherRefusalErrorData {
	if (typeof data !== "object" || data === null) return false;
	const d = data as Record<string, unknown>;
	return d.kind === "voucher_refused" && typeof d.message === "string";
}

/** The refusal a non-redeemable row maps to. Split from the message so the
 * server can throw a typed reason and each surface can choose its own
 * presentation. */
export function refusalForVoucher(
	voucher: VoucherStatusFields,
	now: number,
): Exclude<VoucherRefusal, "malformed" | "not_found" | "already_on_order"> | null {
	const status = resolveVoucherStatus(voucher, now);
	if (status === "active") return null;
	return status;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * "RM10 off" / "15% off" — the voucher's worth in words, for the seller's
 * list, the share sheet and the buyer's applied-voucher row. Takes the
 * currency because a fixed voucher is minted in the store's currency and a
 * percentage has none.
 */
export function formatVoucherTerms(
	terms: VoucherTerms,
	formatAmount: (sen: number) => string,
): string {
	return terms.kind === "percent"
		? `${clampPercent(terms.value)}% off`
		: `${formatAmount(terms.value)} off`;
}

/** The expiry in the seller's words — `undefined` expiry has none, which is a
 * real answer ("no expiry") and not a blank. */
export function formatVoucherExpiry(expiresAt: number | undefined): string {
	return expiresAt === undefined ? "No expiry" : `Until ${ymdFromEpoch(expiresAt)}`;
}
