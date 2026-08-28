/**
 * Seller block-days + the month-view calendar reads (booking bundle S4,
 * `86eyn4kdb`; spec 86eyj70z1 decision 8). The calendar is a LENS over the
 * orders — block/unblock is its ONE write action; managing a booking happens
 * on the order. Blocks stop NEW requests only (the availability module unions
 * them with capacity), never cancel existing bookings, and are invisible as
 * blocks to buyers (blocked ≡ full, locked).
 */

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireRetailerAccess, logAdminAction } from "./lib/auth";
import {
	countBookedPerNight,
	eachNight,
	isNightBlocked,
	loadBlocksForWindow,
	MAX_BLOCK_DAYS,
} from "./lib/bookingAvailability";
import { DAY_MS, isMytMidnight } from "./lib/fulfilmentDate";
import { effectiveKind } from "./lib/productKind";
import { assertSubscriptionActive } from "./subscriptions";

const BLOCK_NOTE_MAX = 200;
/** Calendar reads are month-window scans — same bound as availability. */
const MAX_CALENDAR_WINDOW_DAYS = 92;

/**
 * Does this store sell any booking listings? The Orders header shows the
 * Inbox · Calendar toggle only when the answer is yes — a non-booking store
 * never sees a calendar it has nothing to put on. Tiny read (products are
 * capped at 200/store).
 */
export const hasBookingListings = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<boolean> => {
		const access = await requireRetailerAccess(ctx, retailerId);
		const products = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", access.retailer._id).eq("active", true),
			)
			.collect();
		return products.some((p) => effectiveKind(p.kind) === "booking");
	},
});

/**
 * Block a run of nights. `productId` unset = the whole store; set = one
 * booking listing (validated). startDate/endDate MYT midnights, END-INCLUSIVE
 * (single day = start === end). Overlaps with existing blocks are tolerated —
 * union happens at read (spec recommendation; merging rows here would make
 * unblock ambiguous).
 */
export const blockDays = mutation({
	args: {
		retailerId: v.id("retailers"),
		productId: v.optional(v.id("products")),
		startDate: v.number(),
		endDate: v.number(),
		note: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<Id<"bookingBlocks">> => {
		const access = await requireRetailerAccess(ctx, args.retailerId);
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, args.retailerId);

		if (!isMytMidnight(args.startDate) || !isMytMidnight(args.endDate)) {
			throw new ConvexError("Blocked days must be calendar days");
		}
		if (args.endDate < args.startDate) {
			throw new ConvexError("The block's end can't be before its start");
		}
		const days = Math.round((args.endDate - args.startDate) / DAY_MS) + 1;
		if (days > MAX_BLOCK_DAYS) {
			throw new ConvexError(
				`Blocks are limited to ${MAX_BLOCK_DAYS} days — add another block for a longer closure`,
			);
		}
		if (args.productId !== undefined) {
			const product = await ctx.db.get(args.productId);
			if (
				!product ||
				product.retailerId !== args.retailerId ||
				effectiveKind(product.kind) !== "booking"
			) {
				throw new ConvexError("That listing can't be blocked");
			}
		}
		const note = args.note?.trim();
		if (note && note.length > BLOCK_NOTE_MAX) {
			throw new ConvexError(
				`Keep the note under ${BLOCK_NOTE_MAX} characters`,
			);
		}

		const blockId = await ctx.db.insert("bookingBlocks", {
			retailerId: args.retailerId,
			productId: args.productId,
			startDate: args.startDate,
			endDate: args.endDate,
			note: note && note.length > 0 ? note : undefined,
			createdAt: Date.now(),
		});
		await logAdminAction(ctx, access, "bookingBlocks.block", blockId);
		return blockId;
	},
});

export const unblock = mutation({
	args: { blockId: v.id("bookingBlocks") },
	handler: async (ctx, { blockId }): Promise<void> => {
		const block = await ctx.db.get(blockId);
		if (!block) return; // already gone — unblock is idempotent
		const access = await requireRetailerAccess(ctx, block.retailerId);
		if (!access.actingAsAdmin)
			await assertSubscriptionActive(ctx, block.retailerId);
		await ctx.db.delete(blockId);
		await logAdminAction(ctx, access, "bookingBlocks.unblock", blockId);
	},
});

/**
 * One month-window read for the seller calendar: per-day booked counts +
 * block coverage, plus the raw block rows (the unblock sheet needs ids and
 * notes). Filtered to one listing when `productId` is set — that's when the
 * capacity denominator is honest; the all-listings view shows counts only
 * (summing capacity across different products is fake math, design decision).
 */
