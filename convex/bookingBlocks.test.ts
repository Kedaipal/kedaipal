/// <reference types="vite/client" />
/**
 * Seller block-days + calendar reads (S4, `86eyn4kdb`): blocked ≡ full to
 * buyers, blocks stop NEW requests but never touch existing bookings, scope
 * (whole store vs one listing), unblock restores, and the calendar/day reads
 * the seller month view renders from.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_block_seller";
const today = () => todayMytMidnight(Date.now());
const day = (offset: number) => today() + offset * DAY_MS;

async function seedBookingStore(
	t: ReturnType<typeof convexTest>,
	opts: { capacity?: number } = {},
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
		booking: { capacityPerNight: opts.capacity ?? 1 },
		variants: [{ optionValues: [], price: 8000, onHand: 0 }],
	});
	return { t, asOwner, retailer, productId };
}

function guest(n: number) {
	return { name: `Guest ${n}`, waPhone: `01234567${80 + n}` };
}

describe("bookingBlocks.blockDays", () => {
	test("validates alignment, order, length, note and listing kind", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup());
		await expect(
			asOwner.mutation(api.bookingBlocks.blockDays, {
				retailerId: retailer._id,
				startDate: day(1) + 60_000,
				endDate: day(2),
			}),
		).rejects.toThrow(/calendar days/i);
		await expect(
			asOwner.mutation(api.bookingBlocks.blockDays, {
				retailerId: retailer._id,
				startDate: day(3),
				endDate: day(1),
			}),
		).rejects.toThrow(/before its start/i);
		await expect(
			asOwner.mutation(api.bookingBlocks.blockDays, {
				retailerId: retailer._id,
				startDate: day(0),
				endDate: day(400),
			}),
		).rejects.toThrow(/limited to 366/i);
		await expect(
			asOwner.mutation(api.bookingBlocks.blockDays, {
				retailerId: retailer._id,
				startDate: day(1),
				endDate: day(1),
				note: "x".repeat(201),
			}),
		).rejects.toThrow(/under 200/i);
		// A non-booking product can't be block-scoped.
		const physicalId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Firewood Bundle",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			variants: [{ optionValues: [], price: 1500, onHand: 10 }],
		});
		await expect(
			asOwner.mutation(api.bookingBlocks.blockDays, {
				retailerId: retailer._id,
				productId: physicalId,
				startDate: day(1),
				endDate: day(1),
			}),
		).rejects.toThrow(/can't be blocked/i);
		// Someone who isn't the owner (or an admin) can't block at all.
		const asStranger = t.withIdentity({ subject: "user_not_the_owner" });
		await expect(
			asStranger.mutation(api.bookingBlocks.blockDays, {
				retailerId: retailer._id,
				startDate: day(1),
				endDate: day(1),
			}),
		).rejects.toThrow();
		void productId;
	});

	test("blocked reads as full to buyers and refuses NEW requests, never existing ones", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			capacity: 3,
		});
		// An existing stay over nights 4+5 — placed BEFORE the block.
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(4),
			checkOut: day(6),
			customer: guest(1),
		});
		await asOwner.mutation(api.bookingBlocks.blockDays, {
			retailerId: retailer._id,
			startDate: day(4),
			endDate: day(5),
			note: "Maintenance",
		});
		// Public availability: both blocked nights read unavailable — binary,
		// indistinguishable from full (capacity 3 with 1 booked would otherwise
		// be open).
		const window = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(10),
		});
		expect(window?.unavailable).toEqual([day(4), day(5)]);
		// A NEW request over a blocked night bounces with the same copy as full.
		await expect(
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(5),
				checkOut: day(7),
				customer: guest(2),
			}),
		).rejects.toThrow(/no longer available/i);
		// The existing booking is untouched — still listed on its nights.
		const rows = await asOwner.query(api.bookingBlocks.dayBookings, {
			retailerId: retailer._id,
			date: day(4),
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.checkIn).toBe(day(4));
		// A request entirely outside the block still goes through.
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(7),
			checkOut: day(8),
			customer: guest(3),
		});
	});

	test("per-listing scope leaves sibling listings open; store scope covers all; unblock restores", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup());
		const siblingId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Hilltop Plot",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			kind: "booking" as const,
			booking: { capacityPerNight: 1 },
			variants: [{ optionValues: [], price: 9000, onHand: 0 }],
		});
		await asOwner.mutation(api.bookingBlocks.blockDays, {
			retailerId: retailer._id,
			productId,
			startDate: day(3),
			endDate: day(3),
		});
		const blocked = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(10),
		});
		const sibling = await t.query(api.bookings.availability, {
			productId: siblingId,
			from: day(0),
			to: day(10),
		});
		expect(blocked?.unavailable).toEqual([day(3)]);
		expect(sibling?.unavailable).toEqual([]);
		// Store-level block hits both listings.
		const storeBlockId = await asOwner.mutation(api.bookingBlocks.blockDays, {
			retailerId: retailer._id,
			startDate: day(8),
			endDate: day(8),
		});
		const siblingAfter = await t.query(api.bookings.availability, {
			productId: siblingId,
			from: day(0),
			to: day(10),
		});
		expect(siblingAfter?.unavailable).toEqual([day(8)]);
		// Unblock restores — and a booking lands on the freed night.
		await asOwner.mutation(api.bookingBlocks.unblock, { blockId: storeBlockId });
		const restored = await t.query(api.bookings.availability, {
			productId: siblingId,
			from: day(0),
			to: day(10),
		});
		expect(restored?.unavailable).toEqual([]);
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId: siblingId,
			checkIn: day(8),
			checkOut: day(9),
			customer: guest(4),
		});
		// Unblock is idempotent — a second call on the deleted row is a no-op.
		await asOwner.mutation(api.bookingBlocks.unblock, { blockId: storeBlockId });
	});
});

describe("bookingBlocks calendar reads", () => {
	test("sellerCalendar: counts per night, capacity only when listing-scoped, blocks + listings enumerated", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			capacity: 5,
		});
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(2),
			checkOut: day(4),
			customer: guest(1),
		});
		await asOwner.mutation(api.bookingBlocks.blockDays, {
			retailerId: retailer._id,
			productId,
			startDate: day(6),
			endDate: day(7),
			note: "Private event",
		});
		const all = await asOwner.query(api.bookingBlocks.sellerCalendar, {
			retailerId: retailer._id,
			from: day(0),
			to: day(10),
		});
		// All-listings view: counts, no capacity denominator (summing capacity
		// across products is fake math).
		expect(all.capacityPerNight).toBeUndefined();
		expect(all.listings.map((l) => l.name)).toEqual(["Riverside Plot"]);
		expect(all.blocks).toHaveLength(1);
		const byDate = new Map(all.days.map((d) => [d.date, d]));
		expect(byDate.get(day(2))?.booked).toBe(1);
		expect(byDate.get(day(3))?.booked).toBe(1);
		expect(byDate.get(day(4))?.booked).toBe(0); // checkOut morning is free
		expect(byDate.get(day(6))?.blocked).toBe(true);
		expect(byDate.get(day(5))?.blocked).toBe(false);
		// Listing-scoped: the capacity denominator appears.
		const scoped = await asOwner.query(api.bookingBlocks.sellerCalendar, {
			retailerId: retailer._id,
			from: day(0),
			to: day(10),
			productId,
		});
		expect(scoped.capacityPerNight).toBe(5);
		// Window bounds enforced.
		await expect(
			asOwner.query(api.bookingBlocks.sellerCalendar, {
				retailerId: retailer._id,
				from: day(0),
				to: day(120),
			}),
		).rejects.toThrow(/too large/i);
	});

	test("dayBookings lists overlapping stays, skips cancelled, and hasBookingListings answers by kind", async () => {
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			capacity: 4,
		});
		const first = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(2),
			checkOut: day(5),
			customer: guest(1),
		});
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(4),
			customer: guest(2),
		});
		// Cancelled requests drop off the day view (decline releases the hold).
		const declined = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(6),
			customer: guest(3),
		});
		const declinedOrder = await asOwner.query(api.orders.get, {
			shortId: declined.shortId,
		});
		if (!declinedOrder) throw new Error("order missing");
		await asOwner.mutation(api.bookings.declineBookingRequest, {
			orderId: declinedOrder._id,
			reason: "Fully committed that weekend",
		});
		const rows = await asOwner.query(api.bookingBlocks.dayBookings, {
			retailerId: retailer._id,
			date: day(3),
		});
		expect(rows.map((r) => r.shortId).sort()).toEqual(
			[first.shortId, rows.find((r) => r.shortId !== first.shortId)?.shortId]
				.filter((x): x is string => x !== undefined)
				.sort(),
		);
		expect(rows).toHaveLength(2);
		// The checkOut morning holds no stay.
		const morning = await asOwner.query(api.bookingBlocks.dayBookings, {
			retailerId: retailer._id,
			date: day(5),
		});
		expect(morning).toHaveLength(0);
		expect(
			await asOwner.query(api.bookingBlocks.hasBookingListings, {
				retailerId: retailer._id,
			}),
		).toBe(true);
	});

	test("dayBookings sees a long package whose check-in is months behind the tapped day", async () => {
		// The gym case (S7): a 6-month membership started today still occupies a
		// night 100 days from now. The scan used to look back a flat 30 days —
		// the free-range night cap — so the member vanished from the day sheet
		// while `countBookedPerNight` kept counting them in the grid pill. The
		// calendar contradicted itself: pill said 1, tapping said none.
		const { t, asOwner, retailer } = await seedBookingStore(setup());
		const packageId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "6-Month Membership",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			kind: "booking" as const,
			// No capacity — a gym has no daily member cap (unlimited).
			booking: { packageLength: 6, packageUnit: "month" as const },
			variants: [{ optionValues: [], price: 45000, onHand: 0 }],
		});
		const member = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId: packageId,
			checkIn: today(),
			// Omitted: the server derives the end from the listing's own length.
			customer: guest(9),
		});

		const deepInside = day(100);
		const rows = await asOwner.query(api.bookingBlocks.dayBookings, {
			retailerId: retailer._id,
			date: deepInside,
			productId: packageId,
		});
		expect(rows.map((r) => r.shortId)).toEqual([member.shortId]);

		// …and the grid agrees, which is the whole point: the two reads are
		// looking at the same night through the same bound.
		const calendar = await asOwner.query(api.bookingBlocks.sellerCalendar, {
			retailerId: retailer._id,
			from: deepInside,
			to: day(101),
			productId: packageId,
		});
		expect(calendar.days).toHaveLength(1);
		expect(calendar.days[0].booked).toBe(1);
	});

	test("blockImpact counts what a pending block would land on, scoped like the write", async () => {
		// Blocking never cancels — so the sheet STATES the consequence instead of
		// refusing the action. The count has to be scope-matched to the row that
		// would actually be written, or the seller reads one number and gets
		// another block.
		const { t, asOwner, retailer, productId } = await seedBookingStore(setup(), {
			capacity: 4,
		});
		const other = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Hilltop Plot",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			kind: "booking" as const,
			booking: { capacityPerNight: 2 },
			variants: [{ optionValues: [], price: 9000, onHand: 0 }],
		});
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(4),
			checkOut: day(7),
			customer: { name: "Aisyah", waPhone: "0123456701" },
		});
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId: other,
			checkIn: day(5),
			checkOut: day(6),
			customer: { name: "Farah", waPhone: "0123456702" },
		});

		// Whole store — both listings.
		const store = await asOwner.query(api.bookingBlocks.blockImpact, {
			retailerId: retailer._id,
			startDate: day(5),
			endDate: day(5),
		});
		expect(store.count).toBe(2);
		expect(store.samples.map((s) => s.customerName).sort()).toEqual([
			"Aisyah",
			"Farah",
		]);

		// Scoped to one listing — only its own booking.
		const scoped = await asOwner.query(api.bookingBlocks.blockImpact, {
			retailerId: retailer._id,
			productId: other,
			startDate: day(5),
			endDate: day(5),
		});
		expect(scoped.count).toBe(1);
		expect(scoped.samples[0].customerName).toBe("Farah");

		// The block's endDate is INCLUSIVE, a stay's checkOut EXCLUSIVE. Aisyah
		// leaves on day 7, so a block ON day 7 touches nobody from her stay.
		const leavingMorning = await asOwner.query(api.bookingBlocks.blockImpact, {
			retailerId: retailer._id,
			productId,
			startDate: day(7),
			endDate: day(7),
		});
		expect(leavingMorning.count).toBe(0);

		// A free range with nothing in it is the quiet case — no warning shown.
		const empty = await asOwner.query(api.bookingBlocks.blockImpact, {
			retailerId: retailer._id,
			startDate: day(20),
			endDate: day(22),
		});
		expect(empty).toEqual({ count: 0, samples: [] });
	});

	test("blockImpact sees a long package that started before the block", async () => {
		// Same span-aware bound as every other booking scan: a 6-month member
		// whose check-in was months ago still occupies the day being blocked.
		const { t, asOwner, retailer } = await seedBookingStore(setup());
		const packageId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "6-Month Membership",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			kind: "booking" as const,
			booking: { packageLength: 6, packageUnit: "month" as const },
			variants: [{ optionValues: [], price: 45000, onHand: 0 }],
		});
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId: packageId,
			checkIn: today(),
			customer: { name: "Hafiz", waPhone: "0123456703" },
		});
		const impact = await asOwner.query(api.bookingBlocks.blockImpact, {
			retailerId: retailer._id,
			productId: packageId,
			startDate: day(100),
			endDate: day(100),
		});
		expect(impact.count).toBe(1);
		expect(impact.samples[0].customerName).toBe("Hafiz");
	});

	test("hasBookingListings is false for a store with only physical products", async () => {
		const t = setup();
		const asOwner = t.withIdentity({ subject: "user_plain_seller" });
		await asOwner.mutation(api.retailers.createRetailer, {
			storeName: "Plain Goods",
			slug: "plain-goods",
		});
		const retailer = await asOwner.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tote Bag",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 2500, onHand: 3 }],
		});
		expect(
			await asOwner.query(api.bookingBlocks.hasBookingListings, {
				retailerId: retailer._id,
			}),
		).toBe(false);
	});
});
