import { describe, expect, test } from "vitest";
import {
	DEFAULT_PROMO_LABEL,
	effectivePrice,
	isPromoActive,
	mintPromoRunId,
	promoPhase,
	promoPriceFromPercent,
	promoUnitsLeft,
	sanitizePromo,
	assertValidPromoPrice,
	type PromoConfig,
} from "./promo";

const NOW = 1_760_000_000_000;
const HOUR = 60 * 60 * 1000;

function config(overrides: Partial<PromoConfig> = {}): PromoConfig {
	return { runId: "runA", ...overrides };
}

describe("promoPhase / isPromoActive", () => {
	test("no config → none; open-ended config → live", () => {
		expect(promoPhase(undefined, NOW)).toBe("none");
		expect(promoPhase(config(), NOW)).toBe("live");
	});

	test("a future start is the teaser phase, not live", () => {
		const promo = config({ startsAt: NOW + HOUR });
		expect(promoPhase(promo, NOW)).toBe("scheduled");
		expect(isPromoActive({ promo }, "pro", NOW)).toBe(false);
	});

	test("an end at-or-before now is ended — read-time, no cron needed", () => {
		expect(promoPhase(config({ endsAt: NOW }), NOW)).toBe("ended");
		expect(promoPhase(config({ endsAt: NOW + 1 }), NOW)).toBe("live");
	});

	test("Starter never activates a promo — paused, not deleted", () => {
		const promo = config();
		expect(isPromoActive({ promo }, "starter", NOW)).toBe(false);
		expect(isPromoActive({ promo }, "pro", NOW)).toBe(true);
		expect(isPromoActive({ promo }, "enterprise", NOW)).toBe(true);
	});
});

describe("effectivePrice", () => {
	const product = { promo: config() };

	test("active promo with a valid sale price undercuts the list", () => {
		expect(
			effectivePrice({ price: 4500, promoPrice: 3150 }, product, "pro", NOW),
		).toBe(3150);
	});

	test("inactive (plan, phase) or missing sale price → list", () => {
		expect(
			effectivePrice({ price: 4500, promoPrice: 3150 }, product, "starter", NOW),
		).toBe(4500);
		expect(
			effectivePrice(
				{ price: 4500, promoPrice: 3150 },
				{ promo: config({ startsAt: NOW + HOUR }) },
				"pro",
				NOW,
			),
		).toBe(4500);
		expect(effectivePrice({ price: 4500 }, product, "pro", NOW)).toBe(4500);
	});

	test("a sale price at/above list or ≤0 never speaks — bad data sells at list", () => {
		expect(
			effectivePrice({ price: 4500, promoPrice: 4500 }, product, "pro", NOW),
		).toBe(4500);
		expect(
			effectivePrice({ price: 4500, promoPrice: 0 }, product, "pro", NOW),
		).toBe(4500);
	});

	test("quote-on-request (list 0) is excluded by construction", () => {
		expect(
			effectivePrice({ price: 0, promoPrice: 0 }, product, "pro", NOW),
		).toBe(0);
	});

	test("cap exhausted snaps the price back for everyone", () => {
		const variant = { price: 4500, promoPrice: 3150 };
		expect(effectivePrice(variant, product, "pro", NOW, 3)).toBe(3150);
		expect(effectivePrice(variant, product, "pro", NOW, 0)).toBe(4500);
	});
});

describe("promoPriceFromPercent", () => {
	test("writes 5-sen-rounded absolute values", () => {
		// 30% off RM45.00 = RM31.50 exactly.
		expect(promoPriceFromPercent(4500, 30)).toBe(3150);
		// 10% off RM2.99 = 269.1 sen → 270.
		expect(promoPriceFromPercent(299, 10)).toBe(270);
	});

	test("clamps strictly below list and refuses the un-discountable", () => {
		// 1% off RM1.00 = 99 sen → rounds to 100 = list → clamps to 95.
		expect(promoPriceFromPercent(100, 1)).toBe(95);
		expect(promoPriceFromPercent(5, 50)).toBeNull();
		expect(promoPriceFromPercent(0, 50)).toBeNull();
		expect(promoPriceFromPercent(4500, 0)).toBeNull();
		expect(promoPriceFromPercent(4500, 100)).toBeNull();
	});
});

