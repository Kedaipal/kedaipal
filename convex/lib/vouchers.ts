// Voucher primitives (ClickUp `z8r3fdr617`, docs/vouchers.md). No Convex
// imports — the code generator, the discount maths, the status rule and every
// refusal sentence live here so the server, the storefront preview, the
// counter panel and the claim ticket can never disagree about what a code is
// worth or why it was turned down.
//
// A voucher is the BUYER-SPECIFIC discount lever, deducted from ONE order. It
// comes in two USAGES (`VoucherUsage`): a SINGLE-use voucher is one row = one
// unique `KP-XXXX-XXXX` code = one redemption; a SHARED code (`z8r3fducfm`) is
// one row = one seller-named code (`SALE345`) = many redemptions, bounded by a
// total cap, an end time, or both. The product-level lever (promo price /
// flash sale) changes the LINE PRICE and is a deliberately separate mechanism
// — they stack, and neither knows about the other. See docs/vouchers.md.
//
// The claim ticket loads this file in the BROWSER, so it must never value-
// import a Convex function module (`src/lib/convex-client-imports.test.ts`).

import type { Id } from "../_generated/dataModel";
import {
	DAY_MS,
	formatFulfilmentDate,
	formatFulfilmentTime,
	mytMinutesOfDay,
	todayMytMidnight,
	ymdFromEpoch,
} from "./fulfilmentDate";

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
// Shared codes (`z8r3fducfm`)
// ---------------------------------------------------------------------------

/**
 * How many times a code can be spent. `single` is the original voucher — one
 * crypto-random code, one redemption, flips to `redeemed`. `shared` is one
 * seller-named code many buyers type ("use SALE345 for 20% off"), which
 * COUNTS redemptions instead of flipping, and stops at a total cap, an end
 * time, or whichever of the two comes first.
 *
 * Absent on every row minted before shared codes existed, which is what
 * `voucherUsageOf` folds back to `single` — no backfill, nothing to migrate.
 */
export type VoucherUsage = "single" | "shared";

export function voucherUsageOf(voucher: { usage?: VoucherUsage }): VoucherUsage {
	return voucher.usage ?? "single";
}

/** A seller-chosen code is a WORD, not a secret: 4–16 letters and digits,
 * case-folded. Short enough to say on a poster, long enough that "SALE" alone
 * isn't a code every store on the platform ends up sharing by accident. */
export const SHARED_CODE_MIN = 4;
export const SHARED_CODE_MAX = 16;

/** Ceiling on a shared code's total uses. Not a business rule, a fat-finger
 * guard like `VOUCHER_FIXED_MAX`: an extra zero on "how many can use it" is
 * only visible after the hundredth stranger has. */
export const SHARED_USES_MAX = 10_000;

/**
 * Fold whatever the buyer typed onto a shared code's canonical spelling, or
 * `null` if it can't be one: upper-cased, with spaces and punctuation dropped
 * ("sale 345" → `SALE345`). Letters and digits are the whole alphabet, so —
 * unlike the single-use parser — there is nothing to repair and nothing to
 * refuse per character.
 */
export function normalizeSharedCode(input: string): string | null {
	const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
	if (stripped.length < SHARED_CODE_MIN || stripped.length > SHARED_CODE_MAX)
		return null;
	return stripped;
}

/** What a typed code resolved to — which parser claimed it, and the canonical
 * spelling to look up. */
export type ParsedVoucherCode = { usage: VoucherUsage; code: string };

/**
 * ONE buyer field, two spellings. The single-use parser goes first because
 * its shape is strict (exactly 8 symbols over the no-O/0/I/1 alphabet, with
 * or without `KP-`), and `sharedCodeError` refuses at CREATE any shared code
 * that would parse as a single-use one — so no real code is ever claimed by
 * both, and the order here can never change what a buyer's code means.
 *
 * Every door asks this (storefront field, `?voucher=` link, counter draft,
 * the resolve path) so a code has one spelling in the database and a lookup
 * never misses on punctuation or case.
 */
export function parseVoucherCode(input: string): ParsedVoucherCode | null {
	const single = normalizeVoucherCode(input);
	if (single !== null) return { usage: "single", code: single };
	const shared = normalizeSharedCode(input);
	if (shared !== null) return { usage: "shared", code: shared };
	return null;
}

/**
 * Is this a code a seller is allowed to NAME? Shared by the create mutation
 * and the issue form's disabled-with-reason button, so the form never offers
 * a code the server will refuse. The last rule is the one that keeps
 * `parseVoucherCode` honest: a word that happens to be 8 symbols of the
 * single-use alphabet (`SALEDEAL`) would be claimed by the single-use parser
 * and never reach the shared lookup, so it can't be issued as a shared code.
 */
