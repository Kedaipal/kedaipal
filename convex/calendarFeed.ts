/**
 * The seller's Google-Calendar feed (booking bundle S6, `86eyn4kf2`):
 * ONE-WAY ICS subscribe, locked 12 Aug — Google pulls `GET /cal/<token>.ics`
 * on its own schedule (usually within a day); the Kedaipal calendar is always
 * live, the Settings card says so, and a feed failure can never touch an
 * order (the route only ever reads). OAuth push / two-way sync are
 * deliberately deferred (revival triggers on the spec).
 *
 * The token is the whole capability (`/track` posture): high-entropy,
 * per-store, rotatable — rotating kills the old URL (counter-QR precedent,
 * and the Settings card warns before doing it).
 */

import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { internalQuery, mutation } from "./_generated/server";
import { logAdminAction, requireRetailerAccess } from "./lib/auth";
import {
	loadBlocksForWindow,
	MAX_BOOKING_NIGHTS,
} from "./lib/bookingAvailability";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import {
	buildIcsCalendar,
	type IcsEvent,
	inclusiveEndToExclusive,
} from "./lib/icsFeed";
import { generateTrackingToken } from "./lib/order";
import { effectiveKind } from "./lib/productKind";

/** How far back the feed reaches (past work keeps its history in GCal) and how
 * far forward past the booking horizon (180d) it looks. */
const FEED_PAST_DAYS = 90;
const FEED_FUTURE_DAYS = 210;

/** Safety bound on one feed render. A store doing 20 orders/week fills roughly
 * 850 of these across the window, so this is a runaway guard, not a limit
 * anyone should meet; hitting it logs rather than truncating quietly. */
const MAX_FEED_ORDERS = 2000;

/** What an order reads as on a calendar: the first line, plus a count when
 * there are more. The seller needs to recognise it at a glance, not audit it. */
function describeOrderItems(
	items: ReadonlyArray<{ name: string; quantity: number }>,
): string {
	if (items.length === 0) return "Order";
	const first = items[0];
	const head =
		first.quantity > 1 ? `${first.name} ×${first.quantity}` : first.name;
	return items.length === 1 ? head : `${head} +${items.length - 1} more`;
}

/**
 * The Settings card's read: the current token (null until ensured) + whether
 * this store sells bookings at all (the card explains itself when not).
 */
export const getCalendarFeed = query({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{ token: string | null; hasBookingListings: boolean }> => {
		const access = await requireRetailerAccess(ctx, retailerId);
		const products = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", access.retailer._id).eq("active", true),
			)
			.collect();
		return {
			token: access.retailer.calendarFeedToken ?? null,
			hasBookingListings: products.some(
				(p) => effectiveKind(p.kind) === "booking",
			),
		};
	},
});

/**
 * Mint the feed token if none exists (idempotent — an existing token is
 * returned unchanged, so rendering the card can never rotate by accident).
 */
export const ensureCalendarFeedToken = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<string> => {
		const access = await requireRetailerAccess(ctx, retailerId);
		const existing = access.retailer.calendarFeedToken;
		if (existing) return existing;
		const token = generateTrackingToken();
		await ctx.db.patch(access.retailer._id, {
			calendarFeedToken: token,
			updatedAt: Date.now(),
		});
		await logAdminAction(
			ctx,
			access,
			"calendarFeed.ensureToken",
			access.retailer._id,
		);
		return token;
	},
});

/**
 * Replace the token. The old feed URL STOPS WORKING — Google shows the
 * calendar as unreachable until the seller re-subscribes with the new URL;
 * the Settings card confirms this explicitly before calling.
 */
export const rotateCalendarFeedToken = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<string> => {
		const access = await requireRetailerAccess(ctx, retailerId);
		if (!access.retailer.calendarFeedToken) {
			throw new ConvexError("Connect the calendar first");
		}
		const token = generateTrackingToken();
		await ctx.db.patch(access.retailer._id, {
			calendarFeedToken: token,
			updatedAt: Date.now(),
		});
		await logAdminAction(
			ctx,
			access,
			"calendarFeed.rotateToken",
			access.retailer._id,
		);
		return token;
	},
});

/**
 * Assemble the full ICS document for a token — the HTTP route's one read.
 * Null = unknown token (the route 404s with no detail; a feed URL is a
 * secret and an invalid one learns nothing).
 *
 * Events, in three passes:
 *  1. Every APPROVED booking (past `booking_requested`, not `cancelled`) on
 *     the store's booking listings, drawn across its whole stay. Requests are
 *     deliberately excluded — they expire on a 24 h clock while Google
 *     refreshes on a ~daily one, so most would render already-dead noise; the
 *     live Kedaipal calendar is the request-time truth.
 *  2. Every OTHER order due in the window (owner call, 30 Aug) — all-day on
 *     its fulfilment date, or timed when the order carries one. Every order
 *     has a due date, so this serves a cake seller's twelve Saturday
 *     deliveries exactly as well as it serves a campsite, with no OAuth.
 *     Only CANCELLED orders are skipped — a pending one is still real work
 *     (and is every storefront order on a deployment without the confirm
 *     template) — plus booking orders, which pass 1 already drew.
 *  3. The seller's own blocks ("Blocked", with the listing name when scoped).
 *
 * Titles carry the customer NAME and what was ordered — never a phone number
 * (a feed URL can be forwarded).
 */