describe("promoUnitsLeft", () => {
	test("uncapped is undefined, capped floors at zero", () => {
		expect(promoUnitsLeft(undefined, 7)).toBeUndefined();
		expect(promoUnitsLeft(30, 18)).toBe(12);
		expect(promoUnitsLeft(30, 45)).toBe(0);
	});
});

describe("sanitizePromo", () => {
	test("end before start / end in the past / long label are refused with copy", () => {
		expect(() =>
			sanitizePromo({ startsAt: NOW + HOUR, endsAt: NOW + 1 }, undefined, NOW),
		).toThrow(/end after it starts/);
		expect(() =>
			sanitizePromo({ endsAt: NOW - 1 }, undefined, NOW),
		).toThrow(/already passed/);
		expect(() =>
			sanitizePromo({ label: "x".repeat(21) }, undefined, NOW),
		).toThrow(/20 characters/);
	});

	test("cap and maxPerOrder must be positive integers; pay window has the claim rails", () => {
		expect(() => sanitizePromo({ unitCap: 0 }, undefined, NOW)).toThrow();
		expect(() => sanitizePromo({ unitCap: 2.5 }, undefined, NOW)).toThrow();
		expect(() => sanitizePromo({ maxPerOrder: -1 }, undefined, NOW)).toThrow();
		expect(() =>
			sanitizePromo({ payWithinMinutes: 4 }, undefined, NOW),
		).toThrow(/5 minutes and 7 days/);
		expect(() =>
			sanitizePromo({ payWithinMinutes: 8 * 24 * 60 }, undefined, NOW),
		).toThrow(/5 minutes and 7 days/);
		expect(
			sanitizePromo({ payWithinMinutes: 60 }, undefined, NOW).payWithinMinutes,
		).toBe(60);
	});

	test("a capped promo always gets a concrete start — the tally's left bound", () => {
		const capped = sanitizePromo({ unitCap: 30 }, undefined, NOW);
		expect(capped.startsAt).toBe(NOW);
		// Uncapped "running now" keeps an open start.
		const uncapped = sanitizePromo({}, undefined, NOW);
		expect(uncapped.startsAt).toBeUndefined();
	});

	test("runId survives a label/cap edit and regenerates on new dates — a re-run starts a fresh pool", () => {
		const prev = config({ startsAt: NOW - HOUR, endsAt: NOW + HOUR, unitCap: 30 });
		const capEdit = sanitizePromo(
			{ startsAt: NOW - HOUR, endsAt: NOW + HOUR, unitCap: 10 },
			prev,
			NOW,
		);
		expect(capEdit.runId).toBe("runA");
		const rerun = sanitizePromo(
			{ startsAt: NOW - HOUR, endsAt: NOW + 2 * HOUR, unitCap: 30 },
			prev,
			NOW,
		);
		expect(rerun.runId).not.toBe("runA");
	});

	test("label trims; empty collapses to undefined (render-time default applies)", () => {
		expect(sanitizePromo({ label: "  Raya Sale " }, undefined, NOW).label).toBe(
			"Raya Sale",
		);
		expect(sanitizePromo({ label: "   " }, undefined, NOW).label).toBeUndefined();
		expect(DEFAULT_PROMO_LABEL).toBe("Promo");
	});
});

describe("assertValidPromoPrice", () => {
	test("must undercut the list, and quote variants have nothing to undercut", () => {
		expect(() => assertValidPromoPrice(3150, 4500)).not.toThrow();
		expect(() => assertValidPromoPrice(4500, 4500)).toThrow(/below the list/);
		expect(() => assertValidPromoPrice(0, 4500)).toThrow(/above zero/);
		expect(() => assertValidPromoPrice(100, 0)).toThrow(/quote/i);
	});
});

describe("mintPromoRunId", () => {
	test("12 chars, distinct across mints", () => {
		const a = mintPromoRunId();
		expect(a).toHaveLength(12);
		expect(mintPromoRunId()).not.toBe(a);
	});
});
