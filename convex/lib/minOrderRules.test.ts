import { describe, expect, test } from "vitest";
import {
	collectMinQuantityShortfalls,
	isMinOrderValueExempt,
	MIN_ORDER_VALUE_MAX,
	MIN_QUANTITY_MAX,
	minOrderValueShortfall,
	minQuantityMessage,
	sanitizeMinOrderValue,
	sanitizeMinQuantity,
} from "./minOrderRules";

describe("sanitizeMinQuantity", () => {
	test("undefined passes through", () => {
		expect(sanitizeMinQuantity(undefined)).toBeUndefined();
	});

	test("0 and 1 normalize to unset — a minimum of one is just an order", () => {
		expect(sanitizeMinQuantity(0)).toBeUndefined();
		expect(sanitizeMinQuantity(1)).toBeUndefined();
	});

	test("valid minimums pass", () => {
		expect(sanitizeMinQuantity(2)).toBe(2);
		expect(sanitizeMinQuantity(20)).toBe(20);
		expect(sanitizeMinQuantity(MIN_QUANTITY_MAX)).toBe(MIN_QUANTITY_MAX);
	});

	test("rejects non-integers, negatives and absurd values", () => {
		expect(() => sanitizeMinQuantity(2.5)).toThrow();
		expect(() => sanitizeMinQuantity(-1)).toThrow();
		expect(() => sanitizeMinQuantity(MIN_QUANTITY_MAX + 1)).toThrow();
	});
});

describe("sanitizeMinOrderValue", () => {
	test("undefined passes through; 0 normalizes to unset", () => {
		expect(sanitizeMinOrderValue(undefined)).toBeUndefined();
		expect(sanitizeMinOrderValue(0)).toBeUndefined();
	});

	test("valid sen amounts pass", () => {
		expect(sanitizeMinOrderValue(10000)).toBe(10000);
		expect(sanitizeMinOrderValue(MIN_ORDER_VALUE_MAX)).toBe(
			MIN_ORDER_VALUE_MAX,
		);
	});

	test("rejects non-integers, negatives and absurd values", () => {
		expect(() => sanitizeMinOrderValue(100.5)).toThrow();
		expect(() => sanitizeMinOrderValue(-100)).toThrow();
		expect(() => sanitizeMinOrderValue(MIN_ORDER_VALUE_MAX + 1)).toThrow();
	});
});

describe("collectMinQuantityShortfalls", () => {
	test("no rules → no shortfalls", () => {
		expect(
			collectMinQuantityShortfalls([
				{ productId: "p1", name: "Brownies", quantity: 1 },
			]),
		).toEqual([]);
	});

	test("below the minimum reports the shortfall", () => {
		expect(
			collectMinQuantityShortfalls([
				{ productId: "p1", name: "Nasi Ambeng", quantity: 12, minQuantity: 20 },
			]),
		).toEqual([
			{ productId: "p1", name: "Nasi Ambeng", minQuantity: 20, have: 12 },
		]);
	});

	test("variants of the same product SUM toward the minimum (mixing counts)", () => {
		// 10 + 10 of two flavours meets min 20 — the catering mental model.
		expect(
			collectMinQuantityShortfalls([
				{ productId: "p1", name: "Kuih", quantity: 10, minQuantity: 20 },
				{ productId: "p1", name: "Kuih", quantity: 10, minQuantity: 20 },
			]),
		).toEqual([]);
		// 10 + 5 does not.
		expect(
			collectMinQuantityShortfalls([
				{ productId: "p1", name: "Kuih", quantity: 10, minQuantity: 20 },
				{ productId: "p1", name: "Kuih", quantity: 5, minQuantity: 20 },
			]),
		).toEqual([{ productId: "p1", name: "Kuih", minQuantity: 20, have: 15 }]);
	});

	test("boundary is inclusive — exactly the minimum passes", () => {
		expect(
			collectMinQuantityShortfalls([
				{ productId: "p1", name: "Kuih", quantity: 20, minQuantity: 20 },
			]),
		).toEqual([]);
	});

	test("custom lines never count toward (or trigger) a minimum", () => {
		// Custom-only cart of a min-20 product → no shortfall (one bespoke
		// negotiation stands on its own).
		expect(
			collectMinQuantityShortfalls([
				{
					productId: "p1",
					name: "Cake",
					quantity: 1,
					minQuantity: 20,
					isCustom: true,
				},
			]),
		).toEqual([]);
		// A custom line doesn't help the standard lines reach the bar either.
		expect(
			collectMinQuantityShortfalls([
				{ productId: "p1", name: "Cake", quantity: 19, minQuantity: 20 },
				{
					productId: "p1",
					name: "Cake",
					quantity: 1,
					minQuantity: 20,
					isCustom: true,
				},
			]),
		).toEqual([{ productId: "p1", name: "Cake", minQuantity: 20, have: 19 }]);
	});

	test("independent products are judged independently", () => {
		const shortfalls = collectMinQuantityShortfalls([
			{ productId: "p1", name: "Kuih", quantity: 5, minQuantity: 20 },
			{ productId: "p2", name: "Brownies", quantity: 1 },
			{ productId: "p3", name: "Satay", quantity: 3, minQuantity: 10 },
		]);
		expect(shortfalls).toHaveLength(2);
		expect(shortfalls.map((s) => s.productId)).toEqual(["p1", "p3"]);
	});
});

describe("minOrderValueShortfall", () => {
	test("no minimum set → 0", () => {
		expect(minOrderValueShortfall(undefined, 500, [])).toBe(0);
	});

	test("below the minimum → the remaining amount", () => {
		expect(minOrderValueShortfall(10000, 6500, [{}])).toBe(3500);
	});

	test("boundary inclusive — exactly the minimum passes", () => {
		expect(minOrderValueShortfall(10000, 10000, [{}])).toBe(0);
		expect(minOrderValueShortfall(10000, 10001, [{}])).toBe(0);
	});

	test("custom / price-on-quote lines exempt the order (real value is quoted)", () => {
		expect(minOrderValueShortfall(10000, 0, [{ isCustom: true }])).toBe(0);
		expect(minOrderValueShortfall(10000, 0, [{ quoteOnRequest: true }])).toBe(
			0,
		);
		expect(isMinOrderValueExempt([{ isCustom: true }])).toBe(true);
		expect(isMinOrderValueExempt([{}])).toBe(false);
	});
});

describe("minQuantityMessage", () => {
	test("buyer-facing wording matches the ticket's shape", () => {
		expect(
			minQuantityMessage({
				productId: "p1",
				name: "Nasi Ambeng",
				minQuantity: 20,
				have: 1,
			}),
		).toBe("Minimum 20 × Nasi Ambeng per order — you have 1");
	});
});
