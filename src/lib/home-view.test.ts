import { describe, expect, test } from "vitest";
import { mytMidnightFromYmd } from "../../convex/lib/fulfilmentDate";
import type { ProductStat, SourceStat } from "../../convex/lib/insights";
import {
	buildHomeSalesView,
	closedPartOf,
	homeQueryPlan,
	homeRange,
	previousHomeRange,
	productSharePct,
	topTaggedSource,
} from "./home-view";
import type { RangePayload, TodayPayload } from "./insights-view";

const DAY = 24 * 60 * 60 * 1000;
/** Noon MYT on 5 Oct 2026 — mid-day, so "today" is genuinely partial. */
const NOW = Date.parse("2026-10-05T12:00:00+08:00");
const OCT_5 = mytMidnightFromYmd("2026-10-05");
const ymd = (e: number) =>
	new Date(e + 8 * 3600_000).toISOString().slice(0, 10);

describe("homeRange", () => {
	test("every window ends TODAY — Home always includes the day in progress", () => {
		for (const p of ["today", "7d", "30d"] as const)
			expect(homeRange(p, NOW).to).toBe(OCT_5);
	});

	test("spans are inclusive day counts", () => {
		expect(ymd(homeRange("today", NOW).from)).toBe("2026-10-05");
		expect(ymd(homeRange("7d", NOW).from)).toBe("2026-09-29");
		expect(ymd(homeRange("30d", NOW).from)).toBe("2026-09-06");
	});
});

describe("previousHomeRange", () => {
	test("ends the day BEFORE the current window opens — no shared day", () => {
		const cur = homeRange("7d", NOW);
		const prev = previousHomeRange("7d", NOW);
		expect(prev.to).toBe(cur.from - DAY);
		expect(ymd(prev.to)).toBe("2026-09-28");
		expect(ymd(prev.from)).toBe("2026-09-22");
	});

	test("the two windows are the same length, so the delta is like-for-like", () => {
		for (const p of ["7d", "30d"] as const) {
			const cur = homeRange(p, NOW);
			const prev = previousHomeRange(p, NOW);
			expect(prev.to - prev.from).toBe(cur.to - cur.from);
		}
	});

	test("yesterday is the previous window for today", () => {
		const prev = previousHomeRange("today", NOW);
		expect(ymd(prev.from)).toBe("2026-10-04");
		expect(ymd(prev.to)).toBe("2026-10-04");
	});
});

describe("closedPartOf", () => {
	test("a multi-day window hands the server everything up to yesterday", () => {
		const closed = closedPartOf(homeRange("7d", NOW));
		expect(closed).not.toBeNull();
		expect(ymd(closed?.from ?? 0)).toBe("2026-09-29");
		expect(ymd(closed?.to ?? 0)).toBe("2026-10-04");
	});

	test("a TODAY window has no closed part at all — null, not an empty range", () => {
		// The distinction matters: null means "do not ask the server", whereas an
		// empty range would be a request the server rejects.
		expect(closedPartOf(homeRange("today", NOW))).toBeNull();
	});
});

describe("productSharePct", () => {
	const p = (revenue: number): ProductStat => ({
		key: "k",
		productId: "p",
		name: "Kek Batik",
		revenue,
		quantity: 1,
	});

	test("share of the window's earned revenue", () => {
		expect(productSharePct(p(151_200), 486_000)).toBeCloseTo(31.1, 1);
	});

	test("no revenue → zero, never a divide by zero", () => {
		expect(productSharePct(p(0), 0)).toBe(0);
	});
});

describe("topTaggedSource", () => {
	const s = (source: string, revenue: number): SourceStat => ({
		source,
		revenue,
		orderCount: 1,
	});

	test("picks the highest-revenue tagged source", () => {
		expect(
			topTaggedSource([s("instagram", 142_000), s("tiktok", 60_000)])?.source,
		).toBe("instagram");
	});

	test("DIRECT never wins — it is the absence of an answer", () => {
		// Naming "direct" as the best channel is advice to do nothing.
		expect(
			topTaggedSource([s("direct", 900_000), s("instagram", 10_000)])?.source,
		).toBe("instagram");
	});

	test("COUNTER never wins — a place, not a channel to push", () => {
		expect(
			topTaggedSource([s("counter", 900_000), s("instagram", 10_000)])?.source,
		).toBe("instagram");
	});

	test("nothing tagged → null, so the card can offer tagged links instead", () => {
		expect(topTaggedSource([s("direct", 900_000), s("counter", 5)])).toBeNull();
		expect(topTaggedSource([])).toBeNull();
	});
});

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
		today: OCT_5,
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