export function sharedCodeError(input: string): string | null {
	const trimmed = input.trim();
	if (trimmed === "") return "Type a code, or pick one of the suggestions";
	if (/[^A-Za-z0-9]/.test(trimmed))
		return "Letters and numbers only — no spaces or symbols";
	if (trimmed.length < SHARED_CODE_MIN)
		return `At least ${SHARED_CODE_MIN} characters`;
	if (trimmed.length > SHARED_CODE_MAX)
		return `At most ${SHARED_CODE_MAX} characters`;
	if (normalizeVoucherCode(trimmed) !== null)
		return "That reads like one of our single-use codes — add a digit, or pick another word";
	return null;
}

/** When a shared code stops working: a total number of uses, an exact end
 * instant, or both. At least one is required — see `sharedLimitsError`. */
export type SharedLimits = {
	maxRedemptions?: number;
	/** Exact epoch ms. NOT the single-use `expiresAt` day convention: a shared
	 * code is posted for a happy hour or a weekend sale, so it ends at a
	 * TIME, and "works all through the day" would overshoot by hours. */
	endsAt?: number;
};

/**
 * Is this a bound a seller is allowed to set? A shared code is public by
 * design — anyone who sees the poster can use it — so one WITHOUT a bound is
 * an open-ended liability, and refusing that is the one guard rail here that
 * is a business rule rather than a fat-finger check (Zaki, 30 Oct 2026:
 * "either a max quantity or a deadline or both").
 */
export function sharedLimitsError(limits: SharedLimits, now: number): string | null {
	if (limits.maxRedemptions === undefined && limits.endsAt === undefined)
		return "Set how many orders can use it, when it ends, or both";
	if (limits.maxRedemptions !== undefined) {
		if (
			!Number.isInteger(limits.maxRedemptions) ||
			limits.maxRedemptions < 1
		)
			return "Enter a whole number of uses";
		if (limits.maxRedemptions > SHARED_USES_MAX)
			return `At most ${SHARED_USES_MAX.toLocaleString("en-MY")} uses — check the number`;
	}
	if (limits.endsAt !== undefined) {
		if (!Number.isFinite(limits.endsAt)) return "Pick when it ends";
		if (limits.endsAt <= now) return "That end time has already passed";
	}
	return null;
}

/**
 * Three codes a seller might like, so "name a code" never starts from a blank
 * box: one that says the value (`SAVE20`), a second spelling of it, and a
 * random `SALE###` for when the value isn't a nice word. Every suggestion is
 * passed back through `sharedCodeError`, so none can be refused on pick — a
 * suggestion the form then rejects would be worse than no suggestion.
 */
export function suggestSharedCodes(terms: VoucherTerms): string[] {
	const n =
		terms.kind === "percent"
			? clampPercent(terms.value)
			: Math.floor(finiteNonNegative(terms.value) / 100);
	const bytes = new Uint8Array(2);
	crypto.getRandomValues(bytes);
	const digits = String(100 + ((bytes[0] * 256 + bytes[1]) % 900));
	const picks = new Set<string>();
	if (n > 0) {
		picks.add(`SAVE${n}`);
		picks.add(terms.kind === "percent" ? `DEAL${n}` : `TAKE${n}`);
	}
	picks.add(`SALE${digits}`);
	return [...picks].filter((code) => sharedCodeError(code) === null).slice(0, 3);
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
export type VoucherSnapshot = VoucherTerms & {
	code: string;
	/** Frozen with the code (`z8r3fducfm`): the order page has to say what a
	 * cancel does to the voucher — "back to this buyer" for a single-use one,
	 * "one use back for anyone" for a shared word — and the row the id points
	 * at is not what a money surface should have to join for one sentence.
	 * Absent on orders placed before shared codes existed = `single`. */
	usage?: VoucherUsage;
};

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
	 * convention). The voucher dies when that day ends, not when it begins.
	 * Single-use only. */
	expiresAt?: number;
	usage?: VoucherUsage;
	/** Shared only — see `SharedLimits`. */
	endsAt?: number;
	maxRedemptions?: number;
	/** Shared only: how many orders have spent it (less any handed back). */
	redeemedCount?: number;
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
 *
 * A SHARED code is never stored `redeemed`: its two bounds are both judged
 * here, off the count and the clock, so the row and the truth can't drift.
 * It reads `redeemed` ("all used") once the cap is reached and `expired` once
 * its end time passes — and the cap is asked FIRST, which is not a tie-break
 * but the actual order of events: a redemption can only land while the code
 * is still running, so a full cap was necessarily filled before any end time
 * passed. "Whichever comes first" (Zaki) falls out of that without a stamp.
 */
