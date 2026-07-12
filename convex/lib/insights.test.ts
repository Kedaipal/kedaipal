import { describe, expect, test } from "vitest";
import { mytMidnightFromYmd } from "./fulfilmentDate";
import {
	bucketStartFor,
	buildBucketStarts,
	computeAov,
	type InsightsOrderInput,
	isRevenueOrder,
	mergePaymentStats,
	mergeProductStats,
	pickBucketing,
	productKey,
	reduceInsights,
	topProducts,
} from "./insights";

const DAY_MS = 24 * 60 * 60 * 1000;
const D1 = mytMidnightFromYmd("2026-06-01"); // a MYT midnight anchor

function order(overrides: Partial<InsightsOrderInput> = {}): InsightsOrderInput {
	return {
		createdAt: D1,
		status: "confirmed",
		total: 10_000,
		paymentStatus: undefined,
		paymentMethod: undefined,
		items: [
			{
				productId: "p1",
				variantId: undefined,
				name: "Vanilla Cake",
				variantLabel: undefined,
				price: 5_000,
				quantity: 2,
			},
		],
		...overrides,
	};
}

describe("isRevenueOrder", () => {
	test("confirmed → delivered count; pending/cancelled don't", () => {
		for (const s of ["confirmed", "packed", "shipped", "delivered"]) {
			expect(isRevenueOrder(s)).toBe(true);
		}
		expect(isRevenueOrder("pending")).toBe(false);
		expect(isRevenueOrder("cancelled")).toBe(false);
	});
});

describe("pickBucketing", () => {
	test("≤ 31 days → day, above → week", () => {
		expect(pickBucketing(D1, D1 + 30 * DAY_MS)).toBe("day"); // 31-day span
		expect(pickBucketing(D1, D1 + 31 * DAY_MS)).toBe("week"); // 32-day span
		expect(pickBucketing(D1, D1)).toBe("day"); // single day
	});
});

describe("bucketStartFor / buildBucketStarts", () => {
	test("day mode returns the day midnight itself", () => {
		const d3 = D1 + 3 * DAY_MS;
		expect(bucketStartFor(d3, D1, "day")).toBe(d3);
	});
	test("week mode floors to a 7-day window anchored on `from`", () => {
		expect(bucketStartFor(D1 + 3 * DAY_MS, D1, "week")).toBe(D1);
		expect(bucketStartFor(D1 + 6 * DAY_MS, D1, "week")).toBe(D1);
		expect(bucketStartFor(D1 + 7 * DAY_MS, D1, "week")).toBe(D1 + 7 * DAY_MS);
		expect(bucketStartFor(D1 + 13 * DAY_MS, D1, "week")).toBe(D1 + 7 * DAY_MS);
	});
	test("contiguous grid covers [from, to]", () => {
		expect(buildBucketStarts(D1, D1 + 2 * DAY_MS, "day")).toEqual([
			D1,
			D1 + DAY_MS,
			D1 + 2 * DAY_MS,
		]);
		expect(buildBucketStarts(D1, D1 + 20 * DAY_MS, "week")).toEqual([
			D1,
			D1 + 7 * DAY_MS,
			D1 + 14 * DAY_MS,
		]);
	});
});

describe("reduceInsights — revenue split", () => {
	test("earned excludes pending and cancelled", () => {
		const agg = reduceInsights(
			[
				order({ total: 10_000, status: "confirmed" }),
				order({ total: 5_000, status: "delivered" }),
				order({ total: 9_999, status: "pending" }), // excluded
				order({ total: 8_888, status: "cancelled" }), // excluded
			],
			{ from: D1, bucketing: "day" },
		);
		expect(agg.earned).toBe(15_000);
		expect(agg.orderCount).toBe(2);
	});

	test("collected counts only received revenue orders", () => {
		const agg = reduceInsights(
			[
				order({ total: 10_000, paymentStatus: "received" }),
				order({ total: 5_000, paymentStatus: "claimed" }), // earned not collected
				order({ total: 3_000, paymentStatus: undefined }),
			],
			{ from: D1, bucketing: "day" },
		);
		expect(agg.earned).toBe(18_000);
		expect(agg.collected).toBe(10_000);
	});

	test("order cancelled AFTER payment received drops from both figures", () => {
		const agg = reduceInsights(
			[order({ total: 10_000, status: "cancelled", paymentStatus: "received" })],
			{ from: D1, bucketing: "day" },
		);
		expect(agg.earned).toBe(0);
		expect(agg.collected).toBe(0);
		expect(agg.orderCount).toBe(0);
	});

	test("a pending order that is somehow 'received' is still excluded", () => {
		const agg = reduceInsights(
			[order({ total: 10_000, status: "pending", paymentStatus: "received" })],
			{ from: D1, bucketing: "day" },
		);
		expect(agg.earned).toBe(0);
		expect(agg.collected).toBe(0);
	});
});

