/**
 * Store closed dates (ClickUp `z8r3fdhpm7`) — add, remove, and the "what does
 * this closure land on?" read the add sheet shows before the seller commits.
 * The rules themselves (validation, the covering-range lookup, the one
 * refusal sentence) live in `convex/lib/closedDates.ts`; this file is only the
 * doorway to the retailer row.
 *
 * Two dedicated mutations rather than a field on `retailers.updateSettings`:
 * a closure is added or removed ONE AT A TIME from its own card (the booking
 * calendar's "Mark the store closed" reuses `add`), so there is no draft to
 * save alongside other settings, and each write re-prunes the list.
 *
 * A closure never cancels or moves anything already placed — orders due that
 * day and bookings over it stay exactly as they are. That is why `impact`
 * exists: the seller is told what's already there before saving, and fixes it
 * on the order if they want to.
 */

import { ConvexError, v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { logAdminAction, requireRetailerAccess } from "./lib/auth";
import { bookingsOverlapping } from "./lib/bookingAvailability";
import {
	type ClosedDateRange,
	MAX_CLOSED_RANGE_DAYS,
	MAX_CLOSED_RANGES,
	sameClosedRange,
	sanitizeClosedDateRange,
	upcomingClosures,
} from "./lib/closedDates";
import { DAY_MS, isMytMidnight } from "./lib/fulfilmentDate";
import { effectiveKind } from "./lib/productKind";
import { assertSubscriptionActive } from "./subscriptions";

/** Orders the add sheet names by number; the rest are counted. */
const IMPACT_SAMPLES = 5;
/** The orders read is bounded by the store's own dates, but a busy store's
 * festive rush could still be large — past this the sheet says "N+". */
const IMPACT_ORDER_SCAN = 200;

/**
 * Close a run of days. Validated by `sanitizeClosedDateRange` (midnights,
 * order, not in the past, ≤ 366 days, label ≤ 60 chars), then the list is
 * pruned of ranges that already ended and capped. The exact same range twice
 * is refused rather than stored twice — a double-tap must not need two
 * removes. A range that merely OVERLAPS another is fine (unioned at read).
 */
export const add = mutation({
	args: {
		retailerId: v.id("retailers"),
		startDate: v.number(),
		endDate: v.number(),
		label: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<ClosedDateRange> => {
		const access = await requireRetailerAccess(ctx, args.retailerId);
		// Soft-lock: a past_due seller can't edit store settings (growth-write);
		// an admin onboarding the store bypasses it, the updateSettings posture.
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, args.retailerId);

		const now = Date.now();
		let range: ClosedDateRange;
		try {
			range = sanitizeClosedDateRange(
				{
					startDate: args.startDate,
					endDate: args.endDate,
					label: args.label,
				},
				now,
			);
		} catch (err) {
			throw new ConvexError((err as Error).message);
		}

		const kept = upcomingClosures(access.retailer.closedDates, now);
		if (kept.some((existing) => sameClosedRange(existing, range))) {
			throw new ConvexError("Those dates are already closed");
		}
		if (kept.length >= MAX_CLOSED_RANGES) {
			throw new ConvexError(
				`You can have up to ${MAX_CLOSED_RANGES} closures at once — remove one you no longer need`,
			);
		}
		await ctx.db.patch(access.retailer._id, {
			closedDates: [...kept, range].sort(
				(a, b) => a.startDate - b.startDate || a.endDate - b.endDate,
			),
			updatedAt: now,
		});
		await logAdminAction(ctx, access, "closedDates.add");
		return range;
	},
});

/**
 * Reopen a closed range. Identified by its two dates (a range has no id).
 * Idempotent — an already-gone range is a no-op, so a double-tap or a stale
 * list never errors. The list is pruned on the way through, and an empty
 * result clears the field (no closures has one spelling: unset).
 */
export const remove = mutation({
	args: {
		retailerId: v.id("retailers"),
		startDate: v.number(),
		endDate: v.number(),
	},
	handler: async (ctx, args): Promise<void> => {
		const access = await requireRetailerAccess(ctx, args.retailerId);
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, args.retailerId);

		const stored = access.retailer.closedDates ?? [];
		if (!stored.some((existing) => sameClosedRange(existing, args))) return;
		const kept = upcomingClosures(stored, Date.now()).filter(
			(existing) => !sameClosedRange(existing, args),
		);
		await ctx.db.patch(access.retailer._id, {
			closedDates: kept.length > 0 ? kept : undefined,
			updatedAt: Date.now(),
		});
		await logAdminAction(ctx, access, "closedDates.remove");
	},
});