export function resolveVoucherStatus(
	voucher: VoucherStatusFields,
	now: number,
): VoucherStatus {
	if (voucher.status !== "active") return voucher.status;
	if (voucherUsageOf(voucher) === "shared") {
		if (isSharedExhausted(voucher)) return "redeemed";
		if (isSharedEnded(voucher.endsAt, now)) return "expired";
		return "active";
	}
	return isVoucherExpired(voucher.expiresAt, now) ? "expired" : "active";
}

/** Has a shared code's cap been reached? No cap = never. */
export function isSharedExhausted(voucher: {
	maxRedemptions?: number;
	redeemedCount?: number;
}): boolean {
	return (
		voucher.maxRedemptions !== undefined &&
		(voucher.redeemedCount ?? 0) >= voucher.maxRedemptions
	);
}

/** Has a shared code's end time passed? An exact instant, unlike the
 * single-use day rule — see `SharedLimits.endsAt`. */
export function isSharedEnded(endsAt: number | undefined, now: number): boolean {
	return endsAt !== undefined && now >= endsAt;
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
	/** A SHARED code whose total cap is reached — "already used" would be a
	 * lie to the buyer who never used it, and the honest sentence stops them
	 * retyping it (`z8r3fducfm`). */
	| "exhausted"
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
			// Two shapes are valid now (`KP-XXXX-XXXX` or a 4–16 letter word), so
			// naming one of them would mislead the buyer holding the other.
			return "That doesn't look like a voucher code — check it and try again.";
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
		case "exhausted":
			return "This code has run out — every use has been taken.";
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
	// A full shared code resolves `redeemed` for the seller's chips, but the
	// BUYER was never the one who used it — their sentence is its own.
	if (status === "redeemed" && voucherUsageOf(voucher) === "shared")
		return "exhausted";
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

/** "12 of 50 used" / "12 used" — a shared code's tally, cap or no cap. The
 * ONE author for the seller's list, the share sheet and the uses dialog. */
export function formatSharedUses(voucher: {
	maxRedemptions?: number;
	redeemedCount?: number;
}): string {
	const used = voucher.redeemedCount ?? 0;
	return voucher.maxRedemptions === undefined
		? `${used} used`
		: `${used} of ${voucher.maxRedemptions} used`;
}

/** A shared code's end instant in store time — "31 Oct 2026, 6:00 PM" — from
 * the house date and time formatters, so a time never appears in two
 * spellings. A comma, not the fulfilment line's "·": this sits inside the
 * list's own dot-separated outcome line. */
export function formatVoucherEnd(endsAt: number): string {
	return `${formatFulfilmentDate(todayMytMidnight(endsAt), { weekday: false })}, ${formatFulfilmentTime(mytMinutesOfDay(endsAt))}`;
}

/**
 * The state of a CLAIM's frozen voucher, for the claim page's read and the
 * commit's maths — asked in both places so the price the buyer confirms is the
 * price the commit computes.
 *
 * `dropped` is the state that matters: the claim carries a voucher that can no
 * longer be spent (keyed at the counter meanwhile, voided, lapsed). The page
 * renders `message` above the ticket and prices without it; the commit then
 * agrees. The alternative — refusing the commit — would strand a buyer who did
 * nothing wrong, since only the seller can issue a new link.
 */
export type ClaimVoucherState =
	| { kind: "none" }
	| {
			kind: "applied";
			voucherId: Id<"vouchers">;
			snapshot: VoucherSnapshot;
			terms: VoucherTerms;
		}
	| {
			kind: "dropped";
			snapshot: VoucherSnapshot;
			refusal: VoucherRefusal;
			message: string;
		};

/**
 * What a claim's voucher takes off, from its state alone (`z8r3fdr617`).
 *
 * Only an `applied` voucher discounts: a `dropped` one is exactly the case
 * where the buyer must be charged the full price and TOLD why, so it has to
 * return 0 here or the page would quote a discount the commit then refuses to
 * honour. Every surface that prices a claim asks this — the ticket, the
 * confirm button and the page header — so none of them can disagree.
 */
export function claimVoucherDiscount(
	voucher: ClaimVoucherState | undefined,
	itemSubtotal: number,
): number {
	return voucher?.kind === "applied"
		? voucherDiscountFor(voucher.terms, itemSubtotal)
		: 0;
}
