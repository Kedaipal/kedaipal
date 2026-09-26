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
	bookingsOverlapping,
	eachNight,
	occupiesNight,
	isNightBlocked,
	loadBlocksForWindow,
	MAX_BLOCK_DAYS,
} from "./lib/bookingAvailability";
import {
	type ClosedDateRange,
	isClosedDate,
	upcomingClosures,
} from "./lib/closedDates";
import { DAY_MS, isMytMidnight } from "./lib/fulfilmentDate";
import { closedWeekdays } from "./lib/openingHours";
import {
	type OrderFlows,
	resolveStatusLabel,
	type StatusLabels,
} from "./lib/orderStatus";
import { effectiveKind, type PackageUnit } from "./lib/productKind";
import { assertSubscriptionActive } from "./subscriptions";

const BLOCK_NOTE_MAX = 200;
/** Calendar reads are month-window scans — same bound as availability. */
const MAX_CALENDAR_WINDOW_DAYS = 92;

/** Names carried per night before the cell falls back to "+N more". Three
 * fits the desktop cell; the count stays exact either way. */
const GUESTS_PER_NIGHT = 3;

/**
 * Does this store sell any booking listings? The Orders header shows the
 * Inbox · Calendar toggle only when the answer is yes — a non-booking store
 * never sees a calendar it has nothing to put on. Tiny read (products are
 * capped at 200/store).
 */
export const hasBookingListings = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<boolean> => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			area: "bookings",
			level: "read",
		});
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
		const access = await requireRetailerAccess(ctx, args.retailerId, {
			area: "bookings",
			level: "write",
		});
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
		const access = await requireRetailerAccess(ctx, block.retailerId, {
			area: "bookings",
			level: "write",
		});
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
			/** A store closed date covers this day (z8r3fdhpm7). Store-wide, so
			 * it is set whatever listing is in scope — the seller sees the
			 * closure on every view of the month. */
			closed: boolean;
			/** Who is on this night, in check-in order, capped at
			 * `GUESTS_PER_NIGHT` with the rest carried in `booked`. The desktop
			 * grid's whole job is seeing WHO is booked at a glance; a bare count
			 * makes the seller tap every cell to find out. */
			guests: Array<{ shortId: string; name: string }>;
		}>;
		capacityPerNight?: number;
		/** The store's currency, so the listing cards can print a price without
		 * a second read. */
		currency: string;
		blocks: Array<{
			_id: Id<"bookingBlocks">;
			productId?: Id<"products">;
			startDate: number;
			endDate: number;
			note?: string;
		}>;
		/** The store's upcoming closed dates (z8r3fdhpm7): the cells' labels,
		 * the day sheet's "why", and the overlap note when the seller closes
		 * more dates from here. */
		closures: ClosedDateRange[];
		/** The store's weekly days off (0 = Sun). A package can't start on one,
		 * and an open-days listing steps over them — so the seller's grid marks
		 * them where the selected listing skips them, and the block sheet
		 * judges starts with them. */
		closedWeekdays: number[];
		listings: Array<{
			_id: Id<"products">;
			name: string;
			/** Cover photo for the listing card. Resolved live, never frozen —
			 * a replaced photo shows the new one, a deleted one degrades to
			 * AppImage's fallback. */
			imageUrl: string | null;
			price?: number;
			capacityPerNight?: number;
			packageLength?: number;
			packageUnit?: PackageUnit;
			/** Counts only open days (z8r3fdhpm7). Without it `closureRule` on
			 * the client read every open-days listing as an every-day one, so the
			 * block sheet quoted the wrong starts and the wrong rule. */
			skipsClosedDays?: boolean;
		}>;
	}> => {
		const access = await requireRetailerAccess(ctx, args.retailerId, {
			area: "bookings",
			level: "read",
		});
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
		// ONE scan per listing serves both the count and the names — the seller
		// grid needs who, not just how many, and a second pass for the names
		// would be a second look-back bound to get wrong.
		const totals = new Map<number, number>();
		const guestsByNight = new Map<number, Array<{ shortId: string; name: string }>>();
		for (const listing of scoped) {
			for (const order of await bookingsOverlapping(
				ctx,
				listing._id,
				args.from,
				args.to,
			)) {
				const checkIn = order.bookingCheckIn as number;
				const checkOut = order.bookingCheckOut as number;
				for (
					let night = Math.max(checkIn, args.from);
					night < Math.min(checkOut, args.to);
					night += DAY_MS
				) {
					// A day an open-days package skips isn't one the member is
					// there (z8r3fdhpm7) — no count, no name on the grid.
					if (!occupiesNight(order, night)) continue;
					totals.set(night, (totals.get(night) ?? 0) + 1);
					const named = guestsByNight.get(night) ?? [];
					if (named.length < GUESTS_PER_NIGHT) {
						named.push({
							shortId: order.shortId,
							name: order.customer.name?.trim() || "Guest",
						});
						guestsByNight.set(night, named);
					}
				}
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
			guests: guestsByNight.get(date) ?? [],
			blocked:
				args.productId !== undefined
					? isNightBlocked(visibleBlocks, date, args.productId)
					: visibleBlocks.some(
							(b) => date >= b.startDate && date <= b.endDate,
						),
			closed: isClosedDate(access.retailer.closedDates, date),
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
			currency: access.retailer.currency ?? "MYR",
			blocks: visibleBlocks.map((b) => ({
				_id: b._id,
				productId: b.productId,
				startDate: b.startDate,
				endDate: b.endDate,
				note: b.note,
			})),
			closures: upcomingClosures(access.retailer.closedDates),
			closedWeekdays: closedWeekdays(access.retailer.openingHours),
			listings: await Promise.all(
				bookingListings.map(async (p) => ({
					_id: p._id,
					name: p.name,
					imageUrl: p.imageStorageIds[0]
						? await ctx.storage.getUrl(p.imageStorageIds[0])
						: null,
					price: (
						await ctx.db
							.query("productVariants")
							.withIndex("by_product", (q) => q.eq("productId", p._id))
							.first()
					)?.price,
					capacityPerNight: p.booking?.capacityPerNight,
					packageLength: p.booking?.packageLength,
					packageUnit: p.booking?.packageUnit,
					skipsClosedDays: p.booking?.skipsClosedDays,
				})),
			),
		};
	},
});

