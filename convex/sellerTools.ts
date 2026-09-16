/**
 * Seller MCP tool layer (z8r3fdff6p) — the SHARED analytics functions behind
 * the `/mcp` HTTP endpoint.
 *
 * Trust model — read before touching:
 *  - Every function here is INTERNAL. The only caller is the `/mcp` route in
 *    `convex/http.ts`, which has already (1) verified the caller's Clerk OAuth
 *    access token against Clerk's `oauth/userinfo`, and (2) resolved that Clerk
 *    user to their OWN retailer via `resolveMcpContext`. The `retailerId` each
 *    tool receives is therefore already proven to belong to the caller —
 *    these functions must NEVER be exported as public queries, and the HTTP
 *    route must NEVER accept a retailerId from the client.
 *  - Read-only v1, hard line: queries only. A write reachable from a
 *    third-party AI client could message real buyers off a hallucination.
 *
 * These are transport-agnostic on purpose: MCP is client #1; the planned
 * in-app / WhatsApp "ask your business" assistant is client #2 of the same
 * functions. Analytics logic is REUSED from the Insights/inbox modules
 * (`analytics.scanRange` + `lib/insights` + `lib/orderBuckets`), never
 * duplicated, so a chat answer always agrees with the dashboard.
 *
 * Money: sen in, MAJOR units out (`senToMajor`) — the `/mcp` route stamps the
 * store's `currency` onto every payload. Dates: "YYYY-MM-DD" in MYT.
 */

import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type QueryCtx,
} from "./_generated/server";
import { scanRange, toInput } from "./analytics";
import { matchesBookingPeriod } from "./lib/bookingPeriod";
import { COUNTRY_CURRENCY, DEFAULT_COUNTRY } from "./lib/country";
import { getDisplayName, orderCustomerLabel } from "./lib/customer";
import {
	DAY_MS,
	matchesFulfilmentWindow,
	todayMytMidnight,
	ymdFromEpoch,
} from "./lib/fulfilmentDate";
import { computeAov, reduceInsights, topProducts } from "./lib/insights";
import { minutesToHhMm, senToMajor } from "./lib/mcp";
import { orderBucket } from "./lib/orderBuckets";
import { rateLimiter } from "./lib/rateLimiter";
import { getAccess } from "./subscriptions";

/** Same bound as the inbox (`MAX_INBOX_SCAN`) — "the store's recent orders".
 * Below the cap (the common case) it's simply every order the store has. */
const MCP_ORDER_SCAN = 1000;

/** List-shaped tool outputs stay chat-sized. */
const MAX_LIST_ROWS = 50;
const LOW_STOCK_ROWS = 30;

type OrderDoc = Doc<"orders">;

/** Newest-first bounded read of the store's orders, with the shared
 * never-silently-truncate `capped` flag. */
async function scanRecentOrders(
	ctx: QueryCtx,
	retailerId: Doc<"retailers">["_id"],
): Promise<{ orders: OrderDoc[]; capped: boolean }> {
	const scanned = await ctx.db
		.query("orders")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.order("desc")
		.take(MCP_ORDER_SCAN + 1);
	const capped = scanned.length > MCP_ORDER_SCAN;
	return { orders: capped ? scanned.slice(0, MCP_ORDER_SCAN) : scanned, capped };
}

function isOpenBucket(o: OrderDoc): boolean {
	const bucket = orderBucket(o);
	return bucket === "new" || bucket === "in_progress";
}

function isUnpaid(o: OrderDoc): boolean {
	return (o.paymentStatus ?? "unpaid") !== "received";
}

// ---------------------------------------------------------------------------
// Context resolution + rate limiting (the /mcp route's first two calls)

/**
 * Clerk user → their own retailer, with the access gates applied. Gate order
 * is deliberate: `frozen` outranks the plan pitch — "pay your invoice" is the
 * actionable message for a past_due Pro seller, and a renewal beats an upsell.
 *
 * The frozen refusal is a DECIDED divergence from dashboard reads (which stay
 * open while past_due): MCP access is a vendor action, and the 16 Sep 2026
 * decision is that an expired sub locks vendor actions. `resolveAccess`'s
 * missing-row fail-open (comped Pro) applies here as everywhere.
 */
