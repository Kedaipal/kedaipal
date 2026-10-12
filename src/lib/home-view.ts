/**
 * Home's view model (z8r3fdrgzj) — the ranges its three period chips ask for,
 * and the merge of the payloads into the numbers the cards state.
 *
 * Deliberately built ON TOP of `buildInsightsView`, never a fork of it: Home and
 * Insights must agree about what a window earned, or the seller finds two pages
 * quoting different revenue for the same seven days. This module adds only what
 * Home needs beyond that — the PREVIOUS window for the delta, the best seller's
 * share of revenue, and the top TAGGED source — and takes `now` as an argument
 * so every function stays testable without mocking a clock.
 */

import { todayMytMidnight } from "../../convex/lib/fulfilmentDate";
import type { ProductStat, SourceStat } from "../../convex/lib/insights";
import {
	type InboxStatusLeaf,
	REVENUE_LEAVES,
} from "../../convex/lib/orderBuckets";
import type { HomePeriod } from "./home-copy";
import { periodDays } from "./home-copy";
import {
	buildInsightsView,
	type InsightsView,
	type RangePayload,
	type TodayPayload,
} from "./insights-view";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Both bounds are inclusive MYT midnights, as the server requires. */
export type HomeRange = { from: number; to: number };

/**
 * The window a chip means. Every one ENDS today — Home is "how is my business
 * doing", which always includes the day in progress.
 */
export function homeRange(
	period: HomePeriod,
	now: number = Date.now(),
): HomeRange {
	const today = todayMytMidnight(now);
	const span = periodDays(period);
	return { from: today - (span - 1) * DAY_MS, to: today };
}

/**
 * The equal-length window immediately before it, for the delta.
 *
 * It ends the day BEFORE the current window opens, so the two never share a
 * day. An overlapping comparison would count the same orders on both sides and
 * damp every real move toward zero.
 */
export function previousHomeRange(
	period: HomePeriod,
	now: number = Date.now(),
): HomeRange {
	const current = homeRange(period, now);
	const span = periodDays(period);
	return {
		from: current.from - span * DAY_MS,
		to: current.from - DAY_MS,
	};
}

/**
 * The CLOSED part of a window — what `getInsightsRange` may be asked for.
 *
 * The server refuses a range containing the open day (it caches on the promise
 * that a closed range cannot change), so today is fetched separately by
 * `getTodayStats` and merged back in. A "today" window has no closed part at
 * all, which is why this returns null rather than an empty range: there is
 * nothing to ask for, not a range that happens to be empty.
 */
export function closedPartOf(range: HomeRange): HomeRange | null {
	const yesterday = range.to - DAY_MS;
	return yesterday < range.from ? null : { from: range.from, to: yesterday };
}

/** Share of the window's earned revenue a product took, 0–100. */
export function productSharePct(product: ProductStat, earned: number): number {
	if (earned <= 0) return 0;
	return (product.revenue / earned) * 100;
}

/**
 * The top source the seller can act on.
 *
 * "Direct" is not an answer to "where do my orders come from" — it is the
 * absence of one, meaning the buyer arrived on the plain link with nothing to
 * attribute it to. Naming it as the winner would tell every seller who has not
 * set up tagged links that their best channel is "direct", which is advice to
 * do nothing. Counter is excluded for the same reason: it is a place, not a
 * channel the seller can push harder.
 */
export function topTaggedSource(
	sources: ReadonlyArray<SourceStat>,
): SourceStat | null {
	let best: SourceStat | null = null;
	for (const s of sources) {
		if (s.source === "direct" || s.source === "counter") continue;
		if (best === null || s.revenue > best.revenue) best = s;
	}
	return best;
}

export type HomeSalesView = InsightsView & {
	period: HomePeriod;
	range: HomeRange;
	/** Earned in the equal window before this one; null when it was not fetched
	 * or the store has no history there. */
	previousEarned: number | null;
	/** The window's revenue that has not been collected. */
	uncollected: number;
};

/**
 * One view model for the hero and the three cards.
 *
 * `previousEarned` stays nullable all the way through rather than defaulting to
 * zero: "we did not fetch it" and "the store earned nothing then" produce very
 * different sentences, and zero would quietly turn the first into a 100% rise.
 */
