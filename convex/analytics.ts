/**
 * Seller Insights backend (`/app/insights`). Two Pro-gated read queries feeding
 * one page:
 *
 *   - `getInsightsRange({ from, to, bucketing })` — the heavy query over a CLOSED
 *     range ending no later than yesterday. Args are MYT-midnight epochs + a fixed
 *     bucketing enum, so they're stable and Convex caches the result; it only
 *     re-runs when a HISTORICAL order in the window mutates. It never references
 *     "now", so a day rollover can't silently stale the cache.
 *   - `getTodayStats()` — the small LIVE query over just today. Re-runs on each of
 *     today's inbound orders (cheap: one day of docs).
 *
 * The client merges the two onto one trend grid (see `convex/lib/insights.ts`
 * `mergeProductStats`/`mergePaymentStats` + the grid helpers). Splitting this way
 * keeps every inbound order from re-running the heavy range scan (ticket cache
 * discipline).
 *
 * The scan is an INDEXED `_creationTime` range read on `by_retailer` (bounded to
 * the window, not a full-table take) — `createdAt` is the revenue anchor and
 * `_creationTime` tracks it to sub-second precision, so we read a slightly
 * widened `_creationTime` window then filter precisely on `createdAt`. Bounded by
 * `ANALYTICS_SCAN_CAP` with a `capped` flag surfaced to the UI (never silently
 * truncate). See docs/insights.md.
 */

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { requireRetailerAccess } from "./lib/auth";
import { isMytMidnight, todayMytMidnight } from "./lib/fulfilmentDate";
import {
	type Bucketing,
	computeAov,
	type InsightsOrderInput,
	type PaymentStat,
	type ProductStat,
	reduceInsights,
	topProducts,
} from "./lib/insights";
import { getAccess } from "./subscriptions";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hardest range a seller can request (matches the custom-range calendar cap). */
const MAX_RANGE_DAYS = 366;

/** Bound the range scan. Well above the ICP's ~1–2k orders/year even for a full
 * 365-day range; `capped` is surfaced if a seller ever exceeds it. */
const ANALYTICS_SCAN_CAP = 10_000;

/** `createdAt` (app clock, set just before insert) and `_creationTime` (db clock)
 * track within milliseconds. We index-range on `_creationTime` for speed but the
 * revenue anchor is `createdAt`, so widen the index window by this buffer then
 * filter precisely on `createdAt` — guarantees no boundary order is missed. */
const CREATION_SKEW_BUFFER_MS = 2 * 60 * 1000;

/** Top-K products returned per ranking metric (revenue + quantity are unioned).
 * The page displays ~8; the extra headroom keeps the client-side range+today
 * merge accurate before it re-slices. */
const PRODUCTS_PER_METRIC = 15;

type OrderDoc = Doc<"orders">;

/** Project an order doc down to the pure-reduce input shape. */
function toInput(o: OrderDoc): InsightsOrderInput {
	return {
		createdAt: o.createdAt,
		status: o.status,
		total: o.total,
		paymentStatus: o.paymentStatus,
		paymentMethod: o.paymentMethod,
		items: o.items,
	};
}

/**
 * Indexed `_creationTime` range read on `by_retailer`, widened by the skew buffer
 * and then filtered precisely on `createdAt ∈ [from, toExclusive)`. Returns the
 * matching orders (newest first) and whether the scan hit the cap.
 */
async function scanRange(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
	from: number,
	toExclusive: number,
): Promise<{ orders: OrderDoc[]; capped: boolean }> {
	const scanned = await ctx.db
		.query("orders")
		.withIndex("by_retailer", (q) =>
			q
				.eq("retailerId", retailerId)
				.gte("_creationTime", from - CREATION_SKEW_BUFFER_MS)
				.lt("_creationTime", toExclusive + CREATION_SKEW_BUFFER_MS),
		)
		.order("desc")
		.take(ANALYTICS_SCAN_CAP + 1);
	const capped = scanned.length > ANALYTICS_SCAN_CAP;
	const bounded = capped ? scanned.slice(0, ANALYTICS_SCAN_CAP) : scanned;
	const orders = bounded.filter(
		(o) => o.createdAt >= from && o.createdAt < toExclusive,
	);
	return { orders, capped };
}

/**
 * Resolve a thumbnail URL for each product stat — variant image first, else the
 * product's first image, else null. Deleted products/variants resolve to null
 * (the snapshot name still renders). Only ever called for the trimmed top set.
 */
