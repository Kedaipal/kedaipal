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

		// Every order event carries a deep link back to the dashboard, as BOTH
		// URL and DESCRIPTION — Google renders `URL` inconsistently (mobile
		// often drops it), and the point is one tap from the calendar to the
		// order. The target is Clerk-gated, so a forwarded feed still can't open
		// it and the link leaks nothing beyond a shortId.
		expect(feed).toContain(`URL:https://kedaipal.com/app/orders/${approved.shortId}`);
		expect(feed).toContain(
			`DESCRIPTION:Open in Kedaipal: https://kedaipal.com/app/orders/${approved.shortId}`,
		);
		// A BLOCK is not an order — it has nothing to open, so it gets no link.
		const blockEvent = feed
			.split("BEGIN:VEVENT")
			.find((chunk) => chunk.includes("SUMMARY:Blocked"));
		expect(blockEvent).toBeDefined();
		expect(blockEvent).not.toContain("URL:");
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

describe("calendarFeed — every order, not just bookings", () => {
	/** A plain (non-booking) store + product, the cake-seller shape. */
	async function seedPlainStore(t: ReturnType<typeof convexTest>) {
		const asOwner = t.withIdentity({ subject: "user_plain_feed" });
		await asOwner.mutation(api.retailers.createRetailer, {
			storeName: "Sue Chef Kitchen",
			slug: "sue-chef-feed",
		});
		const retailer = await asOwner.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		const productId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Chocolate Cake",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 12_000, onHand: 20 }],
		});
		const withVariants = await asOwner.query(api.products.get, { productId });
		const variantId = withVariants?.variants[0]?._id;
		if (!variantId) throw new Error("variant missing");
		return { t, asOwner, retailer, productId, variantId };
	}

	test("an ordinary order due in the window lands on the calendar", async () => {
		const ctx = await seedPlainStore(setup());
		await ctx.t.mutation(api.orders.create, {
			retailerId: ctx.retailer._id,
			items: [{ productId: ctx.productId, variantId: ctx.variantId, quantity: 2 }],
			currency: "MYR",
			customer: { name: "Aisha", waPhone: "0123456781" },
			deliveryMethod: "self_collect",
			channel: "whatsapp",
			fulfilmentDate: day(4),
		});
		const token = await ctx.asOwner.mutation(
			api.calendarFeed.ensureCalendarFeedToken,
			{ retailerId: ctx.retailer._id },
		);
		const feed = await ctx.t.query(internal.calendarFeed.feedByToken, { token });
		if (feed === null) throw new Error("feed missing");
		// Named by customer + what they ordered, on the day it's due.
		expect(feed).toContain("SUMMARY:Aisha — Chocolate Cake ×2");
		expect(feed).toContain("DTSTART;VALUE=DATE:");
		// The no-phone promise holds for ordinary orders too.
		expect(feed).not.toMatch(/6?01\d{8}/);
	});

	test("an order with a time becomes a TIMED event, not all-day", async () => {
		const ctx = await seedPlainStore(setup());
		await ctx.t.mutation(api.orders.create, {
			retailerId: ctx.retailer._id,
			items: [{ productId: ctx.productId, variantId: ctx.variantId, quantity: 1 }],
			currency: "MYR",
			customer: { name: "Farah", waPhone: "0123456782" },
			// A fulfilment TIME is delivery-only by design (a pickup point's
			// hours live on its own schedule note), so this has to be a delivery.
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "12 Jln Mawar 3",
				city: "Petaling Jaya",
				state: "Selangor",
				postcode: "47301",
			},
			channel: "whatsapp",
			fulfilmentDate: day(3),
			// 15:30 MYT — which is 07:30 UTC, since MY is UTC+8 with no DST.
			fulfilmentTimeMinutes: 15 * 60 + 30,
		});
		const token = await ctx.asOwner.mutation(
			api.calendarFeed.ensureCalendarFeedToken,
			{ retailerId: ctx.retailer._id },
		);
		const feed = await ctx.t.query(internal.calendarFeed.feedByToken, { token });
		if (feed === null) throw new Error("feed missing");
		expect(feed).toMatch(/DTSTART:\d{8}T073000Z/);
		expect(feed).toContain("SUMMARY:Farah — Chocolate Cake");
	});

	test("cancelled orders are off the calendar", async () => {
		const ctx = await seedPlainStore(setup());
		const { shortId } = await ctx.t.mutation(api.orders.create, {
			retailerId: ctx.retailer._id,
			items: [{ productId: ctx.productId, variantId: ctx.variantId, quantity: 1 }],
			currency: "MYR",
			customer: { name: "Zara", waPhone: "0123456783" },
			deliveryMethod: "self_collect",
			channel: "whatsapp",
			fulfilmentDate: day(6),
		});
		const order = await ctx.asOwner.query(api.orders.get, { shortId });
		if (!order) throw new Error("order missing");
		await ctx.asOwner.mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "cancelled",
		});
		const token = await ctx.asOwner.mutation(
			api.calendarFeed.ensureCalendarFeedToken,
			{ retailerId: ctx.retailer._id },
		);
		const feed = await ctx.t.query(internal.calendarFeed.feedByToken, { token });
		expect(feed).not.toContain("Zara");
	});

	test("a booking is drawn ONCE — across its stay, not again on its due date", async () => {
		const ctx = await seedBookingStore(setup());
		const { shortId } = await ctx.t.mutation(api.bookings.requestBooking, {
			retailerId: ctx.retailer._id,
			productId: ctx.productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: { name: "Aisha", waPhone: "0123456784" },
		});
		const order = await ctx.asOwner.query(api.orders.get, { shortId });
		if (!order) throw new Error("order missing");
		await ctx.asOwner.mutation(api.bookings.approveBookingRequest, {
			orderId: order._id,
		});
		const token = await ctx.asOwner.mutation(
			api.calendarFeed.ensureCalendarFeedToken,
			{ retailerId: ctx.retailer._id },
		);
		const feed = await ctx.t.query(internal.calendarFeed.feedByToken, { token });
		if (feed === null) throw new Error("feed missing");
		// The booking pass owns it; the all-orders pass must skip it, or the
		// stay would be shadowed by a stray all-day event on the check-in day.
		expect(feed.split("BEGIN:VEVENT").length - 1).toBe(1);
		expect(feed).toContain(`UID:booking-${shortId}@kedaipal.com`);
		expect(feed).not.toContain(`UID:order-${shortId}@kedaipal.com`);
	});
});
