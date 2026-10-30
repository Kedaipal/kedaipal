import { describe, expect, test } from "vitest";
import { DAY_MS, mytMidnightFromYmd } from "./fulfilmentDate";
import {
	formatSharedUses,
	formatVoucherMoney,
	formatVoucherMoment,
	formatVoucherExpiry,
	formatVoucherTerms,
	generateVoucherCode,
	isVoucherExpired,
	isVoucherRedeemable,
	isVoucherRefusalErrorData,
	minSpendError,
	minSpendShortfall,
	normalizeSharedCode,
	normalizeVoucherCode,
	parseVoucherCode,
	refusalForVoucher,
	resolveVoucherStatus,
	SHARED_CODE_MAX,
	SHARED_CODE_MIN,
	SHARED_USES_MAX,
	sharedCodeError,
	sharedExtendError,
	sharedLimitsError,
	suggestSharedCodes,
	VOUCHER_FIXED_MAX,
	VOUCHER_PERCENT_MAX,
	voucherDiscountFor,
	voucherFinePrint,
	voucherRefusalErrorData,
	voucherRefusalMessage,
	voucherValueError,
} from "./vouchers";

const sen = (n: number) => `RM${(n / 100).toFixed(2)}`;

describe("voucher codes", () => {
	test("generated codes are KP-XXXX-XXXX over the unambiguous alphabet", () => {
		for (let i = 0; i < 200; i++) {
			const code = generateVoucherCode();
			expect(code).toMatch(/^KP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
			// The whole point of the alphabet: never PRINT a confusable glyph.
			expect(code.slice(3)).not.toMatch(/[O0I1]/);
		}
	});

	test("codes are crypto-random, not a sequence", () => {
		// 2^40 space — 500 draws colliding would mean the generator is broken,
		// not unlucky. (Guards against a `Math.random`/seeded regression.)
		const seen = new Set<string>();
		for (let i = 0; i < 500; i++) seen.add(generateVoucherCode());
		expect(seen.size).toBe(500);
	});

	test("normalize accepts every shape a human produces", () => {
		const canonical = "KP-7F3K-Q2WM";
		for (const typed of [
			"KP-7F3K-Q2WM",
			"kp-7f3k-q2wm",
			"KP7F3KQ2WM",
			"7F3K-Q2WM", // prefix left off
			"7f3kq2wm",
			"  KP 7F3K Q2WM  ",
			"KP–7F3K–Q2WM".replace(/–/g, "-"),
			"kp_7f3k_q2wm",
		]) {
			expect(normalizeVoucherCode(typed), typed).toBe(canonical);
		}
	});

	test("a code whose BODY starts KP still reads in its bare form", () => {
		// ~1 in 1024 codes begin `KP` after the prefix, and stripping the
		// prefix unconditionally ate two of their characters: `KPABCDEF` came
		// back six long and was refused, while the full `KP-KPAB-CDEF` worked
		// — so the bug only ever bit the buyer who typed what they were read
		// out (PR #357 review).
		expect(normalizeVoucherCode("KPAB-CDEF")).toBe("KP-KPAB-CDEF");
		expect(normalizeVoucherCode("kpabcdef")).toBe("KP-KPAB-CDEF");
		expect(normalizeVoucherCode("KP-KPAB-CDEF")).toBe("KP-KPAB-CDEF");
		expect(normalizeVoucherCode("KPKPABCDEF")).toBe("KP-KPAB-CDEF");
	});

	test("reading both ways never maps two codes onto one", () => {
		// The reason the above is a parse and not the character repair the
		// alphabet forbids: a body is exactly 8, so an 8-char input can only BE
		// a body and a 10-char one can only be prefixed. Both readings are
		// never valid at once, so nothing is guessed.
		expect(normalizeVoucherCode("KPABCDEFGH")).toBe("KP-ABCD-EFGH");
		expect(normalizeVoucherCode("ABCDEFGH")).toBe("KP-ABCD-EFGH");
		// 6 after the prefix and 8 raw — only the second reading is whole.
		expect(normalizeVoucherCode("KPABCDEF")).toBe("KP-KPAB-CDEF");
	});

	test("normalize rejects rather than repairing an ambiguous character", () => {
		// No real code contains O/0/I/1, so a typed one is an error. Folding it
		// (0→O) would map two distinct codes onto one and could hand a buyer
		// somebody else's voucher — so it must refuse, not guess.
		expect(normalizeVoucherCode("KP-7F3K-Q2W0")).toBeNull();
		expect(normalizeVoucherCode("KP-7F3K-Q2WO")).toBeNull();
		expect(normalizeVoucherCode("KP-7F3K-Q2WI")).toBeNull();
		expect(normalizeVoucherCode("KP-7F3K-Q2W1")).toBeNull();
	});

	test("normalize rejects the wrong length and junk", () => {
		expect(normalizeVoucherCode("")).toBeNull();
		expect(normalizeVoucherCode("KP-7F3K")).toBeNull(); // too short
		expect(normalizeVoucherCode("KP-7F3K-Q2WMX")).toBeNull(); // too long
		expect(normalizeVoucherCode("ORD-7F3K")).toBeNull(); // an order ref
		expect(normalizeVoucherCode("KP-7F3K-Q2W@")).toBeNull();
	});

	test("a generated code round-trips through normalize", () => {
		for (let i = 0; i < 50; i++) {
			const code = generateVoucherCode();
			expect(normalizeVoucherCode(code)).toBe(code);
			expect(normalizeVoucherCode(code.toLowerCase().replace(/-/g, ""))).toBe(
				code,
			);
		}
	});
});

describe("voucherDiscountFor — the subtractive maths", () => {
	test("a fixed voucher takes its face value off the item subtotal", () => {
		expect(voucherDiscountFor({ kind: "fixed", value: 1000 }, 5000)).toBe(1000);
	});

	test("a percentage voucher takes a share of the item subtotal", () => {
		expect(voucherDiscountFor({ kind: "percent", value: 10 }, 5000)).toBe(500);
		expect(voucherDiscountFor({ kind: "percent", value: 100 }, 5000)).toBe(5000);
	});

	test("percentages round to the nearest sen, once", () => {
		// 15% of RM33.33 = 499.95 sen → RM5.00, not RM4.9995.
		expect(voucherDiscountFor({ kind: "percent", value: 15 }, 3333)).toBe(500);
		// 33% of RM10.01 = 330.33 → 330.
		expect(voucherDiscountFor({ kind: "percent", value: 33 }, 1001)).toBe(330);
	});

	test("the discount is CLAMPED to the item subtotal", () => {
		// The doc's guard rail: a RM50 code on a RM30 basket takes RM30.
		expect(voucherDiscountFor({ kind: "fixed", value: 5000 }, 3000)).toBe(3000);
	});

	test("a zero or negative subtotal yields no discount", () => {
		expect(voucherDiscountFor({ kind: "fixed", value: 1000 }, 0)).toBe(0);
		expect(voucherDiscountFor({ kind: "percent", value: 50 }, 0)).toBe(0);
		expect(voucherDiscountFor({ kind: "fixed", value: 1000 }, -500)).toBe(0);
	});

	test("a nonsense value can never produce a credit", () => {
		// Defence in depth behind `voucherValueError` — whatever reaches the
		// maths, a voucher can only ever reduce a total, never raise it.
		for (const value of [-1000, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				voucherDiscountFor({ kind: "fixed", value }, 5000),
			).toBeGreaterThanOrEqual(0);
			expect(
				voucherDiscountFor({ kind: "percent", value }, 5000),
			).toBeGreaterThanOrEqual(0);
		}
		expect(voucherDiscountFor({ kind: "percent", value: 500 }, 5000)).toBe(5000);
	});
});

describe("voucherValueError", () => {
	test("accepts a sane fixed amount and percentage", () => {
		expect(voucherValueError({ kind: "fixed", value: 1000 })).toBeNull();
		expect(voucherValueError({ kind: "percent", value: 15 })).toBeNull();
		expect(
			voucherValueError({ kind: "percent", value: VOUCHER_PERCENT_MAX }),
		).toBeNull();
		expect(
			voucherValueError({ kind: "fixed", value: VOUCHER_FIXED_MAX }),
		).toBeNull();
	});

	test("refuses a voucher worth nothing, or worth too much", () => {
		expect(voucherValueError({ kind: "fixed", value: 0 })).not.toBeNull();
		expect(voucherValueError({ kind: "fixed", value: -100 })).not.toBeNull();
		expect(voucherValueError({ kind: "percent", value: 101 })).not.toBeNull();
		expect(
			voucherValueError({ kind: "fixed", value: VOUCHER_FIXED_MAX + 1 }),
		).not.toBeNull();
		expect(voucherValueError({ kind: "fixed", value: 10.5 })).not.toBeNull();
	});
});

describe("status — expiry is judged, never stored", () => {
	const day = mytMidnightFromYmd("2026-10-20");

	test("a voucher works all through its expiry day and dies at midnight", () => {
		// First instant of the day, and the last — both still good.
		expect(isVoucherExpired(day, day)).toBe(false);
		expect(isVoucherExpired(day, day + DAY_MS - 1)).toBe(false);
		// Midnight in store time: gone.
		expect(isVoucherExpired(day, day + DAY_MS)).toBe(true);
	});

	test("no expiry never expires", () => {
		expect(isVoucherExpired(undefined, day + 1000 * DAY_MS)).toBe(false);
		expect(
			resolveVoucherStatus({ status: "active" }, day + 1000 * DAY_MS),
		).toBe("active");
	});

	test("resolve reports expired for a lapsed ACTIVE row", () => {
		expect(
			resolveVoucherStatus({ status: "active", expiresAt: day }, day + DAY_MS),
		).toBe("expired");
		expect(
			resolveVoucherStatus({ status: "active", expiresAt: day }, day),
		).toBe("active");
	});

	test("what HAPPENED to a voucher outranks the calendar", () => {
		// "Used on #ORD-7F3K" is more useful to the seller than "expired", and a
		// voided code must not read as merely lapsed.
		const after = day + 30 * DAY_MS;
		expect(
			resolveVoucherStatus({ status: "redeemed", expiresAt: day }, after),
		).toBe("redeemed");
		expect(
			resolveVoucherStatus({ status: "voided", expiresAt: day }, after),
		).toBe("voided");
	});

	test("isVoucherRedeemable is the one predicate every door asks", () => {
		expect(isVoucherRedeemable({ status: "active" }, day)).toBe(true);
		expect(
			isVoucherRedeemable({ status: "active", expiresAt: day }, day + DAY_MS),
		).toBe(false);
		expect(isVoucherRedeemable({ status: "redeemed" }, day)).toBe(false);
		expect(isVoucherRedeemable({ status: "voided" }, day)).toBe(false);
	});

	test("refusalForVoucher maps a dead row to its reason", () => {
		expect(refusalForVoucher({ status: "active" }, day)).toBeNull();
		expect(refusalForVoucher({ status: "redeemed" }, day)).toBe("redeemed");
		expect(refusalForVoucher({ status: "voided" }, day)).toBe("voided");
		expect(
			refusalForVoucher({ status: "active", expiresAt: day }, day + DAY_MS),
		).toBe("expired");
	});
});

describe("refusals", () => {
	test("every refusal has its own sentence", () => {
		const refusals = [
			"malformed",
			"not_found",
			"expired",
			"voided",
			"redeemed",
			"exhausted",
			"store_ineligible",
			"already_on_order",
		] as const;
		const seen = new Set<string>();
		for (const refusal of refusals) {
			const message = voucherRefusalMessage(refusal);
			expect(message.length, refusal).toBeGreaterThan(10);
			seen.add(message);
		}
		// A shared sentence would mean the buyer's next move is unclear in at
		// least one case, which is the whole reason these are named.
		expect(seen.size).toBe(refusals.length);
	});

	test("a spent voucher names the order it went to, when known", () => {
		expect(
			voucherRefusalMessage("redeemed", { usedOnOrder: "ORD-7F3K" }),
		).toContain("ORD-7F3K");
		// …and still reads properly without it.
		expect(voucherRefusalMessage("redeemed")).not.toContain("undefined");
	});

	test("a cross-store code is never confirmed to exist", () => {
		const message = voucherRefusalMessage("not_found");
		expect(message).not.toMatch(/another|other store|different store/i);
	});

	test("the typed error payload round-trips", () => {
		const data = voucherRefusalErrorData("redeemed", {
			usedOnOrder: "ORD-7F3K",
		});
		expect(isVoucherRefusalErrorData(data)).toBe(true);
		expect(data.refusal).toBe("redeemed");
		expect(data.message).toContain("ORD-7F3K");
		// Not every ConvexError payload is ours.
		expect(isVoucherRefusalErrorData({ kind: "credits_locked" })).toBe(false);
		expect(isVoucherRefusalErrorData(null)).toBe(false);
		expect(isVoucherRefusalErrorData("voucher_refused")).toBe(false);
	});
});

describe("display", () => {
	test("terms read as words", () => {
		expect(formatVoucherTerms({ kind: "fixed", value: 1000 }, sen)).toBe(
			"RM10.00 off",
		);
		expect(formatVoucherTerms({ kind: "percent", value: 15 }, sen)).toBe(
			"15% off",
		);
	});

	test("no expiry is a real answer, not a blank", () => {
		expect(formatVoucherExpiry(undefined)).toBe("No expiry");
		expect(formatVoucherExpiry(mytMidnightFromYmd("2026-10-20"))).toBe(
			"Until 2026-10-20",
		);
	});
});

// ---------------------------------------------------------------------------
// Shared codes (`z8r3fducfm`)
// ---------------------------------------------------------------------------

describe("shared codes — the word", () => {
	test("normalizeSharedCode folds case and punctuation, and bounds the length", () => {
		expect(normalizeSharedCode("sale 345")).toBe("SALE345");
		expect(normalizeSharedCode("  happy-hour ")).toBe("HAPPYHOUR");
		expect(normalizeSharedCode("abc")).toBeNull(); // too short
		expect(normalizeSharedCode("A".repeat(SHARED_CODE_MAX + 1))).toBeNull();
		expect(normalizeSharedCode("A".repeat(SHARED_CODE_MIN))).toBe(
			"A".repeat(SHARED_CODE_MIN),
		);
	});

	test("parseVoucherCode gives the single-use parser first claim", () => {
		// A real single-use code, however carelessly typed, is never read as a word.
		expect(parseVoucherCode("kp 7f3k q2wm")).toEqual({
			usage: "single",
			code: "KP-7F3K-Q2WM",
		});
		// Eight alphabet symbols without the prefix: still single-use.
		expect(parseVoucherCode("7F3KQ2WM")).toEqual({
			usage: "single",
			code: "KP-7F3K-Q2WM",
		});
		// A word with a digit the alphabet lacks (0) can only be shared.
		expect(parseVoucherCode("sale20")).toEqual({ usage: "shared", code: "SALE20" });
		// Too short for either.
		expect(parseVoucherCode("hi")).toBeNull();
	});

	test("sharedCodeError refuses a word the single-use parser would claim", () => {
		// `SALEDEAL` is 8 symbols of the single-use alphabet — a buyer typing it
		// would be routed to the KP lookup and never find the shared row.
		expect(sharedCodeError("SALEDEAL")).toMatch(/single-use/);
		expect(sharedCodeError("SALEDEAL1")).toBeNull(); // a 1 breaks the shape
		expect(sharedCodeError("")).toMatch(/type a code/i);
		expect(sharedCodeError("SALE 20")).toMatch(/letters and numbers/i);
		expect(sharedCodeError("abc")).toMatch(/at least/i);
		expect(sharedCodeError("A".repeat(SHARED_CODE_MAX + 1))).toMatch(/at most/i);
		expect(sharedCodeError("sale20")).toBeNull();
	});

	test("every suggestion is one the form would accept", () => {
		for (const terms of [
			{ kind: "percent" as const, value: 20 },
			{ kind: "fixed" as const, value: 1000 },
			// A value whose digits are all alphabet symbols: SAVE2345 would parse
			// as single-use and must be filtered out rather than offered.
			{ kind: "fixed" as const, value: 234_500 },
			{ kind: "percent" as const, value: 0 },
		]) {
			const picks = suggestSharedCodes(terms);
			expect(picks.length).toBeGreaterThan(0);
			expect(picks.length).toBeLessThanOrEqual(3);
			for (const code of picks) expect(sharedCodeError(code)).toBeNull();
		}
		expect(suggestSharedCodes({ kind: "percent", value: 20 })).toContain("SAVE20");
	});
});

describe("shared codes — the bounds", () => {
	const now = Date.parse("2026-10-30T10:00:00+08:00");

	test("at least one bound is required", () => {
		expect(sharedLimitsError({}, now)).toMatch(/how many|when it ends/i);
		expect(sharedLimitsError({ maxRedemptions: 50 }, now)).toBeNull();
		expect(sharedLimitsError({ endsAt: now + 1 }, now)).toBeNull();
		expect(sharedLimitsError({ maxRedemptions: 50, endsAt: now + 1 }, now)).toBeNull();
	});

	test("a cap is a whole positive number under the fat-finger ceiling", () => {
		expect(sharedLimitsError({ maxRedemptions: 0 }, now)).toMatch(/whole number/i);
		expect(sharedLimitsError({ maxRedemptions: 2.5 }, now)).toMatch(/whole number/i);
		expect(sharedLimitsError({ maxRedemptions: SHARED_USES_MAX + 1 }, now)).toMatch(
			/at most/i,
		);
	});

	test("an end time has to be ahead", () => {
		expect(sharedLimitsError({ endsAt: now }, now)).toMatch(/already passed/i);
		expect(sharedLimitsError({ endsAt: Number.NaN }, now)).toMatch(/pick when/i);
	});
});

describe("shared codes — status is judged, never stored", () => {
	const now = Date.parse("2026-10-30T10:00:00+08:00");
	const shared = {
		status: "active" as const,
		usage: "shared" as const,
		maxRedemptions: 2,
		redeemedCount: 0,
		endsAt: now + 60_000,
	};

	test("active while under the cap and before the end", () => {
		expect(resolveVoucherStatus(shared, now)).toBe("active");
		expect(isVoucherRedeemable(shared, now)).toBe(true);
	});

	test("reads USED once the cap is reached, and the buyer hears 'run out'", () => {
		const full = { ...shared, redeemedCount: 2 };
		expect(resolveVoucherStatus(full, now)).toBe("redeemed");
		expect(refusalForVoucher(full, now)).toBe("exhausted");
		expect(voucherRefusalMessage("exhausted")).toMatch(/run out/i);
	});

	test("reads EXPIRED at the end instant exactly — not end of day", () => {
		expect(resolveVoucherStatus(shared, shared.endsAt - 1)).toBe("active");
		expect(resolveVoucherStatus(shared, shared.endsAt)).toBe("expired");
		expect(refusalForVoucher(shared, shared.endsAt)).toBe("expired");
	});

	test("a full cap outranks a passed end — whichever came first, and the cap always did", () => {
		// A use can only land while the code runs, so a full cap was filled
		// BEFORE the end passed; reporting "expired" would hide that.
		const both = { ...shared, redeemedCount: 2 };
		expect(resolveVoucherStatus(both, shared.endsAt + DAY_MS)).toBe("redeemed");
	});

	test("no cap never exhausts; no end never expires", () => {
		expect(
			resolveVoucherStatus(
				{ status: "active", usage: "shared", redeemedCount: 10_000, endsAt: now + 1 },
				now,
			),
		).toBe("active");
		expect(
			resolveVoucherStatus(
				{ status: "active", usage: "shared", maxRedemptions: 5, redeemedCount: 4 },
				now + 1000 * DAY_MS,
			),
		).toBe("active");
	});

	test("voided outranks everything, and a single-use row ignores the shared fields", () => {
		expect(
			resolveVoucherStatus({ ...shared, status: "voided", redeemedCount: 2 }, now),
		).toBe("voided");
		// A single-use voucher never carries these; if it did, they must not act.
		expect(
			resolveVoucherStatus(
				{ status: "active", maxRedemptions: 1, redeemedCount: 1 },
				now,
			),
		).toBe("active");
		expect(refusalForVoucher({ status: "redeemed" }, now)).toBe("redeemed");
	});
});

describe("shared codes — display", () => {
	test("the tally reads with or without a cap", () => {
		expect(formatSharedUses({ maxRedemptions: 50, redeemedCount: 12 })).toBe(
			"12 of 50 used",
		);
		expect(formatSharedUses({ redeemedCount: 12 })).toBe("12 used");
		expect(formatSharedUses({ maxRedemptions: 50 })).toBe("0 of 50 used");
	});

	test("the end instant prints in store time", () => {
		expect(formatVoucherMoment(Date.parse("2026-10-31T18:00:00+08:00"))).toBe(
			"31 Oct 2026, 6:00 PM",
		);
	});
});

// ---------------------------------------------------------------------------
// Shared codes v2 (`z8r3fdz0pw`)
// ---------------------------------------------------------------------------

describe("the per-order discount cap", () => {
	test("clamps a percentage before the subtotal clamp, and composes with it", () => {
		const terms = { kind: "percent" as const, value: 50, maxDiscount: 2000 };
		expect(voucherDiscountFor(terms, 10_000)).toBe(2000);
		expect(voucherDiscountFor(terms, 3000)).toBe(1500);
		expect(voucherDiscountFor({ ...terms, maxDiscount: 9999 }, 1000)).toBe(500);
	});

	test("a non-finite cap floors to 0 — it can never make a voucher ADD", () => {
		expect(
			voucherDiscountFor({ kind: "percent", value: 20, maxDiscount: Number.NaN }, 5000),
		).toBe(0);
	});

	test("is validated: percent only, whole, positive, under the fat-finger ceiling", () => {
		expect(voucherValueError({ kind: "percent", value: 20, maxDiscount: 2000 })).toBeNull();
		expect(voucherValueError({ kind: "fixed", value: 1000, maxDiscount: 500 })).toMatch(
			/already its own limit/,
		);
		expect(voucherValueError({ kind: "percent", value: 20, maxDiscount: 0 })).toMatch(
			/most it can take off/,
		);
		expect(
			voucherValueError({ kind: "percent", value: 20, maxDiscount: VOUCHER_FIXED_MAX + 1 }),
		).toMatch(/limit/);
	});
});

describe("the minimum spend", () => {
	test("shortfall is against the gross subtotal, boundary inclusive", () => {
		expect(minSpendShortfall(5000, 3000)).toBe(2000);
		expect(minSpendShortfall(5000, 5000)).toBe(0);
		expect(minSpendShortfall(undefined, 0)).toBe(0);
	});

	test("validation", () => {
		expect(minSpendError(undefined)).toBeNull();
		expect(minSpendError(5000)).toBeNull();
		expect(minSpendError(0)).toMatch(/least a buyer/);
		expect(minSpendError(12.5)).toMatch(/least a buyer/);
		expect(minSpendError(1_000_001)).toMatch(/limit/);
	});
});

describe("a scheduled start", () => {
	const now = Date.parse("2026-10-30T12:00:00+08:00");
	const shared = { status: "active" as const, usage: "shared" as const, maxRedemptions: 5 };

	test("resolves scheduled before it starts, active from the instant it does", () => {
		expect(resolveVoucherStatus({ ...shared, startsAt: now + 1 }, now)).toBe("scheduled");
		expect(resolveVoucherStatus({ ...shared, startsAt: now }, now)).toBe("active");
		expect(isVoucherRedeemable({ ...shared, startsAt: now + 1 }, now)).toBe(false);
	});

	test("the buyer's refusal is not_started and names the moment", () => {
		expect(refusalForVoucher({ ...shared, startsAt: now + DAY_MS }, now)).toBe("not_started");
		expect(
			voucherRefusalMessage("not_started", {
				startsAt: Date.parse("2026-11-01T09:00:00+08:00"),
			}),
		).toBe("This code starts on 1 Nov 2026, 9:00 AM — try again then.");
	});

	test("must be ahead, and before the end", () => {
		expect(sharedLimitsError({ maxRedemptions: 5, startsAt: now - 1 }, now)).toMatch(
			/already passed/,
		);
		expect(
			sharedLimitsError({ endsAt: now + DAY_MS, startsAt: now + DAY_MS }, now),
		).toMatch(/start before it ends/);
		expect(
			sharedLimitsError({ endsAt: now + 2 * DAY_MS, startsAt: now + DAY_MS }, now),
		).toBeNull();
	});
});

describe("the per-buyer limit", () => {
	const now = Date.now();
	test("whole, at least 1, at most the total and the fat-finger ceiling", () => {
		expect(sharedLimitsError({ maxRedemptions: 5, perBuyerLimit: 1 }, now)).toBeNull();
		expect(sharedLimitsError({ maxRedemptions: 5, perBuyerLimit: 0 }, now)).toMatch(/whole/);
		expect(sharedLimitsError({ maxRedemptions: 5, perBuyerLimit: 6 }, now)).toMatch(
			/more than the total/,
		);
		expect(sharedLimitsError({ endsAt: now + DAY_MS, perBuyerLimit: 100 }, now)).toMatch(
			/At most 99/,
		);
	});

	test("refusal copy never names an order", () => {
		expect(voucherRefusalMessage("buyer_limit", { perBuyerLimit: 1 })).toBe(
			"This WhatsApp number has already used this code — it's 1 per buyer.",
		);
		expect(voucherRefusalMessage("buyer_phone_required")).toMatch(/add your WhatsApp number/);
	});
});

describe("extending a live code", () => {
	const now = Date.parse("2026-10-30T12:00:00+08:00");
	const current = { maxRedemptions: 10, endsAt: now + DAY_MS };

	test("only ever more generous", () => {
		expect(sharedExtendError(current, { maxRedemptions: 20, endsAt: now + DAY_MS }, now)).toBeNull();
		expect(sharedExtendError(current, { maxRedemptions: 10, endsAt: now + 2 * DAY_MS }, now)).toBeNull();
		expect(sharedExtendError(current, { maxRedemptions: 9, endsAt: now + DAY_MS }, now)).toMatch(
			/only raise/,
		);
		expect(sharedExtendError(current, { maxRedemptions: 10, endsAt: now + 1 }, now)).toMatch(
			/only move the end later/,
		);
		expect(sharedExtendError(current, current, now)).toMatch(/Nothing has changed/);
	});

	test("dropping one bound is the widest widening; dropping both or adding one is not", () => {
		expect(sharedExtendError(current, { maxRedemptions: 10 }, now)).toBeNull();
		expect(sharedExtendError(current, {}, now)).toMatch(/can't run forever/);
		expect(
			sharedExtendError({ maxRedemptions: 10 }, { maxRedemptions: 10, endsAt: now + DAY_MS }, now),
		).toMatch(/cut it short/);
	});

	test("a dead code can't be 'extended' along the bound that didn't kill it", () => {
		// Ran out: a later end alone would save and revive nothing.
		const ranOut = { maxRedemptions: 10, endsAt: now + DAY_MS, redeemedCount: 10 };
		expect(sharedExtendError(ranOut, { maxRedemptions: 10, endsAt: now + 2 * DAY_MS }, now)).toMatch(
			/ran out at 10 uses — raise the total/,
		);
		expect(sharedExtendError(ranOut, { maxRedemptions: 11, endsAt: now + DAY_MS }, now)).toBeNull();
		expect(sharedExtendError(ranOut, { endsAt: now + DAY_MS }, now)).toBeNull();
		// Ended: a higher total alone would do the same.
		const ended = { maxRedemptions: 10, endsAt: now - DAY_MS, redeemedCount: 4 };
		expect(sharedExtendError(ended, { maxRedemptions: 20, endsAt: now - DAY_MS }, now)).toMatch(
			/has ended — move the end later/,
		);
		expect(sharedExtendError(ended, { maxRedemptions: 20 }, now)).toBeNull();
		expect(sharedExtendError(ended, { maxRedemptions: 10, endsAt: now + DAY_MS }, now)).toBeNull();
	});
});

describe("the fine print", () => {
	test("reads what it's worth, whether my basket counts, whether I can come back", () => {
		expect(
			voucherFinePrint({ maxDiscount: 2000, minSpend: 5000, perBuyerLimit: 1 }, sen),
		).toEqual(["up to RM20.00 off", "min. spend RM50.00", "1 per buyer"]);
		expect(voucherFinePrint({}, sen)).toEqual([]);
	});

	test("the server's money spelling", () => {
		expect(formatVoucherMoney(5000, "MYR")).toBe("RM 50.00");
		expect(formatVoucherMoney(5000, "SGD")).toBe("S$ 50.00");
		expect(
			voucherRefusalMessage("below_min_spend", {
				minSpend: 5000,
				shortfall: 1200,
				currency: "MYR",
			}),
		).toBe("This code needs RM 50.00 of items — add RM 12.00 more.");
	});

	test("a typed refusal carries no undefined keys", () => {
		const data = voucherRefusalErrorData("buyer_limit", { perBuyerLimit: 1 });
		expect(data).toEqual({
			kind: "voucher_refused",
			refusal: "buyer_limit",
			message: "This WhatsApp number has already used this code — it's 1 per buyer.",
			detail: { perBuyerLimit: 1 },
		});
	});
});
