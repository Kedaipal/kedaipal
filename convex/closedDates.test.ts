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
