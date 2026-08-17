/**
 * Booking requests — the buyer half of the booking kind (86eyj70z1, build S2
 * `86eyn4kbw`). A booking is an ORDER (same table, same lifecycle machinery)
 * created through its own mutation rather than a branch inside the 600-line
 * storefront `orders.create`: the two paths share almost no validation
 * (no cart, no delivery/pickup/fee resolution, no stock movement, no
 * confirmation push) and interleaving them would thread ~20 conditionals
 * through the hottest mutation in the app. Everything they DO share
 * (customer sanitation, id generation, usage metering, CRM linking,
 * orderedAt stamping) is imported from the same lib seams.
 *
 * The request lands as `booking_requested` — the locked carve-out from
 * confirm-at-create (scarce inventory needs vetting). Nothing is charged and
 * no WhatsApp is sent at request time; the seller's approve (S3) fires the
 * ONE confirmation + payment ask.
 */

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	internalMutation,
	mutation,
	type MutationCtx,
	query,
	type QueryCtx,
} from "./_generated/server";
import { linkOrderToCustomer } from "./customers";
import {
	assertValidBookingRange,
	BOOKING_HORIZON_DAYS,
	BOOKING_REQUEST_TTL_MS,
	countBookedPerNight,
	eachNight,
	findFullNights,
	MAX_AVAILABILITY_WINDOW_DAYS,
	MAX_BOOKING_NIGHTS,
	nightsBetween,
} from "./lib/bookingAvailability";
import { requireCustomerName } from "./lib/customer";
import {
	DAY_MS,
	formatFulfilmentDate,
	isMytMidnight,
} from "./lib/fulfilmentDate";
import {
	computeOrderTotals,
	generateShortId,
	generateTrackingToken,
} from "./lib/order";
import { effectiveKind } from "./lib/productKind";
import { stampProductsOrdered } from "./lib/productOrdered";
import { rateLimiter } from "./lib/rateLimiter";
import { assertValidMyMobile } from "./lib/slug";
import { applyStatusTransition, MAX_CUSTOMER_NOTE } from "./orders";
import { recordOrderCreated } from "./subscriptionUsage";

const SHORT_ID_RETRIES = 3;

/** Load + vet the bookable listing behind a public booking surface. */
async function loadBookableListing(
	ctx: QueryCtx | MutationCtx,
	productId: Doc<"products">["_id"],
): Promise<Doc<"products"> | null> {
	const product = await ctx.db.get(productId);
	if (!product) return null;
	if (effectiveKind(product.kind) !== "booking") return null;
	// Public-visibility rules mirror products.list: an archived or hidden
	// listing takes no requests, and one whose every category is hidden is off
	// the storefront too — the direct-mutation hole must not out-sell the UI.
	if (!product.active || product.hidden === true) return null;
	if (product.hiddenByCategory === true) return null;
	return product;
}

/**
 * Public month-window availability for one listing's calendar. BINARY per
 * night (locked: capacity counts never cross the public wire — a probe must
 * not learn "2 of 5 sites left"). Returns null for a listing that isn't
 * publicly bookable, which the route treats as 404 (no-leak posture).
 */
