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
import type { Id } from "./_generated/dataModel";
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
	opts: {
		capacity?: number | null;
		securityDeposit?: number;
		packageDays?: number;
		autoAccept?: boolean;
	} = {},
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
			// null asks for UNLIMITED (the field left unset); undefined = default 1.
			capacityPerNight: opts.capacity === null ? undefined : (opts.capacity ?? 1),
			securityDeposit: opts.securityDeposit,
			packageDays: opts.packageDays,
			autoAccept: opts.autoAccept,
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
			// Cancelling a booking demands a buyer-visible reason, the same way
			// declining one does — the guest planned around these dates.
			cancellationNote: "Double-booked by mistake",
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
		expect(declined?.cancellationNote).toBe(
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

describe("fixed-length packages + instant book (S7)", () => {
	test("a package derives its own end, prices flat, and freezes its shape", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			packageDays: 30,
			capacity: null,
		});
		// The client sends a START date only — no checkOut to tamper with.
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			customer: guest(1),
		});
		const order = await asOwner.query(api.orders.get, { shortId });
		if (!order) throw new Error("order missing");
		expect(order.bookingCheckIn).toBe(day(3));
		expect(order.bookingCheckOut).toBe(day(33)); // start + 30 days
		expect(order.bookingPackageDays).toBe(30);
		// ONE flat-priced line, not 30 × the nightly rate.
		expect(order.items[0]?.quantity).toBe(1);
		expect(order.total).toBe(8000);

		// A later edit to the listing never re-describes the placed order.
		await asOwner.mutation(api.products.update, {
			productId,
			booking: { capacityPerNight: undefined, packageDays: 7 },
		});
		const after = await asOwner.query(api.orders.get, { shortId });
		expect(after?.bookingPackageDays).toBe(30);
		expect(after?.bookingCheckOut).toBe(day(33));
	});

	test("a client-supplied checkOut cannot stretch a package", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			packageDays: 30,
			capacity: null,
		});
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			// A tampered client asking for 90 days at the 30-day price.
			checkOut: day(93),
			customer: guest(2),
		});
		const order = await asOwner.query(api.orders.get, { shortId });
		expect(order?.bookingCheckOut).toBe(day(33));
		expect(order?.total).toBe(8000);
	});

	test("a package longer than the free-range cap is accepted (the cap is the seller's own length)", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			packageDays: 90, // > MAX_BOOKING_NIGHTS (30)
			capacity: null,
		});
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(2),
			customer: guest(3),
		});
		const order = await asOwner.query(api.orders.get, { shortId });
		expect(order?.bookingCheckOut).toBe(day(92));
	});

	test("unlimited capacity never blocks, and never hides a seller's block", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			capacity: null,
			packageDays: 30,
		});
		// Ten members starting the same day — a capped listing would refuse the
		// second one.
		for (let i = 0; i < 10; i++) {
			await t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(1),
				customer: { name: `Member ${i}`, waPhone: `01199900${10 + i}` },
			});
		}
		const window = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(40),
		});
		expect(window?.unavailable).toEqual([]);
		expect(window?.packageDays).toBe(30);

		// A block still closes the day — unlimited means "no capacity ceiling",
		// not "never unavailable".
		await asOwner.mutation(api.bookingBlocks.blockDays, {
			retailerId: retailer._id,
			startDate: day(5),
			endDate: day(5),
		});
		const blocked = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(40),
		});
		expect(blocked?.unavailable).toEqual([day(5)]);
		// And a package spanning that blocked night can't start at all.
		await expect(
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(1),
				customer: guest(4),
			}),
		).rejects.toThrow(/no longer available/i);
	});

	test("a long package still occupies its nights against a LATER window (scan bound)", async () => {
		// The regression this pins: the capacity scan used to look back only
		// MAX_BOOKING_NIGHTS (30) days, so a 90-day package starting 60 days ago
		// would be invisible to a window it genuinely overlaps — and the night
		// would read as free.
		const { t, retailer, productId } = await seedBookingStore(setup(), {
			packageDays: 90,
			capacity: 1,
		});
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(1),
			customer: guest(5),
		});
		// A window 60 days out — far beyond the old 30-day look-back.
		const window = await t.query(api.bookings.availability, {
			productId,
			from: day(60),
			to: day(70),
		});
		expect(window?.unavailable).toEqual([
			day(60), day(61), day(62), day(63), day(64),
			day(65), day(66), day(67), day(68), day(69),
		]);
	});

	test("instant book lands confirmed, skips the request state, and refuses approve/decline", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			packageDays: 30,
			capacity: null,
			autoAccept: true,
		});
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(1),
			customer: guest(6),
		});
		const order = await asOwner.query(api.orders.get, { shortId });
		if (!order) throw new Error("order missing");
		expect(order.status).toBe("confirmed");
		// Template env unset in tests ⇒ confirmed + payable, no automatic send
		// (the documented posture the S3 approve path already has).
		expect(order.confirmationPushStatus).toBeUndefined();
		// There is no request to answer.
		await expect(
			asOwner.mutation(api.bookings.approveBookingRequest, {
				orderId: order._id,
			}),
		).rejects.toThrow();
		// It behaves like any confirmed order from here.
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "delivered",
		});
		expect(
			(await asOwner.query(api.orders.get, { shortId }))?.status,
		).toBe("delivered");
	});

	test("without instant book a package still waits for approval", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			packageDays: 30,
			capacity: null,
		});
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(1),
			customer: guest(7),
		});
		const order = await asOwner.query(api.orders.get, { shortId });
		expect(order?.status).toBe("booking_requested");
	});

	test("a free-range listing is untouched: per-night pricing, no package stamp", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup());
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest(8),
		});
		const order = await asOwner.query(api.orders.get, { shortId });
		expect(order?.items[0]?.quantity).toBe(2);
		expect(order?.total).toBe(16_000);
		expect(order?.bookingPackageDays).toBeUndefined();
		expect(order?.status).toBe("booking_requested");
	});

	test("a free-range request with no check-out is refused", async () => {
		const { t, retailer, productId } = await seedBookingStore(setup());
		await expect(
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(3),
				customer: guest(9),
			}),
		).rejects.toThrow(/check-out/i);
	});
});

