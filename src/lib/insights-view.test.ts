import { describe, expect, test } from "vitest";
import {
	mytMidnightFromYmd,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../convex/lib/fulfilmentDate";
import type { ProductStat } from "../../convex/lib/insights";
import {
	buildInsightsView,
	type RangePayload,
	rangeForPreset,
	rangeSpanDays,
	type TodayPayload,
} from "./insights-view";

const DAY = 24 * 60 * 60 * 1000;
// A fixed instant well inside a MYT day so presets are deterministic.
const NOW = mytMidnightFromYmd("2026-06-15") + 10 * 60 * 60 * 1000; // 10:00 MYT

describe("rangeForPreset", () => {
	const today = todayMytMidnight(NOW);
	test("today = single MYT day", () => {
		expect(rangeForPreset("today", NOW)).toEqual({ from: today, to: today });
	});
	test("7d / 30d / 90d span back from today inclusive", () => {
		expect(rangeForPreset("7d", NOW)).toEqual({
			from: today - 6 * DAY,
			to: today,
		});
		expect(rangeForPreset("30d", NOW)).toEqual({
			from: today - 29 * DAY,
			to: today,
		});
		expect(rangeForPreset("90d", NOW)).toEqual({
			from: today - 89 * DAY,
			to: today,
		});
	});
	test("this month starts on the 1st (MYT) and ends today", () => {
		const r = rangeForPreset("month", NOW);
		expect(ymdFromEpoch(r.from)).toBe("2026-06-01");
		expect(r.to).toBe(today);
	});
	test("rangeSpanDays counts inclusively", () => {
		expect(rangeSpanDays(today - 6 * DAY, today)).toBe(7);
		expect(rangeSpanDays(today, today)).toBe(1);
	});
});

const D1 = mytMidnightFromYmd("2026-06-10");

function product(key: string, revenue: number, quantity: number): ProductStat {
	return { key, productId: key, name: key, revenue, quantity };
}

function rangePayload(over: Partial<RangePayload> = {}): RangePayload {
	return {
		earned: 0,
		collected: 0,
		orderCount: 0,
		products: [],
		trend: [],
		payments: [],
		bucketing: "day",
		capped: false,
		...over,
	};
}

function todayPayload(over: Partial<TodayPayload> = {}): TodayPayload {
	return {
		today: D1 + 2 * DAY,
		earned: 0,
		collected: 0,
		orderCount: 0,
		products: [],
		payments: [],
		...over,
	};
}

describe("buildInsightsView — merge range + today", () => {
	test("sums KPIs and folds today into its own trend bucket; grid is contiguous", () => {
		const view = buildInsightsView({
			from: D1,
			to: D1 + 2 * DAY, // 3-day window: D1, D1+1, D1+2 (today)
			bucketing: "day",
			range: rangePayload({
				earned: 10_000,
				collected: 6_000,
				orderCount: 2,
				trend: [{ start: D1, earned: 10_000, orderCount: 2 }],
				products: [product("cake", 10_000, 2)],
				payments: [{ method: "cash", revenue: 6_000, orderCount: 2 }],
			}),
			today: todayPayload({
				today: D1 + 2 * DAY,
				earned: 4_000,
				collected: 4_000,
				orderCount: 1,
				products: [product("cake", 4_000, 1)],
				payments: [{ method: "duitnow", revenue: 4_000, orderCount: 1 }],
			}),
			includeToday: true,
		});

		expect(view.earned).toBe(14_000);
		expect(view.collected).toBe(10_000);
		expect(view.orderCount).toBe(3);
		expect(view.aov).toBe(Math.round(14_000 / 3));
		// Contiguous 3 buckets; middle day zero-filled; today folded into D1+2.
		expect(view.trend).toEqual([
			{ start: D1, earned: 10_000, orderCount: 2 },
			{ start: D1 + DAY, earned: 0, orderCount: 0 },
			{ start: D1 + 2 * DAY, earned: 4_000, orderCount: 1 },
		]);
		// Products merged by key.
		expect(view.products.find((p) => p.key === "cake")).toMatchObject({
			revenue: 14_000,
			quantity: 3,
		});
		// Payments merged across both methods.
		expect(view.payments.map((p) => p.method).sort()).toEqual([
			"cash",
			"duitnow",
		]);
	});

	test("includeToday=false ignores the today payload entirely", () => {
		const view = buildInsightsView({
			from: D1,
			to: D1 + 1 * DAY,
			bucketing: "day",
			range: rangePayload({ earned: 5_000, orderCount: 1 }),
			today: todayPayload({ earned: 9_999, orderCount: 9 }),
			includeToday: false,
		});
		expect(view.earned).toBe(5_000);
		expect(view.orderCount).toBe(1);
	});

	test("capped flag propagates from the range payload", () => {
		const view = buildInsightsView({
			from: D1,
			to: D1,
			bucketing: "day",
			range: rangePayload({ capped: true }),
			today: null,
			includeToday: false,
		});
		expect(view.capped).toBe(true);
	});
});