async function attachThumbnails(
	ctx: QueryCtx,
	stats: ProductStat[],
): Promise<ProductStat[]> {
	return Promise.all(
		stats.map(async (s) => {
			let storageId: string | undefined;
			if (s.variantId) {
				const variant = await ctx.db.get(s.variantId as Id<"productVariants">);
				storageId = variant?.imageStorageIds?.[0];
			}
			if (!storageId) {
				const product = await ctx.db.get(s.productId as Id<"products">);
				storageId = product?.imageStorageIds?.[0];
			}
			const thumbnailUrl = storageId ? await ctx.storage.getUrl(storageId) : null;
			return { ...s, thumbnailUrl };
		}),
	);
}

/** Union the top-K-by-revenue and top-K-by-quantity products (so a toggle to
 * "by quantity" on the client still has thumbnails), then resolve thumbnails. */
async function topProductsWithThumbnails(
	ctx: QueryCtx,
	products: ProductStat[],
): Promise<ProductStat[]> {
	const byRevenue = topProducts(products, "revenue", PRODUCTS_PER_METRIC);
	const byQuantity = topProducts(products, "quantity", PRODUCTS_PER_METRIC);
	const seen = new Set<string>();
	const union: ProductStat[] = [];
	for (const p of [...byRevenue, ...byQuantity]) {
		if (seen.has(p.key)) continue;
		seen.add(p.key);
		union.push(p);
	}
	return attachThumbnails(ctx, union);
}

export type InsightsRangeResult =
	| { gated: true }
	| {
			gated: false;
			earned: number;
			collected: number;
			orderCount: number;
			aov: number;
			products: ProductStat[];
			trend: { start: number; earned: number; orderCount: number }[];
			payments: PaymentStat[];
			bucketing: Bucketing;
			capped: boolean;
	  };

/**
 * Heavy insights over a CLOSED range [from, to] (both MYT midnights, `to` ≤
 * yesterday — the client caps it so the open day never enters this scan). Pro or
 * above; a Starter caller gets `{ gated: true }` (server-enforced, not just
 * client-hidden). Admin act-as reads the SELLER's plan, not the admin's.
 */
export const getInsightsRange = query({
	args: {
		retailerId: v.id("retailers"),
		from: v.number(),
		to: v.number(),
		bucketing: v.union(v.literal("day"), v.literal("week")),
	},
	handler: async (
		ctx,
		{ retailerId, from, to, bucketing },
	): Promise<InsightsRangeResult> => {
		await requireRetailerAccess(ctx, retailerId);
		const access = await getAccess(ctx, retailerId);
		if (!access.features.insights) return { gated: true };

		if (!isMytMidnight(from) || !isMytMidnight(to)) {
			throw new Error("Insights range must be whole MYT calendar days");
		}
		if (to < from) throw new Error("Insights range end is before its start");
		if ((to - from) / DAY_MS > MAX_RANGE_DAYS) {
			throw new Error(`Insights range can span at most ${MAX_RANGE_DAYS} days`);
		}

		const { orders, capped } = await scanRange(ctx, retailerId, from, to + DAY_MS);
		const agg = reduceInsights(orders.map(toInput), { from, bucketing });
		const products = await topProductsWithThumbnails(ctx, agg.products);

		return {
			gated: false,
			earned: agg.earned,
			collected: agg.collected,
			orderCount: agg.orderCount,
			aov: computeAov(agg.earned, agg.orderCount),
			products,
			trend: agg.trend,
			payments: agg.payments,
			bucketing,
			capped,
		};
	},
});

export type InsightsTodayResult =
	| { gated: true }
	| {
			gated: false;
			today: number;
			earned: number;
			collected: number;
			orderCount: number;
			products: ProductStat[];
			payments: PaymentStat[];
	  };

/**
 * Live insights for TODAY only (MYT). Small — one day of orders — so it can
 * re-run on every inbound order without touching the heavy range scan. Returns
 * `today` (the server's MYT midnight) so the client places today's earned into
 * the correct trend bucket. No trend of its own (the client owns the grid).
 */
export const getTodayStats = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<InsightsTodayResult> => {
		await requireRetailerAccess(ctx, retailerId);
		const access = await getAccess(ctx, retailerId);
		if (!access.features.insights) return { gated: true };

		const today = todayMytMidnight(Date.now());
		const { orders } = await scanRange(ctx, retailerId, today, today + DAY_MS);
		// bucketing/from irrelevant here (trend dropped) — reduce with today's own
		// anchor so the call is well-formed.
		const agg = reduceInsights(orders.map(toInput), {
			from: today,
			bucketing: "day",
		});
		const products = await topProductsWithThumbnails(ctx, agg.products);

		return {
			gated: false,
			today,
			earned: agg.earned,
			collected: agg.collected,
			orderCount: agg.orderCount,
			products,
			payments: agg.payments,
		};
	},
});