describe("cancellation reason (86eyn4kcn follow-up)", () => {
	test("cancelling a BOOKING demands a reason, and the buyer gets it verbatim", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup());
		const { shortId, trackingToken } = await t.mutation(
			api.bookings.requestBooking,
			{
				retailerId: retailer._id,
				productId,
				checkIn: day(3),
				checkOut: day(5),
				customer: guest(1),
			},
		);
		const order = await asOwner.query(api.orders.get, { shortId });
		if (!order) throw new Error("order missing");
		await asOwner.mutation(api.bookings.approveBookingRequest, {
			orderId: order._id,
		});

		// A guest who planned around these dates is owed the same explanation a
		// declined request gets — so a bare cancel is refused.
		await expect(
			asOwner.mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "cancelled",
			}),
		).rejects.toThrow(/short reason/i);
		await expect(
			asOwner.mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "cancelled",
				cancellationNote: "   ",
			}),
		).rejects.toThrow(/short reason/i);
		await expect(
			asOwner.mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "cancelled",
				cancellationNote: "x".repeat(201),
			}),
		).rejects.toThrow(/under 200/i);

		await asOwner.mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "cancelled",
			cancellationNote: "The site flooded after the storm",
		});
		// The BUYER's own read carries it — this is the surface that was silent.
		const buyerRead = await t.query(api.orders.get, { token: trackingToken });
		expect(buyerRead?.status).toBe("cancelled");
		expect(buyerRead?.cancellationNote).toBe(
			"The site flooded after the storm",
		);
	});

	test("an ordinary order cancels without one, but keeps it when given", async () => {
		const t = setup();
		const asOwner = t.withIdentity({ subject: USER });
		await asOwner.mutation(api.retailers.createRetailer, {
			storeName: "Plain Goods",
			slug: "plain-goods-cancel",
		});
		const retailer = await asOwner.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		const productId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tote Bag",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 2500, onHand: 5 }],
		});
		const variants = await asOwner.query(api.products.get, { productId });
		const variantId = variants?.variants[0]?._id;
		if (!variantId) throw new Error("variant missing");

		const retailerId = retailer._id;
		async function place() {
			return await t.mutation(api.orders.create, {
				retailerId,
				items: [{ productId, variantId, quantity: 1 }],
				currency: "MYR",
				customer: { name: "Aisha", waPhone: "0123456799" },
				deliveryMethod: "self_collect",
				channel: "whatsapp",
			});
		}

		// No reason needed — cancel is high-frequency on ordinary orders.
		const a = await place();
		const orderA = await asOwner.query(api.orders.get, { shortId: a.shortId });
		if (!orderA) throw new Error("missing");
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: orderA._id,
			status: "cancelled",
		});
		expect(
			(await asOwner.query(api.orders.get, { shortId: a.shortId }))
				?.cancellationNote,
		).toBeUndefined();

		// ...but it's kept and shown when the seller does explain.
		const b = await place();
		const orderB = await asOwner.query(api.orders.get, { shortId: b.shortId });
		if (!orderB) throw new Error("missing");
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: orderB._id,
			status: "cancelled",
			cancellationNote: "Out of stock — sorry!",
		});
		expect(
			(await asOwner.query(api.orders.get, { shortId: b.shortId }))
				?.cancellationNote,
		).toBe("Out of stock — sorry!");
	});

	test("bulk cancel applies ONE reason, and a booking in the batch still demands it", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			capacity: 5,
		});
		const made: Array<{ id: Id<"orders">; shortId: string }> = [];
		for (let i = 0; i < 2; i++) {
			const { shortId } = await t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(3 + i * 4),
				checkOut: day(5 + i * 4),
				customer: guest(20 + i),
			});
			const o = await asOwner.query(api.orders.get, { shortId });
			if (!o) throw new Error("missing");
			made.push({ id: o._id, shortId });
		}
		const ids = made.map((m) => m.id);
		// The batch holds bookings, so the rule still applies — one prompt, but
		// it can't be skipped.
		await expect(
			asOwner.mutation(api.orders.bulkUpdateStatus, {
				orderIds: ids,
				status: "cancelled",
			}),
		).rejects.toThrow(/short reason/i);

		await asOwner.mutation(api.orders.bulkUpdateStatus, {
			orderIds: ids,
			status: "cancelled",
			cancellationNote: "Closed for maintenance that week",
		});
		for (const m of made) {
			const o = await asOwner.query(api.orders.get, { shortId: m.shortId });
			expect(o?.cancellationNote).toBe("Closed for maintenance that week");
		}
	});
});