export function buildHomeSalesView(opts: {
	period: HomePeriod;
	range: HomeRange;
	rangePayload: RangePayload | null;
	todayPayload: TodayPayload | null;
	previousPayload: RangePayload | null;
}): HomeSalesView {
	const view = buildInsightsView({
		from: opts.range.from,
		to: opts.range.to,
		bucketing: "day",
		range: opts.rangePayload,
		today: opts.todayPayload,
		// Home's windows always run to today, so today's payload always belongs.
		includeToday: true,
	});
	return {
		...view,
		period: opts.period,
		range: opts.range,
		previousEarned: opts.previousPayload?.earned ?? null,
		uncollected: Math.max(0, view.earned - view.collected),
	};
}

/**
 * The inbox scope a Home card drills into.
 *
 * Every "which orders?" on this page opens the SAME window the figure was
 * computed from, narrowed to the revenue statuses Insights counts. Without the
 * status scope the inbox answers a different question than the card asked — a
 * card saying "62 orders" opening a list of 71, the extras cancelled. One
 * author here so a new card cannot invent its own idea of the scope.
 */
export type OrdersDrillSearch = {
	from: number;
	to: number;
	st: InboxStatusLeaf[];
	asrc?: string[];
};

/**
 * The range an Insights link hands over — the window the seller was looking at
 * on Home, in the shape `/app/insights` reads. Distinct from
 * `ordersDrillSearch` because the two answer different questions: that one
 * narrows a LIST of orders, this one positions a REPORT.
 */
export type InsightsRangeSearch = { from: number; to: number };

export function insightsRangeSearch(range: HomeRange): InsightsRangeSearch {
	// Both bounds are the MYT midnights Insights validates and the picker owns.
	return { from: range.from, to: range.to };
}

export function ordersDrillSearch(opts: {
	range: HomeRange;
	/** Narrow to one attribution source (the Sources card's rows). */
	source?: string;
}): OrdersDrillSearch {
	return {
		from: opts.range.from,
		// `to` is an INCLUSIVE end-of-day, matching the Insights drill-ins — the
		// range is whole MYT days, so the last millisecond of `to` belongs to it.
		to: opts.range.to + DAY_MS - 1,
		st: [...REVENUE_LEAVES],
		...(opts.source ? { asrc: [opts.source] } : {}),
	};
}

/**
 * Which ranges a period actually has to fetch.
 *
 * `today` is the awkward one and the reason this is a function rather than two
 * lines in a component. Its HEADLINE covers one partial day, but its CHART
 * shows that day against the six before it, and its comparison sentence names
 * the SAME WEEKDAY LAST WEEK — which is eight days back, one day outside the
 * chart. So the today view fetches a closed week of context whose revenue must
 * NOT be added to the headline, while the 7- and 30-day views fetch a closed
 * range that must be.
 *
 * `includeClosedInTotals` is that distinction, made explicit. Getting it wrong
 * is silent: today's hero would read a whole week's revenue under the words
 * "today so far".
 */
export type HomeQueryPlan = {
	/** The window the headline describes. */
	range: HomeRange;
	/** The closed range to ask `getInsightsRange` for; null when there is none. */
	closed: HomeRange | null;
	/** Whether `closed`'s revenue belongs in the headline totals. */
	includeClosedInTotals: boolean;
	/** The equal window before, for the delta pill. Null for today. */
	previous: HomeRange | null;
	/** MYT midnight of the same weekday last week — today's comparison anchor. */
	lastWeekdayStart: number | null;
};

export function homeQueryPlan(
	period: HomePeriod,
	now: number = Date.now(),
): HomeQueryPlan {
	const range = homeRange(period, now);
	if (period === "today") {
		const lastWeekdayStart = range.to - 7 * DAY_MS;
		return {
			range,
			// Eight days back to yesterday: six days of chart context plus the
			// same weekday last week, which sits one day outside the chart.
			closed: { from: lastWeekdayStart, to: range.to - DAY_MS },
			includeClosedInTotals: false,
			previous: null,
			lastWeekdayStart,
		};
	}
	return {
		range,
		closed: closedPartOf(range),
		includeClosedInTotals: true,
		previous: previousHomeRange(period, now),
		lastWeekdayStart: null,
	};
}
