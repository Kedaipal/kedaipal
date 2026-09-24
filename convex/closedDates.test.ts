/// <reference types="vite/client" />
/**
 * Store closed dates (z8r3fdhpm7): add / remove / impact, and the gate that
 * refuses a closed date at storefront checkout.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { MAX_CLOSED_RANGES } from "./lib/closedDates";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_closed_dates_seller";
const today = () => todayMytMidnight(Date.now());
const day = (offset: number) => today() + offset * DAY_MS;

const customer = { name: "Ali", waPhone: "60123456789" };
const address = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

async function seedStore(t: ReturnType<typeof setup>) {
	const asOwner = t.withIdentity({ subject: USER });
	await asOwner.mutation(api.retailers.createRetailer, {
		storeName: "Kek Mak Jah",
		slug: "kek-mak-jah",
	});
	const retailer = await asOwner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	const productId = await asOwner.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Kek Lapis",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		variants: [{ optionValues: [], price: 4500, onHand: 50 }],
	});
	return { asOwner, retailer, productId };
}

async function closures(t: ReturnType<typeof setup>) {
	const retailer = await t
		.withIdentity({ subject: USER })
		.query(api.retailers.getMyRetailer);
	return retailer?.closedDates;
}

describe("closedDates.add / remove", () => {
	test("adds a labelled range, sorted, and refuses the exact duplicate", async () => {
		const t = setup();
		const { asOwner, retailer } = await seedStore(t);
		await asOwner.mutation(api.closedDates.add, {
			retailerId: retailer._id,
			startDate: day(10),
			endDate: day(12),
			label: " Hari   Raya ",
		});
		await asOwner.mutation(api.closedDates.add, {
			retailerId: retailer._id,
			startDate: day(3),
			endDate: day(3),
		});
		expect(await closures(t)).toEqual([
			{ startDate: day(3), endDate: day(3) },
			{ startDate: day(10), endDate: day(12), label: "Hari Raya" },
		]);
		await expect(
			asOwner.mutation(api.closedDates.add, {
				retailerId: retailer._id,
				startDate: day(10),
				endDate: day(12),
				label: "Different words, same days",
			}),
		).rejects.toThrow(/already closed/);
		// Overlapping (not identical) is fine — unioned at read.
		await asOwner.mutation(api.closedDates.add, {
			retailerId: retailer._id,
			startDate: day(11),
			endDate: day(14),
		});
		expect(await closures(t)).toHaveLength(3);
	});

	test("validates through the shared sanitizer, and strangers can't write", async () => {
		const t = setup();
		const { asOwner, retailer } = await seedStore(t);
		await expect(
			asOwner.mutation(api.closedDates.add, {
				retailerId: retailer._id,
				startDate: day(-1),
				endDate: day(1),
			}),
		).rejects.toThrow(/already passed/);
		await expect(
			asOwner.mutation(api.closedDates.add, {
				retailerId: retailer._id,
				startDate: day(5),
				endDate: day(4),
			}),
		).rejects.toThrow(/before the first/);
		await expect(
			t.withIdentity({ subject: "someone_else" }).mutation(api.closedDates.add, {
				retailerId: retailer._id,
				startDate: day(5),
				endDate: day(5),
			}),
		).rejects.toThrow();
	});

	test("ended ranges are pruned on the next write, and the cap counts only upcoming ones", async () => {
		const t = setup();
		const { asOwner, retailer } = await seedStore(t);
		// Plant history directly: 50 ranges that all ENDED yesterday or earlier.
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				closedDates: Array.from({ length: MAX_CLOSED_RANGES }, (_, i) => ({
					startDate: day(-2 - i),
					endDate: day(-1 - i),
				})),
			});
		});
		await asOwner.mutation(api.closedDates.add, {
			retailerId: retailer._id,
			startDate: day(2),
			endDate: day(2),
		});
		expect(await closures(t)).toEqual([{ startDate: day(2), endDate: day(2) }]);
	});

	test("the cap refuses the 51st upcoming range with a way out", async () => {
		const t = setup();
		const { asOwner, retailer } = await seedStore(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				closedDates: Array.from({ length: MAX_CLOSED_RANGES }, (_, i) => ({
					startDate: day(1 + i),
					endDate: day(1 + i),
				})),
			});
		});
		await expect(
			asOwner.mutation(api.closedDates.add, {
				retailerId: retailer._id,
				startDate: day(100),
				endDate: day(100),
			}),
		).rejects.toThrow(/up to 50 closures.*remove one/);
	});

	test("remove reopens exactly that range, is idempotent, and clears the field when empty", async () => {
		const t = setup();
		const { asOwner, retailer } = await seedStore(t);
		for (const offset of [4, 8]) {
			await asOwner.mutation(api.closedDates.add, {
				retailerId: retailer._id,
				startDate: day(offset),
				endDate: day(offset),
			});
		}
		await asOwner.mutation(api.closedDates.remove, {
			retailerId: retailer._id,
			startDate: day(4),
			endDate: day(4),
		});
		expect(await closures(t)).toEqual([{ startDate: day(8), endDate: day(8) }]);
		// Already gone — no error.
		await asOwner.mutation(api.closedDates.remove, {
			retailerId: retailer._id,
			startDate: day(4),
			endDate: day(4),
		});
		await asOwner.mutation(api.closedDates.remove, {
			retailerId: retailer._id,
			startDate: day(8),
			endDate: day(8),
		});
		expect(await closures(t)).toBeUndefined();
	});
});

describe("closed dates at storefront checkout", () => {
	test("a closed date is refused for delivery AND self-collect, naming the reason", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await seedStore(t);
		await asOwner.mutation(api.closedDates.add, {
			retailerId: retailer._id,
			startDate: day(2),
			endDate: day(3),
			label: "Hari Raya",
		});
		const base = {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR" as const,
			channel: "whatsapp" as const,
			customer,
		};
		await expect(
			t.mutation(api.orders.create, {
				...base,
				deliveryMethod: "delivery",
				deliveryAddress: address,
				fulfilmentDate: day(3),
			}),
		).rejects.toThrow(/The store is closed .* \(Hari Raya\) — pick another day/);
		await expect(
			t.mutation(api.orders.create, {
				...base,
				deliveryMethod: "self_collect",
				fulfilmentDate: day(2),
			}),
		).rejects.toThrow(/closed .*Hari Raya/);
		// The day after the (inclusive) range is open again.
		const { shortId } = await t.mutation(api.orders.create, {
			...base,
			deliveryMethod: "delivery",
			deliveryAddress: address,
			fulfilmentDate: day(4),
		});
		expect(shortId).toMatch(/^ORD-/);
	});

	test("the closure beats the prep window as the reason (truest reason first)", async () => {
		const t = setup();
		const { asOwner, retailer } = await seedStore(t);
		const slowId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Wedding Cake",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			prepMinutes: 24 * 60,
			variants: [{ optionValues: [], price: 30000, onHand: 5 }],
		});
		await asOwner.mutation(api.closedDates.add, {
			retailerId: retailer._id,
			startDate: day(0),
			endDate: day(0),
			label: "Stock-take",
		});
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId: slowId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryMethod: "delivery",
				deliveryAddress: address,
				fulfilmentDate: day(0),
			}),
		).rejects.toThrow(/Stock-take/);
	});
});

describe("closedDates.impact", () => {
	test("counts open orders due on the dates and names a few; ignores cancelled and other dates", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await seedStore(t);
		const place = (date: number) =>
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryMethod: "delivery",
				deliveryAddress: address,
				fulfilmentDate: date,
			});
		const a = await place(day(5));
		await place(day(6));
		await place(day(9)); // outside the range
		const cancelled = await place(day(6));
		await t.run(async (ctx) => {
			const order = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", cancelled.shortId))
				.first();
			if (order) await ctx.db.patch(order._id, { status: "cancelled" });
		});

		const result = await asOwner.query(api.closedDates.impact, {
			retailerId: retailer._id,
			startDate: day(5),
			endDate: day(6),
		});
		expect(result.orders).toBe(2);
		expect(result.ordersCapped).toBe(false);
		expect(result.bookings).toBe(0);
		expect(result.samples.map((s) => s.shortId)).toContain(a.shortId);
		expect(result.samples.every((s) => s.kind === "order")).toBe(true);
	});

	test("counts bookings that run THROUGH the range, not only those starting in it", async () => {
		const t = setup();
		const { asOwner, retailer } = await seedStore(t);
		const campId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Riverside Plot",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			kind: "booking" as const,
			booking: { capacityPerNight: 3 },
			variants: [{ optionValues: [], price: 8000, onHand: 0 }],
		});
		// Checks in BEFORE the closure, still there during it.
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId: campId,
			checkIn: day(3),
			checkOut: day(7),
			customer: { name: "Guest", waPhone: "0123456781" },
		});
		const result = await asOwner.query(api.closedDates.impact, {
			retailerId: retailer._id,
			startDate: day(5),
			endDate: day(5),
		});
		// The booking's fulfilmentDate (check-in) is outside the range, so it is
		// counted ONCE, as a booking — never double-counted as an order.
		expect(result).toMatchObject({ orders: 0, bookings: 1 });
		expect(result.samples).toEqual([
			expect.objectContaining({ kind: "booking", customerName: "Guest" }),
		]);
	});
});

describe("closed dates in bookings — closed ≠ blocked", () => {
	async function listing(
		t: ReturnType<typeof setup>,
		booking: {
			capacityPerNight?: number;
			packageLength?: number;
			packageUnit?: "day" | "night" | "month";
			autoAccept?: boolean;
		},
	) {
		const { asOwner, retailer } = await seedStore(t);
		const productId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Listing",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			kind: "booking" as const,
			booking,
			variants: [{ optionValues: [], price: 15000, onHand: 0 }],
		});
		const close = (from: number, to: number) =>
			asOwner.mutation(api.closedDates.add, {
				retailerId: retailer._id,
				startDate: from,
				endDate: to,
				label: "Hari Raya",
			});
		return { asOwner, retailer, productId, close };
	}
	const guest = { name: "Guest", waPhone: "0123456781" };

	test("a STAY listing: a closed date is an unavailable night — the leaving morning still works", async () => {
		const t = setup();
		const { retailer, productId, close } = await listing(t, {
			capacityPerNight: 3,
		});
		await close(day(5), day(5));
		const window = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(10),
		});
		expect(window?.unavailable).toEqual([day(5)]);
		expect(window?.closureRule).toBe("unavailable");
		expect(window?.closures).toEqual([
			{ startDate: day(5), endDate: day(5), label: "Hari Raya" },
		]);
		await expect(
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(4),
				checkOut: day(6),
				customer: guest,
			}),
		).rejects.toThrow(/no longer available/);
		// Checking OUT on the closed morning sleeps no closed night.
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(3),
			checkOut: day(5),
			customer: guest,
		});
	});

	test("a NIGHT package (3D2N) treats a closure like a stay", async () => {
		const t = setup();
		const { retailer, productId, close } = await listing(t, {
			packageLength: 2,
			packageUnit: "night",
		});
		await close(day(6), day(6));
		await expect(
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(5),
				customer: guest,
			}),
		).rejects.toThrow(/no longer available/);
	});

	test("a MONTH package absorbs a closure: every start stays bookable (the FS Fitness trap)", async () => {
		const t = setup();
		const { retailer, productId, close } = await listing(t, {
			packageLength: 1,
			packageUnit: "month",
			autoAccept: true,
		});
		await close(day(20), day(20));
		const window = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(40),
		});
		// Nothing is unavailable — the closure is priced into the month…
		expect(window?.unavailable).toEqual([]);
		expect(window?.closureRule).toBe("absorbed");
		// …but it IS on the payload, so the buyer can be told.
		expect(window?.closures).toHaveLength(1);
		// A membership whose month runs straight through the closed day sells.
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(10),
			customer: guest,
		});
		expect(shortId).toMatch(/^ORD-/);
	});

	test("…but no package STARTS on a shut day — a closed date or the weekly day off (owner call, 24 Sep)", async () => {
		const t = setup();
		const { asOwner, retailer, productId, close } = await listing(t, {
			packageLength: 1,
			packageUnit: "month",
			autoAccept: true,
		});
		await close(day(20), day(20));
		const weekdayOf = (epoch: number) =>
			new Date(epoch + 8 * 3_600_000).getUTCDay();
		await asOwner.mutation(api.retailers.updateSettings, {
			openingHours: Array.from({ length: 7 }, (_, i) =>
				i === weekdayOf(day(12))
					? { open: 540, close: 1080, closed: true }
					: { open: 540, close: 1080 },
			),
		});
		// The calendar is sent the weekly day off so it can refuse the start too.
		const window = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(40),
		});
		expect(window?.closedWeekdays).toEqual([weekdayOf(day(12))]);
		for (const checkIn of [day(20), day(12)]) {
			await expect(
				t.mutation(api.bookings.requestBooking, {
					retailerId: retailer._id,
					productId,
					checkIn,
					customer: guest,
				}),
			).rejects.toThrow(/closed on that day — start on a day it's open/);
		}
		// Starting on an open day and running THROUGH both still sells.
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(11),
			customer: guest,
		});
		expect(shortId).toMatch(/^ORD-/);
	});

	test("a stay is never sent the weekly day off — it doesn't touch stays", async () => {
		const t = setup();
		const { asOwner, productId } = await listing(t, { capacityPerNight: 2 });
		await asOwner.mutation(api.retailers.updateSettings, {
			openingHours: Array.from({ length: 7 }, (_, i) =>
				i === 0
					? { open: 540, close: 1080, closed: true }
					: { open: 540, close: 1080 },
			),
		});
		const window = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(10),
		});
		expect(window?.closedWeekdays).toEqual([]);
	});

	test("a BLOCK still refuses the package — blocked keeps meaning 'can't be booked'", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await listing(t, {
			packageLength: 1,
			packageUnit: "month",
		});
		await asOwner.mutation(api.bookingBlocks.blockDays, {
			retailerId: retailer._id,
			startDate: day(20),
			endDate: day(20),
		});
		await expect(
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(10),
				customer: guest,
			}),
		).rejects.toThrow(/no longer available/);
	});

	test("the seller calendar marks the closure on every view, whatever listing is in scope", async () => {
		const t = setup();
		const { asOwner, retailer, productId, close } = await listing(t, {
			packageLength: 1,
			packageUnit: "month",
		});
		await close(day(3), day(4));
		const month = await asOwner.query(api.bookingBlocks.sellerCalendar, {
			retailerId: retailer._id,
			from: day(0),
			to: day(10),
			productId,
		});
		expect(month.days.filter((d) => d.closed).map((d) => d.date)).toEqual([
			day(3),
			day(4),
		]);
		// Closed is not blocked: the block flag stays the seller's own.
		expect(month.days.some((d) => d.blocked)).toBe(false);
		expect(month.closures).toHaveLength(1);
	});
});

describe("open-days packages — 'Only days you're open'", () => {
	const guest = { name: "Guest", waPhone: "0123456781" };
	/** MYT weekday (0 = Sunday) of a midnight — inline, clock-independent. */
	const weekdayOf = (epoch: number) => new Date(epoch + 8 * 3_600_000).getUTCDay();

	async function course(t: ReturnType<typeof setup>) {
		const { asOwner, retailer } = await seedStore(t);
		const productId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "5-day kayak course",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			kind: "booking" as const,
			booking: {
				capacityPerNight: 4,
				packageLength: 5,
				packageUnit: "day",
				skipsClosedDays: true,
				autoAccept: true,
			},
			variants: [{ optionValues: [], price: 50000, onHand: 0 }],
		});
		// Shut on day(5)'s weekday every week, and on day(3) for Raya.
		await asOwner.mutation(api.retailers.updateSettings, {
			openingHours: Array.from({ length: 7 }, (_, i) =>
				i === weekdayOf(day(5))
					? { open: 540, close: 1080, closed: true }
					: { open: 540, close: 1080 },
			),
		});
		await asOwner.mutation(api.closedDates.add, {
			retailerId: retailer._id,
			startDate: day(3),
			endDate: day(3),
			label: "Hari Raya",
		});
		return { asOwner, retailer, productId };
	}

	test("the flag is refused on every shape it can't mean anything for", async () => {
		const t = setup();
		const { asOwner, retailer } = await seedStore(t);
		const make = (booking: Record<string, unknown>) =>
			asOwner.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "X",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 1,
				kind: "booking" as const,
				booking: { skipsClosedDays: true, ...booking },
				variants: [{ optionValues: [], price: 100, onHand: 0 }],
			});
		await expect(make({})).rejects.toThrow(/set a package length first/);
		await expect(
			make({ packageLength: 1, packageUnit: "month" }),
		).rejects.toThrow(/runs by the calendar/);
		await expect(
			make({ packageLength: 2, packageUnit: "night" }),
		).rejects.toThrow(/package of nights is a stay/);
		// false has one spelling: unset.
		const id = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Y",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 2,
			kind: "booking" as const,
			booking: { packageLength: 5, packageUnit: "day", skipsClosedDays: false },
			variants: [{ optionValues: [], price: 100, onHand: 0 }],
		});
		const stored = await t.run((ctx) => ctx.db.get(id));
		expect(stored?.booking?.skipsClosedDays).toBeUndefined();
	});

	test("five OPEN days: the term runs past the closures, and the order freezes what it skipped", async () => {
		const t = setup();
		const { retailer, productId } = await course(t);
		const window = await t.query(api.bookings.availability, {
			productId,
			from: day(0),
			to: day(20),
		});
		expect(window?.closureRule).toBe("skipped");
		expect(window?.closedWeekdays).toEqual([weekdayOf(day(5))]);
		// Starting day 1: counts 1, 2, 4, 6, 7 — steps over 3 (Raya) and 5.
		const { shortId } = await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(1),
			customer: guest,
		});
		const order = await t.run((ctx) =>
			ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first(),
		);
		expect(order?.bookingCheckIn).toBe(day(1));
		expect(order?.bookingCheckOut).toBe(day(8));
		expect(order?.bookingSkippedDays).toEqual([day(3), day(5)]);
		// A later edit to the hours never re-describes the paid package.
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, { openingHours: undefined });
		});
		const again = await t.run((ctx) => ctx.db.get(order!._id));
		expect(again?.bookingSkippedDays).toEqual([day(3), day(5)]);
	});

	test("the seller's grid doesn't put a member on a day their package skips", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await course(t);
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(1),
			customer: guest,
		});
		const month = await asOwner.query(api.bookingBlocks.sellerCalendar, {
			retailerId: retailer._id,
			from: day(0),
			to: day(10),
			productId,
		});
		const booked = (d: number) =>
			month.days.find((row) => row.date === d)?.booked;
		expect(booked(day(4))).toBe(1);
		expect(booked(day(5))).toBe(0); // the weekly day off it stepped over
		expect(booked(day(3))).toBe(0); // Raya
		expect(
			await asOwner.query(api.bookingBlocks.dayBookings, {
				retailerId: retailer._id,
				date: day(5),
			}),
		).toEqual([]);
	});

	test("the seller calendar knows the listing counts open days, and the day sheet counts them", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await course(t);
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(1),
			customer: guest,
		});
		const month = await asOwner.query(api.bookingBlocks.sellerCalendar, {
			retailerId: retailer._id,
			from: day(0),
			to: day(10),
			productId,
		});
		// Without the flag the client read this listing as an every-day one.
		expect(month.listings[0]?.skipsClosedDays).toBe(true);
		expect(month.closedWeekdays).toEqual([weekdayOf(day(5))]);
		const [row] = await asOwner.query(api.bookingBlocks.dayBookings, {
			retailerId: retailer._id,
			date: day(4),
		});
		expect(row?.skippedDays).toEqual([day(3), day(5)]);
		// The status as the seller's pages name it — never the raw key.
		expect(row?.statusLabel).toBe("Confirmed");
	});

	test("the approve card's capacity line ignores the days this booking skips", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await course(t);
		const request = (name: string, waPhone: string) =>
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(1),
				customer: { name, waPhone },
			});
		const mine = await request("Mine", "0123456781");
		// Two others who are ONLY there on day 3 — a day mine skips (Raya).
		for (const [name, phone] of [
			["Other A", "0123456782"],
			["Other B", "0123456783"],
		] as const) {
			const other = await request(name, phone);
			await t.run(async (ctx) => {
				const row = await ctx.db
					.query("orders")
					.withIndex("by_shortId", (q) => q.eq("shortId", other.shortId))
					.first();
				if (!row) throw new Error("missing");
				await ctx.db.patch(row._id, {
					bookingCheckIn: day(3),
					bookingCheckOut: day(4),
					bookingSkippedDays: undefined,
				});
			});
		}
		const read = await asOwner.query(api.orders.get, {
			shortId: mine.shortId,
		});
		// Nobody shares a day mine is actually there.
		expect(read?.bookingContext?.peakOtherBookings).toBe(0);
	});

	test("can't start on a shut day — the buyer is told to pick an open one", async () => {
		const t = setup();
		const { retailer, productId } = await course(t);
		await expect(
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(3),
				customer: guest,
			}),
		).rejects.toThrow(/closed on that day — start on a day it's open/);
	});

	test("a block on a SKIPPED day doesn't refuse the course; one on a counted day does", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await course(t);
		// The weekly day off inside the term, blocked too — never used, so fine.
		await asOwner.mutation(api.bookingBlocks.blockDays, {
			retailerId: retailer._id,
			startDate: day(5),
			endDate: day(5),
		});
		await t.mutation(api.bookings.requestBooking, {
			retailerId: retailer._id,
			productId,
			checkIn: day(1),
			customer: guest,
		});
		await asOwner.mutation(api.bookingBlocks.blockDays, {
			retailerId: retailer._id,
			startDate: day(6),
			endDate: day(6),
		});
		await expect(
			t.mutation(api.bookings.requestBooking, {
				retailerId: retailer._id,
				productId,
				checkIn: day(1),
				customer: { name: "Second", waPhone: "0123456782" },
			}),
		).rejects.toThrow(/no longer available/);
	});
});
