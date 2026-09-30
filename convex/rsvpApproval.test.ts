/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { BOOKING_REQUEST_TTL_MS } from "./lib/bookingAvailability";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import { sanitizeEvent } from "./lib/productEvent";
import schema from "./schema";

/**
 * "Approve each RSVP before the guest pays" (`z8r3fdkjek`) — an RSVP on such
 * an event lands as `booking_requested` (the generic awaiting-approval status
 * bookings already use): seat held, nothing payable, until the seller
 * approves; decline/expiry frees the seat through the one cancel path.
 */

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_rsvp_host";
const EVENT_DATE = todayMytMidnight() + 9 * DAY_MS;

async function seed(
	t: ReturnType<typeof setup>,
	opts: { requiresApproval?: boolean; price?: number } = {},
) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Helinox Community",
		slug: "hcm-approval",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await asUser.mutation(api.retailers.updateSettings, { offerSelfCollect: true });
	const { pickupLocationId } = await asUser.mutation(api.pickupLocations.create, {
		retailerId: retailer._id,
		label: "Sungai Chiling",
		address: "Kuala Kubu Bharu, Selangor",
	});
	const productId = await asUser.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Into The Falls 2026",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		event: {
			date: EVENT_DATE,
			seats: 2,
			requiresApproval: opts.requiresApproval ?? true,
		},
		variants: [{ optionValues: [], price: opts.price ?? 15000, onHand: 0 }],
	});
	const variantId = await t.run(async (ctx) => {
		const row = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.first();
		if (!row) throw new Error("variant missing");
		return row._id;
	});
	return { asUser, retailer, pickupLocationId, productId, variantId };
}

function rsvp(
	t: ReturnType<typeof setup>,
	s: Awaited<ReturnType<typeof seed>>,
	quantity = 1,
) {
	return t.mutation(api.orders.create, {
		retailerId: s.retailer._id,
		items: [{ variantId: s.variantId, quantity }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Wilson Tan", waPhone: "60123456789" },
		deliveryMethod: "self_collect",
		pickupLocationId: s.pickupLocationId,
	});
}

async function orderByShortId(t: ReturnType<typeof setup>, shortId: string) {
	const order = await t.run((ctx) =>
		ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first(),
	);
	if (!order) throw new Error("order missing");
	return order;
}

describe("sanitizeEvent — requiresApproval", () => {
	test("true is kept; false and absent both mean off (one spelling)", () => {
		expect(
			sanitizeEvent({ date: EVENT_DATE, requiresApproval: true })
				?.requiresApproval,
		).toBe(true);
		expect(
			sanitizeEvent({ date: EVENT_DATE, requiresApproval: false })
				?.requiresApproval,
		).toBeUndefined();
		expect(sanitizeEvent({ date: EVENT_DATE })?.requiresApproval).toBeUndefined();
	});
});

describe("an RSVP on an event that approves each guest", () => {
	test("lands as a request that holds its seat, with no WhatsApp handoff", async () => {
		const t = setup();
		const s = await seed(t);
		const result = await rsvp(t, s);
		expect(result.awaitingApproval).toBe(true);
		expect(result.confirmedAtCreate).toBeUndefined();

		const order = await orderByShortId(t, result.shortId);
		expect(order.status).toBe("booking_requested");
		expect(order.eventRsvp).toBe(true);
		expect(order.confirmationPushStatus).toBeUndefined();

		const head = await s.asUser.query(api.products.eventHeadcount, {
			productId: s.productId,
		});
		expect(head?.taken).toBe(1);
		// The seat cap counts requests — a second guest can't take a held seat.
		await rsvp(t, s);
		await expect(rsvp(t, s)).rejects.toThrow(/fully booked|seat/i);
	});

	test("the nav badge counts requests as new work", async () => {
		const t = setup();
		const s = await seed(t);
		await rsvp(t, s);
		const counts = await s.asUser.query(api.orders.countActionable, {
			retailerId: s.retailer._id,
		});
		expect(counts.newOrders).toBe(1);
	});

	test("nothing is payable until approved — buyer claim and seller mark both refused", async () => {
		const t = setup();
		const s = await seed(t);
		const { shortId, trackingToken } = await rsvp(t, s);
		await expect(
			t.mutation(api.orders.claimPayment, {
				token: trackingToken,
				reference: "IBG 123",
			}),
		).rejects.toThrow(/hasn't approved/);
		const order = await orderByShortId(t, shortId);
		await expect(
			s.asUser.mutation(api.orders.markPaymentReceived, { orderId: order._id }),
		).rejects.toThrow(/Approve this request first/);
	});

	test("approve confirms it and payment opens", async () => {
		const t = setup();
		const s = await seed(t);
		const { shortId, trackingToken } = await rsvp(t, s);
		const order = await orderByShortId(t, shortId);
		await s.asUser.mutation(api.bookings.approveBookingRequest, {
			orderId: order._id,
		});
		expect((await orderByShortId(t, shortId)).status).toBe("confirmed");
		await expect(
			t.mutation(api.orders.claimPayment, {
				token: trackingToken,
				reference: "IBG 123",
			}),
		).resolves.toBeNull();
	});

	test("decline cancels with the reason and frees the seat", async () => {
		const t = setup();
		const s = await seed(t);
		const { shortId } = await rsvp(t, s, 2);
		const order = await orderByShortId(t, shortId);
		await s.asUser.mutation(api.bookings.declineBookingRequest, {
			orderId: order._id,
			reason: "Registration is for members only",
		});
		const after = await orderByShortId(t, shortId);
		expect(after.status).toBe("cancelled");
		expect(after.bookingResolution).toBe("declined");
		expect(after.cancellationNote).toBe("Registration is for members only");
		const head = await s.asUser.query(api.products.eventHeadcount, {
			productId: s.productId,
		});
		expect(head?.taken).toBe(0);
		// A second answer to a resolved request speaks the RSVP's words.
		await expect(
			s.asUser.mutation(api.bookings.approveBookingRequest, {
				orderId: order._id,
			}),
		).rejects.toThrow(/already declined/);
	});

	test("an unanswered request expires after 24 hours and frees the seat", async () => {
		vi.useFakeTimers();
		try {
			const t = setup();
			const s = await seed(t);
			const { shortId } = await rsvp(t, s);
			vi.setSystemTime(Date.now() + BOOKING_REQUEST_TTL_MS + 60_000);
			await t.mutation(internal.bookings.expireStaleRequests, {});
			const after = await orderByShortId(t, shortId);
			expect(after.status).toBe("cancelled");
			expect(after.bookingResolution).toBe("expired");
		} finally {
			vi.useRealTimers();
		}
	});

	test("the toggle off keeps today's flow — no request", async () => {
		const t = setup();
		const s = await seed(t, { requiresApproval: false });
		const result = await rsvp(t, s);
		expect(result.awaitingApproval).toBeUndefined();
		expect((await orderByShortId(t, result.shortId)).status).not.toBe(
			"booking_requested",
		);
	});

	test("a walk-in RSVP at the counter is never held — the seller is keying it", async () => {
		const t = setup();
		const s = await seed(t);
		const { sessionId } = await s.asUser.mutation(
			api.counterCheckout.bindSessionManualPhone,
			{ waPhone: "60129998888", name: "Aina Hamzah" },
		);
		const { orderId } = await s.asUser.mutation(
			api.counterCheckout.createOrderFromSession,
			{
				sessionId,
				items: [{ variantId: s.variantId as Id<"productVariants">, quantity: 1 }],
				paidInPerson: true,
				paymentMethod: "cash",
			},
		);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("confirmed");
	});
});
