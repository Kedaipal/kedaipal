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
	mergeSourceStats,
	type PaymentStat,
	type ProductStat,
	pickBucketing,
	type SourceStat,
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
	depositsExcluded: number;
	collected: number;
	orderCount: number;
	products: ProductStat[];
	trend: TrendBucket[];
	payments: PaymentStat[];
	sources: SourceStat[];
	bucketing: Bucketing;
	capped: boolean;
	customers: CustomerIdentity[];
	customersCapped: boolean;
};

export type TodayPayload = {
	today: number;
	earned: number;
	depositsExcluded: number;
	collected: number;
	orderCount: number;
	products: ProductStat[];
	payments: PaymentStat[];
	sources: SourceStat[];
	customers: CustomerIdentity[];
	customersCapped: boolean;
};

export type InsightsView = {
	earned: number;
	/** Σ security deposit netted out of `earned` (0 unless a booking order with
	 * a deposit sits in the window) — drives the Revenue earned sub-label. */
	depositsExcluded: number;
	collected: number;
	orderCount: number;
	aov: number;
	capped: boolean;
	bucketing: Bucketing;
	/** Contiguous buckets spanning [from, to] (empty ones zero-filled). */
	trend: TrendBucket[];
	products: ProductStat[];
	payments: PaymentStat[];
	sources: SourceStat[];
	/** Distinct buyers in the window, split returning vs first-time. */
	customers: CustomerSplit;
};

/** A distinct buyer in a window, with the timestamp that decides returning vs new. */
export type CustomerIdentity = { id: string; firstOrderAt: number };

export type CustomerSplit = {
	/** Distinct identified buyers in the window. */
	total: number;
	/** Had already ordered before the window opened. */
	returning: number;
	/** First ever ordered inside this window. */
	fresh: number;
	/** The id set hit the server cap, so these are floors, not totals. */
	capped: boolean;
};

/**
 * Union the closed range's buyers with today's and classify each ONCE against
 * the window's own `from`.
 *
 * Both halves have to be unioned as a SET before anything is counted: a regular
 * who ordered on Tuesday and again this morning is in both payloads and is one
 * customer, so adding two counts would invent a buyer. And classification has
 * to happen after the union, against ONE `from` — were each query to decide
 * returning-vs-new against its own window, today's call would label nearly
 * everyone "returning" (they ordered before this morning) and the merged split
 * would be meaningless.
 */
export function splitCustomers(
	range: ReadonlyArray<CustomerIdentity>,
	today: ReadonlyArray<CustomerIdentity>,
	from: number,
	capped = false,
): CustomerSplit {
	const seen = new Map<string, number>();
	for (const c of [...range, ...today]) {
		// Keep the EARLIEST firstOrderAt if the two payloads ever disagree — a
		// buyer's first order can only move backwards as more history is seen.
		const prev = seen.get(c.id);
		if (prev === undefined || c.firstOrderAt < prev)
			seen.set(c.id, c.firstOrderAt);
	}
	let returning = 0;
	for (const firstOrderAt of seen.values())
		if (firstOrderAt < from) returning += 1;
	return {
		total: seen.size,
		returning,
		fresh: seen.size - returning,
		capped,
	};
}

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
	const depositsExcluded =
		(range?.depositsExcluded ?? 0) + (today?.depositsExcluded ?? 0);
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
	const sources = mergeSourceStats(range?.sources ?? [], today?.sources ?? []);

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
		depositsExcluded,
		collected,
		orderCount,
		aov: computeAov(earned, orderCount),
		capped: range?.capped ?? false,
		bucketing,
		trend: [...grid.values()].sort((a, b) => a.start - b.start),
		products,
		payments,
		sources,
		customers: splitCustomers(
			range?.customers ?? [],
			today?.customers ?? [],
			from,
			(range?.customersCapped ?? false) || (today?.customersCapped ?? false),
		),
	};
}

export { pickBucketing };