export const feedByToken = internalQuery({
	args: { token: v.string() },
	handler: async (ctx, { token }): Promise<string | null> => {
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_calendarFeedToken", (q) =>
				q.eq("calendarFeedToken", token),
			)
			.unique();
		if (!retailer) return null;

		const today = todayMytMidnight(Date.now());
		const from = today - FEED_PAST_DAYS * DAY_MS;
		const to = today + FEED_FUTURE_DAYS * DAY_MS;

		const products = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailer._id).eq("active", true),
			)
			.collect();
		const listings = products.filter(
			(p) => effectiveKind(p.kind) === "booking",
		);
		const listingName = new Map(listings.map((p) => [p._id, p.name]));

		const events: IcsEvent[] = [];
		for (const listing of listings) {
			// Same bounded index scan as the availability module: check-ins from
			// `from − max stay` can still overlap the window.
			const holders = await ctx.db
				.query("orders")
				.withIndex("by_booking_product", (q) =>
					q
						.eq("bookingProductId", listing._id)
						.gte("bookingCheckIn", from - MAX_BOOKING_NIGHTS * DAY_MS)
						.lt("bookingCheckIn", to),
				)
				.collect();
			for (const order of holders) {
				if (order.status === "cancelled") continue;
				if (order.status === "booking_requested") continue;
				if (
					order.bookingCheckIn === undefined ||
					order.bookingCheckOut === undefined
				)
					continue;
				events.push({
					uid: `booking-${order.shortId}`,
					summary: `${order.customer.name?.trim() || "Guest"} — ${listing.name}`,
					start: order.bookingCheckIn,
					endExclusive: order.bookingCheckOut,
					createdAt: order.createdAt,
				});
			}
		}

		// EVERY other order due in the window — not just bookings (owner call, 30
		// Aug). Every order already carries a fulfilment date, so a cake seller
		// with twelve Saturday deliveries gets the same value from this feed as
		// a campsite does, and it needs no OAuth to deliver. Booking orders are
		// excluded here because the pass above already emitted them with their
		// full stay range; a second all-day event on the check-in day would
		// double them up.
		const dueOrders = await ctx.db
			.query("orders")
			.withIndex("by_retailer_fulfilment", (q) =>
				q
					.eq("retailerId", retailer._id)
					.gte("fulfilmentDate", from)
					.lt("fulfilmentDate", to),
			)
			.take(MAX_FEED_ORDERS + 1);
		if (dueOrders.length > MAX_FEED_ORDERS) {
			// Never a silent truncation: the seller's calendar would just stop
			// part-way through a busy season with no way to tell.
			console.warn("calendar feed truncated", {
				retailerId: retailer._id,
				cap: MAX_FEED_ORDERS,
			});
		}
		for (const order of dueOrders.slice(0, MAX_FEED_ORDERS)) {
			if (order.fulfilmentDate === undefined) continue;
			if (order.deliveryMethod === "booking") continue;
			// Only a cancelled order leaves the calendar. `pending` deliberately
			// STAYS: on the legacy/fallback path (and any deployment without the
			// confirmation template configured) every storefront order lands
			// pending, so excluding it would empty the calendar of real work. It
			// is also what the inbox does — pending sits in the New bucket, not
			// out of sight. Booking REQUESTS are the one exception, excluded in
			// the pass above because they self-destruct on a 24 h clock.
			if (order.status === "cancelled") continue;
			events.push({
				uid: `order-${order.shortId}`,
				summary: `${order.customer.name?.trim() || "Order"} — ${describeOrderItems(order.items)}`,
				start: order.fulfilmentDate,
				endExclusive: order.fulfilmentDate + DAY_MS,
				// A timed order becomes a timed event — twelve deliveries on one
				// Saturday are only useful with their times attached.
				startMinutes: order.fulfilmentTimeMinutes,
				createdAt: order.createdAt,
			});
		}

		const blocks = await loadBlocksForWindow(ctx, retailer._id, from, to);
		for (const block of blocks) {
			const scoped =
				block.productId !== undefined
					? listingName.get(block.productId)
					: undefined;
			events.push({
				uid: `block-${block._id}`,
				summary: `Blocked${scoped ? ` — ${scoped}` : ""}${
					block.note ? ` (${block.note})` : ""
				}`,
				start: block.startDate,
				endExclusive: inclusiveEndToExclusive(block.endDate),
				createdAt: block.createdAt,
			});
		}

		// Stable order (start, then UID) so an unchanged dataset yields a
		// byte-identical document across fetches.
		events.sort(
			(a, b) => a.start - b.start || a.uid.localeCompare(b.uid),
		);

		return buildIcsCalendar({
			calendarName: `${retailer.storeName} — Kedaipal`,
			events,
		});
	},
});
