import { describe, expect, test } from "vitest";
import {
	mytMidnightFromYmd,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../convex/lib/fulfilmentDate";
import type { ProductStat } from "../../convex/lib/insights";
import {
	buildInsightsView,
	type CustomerIdentity,
	type RangePayload,
	rangeForPreset,
	rangeSpanDays,
	splitCustomers,
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
		depositsExcluded: 0,
		collected: 0,
		orderCount: 0,
		products: [],
		trend: [],
		payments: [],
		sources: [],
		bucketing: "day",
		capped: false,
		customers: [],
		customersCapped: false,
		...over,
	};
}

function todayPayload(over: Partial<TodayPayload> = {}): TodayPayload {
	return {
		today: D1 + 2 * DAY,
		earned: 0,
		depositsExcluded: 0,
		collected: 0,
		orderCount: 0,
		products: [],
		payments: [],
		sources: [],
		customers: [],
		customersCapped: false,
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
				depositsExcluded: 3_000,
				collected: 6_000,
				orderCount: 2,
				trend: [{ start: D1, earned: 10_000, orderCount: 2 }],
				products: [product("cake", 10_000, 2)],
				payments: [{ method: "cash", revenue: 6_000, orderCount: 2 }],
			}),
			today: todayPayload({
				today: D1 + 2 * DAY,
				earned: 4_000,
				depositsExcluded: 1_000,
				collected: 4_000,
				orderCount: 1,
				products: [product("cake", 4_000, 1)],
				payments: [{ method: "duitnow", revenue: 4_000, orderCount: 1 }],
			}),
			includeToday: true,
		});

		expect(view.earned).toBe(14_000);
		// Netted-out deposits sum across both payloads like earned does.
		expect(view.depositsExcluded).toBe(4_000);
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
			range: rangePayload({
				earned: 5_000,
				orderCount: 1,
				depositsExcluded: 700,
			}),
			today: todayPayload({
				earned: 9_999,
				orderCount: 9,
				depositsExcluded: 9_999,
			}),
			includeToday: false,
		});
		expect(view.earned).toBe(5_000);
		expect(view.depositsExcluded).toBe(700);
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

describe("splitCustomers — the range and today are one set, classified once", () => {
	const FROM = D1;
	const knownBefore = (id: string): CustomerIdentity => ({
		id,
		firstOrderAt: FROM - DAY,
		initial: id[0].toUpperCase(),
	});
	const inside = (id: string): CustomerIdentity => ({
		id,
		firstOrderAt: FROM + DAY,
		initial: id[0].toUpperCase(),
	});

	test("a buyer in BOTH halves counts once, not twice", () => {
		// The regular who ordered on Tuesday and again this morning. Summing the
		// two payloads' counts would invent a customer that does not exist.
		const split = splitCustomers(
			[knownBefore("c1")],
			[knownBefore("c1")],
			FROM,
		);
		expect(split.total).toBe(1);
		expect(split.returning).toBe(1);
		expect(split.fresh).toBe(0);
	});

	test("returning vs new is decided by the WINDOW's from, not today's", () => {
		// `c2` first ordered inside the window, so they are new TO THIS WINDOW
		// even though they appear in today's payload — which, classified against
		// its own midnight, would have called them returning.
		const split = splitCustomers([inside("c2")], [inside("c2")], FROM);
		expect(split.returning).toBe(0);
		expect(split.fresh).toBe(1);
	});

	test("first order exactly AT from is new — the window is inclusive of its start", () => {
		const split = splitCustomers(
			[{ id: "c3", firstOrderAt: FROM, initial: "C" }],
			[],
			FROM,
		);
		expect(split.returning).toBe(0);
		expect(split.fresh).toBe(1);
	});

	test("one millisecond before from is returning", () => {
		const split = splitCustomers(
			[{ id: "c4", firstOrderAt: FROM - 1, initial: "C" }],
			[],
			FROM,
		);
		expect(split.returning).toBe(1);
		expect(split.fresh).toBe(0);
	});

	test("totals add up across a mixed window", () => {
		const split = splitCustomers(
			[knownBefore("a"), knownBefore("b"), inside("c")],
			[inside("c"), inside("d"), knownBefore("a")],
			FROM,
		);
		expect(split.total).toBe(4);
		expect(split.returning).toBe(2);
		expect(split.fresh).toBe(2);
		expect(split.returning + split.fresh).toBe(split.total);
	});

	// Both orderings, deliberately. With only the range-is-later case the test
	// passes under "last one wins" too — the two rules agree when the earlier
	// timestamp happens to arrive second, so that case never reaches the guard.
	test("disagreeing payloads keep the EARLIEST first order (earlier in range)", () => {
		const split = splitCustomers(
			[{ id: "c5", firstOrderAt: FROM - DAY, initial: "C" }],
			[{ id: "c5", firstOrderAt: FROM + DAY, initial: "C" }],
			FROM,
		);
		expect(split.total).toBe(1);
		expect(split.returning).toBe(1);
	});

	test("disagreeing payloads keep the EARLIEST first order (earlier in today)", () => {
		const split = splitCustomers(
			[{ id: "c6", firstOrderAt: FROM + DAY, initial: "C" }],
			[{ id: "c6", firstOrderAt: FROM - DAY, initial: "C" }],
			FROM,
		);
		expect(split.total).toBe(1);
		expect(split.returning).toBe(1);
	});

	test("empty window is zeros, not NaN", () => {
		expect(splitCustomers([], [], FROM)).toEqual({
			total: 0,
			returning: 0,
			fresh: 0,
			capped: false,
			initials: [],
		});
	});

	test("capped rides through so the card can say these are floors", () => {
		expect(splitCustomers([], [], FROM, true).capped).toBe(true);
	});
});