describe("reduceInsights — top products", () => {
	test("groups by productId+variantId, sums line revenue (price × qty)", () => {
		const agg = reduceInsights(
			[
				order({
					items: [
						{
							productId: "p1",
							variantId: "v1",
							name: "Cake",
							variantLabel: "1kg",
							price: 5_000,
							quantity: 2,
						},
						{
							productId: "p1",
							variantId: "v2",
							name: "Cake",
							variantLabel: "2kg",
							price: 9_000,
							quantity: 1,
						},
					],
				}),
				order({
					items: [
						{
							productId: "p1",
							variantId: "v1",
							name: "Cake",
							variantLabel: "1kg",
							price: 5_000,
							quantity: 3,
						},
					],
				}),
			],
			{ from: D1, bucketing: "day" },
		);
		const v1 = agg.products.find((p) => p.key === productKey("p1", "v1"));
		const v2 = agg.products.find((p) => p.key === productKey("p1", "v2"));
		expect(v1).toMatchObject({ revenue: 25_000, quantity: 5, variantLabel: "1kg" });
		expect(v2).toMatchObject({ revenue: 9_000, quantity: 1, variantLabel: "2kg" });
		// sorted by revenue desc
		expect(agg.products[0].key).toBe(productKey("p1", "v1"));
	});

	test("uses the item snapshot name — a since-deleted product still appears", () => {
		const agg = reduceInsights(
			[
				order({
					items: [
						{
							productId: "gone",
							variantId: undefined,
							name: "Discontinued Kuih",
							variantLabel: undefined,
							price: 1_200,
							quantity: 4,
						},
					],
				}),
			],
			{ from: D1, bucketing: "day" },
		);
		expect(agg.products[0]).toMatchObject({
			name: "Discontinued Kuih",
			revenue: 4_800,
			quantity: 4,
		});
	});
});

describe("reduceInsights — MYT bucketing", () => {
	test("a 00:30 MYT order lands in that MYT day, not the day before", () => {
		const justAfterMidnight = D1 + 30 * 60 * 1000; // 00:30 MYT on 2026-06-01
		const lateSameDay = D1 + 23 * 60 * 60 * 1000; // 23:00 MYT same day
		const agg = reduceInsights(
			[
				order({ createdAt: justAfterMidnight, total: 1_000 }),
				order({ createdAt: lateSameDay, total: 2_000 }),
			],
			{ from: D1, bucketing: "day" },
		);
		expect(agg.trend).toEqual([{ start: D1, earned: 3_000, orderCount: 2 }]);
	});

	test("day buckets separate consecutive days", () => {
		const agg = reduceInsights(
			[
				order({ createdAt: D1, total: 1_000 }),
				order({ createdAt: D1 + DAY_MS + 5_000, total: 2_000 }),
			],
			{ from: D1, bucketing: "day" },
		);
		expect(agg.trend).toEqual([
			{ start: D1, earned: 1_000, orderCount: 1 },
			{ start: D1 + DAY_MS, earned: 2_000, orderCount: 1 },
		]);
	});

	test("week buckets group a 7-day window", () => {
		const agg = reduceInsights(
			[
				order({ createdAt: D1, total: 1_000 }),
				order({ createdAt: D1 + 6 * DAY_MS, total: 2_000 }),
				order({ createdAt: D1 + 7 * DAY_MS, total: 4_000 }),
			],
			{ from: D1, bucketing: "week" },
		);
		expect(agg.trend).toEqual([
			{ start: D1, earned: 3_000, orderCount: 2 },
			{ start: D1 + 7 * DAY_MS, earned: 4_000, orderCount: 1 },
		]);
	});
});

