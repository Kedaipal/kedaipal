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

/** How far back the feed reaches (past stays keep their history in GCal) and
 * how far forward past the booking horizon (180d) it looks. */
const FEED_PAST_DAYS = 90;
const FEED_FUTURE_DAYS = 210;

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
 * Events: every APPROVED booking (status past `booking_requested`, not
 * `cancelled`) on the store's booking listings — requests are deliberately
 * excluded: they expire on a 24 h clock while Google refreshes on a ~daily
 * one, so most would render already-dead noise; the live Kedaipal calendar
 * is the request-time truth — plus the seller's own blocks ("Blocked", with
 * the listing name when scoped). Titles carry the guest NAME and listing
 * only — never a phone number (a feed URL can be forwarded).
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
			calendarName: `Bookings — ${retailer.storeName}`,
			events,
		});
	},
});
