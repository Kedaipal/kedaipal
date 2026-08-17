/// <reference types="vite/client" />
/**
 * Calendar feed (booking S6, `86eyn4kf2`): token mint/rotate (rotation kills
 * the old URL), the feed's event set (approved stays + blocks; requests and
 * cancellations excluded), and the no-phone promise — a feed URL can be
 * forwarded, so guest names are the only PII it may carry.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_feed_seller";
const today = () => todayMytMidnight(Date.now());
const day = (offset: number) => today() + offset * DAY_MS;

async function seedBookingStore(t: ReturnType<typeof convexTest>) {
	const asOwner = t.withIdentity({ subject: USER });
	await asOwner.mutation(api.retailers.createRetailer, {
		storeName: "Lembah Riverside Camp",
		slug: "lembah-riverside",
	});
	const retailer = await asOwner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	const productId = await asOwner.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Riverside Plot",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		kind: "booking" as const,
		booking: { capacityPerNight: 3 },
		variants: [{ optionValues: [], price: 8000, onHand: 0 }],
	});
	return { t, asOwner, retailer, productId };
}

async function requestAndGet(
	ctx: Awaited<ReturnType<typeof seedBookingStore>>,
	opts: { checkIn: number; checkOut: number; name: string; phone: string },
) {
	const { shortId } = await ctx.t.mutation(api.bookings.requestBooking, {
		retailerId: ctx.retailer._id,
		productId: ctx.productId,
		checkIn: opts.checkIn,
		checkOut: opts.checkOut,
		customer: { name: opts.name, waPhone: opts.phone },
	});
	const order = await ctx.asOwner.query(api.orders.get, { shortId });
	if (!order) throw new Error("order missing");
	return order;
}

describe("calendarFeed tokens", () => {
	test("ensure is idempotent; rotate kills the old URL", async () => {
		const ctx = await seedBookingStore(setup());
		const first = await ctx.asOwner.mutation(
			api.calendarFeed.ensureCalendarFeedToken,
			{ retailerId: ctx.retailer._id },
		);
		const second = await ctx.asOwner.mutation(
			api.calendarFeed.ensureCalendarFeedToken,
			{ retailerId: ctx.retailer._id },
		);
		expect(second).toBe(first);
		expect(
			await ctx.t.query(internal.calendarFeed.feedByToken, { token: first }),
		).not.toBeNull();
		const rotated = await ctx.asOwner.mutation(
			api.calendarFeed.rotateCalendarFeedToken,
			{ retailerId: ctx.retailer._id },
		);
		expect(rotated).not.toBe(first);
		// The old URL answers nothing; the new one serves the feed.
		expect(
			await ctx.t.query(internal.calendarFeed.feedByToken, { token: first }),
		).toBeNull();
		expect(
			await ctx.t.query(internal.calendarFeed.feedByToken, {
				token: rotated,
			}),
		).not.toBeNull();
		// A stranger can't mint for someone else's store.
		const asStranger = ctx.t.withIdentity({ subject: "user_not_owner" });
		await expect(
			asStranger.mutation(api.calendarFeed.ensureCalendarFeedToken, {
				retailerId: ctx.retailer._id,
			}),
		).rejects.toThrow();
	});

	test("getCalendarFeed reports token + booking-listing presence", async () => {
		const ctx = await seedBookingStore(setup());
		let feed = await ctx.asOwner.query(api.calendarFeed.getCalendarFeed, {
			retailerId: ctx.retailer._id,
		});
		expect(feed).toEqual({ token: null, hasBookingListings: true });
		const token = await ctx.asOwner.mutation(
			api.calendarFeed.ensureCalendarFeedToken,
			{ retailerId: ctx.retailer._id },
		);
		feed = await ctx.asOwner.query(api.calendarFeed.getCalendarFeed, {
			retailerId: ctx.retailer._id,
		});
		expect(feed.token).toBe(token);
	});
});

describe("calendarFeed content", () => {
	test("approved stays + blocks appear; requests, cancels and phones never do", async () => {
		const ctx = await seedBookingStore(setup());
		// Approved 2-night stay.
		const approved = await requestAndGet(ctx, {
			checkIn: day(3),
			checkOut: day(5),
			name: "Aisha, the regular",
			phone: "0123456781",
		});
		await ctx.asOwner.mutation(api.bookings.approveBookingRequest, {
			orderId: approved._id,
		});
		// Still-pending request — excluded (24 h clock vs Google's daily one).
		await requestAndGet(ctx, {
			checkIn: day(8),
			checkOut: day(9),
			name: "Pending Guest",
			phone: "0123456782",
		});
		// Declined request — cancelled, excluded.
		const declined = await requestAndGet(ctx, {
			checkIn: day(10),
			checkOut: day(11),
			name: "Declined Guest",
			phone: "0123456783",
		});
		await ctx.asOwner.mutation(api.bookings.declineBookingRequest, {
			orderId: declined._id,
			reason: "Closed that week",
		});
		// A per-listing block with a note.
		await ctx.asOwner.mutation(api.bookingBlocks.blockDays, {
			retailerId: ctx.retailer._id,
			productId: ctx.productId,
			startDate: day(15),
			endDate: day(16),
			note: "Maintenance",
		});

		const token = await ctx.asOwner.mutation(
			api.calendarFeed.ensureCalendarFeedToken,
			{ retailerId: ctx.retailer._id },
		);
		const feed = await ctx.t.query(internal.calendarFeed.feedByToken, {
			token,
		});
		if (feed === null) throw new Error("feed missing");

		// The approved stay: guest name + listing, comma escaped, exclusive end.
		expect(feed).toContain(`UID:booking-${approved.shortId}@kedaipal.com`);
		expect(feed).toContain("SUMMARY:Aisha\\, the regular — Riverside Plot");
		// The block: labelled, listing-scoped, inclusive end +1 day.
		expect(feed).toContain("SUMMARY:Blocked — Riverside Plot (Maintenance)");
		// Excluded rows.
		expect(feed).not.toContain("Pending Guest");
		expect(feed).not.toContain("Declined Guest");
		// The no-phone promise — no buyer number anywhere in the document.
		expect(feed).not.toMatch(/6?01\d{8}/);
	});

	test("unknown token answers null (the route 404s with no detail)", async () => {
		const ctx = await seedBookingStore(setup());
		expect(
			await ctx.t.query(internal.calendarFeed.feedByToken, {
				token: "nosuchtokenatall123",
			}),
		).toBeNull();
	});
});