describe("reduceInsights — payment donut", () => {
	test("slices received revenue by method; undefined → unspecified; Σ = collected", () => {
		const agg = reduceInsights(
			[
				order({ total: 10_000, paymentStatus: "received", paymentMethod: "cash" }),
				order({
					total: 6_000,
					paymentStatus: "received",
					paymentMethod: "duitnow",
				}),
				order({ total: 4_000, paymentStatus: "received" }), // no method → unspecified
				order({ total: 9_000, paymentStatus: "claimed" }), // not collected
			],
			{ from: D1, bucketing: "day" },
		);
		const sliceSum = agg.payments.reduce((s, p) => s + p.revenue, 0);
		expect(sliceSum).toBe(agg.collected);
		expect(agg.collected).toBe(20_000);
		expect(agg.payments[0]).toMatchObject({ method: "cash", revenue: 10_000 });
		expect(agg.payments.find((p) => p.method === "unspecified")).toMatchObject({
			revenue: 4_000,
			orderCount: 1,
		});
	});
});

describe("computeAov", () => {
	test("earned ÷ order count, rounded; 0 when no orders", () => {
		expect(computeAov(30_000, 3)).toBe(10_000);
		expect(computeAov(10_000, 3)).toBe(3_333);
		expect(computeAov(0, 0)).toBe(0);
	});
});

describe("merge helpers (range + today)", () => {
	test("mergeProductStats sums by key and keeps a resolved thumbnail", () => {
		const merged = mergeProductStats(
			[
				{
					key: productKey("p1", "v1"),
					productId: "p1",
					variantId: "v1",
					name: "Cake",
					revenue: 5_000,
					quantity: 1,
					thumbnailUrl: "https://img/1",
				},
			],
			[
				{
					key: productKey("p1", "v1"),
					productId: "p1",
					variantId: "v1",
					name: "Cake",
					revenue: 3_000,
					quantity: 2,
					thumbnailUrl: null,
				},
				{
					key: productKey("p2"),
					productId: "p2",
					name: "Kuih",
					revenue: 9_000,
					quantity: 3,
				},
			],
		);
		const cake = merged.find((p) => p.key === productKey("p1", "v1"));
		expect(cake).toMatchObject({
			revenue: 8_000,
			quantity: 3,
			thumbnailUrl: "https://img/1",
		});
		// re-sorted by revenue desc → Kuih (9k) before Cake (8k)
		expect(merged[0].key).toBe(productKey("p2"));
	});

	test("mergePaymentStats sums by method", () => {
		const merged = mergePaymentStats(
			[{ method: "cash", revenue: 5_000, orderCount: 1 }],
			[
				{ method: "cash", revenue: 2_000, orderCount: 1 },
				{ method: "duitnow", revenue: 9_000, orderCount: 1 },
			],
		);
		expect(merged.find((p) => p.method === "cash")).toMatchObject({
			revenue: 7_000,
			orderCount: 2,
		});
		expect(merged[0].method).toBe("duitnow"); // 9k sorts first
	});
});

describe("topProducts", () => {
	const products = [
		{ key: "a", productId: "a", name: "A", revenue: 100, quantity: 1 },
		{ key: "b", productId: "b", name: "B", revenue: 50, quantity: 9 },
		{ key: "c", productId: "c", name: "C", revenue: 80, quantity: 2 },
	];
	test("ranks by revenue", () => {
		expect(topProducts(products, "revenue", 2).map((p) => p.key)).toEqual([
			"a",
			"c",
		]);
	});
	test("ranks by quantity", () => {
		expect(topProducts(products, "quantity", 2).map((p) => p.key)).toEqual([
			"b",
			"c",
		]);
	});
});