export const resolveMcpContext = internalQuery({
	args: { clerkUserId: v.string() },
	handler: async (ctx, { clerkUserId }) => {
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", clerkUserId))
			.first();
		if (!retailer) return { ok: false as const, reason: "no_store" as const };
		const access = await getAccess(ctx, retailer._id);
		if (access.frozen) return { ok: false as const, reason: "frozen" as const };
		if (!access.features.mcp)
			return { ok: false as const, reason: "plan" as const };
		return {
			ok: true as const,
			retailerId: retailer._id,
			storeName: retailer.storeName,
			currency: COUNTRY_CURRENCY[retailer.country ?? DEFAULT_COUNTRY],
		};
	},
});

/**
 * Per-store limiter pair for MCP tool calls — the cost guard for a FREE
 * endpoint (calls are never credit-metered, decided 16 Sep 2026). The minute
 * bucket absorbs one assistant question's fan-out; the daily bucket bounds
 * total read exposure. Sizing rationale lives with the config in
 * `lib/rateLimiter.ts`.
 */
export const checkMcpRateLimit = internalMutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		const minute = await rateLimiter.limit(ctx, "mcpToolCall", {
			key: retailerId,
		});
		if (!minute.ok) {
			return { ok: false as const, retryAfterMs: minute.retryAfter };
		}
		const daily = await rateLimiter.limit(ctx, "mcpToolCallDaily", {
			key: retailerId,
		});
		if (!daily.ok) {
			return { ok: false as const, retryAfterMs: daily.retryAfter };
		}
		return { ok: true as const };
	},
});

// ---------------------------------------------------------------------------
// Tools

/**
 * KPIs over a resolved MYT window — the Insights page's numbers, verbatim:
 * same scan (`analytics.scanRange`), same reduce (`reduceInsights`), so
 * "earned" here can never disagree with `/app/insights`.
 */
export const salesSummary = internalQuery({
	args: {
		retailerId: v.id("retailers"),
		from: v.number(),
		toExclusive: v.number(),
	},
	handler: async (ctx, { retailerId, from, toExclusive }) => {
		const { orders, capped } = await scanRange(ctx, retailerId, from, toExclusive);
		const agg = reduceInsights(orders.map(toInput), { from, bucketing: "day" });
		return {
			period: {
				from: ymdFromEpoch(from),
				to: ymdFromEpoch(toExclusive - DAY_MS),
			},
			earned: senToMajor(agg.earned),
			depositsExcluded: senToMajor(agg.depositsExcluded),
			collected: senToMajor(agg.collected),
			orderCount: agg.orderCount,
			averageOrderValue: senToMajor(computeAov(agg.earned, agg.orderCount)),
			topProducts: topProducts(agg.products, "revenue", 5).map((p) => ({
				name: p.name,
				variant: p.variantLabel ?? null,
				quantity: p.quantity,
				revenue: senToMajor(p.revenue),
			})),
			payments: agg.payments.map((p) => ({
				method: p.method,
				revenue: senToMajor(p.revenue),
				orderCount: p.orderCount,
			})),
			sources: agg.sources.map((s) => ({
				source: s.source,
				revenue: senToMajor(s.revenue),
				orderCount: s.orderCount,
			})),
			capped,
		};
	},
});

/** Ranked product list for a window — same reduce as salesSummary, wider K. */
export const productRanking = internalQuery({
	args: {
		retailerId: v.id("retailers"),
		from: v.number(),
		toExclusive: v.number(),
		by: v.union(v.literal("revenue"), v.literal("quantity")),
	},
	handler: async (ctx, { retailerId, from, toExclusive, by }) => {
		const { orders, capped } = await scanRange(ctx, retailerId, from, toExclusive);
		const agg = reduceInsights(orders.map(toInput), { from, bucketing: "day" });
		return {
			period: {
				from: ymdFromEpoch(from),
				to: ymdFromEpoch(toExclusive - DAY_MS),
			},
			rankedBy: by,
			products: topProducts(agg.products, by, 15).map((p) => ({
				name: p.name,
				variant: p.variantLabel ?? null,
				quantity: p.quantity,
				revenue: senToMajor(p.revenue),
			})),
			capped,
		};
	},
});

/**
 * Inbox-bucket counts over the store's recent orders. Buckets come from
 * `orderBucket` — the ONE legal derivation (status alone is not a leaf; a
 * hand-rolled status filter here would reintroduce the `confirmed_unseen`
 * drift `lib/orderBuckets.ts` exists to prevent). The unpaid/dueToday rules
 * mirror the inbox tally in `orders.searchOrders`: unpaid counts OPEN orders
 * only and sums GROSS totals; dueToday skips counter orders (their date is
 * defaulted, not buyer-chosen).
 */