/** Named guests shown before a block is confirmed; the rest become "+N more". */
const BLOCK_IMPACT_SAMPLES = 4;

/**
 * What a block the seller is ABOUT to place would land on top of.
 *
 * Blocking never cancels anything (locked: it stops NEW requests only), so the
 * honest design is to state the consequence rather than refuse the action — a
 * seller closing for a flood must not be told to cancel their existing guests
 * first. The confirm sheet used to say only a generic "bookings already on
 * these nights stay", which is true but leaves the seller guessing whether that
 * means nobody or forty people.
 *
 * Scope mirrors `blockDays`: `productId` unset = the whole store, so the count
 * spans every booking listing exactly as the block itself would.
 */
export const blockImpact = query({
	args: {
		retailerId: v.id("retailers"),
		productId: v.optional(v.id("products")),
		startDate: v.number(),
		endDate: v.number(),
	},
	handler: async (
		ctx,
		args,
	): Promise<{
		count: number;
		samples: Array<{ shortId: string; customerName?: string }>;
	}> => {
		const access = await requireRetailerAccess(ctx, args.retailerId, {
			area: "bookings",
			level: "read",
		});
		if (!isMytMidnight(args.startDate) || !isMytMidnight(args.endDate)) {
			throw new ConvexError("Blocked days must be calendar days");
		}
		if (args.endDate < args.startDate) return { count: 0, samples: [] };
		const days = Math.round((args.endDate - args.startDate) / DAY_MS) + 1;
		if (days > MAX_BLOCK_DAYS) {
			throw new ConvexError("That range is longer than a block can cover");
		}
		// endDate is INCLUSIVE for a block (no leaving morning); a stay occupies
		// [checkIn, checkOut). They overlap when the stay starts on or before the
		// block's last day and ends after its first.
		const blockEndExclusive = args.endDate + DAY_MS;

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

		const seen = new Set<string>();
		const samples: Array<{ shortId: string; customerName?: string }> = [];
		for (const listing of scoped) {
			// THE shared bounded scan, so a long package that started months ago
			// still counts against a block placed over it.
			const holders = await bookingsOverlapping(
				ctx,
				listing._id,
				args.startDate,
				blockEndExclusive,
			);
			for (const order of holders) {
				if (seen.has(order.shortId)) continue;
				seen.add(order.shortId);
				if (samples.length < BLOCK_IMPACT_SAMPLES) {
					samples.push({
						shortId: order.shortId,
						customerName: order.customer.name,
					});
				}
			}
		}
		return { count: seen.size, samples };
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
			/** The status as the seller's own order pages name it (their renames,
			 * the package vocabulary) — the raw key rendered "Booking_requested". */
			statusLabel: string;
			/** Paid or not — the sheet exists to help the seller decide WHICH
			 * order to open, and "has this one paid" is the question they open it
			 * for most often. */
			paymentStatus?: Doc<"orders">["paymentStatus"];
			/** Which listing, for the all-listings view where two campsites'
			 * guests share a night and the name alone doesn't say whose. */
			listingName: string;
			/** A package reads as a validity window, a stay as check-in → out. */
			packaged: boolean;
			/** The shut days an open-days package steps over, so "day 2 of 4"
			 * counts the days the member actually comes. */
			skippedDays?: number[];
		}>
	> => {
		const access = await requireRetailerAccess(ctx, args.retailerId, {
			area: "bookings",
			level: "read",
		});
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
			statusLabel: string;
			paymentStatus?: Doc<"orders">["paymentStatus"];
			listingName: string;
			packaged: boolean;
			skippedDays?: number[];
		}> = [];
		for (const listing of scoped) {
			// THE shared bounded scan — never a hand-rolled look-back here again.
			const holders = await bookingsOverlapping(
				ctx,
				listing._id,
				args.date,
				args.date + DAY_MS,
			);
			for (const order of holders) {
				// Nobody on an open-days package is here on a day it skips.
				if (!occupiesNight(order, args.date)) continue;
				rows.push({
					shortId: order.shortId,
					customerName: order.customer.name,
					checkIn: order.bookingCheckIn as number,
					checkOut: order.bookingCheckOut as number,
					status: order.status,
					statusLabel: resolveStatusLabel(order.status, {
						labels: access.retailer.statusLabels as StatusLabels | undefined,
						orderFlows: access.retailer.orderFlows as OrderFlows | undefined,
						deliveryMethod: "booking",
						bookingPackaged: order.bookingPackaged === true,
						locale: "en",
					}),
					paymentStatus: order.paymentStatus,
					listingName: listing.name,
					packaged: order.bookingPackaged === true,
					skippedDays: order.bookingSkippedDays,
				});
			}
		}
		rows.sort((a, b) => a.checkIn - b.checkIn);
		return rows;
	},
});
