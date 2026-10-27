// Orders → Schedule (`z8r3fdjv0d`): every dated programme on one screen, with
// registered vs paid per date. A read-only LENS over the orders the inbox
// lists, like the booking calendar — the grouping rules live in
// `lib/scheduleRows.ts`, this module only gathers the window. See
// docs/schedule-view.md.

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { creditGateFor, isOrderGated } from "./creditLock";
import { requireRetailerAccess } from "./lib/auth";
import { DAY_MS, isMytMidnight } from "./lib/fulfilmentDate";
import { eventLastDay } from "./lib/productEvent";
import { isFreeOrder } from "./lib/order";
import { effectiveKind } from "./lib/productKind";
import {
	buildScheduleRows,
	SCHEDULE_AHEAD_DAYS,
	SCHEDULE_PAST_DAYS,
	type ScheduleListing,
	type ScheduleOrder,
	type ScheduleRow,
} from "./lib/scheduleRows";
import { assertPlanFeature } from "./subscriptions";

/** Today plus both horizons — see `SCHEDULE_AHEAD_DAYS`. */
const MAX_WINDOW_DAYS = SCHEDULE_AHEAD_DAYS + SCHEDULE_PAST_DAYS + 1;

/** Runaway guard on one window's orders, the calendar feed's bound. A store
 * doing 20 orders a week puts ~360 in a 120-day window, so nobody should meet
 * it; one who does is TOLD (`truncated`), never shown quietly short counts. */
const MAX_SCHEDULE_ORDERS = 2000;

/** The listings a schedule is about: fixed-date events and bookings. */
function datedKind(p: Doc<"products">): ScheduleListing["kind"] | null {
	if (p.event !== undefined) return "event";
	if (effectiveKind(p.kind) === "booking") return "booking";
	return null;
}

function toListing(
	p: Doc<"products">,
	kind: ScheduleListing["kind"],
): ScheduleListing {
	return {
		_id: p._id,
		name: p.name,
		kind,
		event: p.event
			? {
					date: p.event.date,
					endDate: p.event.endDate,
					timeMinutes: p.event.timeMinutes,
					seats: p.event.seats,
				}
			: undefined,
	};
}

async function activeProducts(ctx: QueryCtx, retailerId: Id<"retailers">) {
	return await ctx.db
		.query("products")
		.withIndex("by_retailer_active", (q) =>
			q.eq("retailerId", retailerId).eq("active", true),
		)
		.collect();
}

/**
 * Does this store sell anything with a date of its own — an event or a booking
 * listing? Decides whether the Orders view switch offers Schedule at all, the
 * way `hasBookingListings` decides Calendar: a store selling only cakes has no
 * programme to schedule.
 */
export const hasDatedListings = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<boolean> => {
		await requireRetailerAccess(ctx, retailerId, {
			area: "orders",
			level: "read",
		});
		const products = await activeProducts(ctx, retailerId);
		return products.some((p) => datedKind(p) !== null);
	},
});

/**
 * One row per (date, listing) for `[fromMyt, toMyt]` (inclusive MYT
 * midnights): seats, registered, and the payment split.
 *
 * `fromMyt` comes from the client, as in `orders.countDueByDay`: a query that
 * reads the clock to pick its window can't be cached.
 *
 * Reads: the window on `by_retailer_fulfilment`, the store's active products
 * (to seed events nobody has registered for yet), and one `get` per listing an
 * order names that isn't active any more — an archived event with RSVPs still
 * happens on its day.
 */
