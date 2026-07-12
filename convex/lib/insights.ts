/**
 * Pure reduce logic for Seller Insights (`/app/insights`) — revenue split,
 * top-product grouping, day/week trend bucketing and payment-method breakdown.
 *
 * No Convex imports (mirrors `fulfilmentDate.ts` / `paymentMethod.ts`) so the
 * aggregation is unit-tested in isolation and SHARED between the backend
 * (`analytics.ts` bounded scan) and the frontend (the range + today results are
 * merged client-side onto one trend grid — see `mergeAggregates`).
 *
 * Definitions (see docs/insights.md):
 *   - A **revenue order** is one whose status is confirmed → delivered. `pending`
 *     and `cancelled` are excluded from EVERY figure (an order cancelled after
 *     payment therefore drops out of both earned and collected).
 *   - **Earned** = Σ total over revenue orders (order placed = revenue recognised).
 *   - **Collected** = Σ total over revenue orders whose paymentStatus is
 *     "received" (money actually in hand). The payment-method donut slices this
 *     same figure, so Σ slices === collected.
 *   - Revenue anchors on `createdAt` (when the order was placed); `fulfilmentDate`
 *     is ops, not revenue.
 *
 * All bucketing is MYT (UTC+8, no DST) — a 00:30 MYT order lands in the right
 * day. We reuse `todayMytMidnight(epoch)` (it returns the MYT midnight of the day
 * CONTAINING any epoch, not just "now") as the day-flooring primitive.
 */

import { todayMytMidnight } from "./fulfilmentDate";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Day buckets up to this span (inclusive), week buckets beyond. */
export const DAY_BUCKET_MAX_DAYS = 31;

/** Order statuses that count as realised revenue (confirmed → delivered). */
export const REVENUE_STATUSES = [
	"confirmed",
	"packed",
	"shipped",
	"delivered",
] as const;

const REVENUE_STATUS_SET: ReadonlySet<string> = new Set(REVENUE_STATUSES);

/** True when an order's status counts toward revenue (excludes pending/cancelled). */
export function isRevenueOrder(status: string): boolean {
	return REVENUE_STATUS_SET.has(status);
}

/** Minimal order shape the reduce needs — a projection of the `orders` doc. */
export type InsightsOrderInput = {
	createdAt: number;
	status: string;
	total: number;
	paymentStatus?: string;
	paymentMethod?: string;
	items: ReadonlyArray<{
		productId: string;
		variantId?: string;
		name: string;
		variantLabel?: string;
		price: number;
		quantity: number;
	}>;
};

export type Bucketing = "day" | "week";

/** Per product+variant sales, sorted by revenue desc by the reduce. `thumbnailUrl`
 * is attached later by the query (needs `ctx.storage`); the pure reduce leaves it
 * undefined. */
export type ProductStat = {
	/** Stable grouping key — `productId::variantId`. */
	key: string;
	productId: string;
	variantId?: string;
	/** Snapshot name/label frozen on the order item (never joined from live
	 * products, so a deleted product still shows its historical name). */
	name: string;
	variantLabel?: string;
	revenue: number;
	quantity: number;
	thumbnailUrl?: string | null;
};

/** One trend column. `start` is the bucket's MYT-midnight (day) or week-start. */
export type TrendBucket = { start: number; earned: number; orderCount: number };

/** One donut slice. `method` is a concrete `OrderPaymentMethod` or "unspecified"
 * (received online / self-claimed, no method recorded). */
export type PaymentStat = { method: string; revenue: number; orderCount: number };

export type InsightsAggregate = {
	/** Σ total over revenue orders. */
	earned: number;
	/** Σ total over revenue orders with paymentStatus "received". */
	collected: number;
	/** Count of revenue orders (denominator for AOV). */
	orderCount: number;
	/** Full product breakdown, sorted by revenue desc (the query trims + adds
	 * thumbnails). */
	products: ProductStat[];
	/** Sparse trend buckets (only buckets with ≥1 revenue order), ascending. */
	trend: TrendBucket[];
	/** Payment-method slices over collected revenue, sorted by revenue desc. */
	payments: PaymentStat[];
};

/** Average order value (minor units) — earned ÷ revenue-order count, 0 when none. */
export function computeAov(earned: number, orderCount: number): number {
	if (orderCount <= 0) return 0;
	return Math.round(earned / orderCount);
}

/** Day buckets for a span ≤ 31 days, week buckets above. `from`/`to` are MYT
 * midnights (inclusive day bounds). */
export function pickBucketing(from: number, to: number): Bucketing {
	const spanDays = Math.round((to - from) / DAY_MS) + 1;
	return spanDays <= DAY_BUCKET_MAX_DAYS ? "day" : "week";
}

/** The bucket start (MYT midnight for day, week-start for week) that a given MYT
 * day-midnight falls into, anchored on `from` so range + today share one grid. */
export function bucketStartFor(
	dayMidnight: number,
	from: number,
	bucketing: Bucketing,
): number {
	if (bucketing === "day") return dayMidnight;
	const weeks = Math.floor((dayMidnight - from) / WEEK_MS);
	return from + weeks * WEEK_MS;
}

