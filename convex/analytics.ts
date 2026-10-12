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
import { getDisplayName } from "./lib/customer";
import { isMytMidnight, todayMytMidnight } from "./lib/fulfilmentDate";
import {
	type Bucketing,
	computeAov,
	type InsightsOrderInput,
	type PaymentStat,
	type ProductStat,
	reduceInsights,
	type SourceStat,
	topProducts,
} from "./lib/insights";
import { getAccess } from "./subscriptions";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hardest range a seller can request (matches the custom-range calendar cap). */
const MAX_RANGE_DAYS = 366;

/** Bound the range scan. Well above the ICP's ~1–2k orders/year even for a full
 * 365-day range; `capped` is surfaced if a seller ever exceeds it. */
const ANALYTICS_SCAN_CAP = 10_000;

/** Bound the distinct-customer set returned per window. The Home Customers card
 * merges range + today as SETS (the same buyer can appear in both), so the ids
 * have to cross the wire — but an unbounded set would grow with the store. Well
 * above the ICP's distinct buyers in a 30-day window; past it `customersCapped`
 * is surfaced and the card says so rather than quietly under-reporting. */
const CUSTOMER_SET_CAP = 2_000;

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
		securityDeposit: o.securityDeposit,
		paymentStatus: o.paymentStatus,
		paymentMethod: o.paymentMethod,
		source: o.source,
		attributionSource: o.attributionSource,
		customerId: o.customerId,
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

/**
 * One customer-identity row per distinct id on the window's revenue orders.
 *
 * `firstOrderAt` rides along rather than a server-side returning/new verdict on
 * purpose: "returning" means "first ordered BEFORE this window started", and the
 * Home card's window is a closed range PLUS today, resolved on the client. If
 * each query classified against its own `from`, today's call would call almost
 * everyone returning and the union would be nonsense. One window, one `from`,
 * one classification — `splitCustomers` in `src/lib/insights-view.ts`.
 */
async function resolveCustomers(
	ctx: QueryCtx,
	customerIds: string[],
): Promise<{ customers: CustomerIdentity[]; customersCapped: boolean }> {
	const customersCapped = customerIds.length > CUSTOMER_SET_CAP;
	const bounded = customersCapped
		? customerIds.slice(0, CUSTOMER_SET_CAP)
		: customerIds;
	const docs = await Promise.all(
		bounded.map((id) => ctx.db.get(id as Id<"customers">)),
	);
	const customers: CustomerIdentity[] = [];
	for (const doc of docs) {
		// A customer deleted since the order was placed has no identity left to
		// classify; its revenue still counts, it just stops being a head.
		if (doc)
			customers.push({
				id: doc._id,
				firstOrderAt: doc.firstOrderAt,
				initial: initialOf(doc),
			});
	}
	return { customers, customersCapped };
}

/**
 * A distinct buyer in a window, with the timestamp that decides returning vs
 * new and ONE character for the avatar stack the design draws.
 *
 * One character, never the name: the stack shows three faces and a "+39", so a
 * single initial is all it can render — and Home runs session recording, which
 * makes every extra character of buyer identity a cost with no benefit. The
 * client masks even this (`MASK_PII` on the stack), so it is belt and braces.
 */
export type CustomerIdentity = {
	id: string;
	firstOrderAt: number;
	/** Uppercase first letter of the display name; "?" when it has none. */
	initial: string;
};

/** First letter of a buyer's display name, for the avatar stack. */
function initialOf(doc: Doc<"customers">): string {
	const letter = getDisplayName(doc).match(/[a-z0-9]/i)?.[0];
	return letter ? letter.toUpperCase() : "?";
}

export type InsightsRangeResult =
	| { gated: true }
	| {
			gated: false;
			earned: number;
			depositsExcluded: number;
			collected: number;
			orderCount: number;
			aov: number;
			products: ProductStat[];
			trend: { start: number; earned: number; orderCount: number }[];
			payments: PaymentStat[];
			sources: SourceStat[];
			bucketing: Bucketing;
			capped: boolean;
			customers: CustomerIdentity[];
			customersCapped: boolean;
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
		// Insights carries the store's aggregates — its own grant (86exr91r4), so
		// an owner can keep totals/trends to themselves while a helper works
		// orders. Per-order amounts stay visible under the orders grant; the
		// permission copy promises exactly that, no more.
		await requireRetailerAccess(ctx, retailerId, {
			area: "insights",
			level: "read",
		});
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
			depositsExcluded: agg.depositsExcluded,
			collected: agg.collected,
			orderCount: agg.orderCount,
			aov: computeAov(agg.earned, agg.orderCount),
			products,
			trend: agg.trend,
			payments: agg.payments,
			sources: agg.sources,
			bucketing,
			capped,
			...(await resolveCustomers(ctx, agg.customerIds)),
		};
	},
});

export type InsightsTodayResult =
	| { gated: true }
	| {
			gated: false;
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

/**
 * Live insights for TODAY only (MYT). Small — one day of orders — so it can
 * re-run on every inbound order without touching the heavy range scan. Returns
 * `today` (the server's MYT midnight) so the client places today's earned into
 * the correct trend bucket. No trend of its own (the client owns the grid).
 */
export const getTodayStats = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<InsightsTodayResult> => {
		// Insights carries the store's aggregates — its own grant (86exr91r4), so
		// an owner can keep totals/trends to themselves while a helper works
		// orders. Per-order amounts stay visible under the orders grant; the
		// permission copy promises exactly that, no more.
		await requireRetailerAccess(ctx, retailerId, {
			area: "insights",
			level: "read",
		});
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
			depositsExcluded: agg.depositsExcluded,
			collected: agg.collected,
			orderCount: agg.orderCount,
			products,
			payments: agg.payments,
			sources: agg.sources,
			...(await resolveCustomers(ctx, agg.customerIds)),
		};
	},
});

export type InsightsTodayPulse = {
	/** Server's MYT midnight for today, so the client buckets without its own clock. */
	today: number;
	earned: number;
	depositsExcluded: number;
	collected: number;
	orderCount: number;
};

/**
 * Today's three numbers for Home — earned, collected, order count — with NO plan
 * gate (z8r3fdrgzj decision 1). Every plan sees what it made today; the 7/30-day
 * views, the trend and the insight cards stay Pro via `getInsightsRange` /
 * `getTodayStats`, which keep their `{ gated: true }` branch.
 *
 * Still an `insights` AREA read: the plan decides whether a store has paid for
 * trends, the grant decides whether this teammate is allowed near the store's
 * money at all. Loosening the first never loosens the second.
 *
 * Deliberately NOT a thinner `getTodayStats` — that query carries products,
 * payments, sources and customer identities, all of which are the Pro product.
 * A shared handler with a flag would make it one edit away from leaking them.
 */
export const getTodayPulse = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<InsightsTodayPulse> => {
		await requireRetailerAccess(ctx, retailerId, {
			area: "insights",
			level: "read",
		});

		const today = todayMytMidnight(Date.now());
		const { orders } = await scanRange(ctx, retailerId, today, today + DAY_MS);
		const agg = reduceInsights(orders.map(toInput), {
			from: today,
			bucketing: "day",
		});
		return {
			today,
			earned: agg.earned,
			depositsExcluded: agg.depositsExcluded,
			collected: agg.collected,
			orderCount: agg.orderCount,
		};
	},
});
