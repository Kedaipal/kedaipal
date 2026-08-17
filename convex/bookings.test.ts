/// <reference types="vite/client" />
/**
 * Booking requests (S2, `86eyn4kbw`): the request-to-book flow end to end —
 * availability, capacity holds + the race for the last spot, range gates,
 * release-on-cancel, the 24 h expiry sweep, and the write-path guards that
 * keep approve/decline the only exits.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_booking_seller";
const today = () => todayMytMidnight(Date.now());
const day = (offset: number) => today() + offset * DAY_MS;

async function seedBookingStore(
	t: ReturnType<typeof convexTest>,
	opts: { capacity?: number; securityDeposit?: number } = {},
) {
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
		booking: {
			capacityPerNight: opts.capacity ?? 1,
			securityDeposit: opts.securityDeposit,
		},
		variants: [{ optionValues: [], price: 8000, onHand: 0 }],
	});
	return { t, asOwner, retailer, productId };
}

function guest(n: number) {
	return { name: `Guest ${n}`, waPhone: `01234567${80 + n}` };
}

describe("bookings.availability", () => {
	test("binary per-night availability, capacity counted per night", async () => {
		const { t, retailer, productId } = await seedBookingStore(setup(), { capacity: 2 });
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest(1),
		});
		// One of two spots taken — every night still open.
		let window = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(10),
		});
		expect(window?.unavailable).toEqual([]);
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(4),
			checkOut: day(6),
			customer: guest(2),
		});
		// Night 4 now holds both stays → full; nights 3 and 5 hold one each.
		window = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(10),
		});
		expect(window?.unavailable).toEqual([day(4)]);
		expect(window?.maxNights).toBeGreaterThan(0);
	});

	test("an unbookable listing answers null (no-leak posture)", async () => {
		const { t, asOwner, productId } = await seedBookingStore(setup());
		await asOwner.mutation(api.products.update, {
			productId,
			hidden: true,
		});
		const window = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(10),
		});
		expect(window).toBeNull();
	});

	test("rejects unaligned or oversized windows", async () => {
		const { t, productId } = await seedBookingStore(setup());
		await expect(
			t.query(api.bookings.availability, {
				productId,
				from: day(0) + 1,
				to: day(10),
			}),
		).rejects.toThrow(/calendar days/);
		await expect(
			t.query(api.bookings.availability, {
				productId,
				from: day(0),
				to: day(120),
			}),
		).rejects.toThrow(/too large/);
	});
});

describe("bookings.requestBooking", () => {
	test("lands as booking_requested with the stay priced × nights", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup());
		const result = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest(1),
			customerNote: "Near the river please",
		});
		expect(result.shortId).toMatch(/^ORD-/);
		const order = await asOwner.query(api.orders.get, {
			shortId: result.shortId,
		});
		if (!order) throw new Error("order missing");
		expect(order.status).toBe("booking_requested");
		expect(order.deliveryMethod).toBe("booking");
		expect(order.bookingCheckIn).toBe(day(3));
		expect(order.bookingCheckOut).toBe(day(5));
		// The check-in day IS the due date — inbox sort/urgency read it directly.
		expect(order.fulfilmentDate).toBe(day(3));
		expect(order.items).toHaveLength(1);
		expect(order.items[0].quantity).toBe(2);
		expect(order.total).toBe(16000);
		expect(order.customerNote).toBe("Near the river please");
	});

	test("requires a reachable guest phone", async () => {
		const { t, retailer, productId } = await seedBookingStore(setup());
		await expect(
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(3),
				checkOut: day(5),
				customer: { name: "Nameful Guest" },
			}),
		).rejects.toThrow(/WhatsApp number/);
	});

	test("holds capacity from the request — the last spot can't double-book", async () => {
		const { t, retailer, productId } = await seedBookingStore(setup()); // capacity 1
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest(1),
		});
		await expect(
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(4),
				checkOut: day(6),
				customer: guest(2),
			}),
		).rejects.toThrow(/no longer available/);
		// Back-to-back is fine: the first stay's check-out morning is the second
		// stay's check-in day (exclusive checkOut).
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(5),
			checkOut: day(6),
			customer: guest(3),
		});
	});

	test("cancelling a request releases its nights", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup());
		const first = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest(1),
		});
		const order = await asOwner.query(api.orders.get, {
			shortId: first.shortId,
		});
		if (!order) throw new Error("order missing");
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "cancelled",
		});
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest(2),
		});
	});

	test("range gates: inverted, over-long, past and beyond-horizon stays", async () => {
		const { t, retailer, productId } = await seedBookingStore(setup());
		const attempt = (checkIn: number, checkOut: number) =>
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn,
				checkOut,
				customer: guest(1),
			});
		await expect(attempt(day(5), day(5))).rejects.toThrow(/after check-in/);
		await expect(attempt(day(1), day(40))).rejects.toThrow(/limited to/);
		await expect(attempt(day(-2), day(1))).rejects.toThrow(/in the past/);
		await expect(attempt(day(200), day(201))).rejects.toThrow(
			/further ahead/,
		);
	});

	test("a non-booking product refuses the request path", async () => {
		const t = setup();
		const asOwner = t.withIdentity({ subject: USER });
		await asOwner.mutation(api.retailers.createRetailer, {
			storeName: "Plain Store",
			slug: "plain-store",
		});
		const retailer = await asOwner.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		const productId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tent 2P",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 12000, onHand: 5 }],
		});
		await expect(
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(3),
				checkOut: day(5),
				customer: guest(1),
			}),
		).rejects.toThrow(/isn't taking bookings/);
	});
});

describe("booking_requested write-path guards", () => {
	test("manual transitions are refused; cancel stays open", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup());
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest(1),
		});
		const order = await asOwner.query(api.orders.get, { shortId });
		if (!order) throw new Error("order missing");
		await expect(
			asOwner.mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "confirmed",
			}),
		).rejects.toThrow(/approve or decline/);
		// Bulk skips it rather than failing the batch.
		const summary = await asOwner.mutation(api.orders.bulkUpdateStatus, {
			orderIds: [order._id],
			status: "packed",
		});
		expect(summary.updated).toBe(0);
		expect(summary.skipped).toBe(1);
	});
});

describe("expiry sweep", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	test("releases requests older than 24 h, leaves fresh ones", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup());
		const stale = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(10),
			checkOut: day(12),
			customer: guest(1),
		});
		// 25 h later a fresh request arrives on other nights, then the cron runs.
		vi.advanceTimersByTime(25 * 60 * 60 * 1000);
		const fresh = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(20),
			checkOut: day(21),
			customer: guest(2),
		});
		await t.mutation(internal.bookings.expireStaleRequests, {});
		const staleOrder = await asOwner.query(api.orders.get, {
			shortId: stale.shortId,
		});
		const freshOrder = await asOwner.query(api.orders.get, {
			shortId: fresh.shortId,
		});
		expect(staleOrder?.status).toBe("cancelled");
		expect(freshOrder?.status).toBe("booking_requested");
	});
});

describe("counter exclusion", () => {
	test("booking listings never appear in the counter catalog", async () => {
		const { asOwner, retailer, productId } = await seedBookingStore(setup());
		await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Firewood Bundle",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			variants: [{ optionValues: [], price: 1500, onHand: 20 }],
		});
		const counter = await asOwner.query(api.products.listForCounter, {
			retailerId: retailer._id,
		});
		expect(counter.map((p) => p.name)).toEqual(["Firewood Bundle"]);
		expect(counter.find((p) => p._id === productId)).toBeUndefined();
	});
});

describe("approve / decline (S3)", () => {
	test("approve: request → confirmed, timeline beat, no push without the template env", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup());
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest(1),
		});
		const order = await asOwner.query(api.orders.get, { shortId });
		if (!order) throw new Error("order missing");
		await asOwner.mutation(api.bookings.approveBookingRequest, {
			orderId: order._id,
		});
		const approved = await asOwner.query(api.orders.get, { shortId });
		expect(approved?.status).toBe("confirmed");
		// Template env unset in tests ⇒ no push stamped/scheduled — the order
		// page still shows approved + payable (documented legacy posture).
		expect(approved?.confirmationPushStatus).toBeUndefined();
		// Approving twice is a cause-true refusal, not a silent no-op.
		await expect(
			asOwner.mutation(api.bookings.approveBookingRequest, {
				orderId: order._id,
			}),
		).rejects.toThrow(/already approved/);
	});

	test("decline requires a reason, stamps the resolution and frees the nights", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup());
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest(1),
		});
		const order = await asOwner.query(api.orders.get, { shortId });
		if (!order) throw new Error("order missing");
		await expect(
			asOwner.mutation(api.bookings.declineBookingRequest, {
				orderId: order._id,
				reason: "   ",
			}),
		).rejects.toThrow(/reason/i);
		await asOwner.mutation(api.bookings.declineBookingRequest, {
			orderId: order._id,
			reason: "Closed for a private event that weekend",
		});
		const declined = await asOwner.query(api.orders.get, { shortId });
		expect(declined?.status).toBe("cancelled");
		expect(declined?.bookingResolution).toBe("declined");
		expect(declined?.bookingDeclineReason).toBe(
			"Closed for a private event that weekend",
		);
		// The hold is gone — the same nights book again.
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest(2),
		});
		// A resolved request refuses further action with the true cause.
		await expect(
			asOwner.mutation(api.bookings.approveBookingRequest, {
				orderId: order._id,
			}),
		).rejects.toThrow(/already declined/);
	});

	test("the expiry sweep stamps the resolution the buyer page reads", async () => {
		vi.useFakeTimers();
		try {
			const { t, asOwner, retailer, productId } = await seedBookingStore(
				setup(),
			);
			const { shortId } = await t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(10),
				checkOut: day(12),
				customer: guest(1),
			});
			vi.advanceTimersByTime(25 * 60 * 60 * 1000);
			await t.mutation(internal.bookings.expireStaleRequests, {});
			const expired = await asOwner.query(api.orders.get, { shortId });
			expect(expired?.status).toBe("cancelled");
			expect(expired?.bookingResolution).toBe("expired");
			// Approving at hour 25 names the expiry, not a generic error.
			const order = await asOwner.query(api.orders.get, { shortId });
			if (!order) throw new Error("order missing");
			await expect(
				asOwner.mutation(api.bookings.approveBookingRequest, {
					orderId: order._id,
				}),
			).rejects.toThrow(/expired/);
		} finally {
			vi.useRealTimers();
		}
	});

	test("capacity context reaches the seller read, never the buyer token read", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			capacity: 5,
		});
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest(1),
		});
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(4),
			checkOut: day(6),
			customer: guest(2),
		});
		const third = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(4),
			checkOut: day(5),
			customer: guest(3),
		});
		const sellerRead = await asOwner.query(api.orders.get, {
			shortId: third.shortId,
		});
		// Night 4 holds all three stays — two besides this order.
		expect(sellerRead?.bookingContext).toEqual({
			capacityPerNight: 5,
			peakOtherBookings: 2,
			nights: 1,
		});
		const buyerRead = await t.query(api.orders.get, {
			token: third.trackingToken,
		});
		expect(buyerRead?.bookingContext).toBeUndefined();
	});
});

describe("security deposit (S5)", () => {
	async function requestWithDeposit(deposit: number | undefined) {
		const seeded = await seedBookingStore(setup(), {
			securityDeposit: deposit,
		});
		const { t, asOwner, retailer, productId } = seeded;
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5), // 2 nights × RM80
			customer: guest(1),
		});
		const order = await asOwner.query(api.orders.get, { shortId });
		if (!order) throw new Error("order missing");
		return { ...seeded, shortId, order };
	}

	test("frozen at request, inside the one total, excluded from CRM spend", async () => {
		const { asOwner, retailer, order, productId } =
			await requestWithDeposit(10_000);
		expect(order.subtotal).toBe(16_000);
		expect(order.securityDeposit).toBe(10_000);
		expect(order.total).toBe(26_000); // stay + deposit, one payment
		// A later policy edit never rewrites the placed booking.
		await asOwner.mutation(api.products.update, {
			productId,
			booking: { capacityPerNight: 1, securityDeposit: 55_500 },
		});
		const after = await asOwner.query(api.orders.get, {
			shortId: order.shortId,
		});
		expect(after?.securityDeposit).toBe(10_000);
		// CRM: held money is not spend.
		const customers = await asOwner.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(customers.page[0]?.totalSpent).toBe(16_000);
	});

	test("settle: delivered+paid only, kept ≤ deposit, reason on keep, one shot", async () => {
		const { asOwner, order } = await requestWithDeposit(10_000);
		await asOwner.mutation(api.bookings.approveBookingRequest, {
			orderId: order._id,
		});
		// Before check-out: refused with the cause.
		await expect(
			asOwner.mutation(api.bookings.settleSecurityDeposit, {
				orderId: order._id,
				keptAmount: 0,
			}),
		).rejects.toThrow(/checked out/i);
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "delivered",
		});
		// Checked out but never paid: nothing to return.
		await expect(
			asOwner.mutation(api.bookings.settleSecurityDeposit, {
				orderId: order._id,
				keptAmount: 0,
			}),
		).rejects.toThrow(/never collected/i);
		await asOwner.mutation(api.orders.markPaymentReceived, {
			orderId: order._id,
		});
		// Keep gates: over the deposit / keep without a reason.
		await expect(
			asOwner.mutation(api.bookings.settleSecurityDeposit, {
				orderId: order._id,
				keptAmount: 10_001,
				reason: "too much",
			}),
		).rejects.toThrow(/exceed/i);
		await expect(
			asOwner.mutation(api.bookings.settleSecurityDeposit, {
				orderId: order._id,
				keptAmount: 4_000,
			}),
		).rejects.toThrow(/reason/i);
		// Partial keep records the split + reason.
		await asOwner.mutation(api.bookings.settleSecurityDeposit, {
			orderId: order._id,
			keptAmount: 4_000,
			reason: "Broken camp chair",
		});
		const settled = await asOwner.query(api.orders.get, {
			shortId: order.shortId,
		});
		expect(settled?.securityDepositReturnedAt).toBeDefined();
		expect(settled?.securityDepositKeptAmount).toBe(4_000);
		expect(settled?.securityDepositKeptReason).toBe("Broken camp chair");
		// One shot.
		await expect(
			asOwner.mutation(api.bookings.settleSecurityDeposit, {
				orderId: order._id,
				keptAmount: 0,
			}),
		).rejects.toThrow(/already settled/i);
	});

	test("mark-returned-in-full stamps no kept fields; depositless orders refuse", async () => {
		const { asOwner, order } = await requestWithDeposit(10_000);
		await asOwner.mutation(api.bookings.approveBookingRequest, {
			orderId: order._id,
		});
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "delivered",
		});
		await asOwner.mutation(api.orders.markPaymentReceived, {
			orderId: order._id,
		});
		await asOwner.mutation(api.bookings.settleSecurityDeposit, {
			orderId: order._id,
			keptAmount: 0,
		});
		const settled = await asOwner.query(api.orders.get, {
			shortId: order.shortId,
		});
		expect(settled?.securityDepositReturnedAt).toBeDefined();
		expect(settled?.securityDepositKeptAmount).toBeUndefined();
		expect(settled?.securityDepositKeptReason).toBeUndefined();

		const plain = await requestWithDeposit(undefined);
		expect(plain.order.total).toBe(16_000);
		expect(plain.order.securityDeposit).toBeUndefined();
		await expect(
			plain.asOwner.mutation(api.bookings.settleSecurityDeposit, {
				orderId: plain.order._id,
				keptAmount: 0,
			}),
		).rejects.toThrow(/no security deposit/i);
	});
});