/** Contiguous ascending bucket-start grid covering [from, to] — the client seeds
 * this from the sparse range/today buckets so empty days/weeks still render. */
export function buildBucketStarts(
	from: number,
	to: number,
	bucketing: Bucketing,
): number[] {
	const step = bucketing === "day" ? DAY_MS : WEEK_MS;
	const starts: number[] = [];
	// Anchor the last bucket on the day CONTAINING `to` (week grids step from `from`).
	for (let s = from; s <= to; s += step) starts.push(s);
	if (starts.length === 0) starts.push(from);
	return starts;
}

/** Stable product grouping key. */
export function productKey(productId: string, variantId?: string): string {
	return `${productId}::${variantId ?? ""}`;
}

/**
 * Reduce a set of orders into an insights aggregate. `from` + `bucketing` anchor
 * the trend grid; the reduce itself needs no `to` (buckets derive from the data,
 * the client builds the contiguous display grid). Orders outside the revenue
 * status set are ignored entirely.
 */
export function reduceInsights(
	orders: ReadonlyArray<InsightsOrderInput>,
	{ from, bucketing }: { from: number; bucketing: Bucketing },
): InsightsAggregate {
	let earned = 0;
	let collected = 0;
	let orderCount = 0;
	const productMap = new Map<string, ProductStat>();
	const trendMap = new Map<number, TrendBucket>();
	const paymentMap = new Map<string, PaymentStat>();

	for (const o of orders) {
		if (!isRevenueOrder(o.status)) continue;
		orderCount += 1;
		earned += o.total;

		// Trend — earned revenue by MYT day/week bucket.
		const dayMidnight = todayMytMidnight(o.createdAt);
		const start = bucketStartFor(dayMidnight, from, bucketing);
		const bucket = trendMap.get(start);
		if (bucket) {
			bucket.earned += o.total;
			bucket.orderCount += 1;
		} else {
			trendMap.set(start, { start, earned: o.total, orderCount: 1 });
		}

		// Top products — group order-item lines by product+variant (snapshot name).
		for (const item of o.items) {
			const key = productKey(item.productId, item.variantId);
			const lineRevenue = item.price * item.quantity;
			const existing = productMap.get(key);
			if (existing) {
				existing.revenue += lineRevenue;
				existing.quantity += item.quantity;
			} else {
				productMap.set(key, {
					key,
					productId: item.productId,
					variantId: item.variantId,
					name: item.name,
					variantLabel: item.variantLabel,
					revenue: lineRevenue,
					quantity: item.quantity,
				});
			}
		}

		// Collected + payment-method donut — only orders whose money is in hand.
		if (o.paymentStatus === "received") {
			collected += o.total;
			const method = o.paymentMethod ?? "unspecified";
			const slice = paymentMap.get(method);
			if (slice) {
				slice.revenue += o.total;
				slice.orderCount += 1;
			} else {
				paymentMap.set(method, { method, revenue: o.total, orderCount: 1 });
			}
		}
	}

	return {
		earned,
		collected,
		orderCount,
		products: [...productMap.values()].sort((a, b) => b.revenue - a.revenue),
		trend: [...trendMap.values()].sort((a, b) => a.start - b.start),
		payments: [...paymentMap.values()].sort((a, b) => b.revenue - a.revenue),
	};
}

/** Merge two product breakdowns by key (range + today), summing revenue/qty and
 * keeping whichever thumbnail resolved. Re-sorted by revenue desc. */
export function mergeProductStats(
	a: ReadonlyArray<ProductStat>,
	b: ReadonlyArray<ProductStat>,
): ProductStat[] {
	const map = new Map<string, ProductStat>();
	for (const p of [...a, ...b]) {
		const existing = map.get(p.key);
		if (existing) {
			existing.revenue += p.revenue;
			existing.quantity += p.quantity;
			if (existing.thumbnailUrl == null && p.thumbnailUrl != null) {
				existing.thumbnailUrl = p.thumbnailUrl;
			}
		} else {
			map.set(p.key, { ...p });
		}
	}
	return [...map.values()].sort((x, y) => y.revenue - x.revenue);
}

/** Merge two payment breakdowns by method, summing revenue/count. */
export function mergePaymentStats(
	a: ReadonlyArray<PaymentStat>,
	b: ReadonlyArray<PaymentStat>,
): PaymentStat[] {
	const map = new Map<string, PaymentStat>();
	for (const p of [...a, ...b]) {
		const existing = map.get(p.method);
		if (existing) {
			existing.revenue += p.revenue;
			existing.orderCount += p.orderCount;
		} else {
			map.set(p.method, { ...p });
		}
	}
	return [...map.values()].sort((x, y) => y.revenue - x.revenue);
}

export type ProductMetric = "revenue" | "quantity";

/** Top-N products by the chosen metric (revenue or units sold). */
export function topProducts(
	products: ReadonlyArray<ProductStat>,
	metric: ProductMetric,
	n: number,
): ProductStat[] {
	return [...products]
		.sort((a, b) =>
			metric === "revenue" ? b.revenue - a.revenue : b.quantity - a.quantity,
		)
		.slice(0, n);
}
