import { describe, expect, test } from "vitest";
import { DAY_MS, mytMidnightFromYmd } from "./fulfilmentDate";
import {
	formatVoucherExpiry,
	formatVoucherTerms,
	generateVoucherCode,
	isVoucherExpired,
	isVoucherRedeemable,
	isVoucherRefusalErrorData,
	normalizeVoucherCode,
	refusalForVoucher,
	resolveVoucherStatus,
	VOUCHER_FIXED_MAX,
	VOUCHER_PERCENT_MAX,
	voucherDiscountFor,
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