export const availability = query({
	args: {
		productId: v.id("products"),
		// MYT-midnight window [from, to) — the calendar asks month by month with
		// stable anchors (insights cache-discipline precedent; unaligned args are
		// a bug, not a preference, so they throw).
		from: v.number(),
		to: v.number(),
	},
	handler: async (
		ctx,
		args,
	): Promise<{
		// Nights inside [from, to) that can NOT take another booking (full —
		// and, from S4, seller-blocked: never distinguished). Everything else in
		// the window is open.
		unavailable: number[];
		// The calendar's own gates, so client + server can't disagree.
		noticeDays: number;
		horizonDays: number;
		maxNights: number;
	} | null> => {
		if (!isMytMidnight(args.from) || !isMytMidnight(args.to)) {
			throw new ConvexError("Availability window must be calendar days");
		}
		const windowDays = Math.round((args.to - args.from) / DAY_MS);
		if (windowDays < 1 || windowDays > MAX_AVAILABILITY_WINDOW_DAYS) {
			throw new ConvexError("Availability window too large");
		}
		const product = await loadBookableListing(ctx, args.productId);
		if (!product) return null;
		const retailer = await ctx.db.get(product.retailerId);
		if (!retailer) return null;

		const capacity = product.booking?.capacityPerNight ?? 1;
		const counts = await countBookedPerNight(
			ctx,
			product._id,
			args.from,
			args.to,
		);
		const unavailable = eachNight(args.from, args.to).filter(
			(night) => (counts.get(night) ?? 0) >= capacity,
		);
		return {
			unavailable,
			noticeDays: Math.max(
				retailer.minFulfilmentNoticeDays ?? 0,
				product.minNoticeDays ?? 0,
			),
			horizonDays: BOOKING_HORIZON_DAYS,
			maxNights: MAX_BOOKING_NIGHTS,
		};
	},
});

