// Client-side view model for the Insights page: date-range presets + the merge
// of the two backend queries (closed range + live today) onto one contiguous
// trend grid. All the arithmetic reuses the SHARED pure helpers in
// `convex/lib/insights.ts` so client + server never diverge. See docs/insights.md.

import {
	formatFulfilmentDate,
	mytMidnightFromYmd,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../convex/lib/fulfilmentDate";
import {
	type Bucketing,
	bucketStartFor,
	buildBucketStarts,
	computeAov,
	mergePaymentStats,
	mergeProductStats,
	type PaymentStat,
	type ProductStat,
	pickBucketing,
	type TrendBucket,
} from "../../convex/lib/insights";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Longest custom range the calendar allows (matches the server's cap). */
export const MAX_CUSTOM_RANGE_DAYS = 365;

export type InsightsPreset = "today" | "7d" | "30d" | "month" | "90d";

export const INSIGHTS_PRESETS: { key: InsightsPreset; label: string }[] = [
	{ key: "today", label: "Today" },
	{ key: "7d", label: "7 days" },
	{ key: "30d", label: "30 days" },
	{ key: "month", label: "This month" },
	{ key: "90d", label: "90 days" },
];

/** {from, to} MYT midnights for a preset (both inclusive day bounds). */
export function rangeForPreset(
	preset: InsightsPreset,
	now: number = Date.now(),
): { from: number; to: number } {
	const today = todayMytMidnight(now);
	switch (preset) {
		case "today":
			return { from: today, to: today };
		case "7d":
			return { from: today - 6 * DAY_MS, to: today };
		case "30d":
			return { from: today - 29 * DAY_MS, to: today };
		case "90d":
			return { from: today - 89 * DAY_MS, to: today };
		case "month": {
			const firstOfMonth = `${ymdFromEpoch(today).slice(0, 8)}01`;
			return { from: mytMidnightFromYmd(firstOfMonth), to: today };
		}
	}
}

/** Inclusive day span of a range. */
export function rangeSpanDays(from: number, to: number): number {
	return Math.round((to - from) / DAY_MS) + 1;
}

/** Human label for the active range, e.g. "5 – 12 Jun 2026" or "Today". */
export function formatRangeLabel(from: number, to: number): string {
	if (from === to) {
		return from === todayMytMidnight()
			? "Today"
			: formatFulfilmentDate(from, { weekday: false });
	}
	return `${formatFulfilmentDate(from, { weekday: false })} – ${formatFulfilmentDate(
		to,
		{ weekday: false },
	)}`;
}

/** Short axis label for a trend bucket ("5 Jun"; for weeks, the week-start). */
export function bucketLabel(start: number): string {
	return formatFulfilmentDate(start, { weekday: false }).replace(/ \d{4}$/, "");
}

export type RangePayload = {
	earned: number;
	collected: number;
	orderCount: number;
	products: ProductStat[];
	trend: TrendBucket[];
	payments: PaymentStat[];
	bucketing: Bucketing;
	capped: boolean;
};

export type TodayPayload = {
	today: number;
	earned: number;
	collected: number;
	orderCount: number;
	products: ProductStat[];
	payments: PaymentStat[];
};

export type InsightsView = {
	earned: number;
	collected: number;
	orderCount: number;
	aov: number;
	capped: boolean;
	bucketing: Bucketing;
	/** Contiguous buckets spanning [from, to] (empty ones zero-filled). */
	trend: TrendBucket[];
	products: ProductStat[];
	payments: PaymentStat[];
};

/**
 * Merge the closed-range result and the live today result onto one grid. Either
 * may be absent (a today-only preset skips the range query; a past-only custom
 * range skips today). `includeToday` gates whether the today payload folds in.
 */
export function buildInsightsView(opts: {
	from: number;
	to: number;
	bucketing: Bucketing;
	range: RangePayload | null;
	today: TodayPayload | null;
	includeToday: boolean;
}): InsightsView {
	const { from, to, bucketing, range, includeToday } = opts;
	const today = includeToday ? opts.today : null;

	const earned = (range?.earned ?? 0) + (today?.earned ?? 0);
	const collected = (range?.collected ?? 0) + (today?.collected ?? 0);
	const orderCount = (range?.orderCount ?? 0) + (today?.orderCount ?? 0);

	const products = mergeProductStats(
		range?.products ?? [],
		today?.products ?? [],
	);
	const payments = mergePaymentStats(
		range?.payments ?? [],
		today?.payments ?? [],
	);

	// Seed the contiguous grid, add the sparse range buckets, then today's column.
	const grid = new Map<number, TrendBucket>(
		buildBucketStarts(from, to, bucketing).map((s) => [
			s,
			{ start: s, earned: 0, orderCount: 0 },
		]),
	);
	const add = (start: number, e: number, c: number) => {
		const cur = grid.get(start);
		if (cur) {
			cur.earned += e;
			cur.orderCount += c;
		} else {
			grid.set(start, { start, earned: e, orderCount: c });
		}
	};
	for (const b of range?.trend ?? []) add(b.start, b.earned, b.orderCount);
	if (today) {
		add(
			bucketStartFor(today.today, from, bucketing),
			today.earned,
			today.orderCount,
		);
	}

	return {
		earned,
		collected,
		orderCount,
		aov: computeAov(earned, orderCount),
		capped: range?.capped ?? false,
		bucketing,
		trend: [...grid.values()].sort((a, b) => a.start - b.start),
		products,
		payments,
	};
}

export { pickBucketing };