export const orderCounts = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		const now = Date.now();
		const { orders, capped } = await scanRecentOrders(ctx, retailerId);
		const counts = {
			new: 0,
			in_progress: 0,
			completed: 0,
			cancelled: 0,
		};
		let unpaid = 0;
		let unpaidAmount = 0;
		let dueToday = 0;
		for (const o of orders) {
			const bucket = orderBucket(o);
			counts[bucket]++;
			const open = bucket === "new" || bucket === "in_progress";
			if (open && isUnpaid(o)) {
				unpaid++;
				unpaidAmount += o.total;
			}
			if (
				open &&
				o.source !== "counter" &&
				o.fulfilmentDate !== undefined &&
				matchesFulfilmentWindow(o.fulfilmentDate, "today", now)
			) {
				dueToday++;
			}
		}
		return {
			needsAttention: counts.new,
			inProgress: counts.in_progress,
			completed: counts.completed,
			cancelled: counts.cancelled,
			unpaidOpenOrders: unpaid,
			unpaidAmount: senToMajor(unpaidAmount),
			dueToday,
			ordersScanned: orders.length,
			capped,
		};
	},
});

/** The chase list: open orders not yet paid, newest first. */
export const unpaidOrders = internalQuery({
	args: { retailerId: v.id("retailers"), limit: v.number() },
	handler: async (ctx, { retailerId, limit }) => {
		const now = Date.now();
		const bounded = Math.max(1, Math.min(limit, MAX_LIST_ROWS));
		const { orders, capped } = await scanRecentOrders(ctx, retailerId);
		const unpaid = orders.filter((o) => isOpenBucket(o) && isUnpaid(o));
		return {
			totalUnpaid: unpaid.length,
			unpaidAmount: senToMajor(unpaid.reduce((sum, o) => sum + o.total, 0)),
			orders: unpaid.slice(0, bounded).map((o) => ({
				orderId: o.shortId,
				customer: orderCustomerLabel(o.customer, "No name"),
				total: senToMajor(o.total),
				status: o.status,
				placed: ymdFromEpoch(o.createdAt),
				ageDays: Math.max(0, Math.floor((now - o.createdAt) / DAY_MS)),
				fulfilmentDate:
					o.fulfilmentDate !== undefined ? ymdFromEpoch(o.fulfilmentDate) : null,
			})),
			capped,
		};
	},
});

/**
 * What's due in the window: dated open orders (indexed range on
 * `by_retailer_fulfilment`) plus bookings starting in the window or currently
 * active. Counter orders are skipped like the inbox's dueToday chip — their
 * fulfilment date is defaulted, not a real commitment to a buyer.
 */
export const upcomingFulfilments = internalQuery({
	args: {
		retailerId: v.id("retailers"),
		window: v.union(
			v.literal("today"),
			v.literal("tomorrow"),
			v.literal("this_week"),
		),
	},
	handler: async (ctx, { retailerId, window }) => {
		const now = Date.now();
		const today = todayMytMidnight(now);
		// Half-open index range for the chip window ("this_week" = today..+7d,
		// matching `matchesFulfilmentWindow`'s inclusive-of-today semantics).
		const rangeStart = window === "tomorrow" ? today + DAY_MS : today;
		const rangeEnd =
			window === "today"
				? today + DAY_MS
				: window === "tomorrow"
					? today + 2 * DAY_MS
					: today + 8 * DAY_MS;

		const dated = await ctx.db
			.query("orders")
			.withIndex("by_retailer_fulfilment", (q) =>
				q
					.eq("retailerId", retailerId)
					.gte("fulfilmentDate", rangeStart)
					.lt("fulfilmentDate", rangeEnd),
			)
			.take(MAX_LIST_ROWS * 4);
		const due = dated
			.filter((o) => isOpenBucket(o) && o.source !== "counter")
			.slice(0, MAX_LIST_ROWS)
			.map((o) => ({
				orderId: o.shortId,
				customer: orderCustomerLabel(o.customer, "No name"),
				date: ymdFromEpoch(o.fulfilmentDate as number),
				time: minutesToHhMm(o.fulfilmentTimeMinutes),
				method: o.deliveryMethod ?? "delivery",
				total: senToMajor(o.total),
				paid: !isUnpaid(o),
			}));

		const { orders: recent } = await scanRecentOrders(ctx, retailerId);
		const bookings = recent
			.filter((o) => {
				if (o.deliveryMethod !== "booking") return false;
				if (matchesBookingPeriod(o, "active", now)) return true;
				return (
					matchesBookingPeriod(o, "upcoming", now) &&
					(o.bookingCheckIn as number) >= rangeStart &&
					(o.bookingCheckIn as number) < rangeEnd
				);
			})
			.slice(0, MAX_LIST_ROWS)
			.map((o) => ({
				orderId: o.shortId,
				customer: orderCustomerLabel(o.customer, "No name"),
				checkIn: ymdFromEpoch(o.bookingCheckIn as number),
				checkOut: ymdFromEpoch(o.bookingCheckOut as number),
				active: matchesBookingPeriod(o, "active", now),
				total: senToMajor(o.total),
				paid: !isUnpaid(o),
			}));

		return { window, orders: due, bookings };
	},
});