describe("buildInsightsView carries the customer split", () => {
	test("either half capping caps the merged split", () => {
		const view = buildInsightsView({
			from: D1,
			to: D1 + 2 * DAY,
			bucketing: "day",
			range: rangePayload({
				customers: [{ id: "a", firstOrderAt: D1 - DAY, initial: "A" }],
				customersCapped: true,
			}),
			today: todayPayload({
				customers: [{ id: "b", firstOrderAt: D1 + DAY, initial: "B" }],
			}),
			includeToday: true,
		});
		expect(view.customers.total).toBe(2);
		expect(view.customers.returning).toBe(1);
		expect(view.customers.fresh).toBe(1);
		expect(view.customers.capped).toBe(true);
	});

	test("excluding today excludes its customers too", () => {
		const view = buildInsightsView({
			from: D1,
			to: D1 + 2 * DAY,
			bucketing: "day",
			range: rangePayload({
				customers: [{ id: "a", firstOrderAt: D1 - DAY, initial: "A" }],
			}),
			today: todayPayload({
				customers: [{ id: "b", firstOrderAt: D1 + DAY, initial: "B" }],
			}),
			includeToday: false,
		});
		expect(view.customers.total).toBe(1);
	});
});

describe("the avatar stack's initials", () => {
	const FROM2 = D1;
	const who = (id: string, initial: string): CustomerIdentity => ({
		id,
		firstOrderAt: FROM2 - DAY,
		initial,
	});

	test("carries at most three, in the order the buyers were seen", () => {
		// Three is what the card draws; everyone else is the "+39".
		const split = splitCustomers(
			[who("a", "A"), who("b", "H"), who("c", "M"), who("d", "Z")],
			[],
			FROM2,
		);
		expect(split.initials.map((f) => f.letter)).toEqual(["A", "H", "M"]);
		expect(split.total).toBe(4);
	});

	test("a buyer in both halves contributes ONE face, not two", () => {
		const split = splitCustomers([who("a", "A")], [who("a", "A")], FROM2);
		expect(split.initials.map((f) => f.letter)).toEqual(["A"]);
		expect(split.total).toBe(1);
	});

	test("fewer than three buyers gives fewer faces, never blanks", () => {
		const split = splitCustomers([who("a", "A")], [], FROM2);
		expect(split.initials.map((f) => f.letter)).toEqual(["A"]);
	});

	test("no buyers at all gives no faces", () => {
		expect(splitCustomers([], [], FROM2).initials).toEqual([]);
	});
});