export const sellerCalendar = query({
	args: {
		retailerId: v.id("retailers"),
		from: v.number(),
		to: v.number(),
		productId: v.optional(v.id("products")),
	},
	handler: async (
		ctx,
		args,
	): Promise<{
		days: Array<{
			date: number;
			booked: number;
			blocked: boolean;
		}>;
		capacityPerNight?: number;
		blocks: Array<{
			_id: Id<"bookingBlocks">;
			productId?: Id<"products">;
			startDate: number;
			endDate: number;
			note?: string;
		}>;
		listings: Array<{ _id: Id<"products">; name: string }>;
	}> => {
		const access = await requireRetailerAccess(ctx, args.retailerId);
		if (!isMytMidnight(args.from) || !isMytMidnight(args.to)) {
			throw new ConvexError("Calendar window must be calendar days");
		}
		const windowDays = Math.round((args.to - args.from) / DAY_MS);
		if (windowDays < 1 || windowDays > MAX_CALENDAR_WINDOW_DAYS) {
			throw new ConvexError("Calendar window too large");
		}

		// The store's booking listings — the filter chips + per-listing counts.
		const products = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", access.retailer._id).eq("active", true),
			)
			.collect();
		const bookingListings = products.filter(
			(p) => effectiveKind(p.kind) === "booking",
		);
		const scoped =
			args.productId !== undefined
				? bookingListings.filter((p) => p._id === args.productId)
				: bookingListings;

		// Booked counts per night, summed across the scoped listings (each
		// listing's counts come off the same indexed scan the buyer calendar
		// uses — one authority).
		const totals = new Map<number, number>();
		for (const listing of scoped) {
			const counts = await countBookedPerNight(
				ctx,
				listing._id,
				args.from,
				args.to,
			);
			for (const [night, count] of counts) {
				totals.set(night, (totals.get(night) ?? 0) + count);
			}
		}

		const blocks = await loadBlocksForWindow(
			ctx,
			access.retailer._id,
			args.from,
			args.to,
		);
		const visibleBlocks =
			args.productId !== undefined
				? blocks.filter(
						(b) => b.productId === undefined || b.productId === args.productId,
					)
				: blocks;

		const days = eachNight(args.from, args.to).map((date) => ({
			date,
			booked: totals.get(date) ?? 0,
			blocked:
				args.productId !== undefined
					? isNightBlocked(visibleBlocks, date, args.productId)
					: visibleBlocks.some(
							(b) => date >= b.startDate && date <= b.endDate,
						),
		}));

		return {
			days,
			// Undefined = no honest denominator to show: either the view spans
			// several listings, or this one has UNLIMITED capacity (S7). The grid
			// renders a bare count in both cases.
			capacityPerNight:
				args.productId !== undefined
					? scoped[0]?.booking?.capacityPerNight
					: undefined,
			blocks: visibleBlocks.map((b) => ({
				_id: b._id,
				productId: b.productId,
				startDate: b.startDate,
				endDate: b.endDate,
				note: b.note,
			})),
			listings: bookingListings.map((p) => ({ _id: p._id, name: p.name })),
		};
	},
});

/**
 * One day's bookings for the tap-through sheet — rows open the order
 * (calendar-is-a-lens: managing a booking happens there).
 */
export const dayBookings = query({
	args: {
		retailerId: v.id("retailers"),
		date: v.number(),
		productId: v.optional(v.id("products")),
	},
	handler: async (
		ctx,
		args,
	): Promise<
		Array<{
			shortId: string;
			customerName?: string;
			checkIn: number;
			checkOut: number;
			status: Doc<"orders">["status"];
		}>
	> => {
		const access = await requireRetailerAccess(ctx, args.retailerId);
		if (!isMytMidnight(args.date)) {
			throw new ConvexError("Pick a calendar day");
		}
		const products = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", access.retailer._id).eq("active", true),
			)
			.collect();
		const scoped = products.filter(
			(p) =>
				effectiveKind(p.kind) === "booking" &&
				(args.productId === undefined || p._id === args.productId),
		);
		const rows: Array<{
			shortId: string;
			customerName?: string;
			checkIn: number;
			checkOut: number;
			status: Doc<"orders">["status"];
		}> = [];
		for (const listing of scoped) {
			// Same bounded overlap scan as the availability counts.
			const holders = await ctx.db
				.query("orders")
				.withIndex("by_booking_product", (q) =>
					q
						.eq("bookingProductId", listing._id)
						.gte("bookingCheckIn", args.date - 30 * DAY_MS)
						.lte("bookingCheckIn", args.date),
				)
				.collect();
			for (const order of holders) {
				if (order.status === "cancelled") continue;
				if (
					order.bookingCheckIn === undefined ||
					order.bookingCheckOut === undefined
				)
					continue;
				if (
					order.bookingCheckIn > args.date ||
					order.bookingCheckOut <= args.date
				)
					continue;
				rows.push({
					shortId: order.shortId,
					customerName: order.customer.name,
					checkIn: order.bookingCheckIn,
					checkOut: order.bookingCheckOut,
					status: order.status,
				});
			}
		}
		rows.sort((a, b) => a.checkIn - b.checkIn);
		return rows;
	},
});