export const requestBooking = mutation({
	args: {
		retailerId: v.id("retailers"),
		productId: v.id("products"),
		// MYT midnights; checkOut exclusive — the stay occupies [checkIn, checkOut).
		checkIn: v.number(),
		checkOut: v.number(),
		customer: v.object({
			name: v.optional(v.string()),
			// REQUIRED here (validated below), unlike the storefront path's
			// protocol-optional phone: a request's whole lifecycle (approved +
			// payment ask, declined-with-reason, expiry) reaches the guest on
			// WhatsApp — a phone-less request would dead-end at approval.
			waPhone: v.optional(v.string()),
		}),
		customerNote: v.optional(v.string()),
	},
	handler: async (
		ctx,
		args,
	): Promise<{ shortId: string; trackingToken: string }> => {
		// Same public-endpoint throttle bucket as the storefront checkout.
		await rateLimiter.limit(ctx, "orderCreate", {
			key: args.retailerId,
			throws: true,
		});

		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const product = await loadBookableListing(ctx, args.productId);
		if (!product || product.retailerId !== args.retailerId) {
			throw new ConvexError("This listing isn't taking bookings right now");
		}

		// Guest identity — name required (same rule as every checkout) and a
		// reachable MY WhatsApp mobile required (see the args comment).
		const name = requireCustomerName(args.customer.name);
		if (!args.customer.waPhone) {
			throw new ConvexError("A WhatsApp number is required to request a booking");
		}
		let waPhone: string;
		try {
			waPhone = assertValidMyMobile(args.customer.waPhone);
		} catch (err) {
			throw new ConvexError((err as Error).message);
		}

		const trimmedNote = args.customerNote?.trim();
		if (trimmedNote && trimmedNote.length > MAX_CUSTOMER_NOTE) {
			throw new ConvexError(
				`Note must be ${MAX_CUSTOMER_NOTE} characters or fewer`,
			);
		}

		// The listing's single implicit variant carries the per-night price.
		const variants = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", product._id))
			.collect();
		const variant = variants.find((row) => row.active);
		if (!variant || variants.filter((row) => row.active).length !== 1) {
			// A booking listing is one implicit variant by construction (S1 wizard
			// + form); anything else is a corrupted row, not a buyer mistake.
			throw new ConvexError("This listing isn't taking bookings right now");
		}

		// Range gates — notice window is max(store, listing), same composition as
		// the fulfilment-date path.
		try {
			assertValidBookingRange(args.checkIn, args.checkOut, {
				noticeDays: Math.max(
					retailer.minFulfilmentNoticeDays ?? 0,
					product.minNoticeDays ?? 0,
				),
			});
		} catch (err) {
			throw new ConvexError((err as Error).message);
		}

		// Capacity — the authoritative re-check, atomically inside this mutation
		// (Convex serializes, so two buyers racing for the last spot can't both
		// pass; a block/booking landing mid-checkout surfaces here as the
		// friendly retry, never a silent failure).
		const fullNights = await findFullNights(
			ctx,
			product,
			args.checkIn,
			args.checkOut,
		);
		if (fullNights.length > 0) {
			throw new ConvexError(
				`${formatFulfilmentDate(fullNights[0])} is no longer available — pick different dates`,
			);
		}

		const nights = nightsBetween(args.checkIn, args.checkOut);
		const items = [
			{
				productId: product._id,
				variantId: variant._id,
				name: product.name,
				variantLabel: undefined,
				// Per-night price × nights via the standard quantity math, so every
				// money surface (totals, CSV, insights, receipts) reads the stay as
				// "listing × nights" with zero special-casing.
				price: variant.price,
				quantity: nights,
			},
		];
		const { subtotal, total } = computeOrderTotals(items, {});
		const now = Date.now();

		let shortId: string | null = null;
		for (let attempt = 0; attempt < SHORT_ID_RETRIES; attempt++) {
			const candidate = generateShortId();
			const existing = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", candidate))
				.first();
			if (!existing) {
				shortId = candidate;
				break;
			}
		}
		if (!shortId)
			throw new ConvexError("Failed to generate unique order ID, please retry");
		const trackingToken = generateTrackingToken();

		const orderId = await ctx.db.insert("orders", {
			retailerId: args.retailerId,
			shortId,
			trackingToken,
			items,
			subtotal,
			total,
			currency: product.currency,
			status: "booking_requested",
			channel: "whatsapp",
			source: "storefront",
			customer: { name, waPhone },
			deliveryMethod: "booking",
			bookingCheckIn: args.checkIn,
			bookingCheckOut: args.checkOut,
			bookingProductId: product._id,
			// The check-in day IS the order's due date — the inbox sort, due-today
			// strip and urgency badges all read fulfilmentDate, so a request for
			// this weekend surfaces exactly like an order due this weekend.
			fulfilmentDate: args.checkIn,
			customerNote:
				trimmedNote && trimmedNote.length > 0 ? trimmedNote : undefined,
			// No confirmationPushStatus: nothing is pushed at request time (the
			// approve fires the one message, S3) — and leaving it unset keeps the
			// unseen-order machinery keyed to push-path orders only; the New
			// bucket routes on the status itself.
			statusChangedAt: now,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("orderEvents", {
			orderId,
			status: "booking_requested",
			createdAt: now,
		});

		// Same bookkeeping as any created order: usage meter (soft cap), the
		// sold-once stamp (protects the listing from permanent delete), CRM link.
		await recordOrderCreated(ctx, args.retailerId, now);
		await stampProductsOrdered(ctx, items, now);
		await linkOrderToCustomer(ctx, {
			retailerId: args.retailerId,
			waPhone,
			orderId,
			orderTotal: total,
			orderCreatedAt: now,
			customerName: name,
		});

		// Seller attention: the standard new-order email (booking-aware copy is
		// S3's sweep) + the WhatsApp approve/decline alert (S3). Browser alerts
		// ride the client's existing new-order watch for free.
		await ctx.scheduler.runAfter(0, internal.email.notifyRetailerOrderAlert, {
			orderId,
		});

		return { shortId, trackingToken };
	},
});

/**
 * Release requests the seller never actioned (86eyj70z1 decision 3: default
 * 24 h, promised to the buyer up front). Runs on a cron; cancellation rides
 * `applyStatusTransition`, so the hold release, CRM/usage reversal, timeline
 * event and buyer notice all follow the one cancel path.
 */
export const expireStaleRequests = internalMutation({
	args: {},
	handler: async (ctx): Promise<void> => {
		const cutoff = Date.now() - BOOKING_REQUEST_TTL_MS;
		// Bounded batch; the cron cadence drains any backlog. _creationTime is
		// the index's implicit trailing key, so this reads exactly the stale rows.
		const stale = await ctx.db
			.query("orders")
			.withIndex("by_status", (q) =>
				q.eq("status", "booking_requested").lt("_creationTime", cutoff),
			)
			.take(50);
		for (const order of stale) {
			await applyStatusTransition(ctx, order, "cancelled", {
				note: "Booking request expired — not answered within 24 hours",
			});
		}
	},
});