/**
 * All-time best customers off the denormalized aggregates (`by_retailer_ltv` /
 * `by_retailer_orderCount` exist for exactly this read). `totalSpent` is GROSS
 * order totals — deliberately not reconciled with Insights' deposit-net
 * `earned`; the tool description warns the model.
 */
export const topCustomers = internalQuery({
	args: {
		retailerId: v.id("retailers"),
		by: v.union(v.literal("spend"), v.literal("orders")),
	},
	handler: async (ctx, { retailerId, by }) => {
		const rows =
			by === "orders"
				? await ctx.db
						.query("customers")
						.withIndex("by_retailer_orderCount", (q) =>
							q.eq("retailerId", retailerId),
						)
						.order("desc")
						.take(10)
				: await ctx.db
						.query("customers")
						.withIndex("by_retailer_ltv", (q) => q.eq("retailerId", retailerId))
						.order("desc")
						.take(10);
		return {
			rankedBy: by,
			customers: rows
				.filter((c) => c.orderCount > 0)
				.map((c) => ({
					name: getDisplayName(c),
					orders: c.orderCount,
					totalSpent: senToMajor(c.totalSpent),
					firstOrder: ymdFromEpoch(c.firstOrderAt),
					lastOrder: ymdFromEpoch(c.lastOrderAt),
				})),
		};
	},
});

/**
 * Stock-tracked variants at or below the threshold. Only variants with
 * `blockWhenOutOfStock === true` participate — made-to-order lines have no
 * ceiling, so "low" is meaningless for them (same rule as the storefront's
 * stock notes). The product cap (200 rows, 86eyjmf4q) bounds the walk.
 */
export const lowStock = internalQuery({
	args: { retailerId: v.id("retailers"), threshold: v.number() },
	handler: async (ctx, { retailerId, threshold }) => {
		const bounded = Math.max(0, Math.min(threshold, 100));
		const products = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("active", true),
			)
			.take(300);
		const rows: { product: string; variant: string | null; onHand: number }[] =
			[];
		for (const product of products) {
			const variants = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", product._id))
				.collect();
			for (const variant of variants) {
				if (!variant.active) continue;
				// Variant flag first, product flag for un-backfilled rows — the
				// shared idiom (counterCheckout/orderClaims). Custom lines always
				// behave made-to-order whatever their flags say.
				if (variant.isCustom === true) continue;
				const tracksStock =
					(variant.blockWhenOutOfStock ?? product.blockWhenOutOfStock) === true;
				if (!tracksStock) continue;
				if (variant.onHand > bounded) continue;
				rows.push({
					product: product.name,
					variant:
						variant.optionValues.length > 0
							? variant.optionValues.join(" / ")
							: null,
					onHand: variant.onHand,
				});
			}
		}
		rows.sort((a, b) => a.onHand - b.onHand);
		return {
			threshold: bounded,
			totalMatching: rows.length,
			items: rows.slice(0, LOW_STOCK_ROWS),
		};
	},
});

/**
 * Order-credit balance — STUB until Credits T1 (86eye2ccu) ships its ledger.
 * The tool exists now so connected assistants discover it and the answer is
 * honest, and lights up with real numbers when the ledger lands (swap this
 * body for a `getBalance` read; the catalog entry in `lib/mcp.ts` then drops
 * its "not live yet" line).
 */
export const creditBalance = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (_ctx, _args) => {
		return {
			available: false,
			message:
				"Order credits aren't live on Kedaipal yet — your plan currently includes a monthly order allowance instead. Check Settings → Billing on your dashboard for your plan's details.",
		};
	},
});