/**
 * What a closure over [startDate, endDate] (inclusive) would land on — shown
 * in the add sheet BEFORE saving, because a closure never touches what's
 * already placed and the seller should know what they'll need to handle.
 *
 *  - `orders`: storefront/counter orders due on those dates that aren't
 *    finished or cancelled (bookings excluded — they're counted by overlap
 *    below, since a stay can run THROUGH a closure without starting on it).
 *  - `bookings`: bookings whose stay or package term overlaps the range,
 *    through `bookingsOverlapping`, THE bounded scan (a 3-month membership
 *    that started last month still counts).
 */
export const impact = query({
	args: {
		retailerId: v.id("retailers"),
		startDate: v.number(),
		endDate: v.number(),
	},
	handler: async (
		ctx,
		args,
	): Promise<{
		orders: number;
		/** True when the order scan hit its bound — the count is a floor. */
		ordersCapped: boolean;
		bookings: number;
		samples: Array<{
			shortId: string;
			customerName?: string;
			kind: "order" | "booking";
		}>;
	}> => {
		const access = await requireRetailerAccess(ctx, args.retailerId);
		if (!isMytMidnight(args.startDate) || !isMytMidnight(args.endDate)) {
			throw new ConvexError("Closed dates must be calendar days");
		}
		const empty = { orders: 0, ordersCapped: false, bookings: 0, samples: [] };
		if (args.endDate < args.startDate) return empty;
		const days = Math.round((args.endDate - args.startDate) / DAY_MS) + 1;
		if (days > MAX_CLOSED_RANGE_DAYS) return empty;

		const samples: Array<{
			shortId: string;
			customerName?: string;
			kind: "order" | "booking";
		}> = [];

		const due = await ctx.db
			.query("orders")
			.withIndex("by_retailer_fulfilment", (q) =>
				q
					.eq("retailerId", access.retailer._id)
					.gte("fulfilmentDate", args.startDate)
					.lte("fulfilmentDate", args.endDate),
			)
			.take(IMPACT_ORDER_SCAN + 1);
		const ordersCapped = due.length > IMPACT_ORDER_SCAN;
		const openOrders = due
			.slice(0, IMPACT_ORDER_SCAN)
			.filter(
				(order) =>
					order.deliveryMethod !== "booking" &&
					order.status !== "cancelled" &&
					order.status !== "delivered",
			);
		for (const order of openOrders.slice(0, IMPACT_SAMPLES)) {
			samples.push({
				shortId: order.shortId,
				customerName: order.customer.name,
				kind: "order",
			});
		}

		// Booking listings, active or not — a paused listing's bookings still
		// happen. Products are capped at 200 per store.
		const products = await ctx.db
			.query("products")
			.withIndex("by_retailer", (q) => q.eq("retailerId", access.retailer._id))
			.collect();
		const seen = new Set<string>();
		const endExclusive = args.endDate + DAY_MS;
		for (const listing of products) {
			if (effectiveKind(listing.kind) !== "booking") continue;
			for (const order of await bookingsOverlapping(
				ctx,
				listing._id,
				args.startDate,
				endExclusive,
			)) {
				if (seen.has(order.shortId)) continue;
				seen.add(order.shortId);
				if (samples.length < IMPACT_SAMPLES) {
					samples.push({
						shortId: order.shortId,
						customerName: order.customer.name,
						kind: "booking",
					});
				}
			}
		}

		return {
			orders: openOrders.length,
			ordersCapped,
			bookings: seen.size,
			samples,
		};
	},
});