export const byDate = query({
	args: {
		retailerId: v.id("retailers"),
		fromMyt: v.number(),
		toMyt: v.number(),
	},
	handler: async (
		ctx,
		{ retailerId, fromMyt, toMyt },
	): Promise<{ rows: ScheduleRow[]; truncated: boolean }> => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			area: "orders",
			level: "read",
		});
		// The schedule is an inbox lens — and every row taps into the inbox's
		// listing filter, which is the Pro inbox — so it is gated with the inbox.
		if (!access.actingAsAdmin)
			await assertPlanFeature(ctx, retailerId, "orderInbox");
		if (!isMytMidnight(fromMyt) || !isMytMidnight(toMyt))
			throw new ConvexError("Schedule window must run between MYT midnights");
		if (toMyt < fromMyt || (toMyt - fromMyt) / DAY_MS + 1 > MAX_WINDOW_DAYS)
			throw new ConvexError(
				`Schedule window must span 1–${MAX_WINDOW_DAYS} days`,
			);

		const listings = new Map<string, ScheduleListing>();
		const seedEvents: ScheduleListing[] = [];
		// A multi-day event that STARTED before the window but is still running
		// belongs on it (it's on today), and its RSVPs all sit on its first day —
		// so the order read has to reach back to the earliest such start.
		let readFrom = fromMyt;
		const active = await activeProducts(ctx, retailerId);
		for (const p of active) {
			const kind = datedKind(p);
			if (kind === null) continue;
			const listing = toListing(p, kind);
			listings.set(p._id, listing);
			if (
				p.event &&
				p.event.date <= toMyt &&
				eventLastDay(p.event) >= fromMyt
			) {
				seedEvents.push(listing);
				readFrom = Math.min(readFrom, p.event.date);
			}
		}

		const window = await ctx.db
			.query("orders")
			.withIndex("by_retailer_fulfilment", (q) =>
				q
					.eq("retailerId", retailerId)
					.gte("fulfilmentDate", readFrom)
					.lte("fulfilmentDate", toMyt),
			)
			.take(MAX_SCHEDULE_ORDERS + 1);
		const truncated = window.length > MAX_SCHEDULE_ORDERS;
		if (truncated) {
			console.warn("schedule window truncated", {
				retailerId,
				cap: MAX_SCHEDULE_ORDERS,
			});
		}
		const orders = window.slice(0, MAX_SCHEDULE_ORDERS);

		// A listing archived after people registered for it: its day still
		// happens, so its row must still be there. Looked up once each — and
		// only ids that aren't ACTIVE products, so the cake on a dated order
		// (active, just not dated) costs nothing.
		const activeIds = new Set<Id<"products">>(active.map((p) => p._id));
		const missing = new Set<Id<"products">>();
		for (const o of orders) {
			for (const id of listingIdsOf(o)) if (!activeIds.has(id)) missing.add(id);
		}
		for (const id of missing) {
			const p = await ctx.db.get(id);
			if (!p || p.retailerId !== retailerId) continue;
			const kind = datedKind(p);
			if (kind !== null) listings.set(p._id, toListing(p, kind));
		}

		// Counted, never described: a gated order holds its place on the row,
		// reported as waiting on credits, and nothing else about it is read.
		const gate = await creditGateFor(ctx, retailerId);
		const projected: ScheduleOrder[] = [];
		for (const o of orders) {
			// The reach-back above is for events that started before the window;
			// any OTHER order before it is outside what was asked for.
			if (
				o.fulfilmentDate !== undefined &&
				o.fulfilmentDate < fromMyt &&
				!startsSeededEvent(o, seedEvents)
			)
				continue;
			projected.push({
				status: o.status,
				paymentStatus: o.paymentStatus,
				fulfilmentDate: o.fulfilmentDate,
				deliveryMethod: o.deliveryMethod,
				bookingProductId: o.bookingProductId,
				free: isFreeOrder(o),
				items: o.items.map((i) => ({
					productId: i.productId,
					quantity: i.quantity,
				})),
				creditGated: isOrderGated(gate, o),
			});
		}

		return {
			rows: buildScheduleRows({ orders: projected, listings, seedEvents }),
			truncated,
		};
	},
});

/** Every listing id an order could be counted against. */
function listingIdsOf(o: Doc<"orders">): Id<"products">[] {
	const ids = o.items.map((i) => i.productId);
	if (o.bookingProductId) ids.push(o.bookingProductId);
	return ids;
}

/** Is this pre-window order an RSVP to an event that is still running? */
function startsSeededEvent(
	o: Doc<"orders">,
	seedEvents: readonly ScheduleListing[],
): boolean {
	return seedEvents.some(
		(e) =>
			e.event?.date === o.fulfilmentDate &&
			o.items.some((i) => i.productId === e._id),
	);
}