describe("buildHomeSalesView", () => {
	const range = homeRange("7d", NOW);

	test("the closed range and today are summed, not chosen between", () => {
		const view = buildHomeSalesView({
			period: "7d",
			range,
			rangePayload: rangePayload({ earned: 450_000, orderCount: 57 }),
			todayPayload: todayPayload({ earned: 36_000, orderCount: 5 }),
			previousPayload: rangePayload({ earned: 412_000 }),
		});
		expect(view.earned).toBe(486_000);
		expect(view.orderCount).toBe(62);
		expect(view.previousEarned).toBe(412_000);
	});

	test("uncollected is the window's own earned-minus-collected", () => {
		const view = buildHomeSalesView({
			period: "7d",
			range,
			rangePayload: rangePayload({ earned: 450_000, collected: 370_000 }),
			todayPayload: todayPayload({ earned: 36_000, collected: 24_000 }),
			previousPayload: null,
		});
		expect(view.uncollected).toBe(92_000);
	});

	test("collected above earned never produces a negative outstanding", () => {
		// A refund settled inside the window can push collected past earned.
		const view = buildHomeSalesView({
			period: "7d",
			range,
			rangePayload: rangePayload({ earned: 100, collected: 500 }),
			todayPayload: null,
			previousPayload: null,
		});
		expect(view.uncollected).toBe(0);
	});

	test("a missing previous window stays NULL, never zero", () => {
		// Zero would read as "they earned nothing then" and turn into a 100% rise.
		const view = buildHomeSalesView({
			period: "7d",
			range,
			rangePayload: rangePayload({ earned: 486_000 }),
			todayPayload: null,
			previousPayload: null,
		});
		expect(view.previousEarned).toBeNull();
	});

	test("customers merge as sets across the closed range and today", () => {
		const view = buildHomeSalesView({
			period: "7d",
			range,
			rangePayload: rangePayload({
				customers: [
					{ id: "a", firstOrderAt: range.from - DAY },
					{ id: "b", firstOrderAt: range.from + DAY },
				],
			}),
			todayPayload: todayPayload({
				// "a" again (a regular who ordered twice) plus one genuinely new.
				customers: [
					{ id: "a", firstOrderAt: range.from - DAY },
					{ id: "c", firstOrderAt: range.to },
				],
			}),
			previousPayload: null,
		});
		expect(view.customers.total).toBe(3);
		expect(view.customers.returning).toBe(1);
		expect(view.customers.fresh).toBe(2);
	});
});

describe("homeQueryPlan", () => {
	test("7 days fetches its own closed part and counts it in the totals", () => {
		const plan = homeQueryPlan("7d", NOW);
		expect(plan.includeClosedInTotals).toBe(true);
		expect(ymd(plan.closed?.from ?? 0)).toBe("2026-09-29");
		expect(ymd(plan.closed?.to ?? 0)).toBe("2026-10-04");
		expect(ymd(plan.previous?.from ?? 0)).toBe("2026-09-22");
	});

	test("TODAY fetches a week of context that must NOT reach the headline", () => {
		// The hero says "today so far"; summing the context range into it would
		// print a week's revenue under those words.
		const plan = homeQueryPlan("today", NOW);
		expect(plan.includeClosedInTotals).toBe(false);
		expect(ymd(plan.range.from)).toBe("2026-10-05");
		expect(ymd(plan.range.to)).toBe("2026-10-05");
	});

	test("today's context reaches back to the SAME WEEKDAY last week", () => {
		// 5 Oct 2026 is a Monday; the sentence names last Monday, 28 Sep — which
		// is one day outside the six-day chart, so the range has to cover it.
		const plan = homeQueryPlan("today", NOW);
		expect(ymd(plan.lastWeekdayStart ?? 0)).toBe("2026-09-28");
		expect(ymd(plan.closed?.from ?? 0)).toBe("2026-09-28");
		expect(ymd(plan.closed?.to ?? 0)).toBe("2026-10-04");
		expect(new Date(plan.lastWeekdayStart ?? 0).getUTCDay()).toBe(
			new Date(plan.range.from).getUTCDay(),
		);
	});

	test("today has no delta window — a partial day has nothing like-for-like", () => {
		expect(homeQueryPlan("today", NOW).previous).toBeNull();
	});

	test("30 days spans a month and still compares like for like", () => {
		const plan = homeQueryPlan("30d", NOW);
		expect(ymd(plan.range.from)).toBe("2026-09-06");
		expect(ymd(plan.previous?.to ?? 0)).toBe("2026-09-05");
		expect(ymd(plan.previous?.from ?? 0)).toBe("2026-08-07");
	});
});
