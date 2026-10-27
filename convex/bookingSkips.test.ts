/// <reference types="vite/client" />
/**
 * "Skip a day" on an open-days package (z8r3fdh3ay), end to end: the Sue Chef
 * shape — a Mon–Fri kitchen selling 5-meal-day plans — through the real
 * mutations, so the frozen flag, the extension, the cap, undo, the timeline
 * event and the no-message rule are each pinned where they actually happen.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_sue_chef";
const weekdayOf = (epoch: number) =>
	new Date(epoch + 8 * 3_600_000).getUTCDay();
/** The next Monday at least two days out — a plan that hasn't started, so
 * every skip below is a future day and the test is clock-independent. */
function nextMonday(): number {
	let day = todayMytMidnight(Date.now()) + 2 * DAY_MS;
	while (weekdayOf(day) !== 1) day += DAY_MS;
	return day;
}

async function seedKitchen(
	t: ReturnType<typeof setup>,
	booking: Record<string, unknown> = {},
) {
	const asOwner = t.withIdentity({ subject: USER });
	await asOwner.mutation(api.retailers.createRetailer, {
		storeName: "Sue Chef Kitchen",
		slug: "sue-chef",
	});
	const retailer = await asOwner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	// Shut Saturday and Sunday — "Mon–Fri, public holidays skipped".
	await asOwner.mutation(api.retailers.updateSettings, {
		openingHours: Array.from({ length: 7 }, (_, i) =>
			i === 0 || i === 6
				? { open: 600, close: 1200, closed: true }
				: { open: 600, close: 1200 },
		),
	});
	const productId = await asOwner.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "5-day dinner plan",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		kind: "booking" as const,
		booking: {
			packageLength: 5,
			packageUnit: "day",
			skipsClosedDays: true,
			autoAccept: true,
			...booking,
		},
		variants: [{ optionValues: [], price: 7500, onHand: 0 }],
	});
	return { asOwner, retailer, productId };
}

async function buyPlan(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	checkIn: number,
	waPhone = "0123456781",
) {
	const { shortId } = await t.mutation(api.bookings.requestBooking, {
		retailerId,
		productId,
		checkIn,
		customer: { name: "Aisyah", waPhone },
	});
	const order = await t.run((ctx) =>
		ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first(),
	);
	if (!order) throw new Error("order not created");
	return order;
}

const getOrder = (t: ReturnType<typeof setup>, id: Id<"orders">) =>
	t.run((ctx) => ctx.db.get(id));

describe("skipPackageDay — the Mon–Fri meal plan", () => {
	test("the order freezes that it counts open days; a skip moves the last day across the weekend", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await seedKitchen(t);
		const mon = nextMonday();
		const order = await buyPlan(t, retailer._id, productId, mon);
		expect(order.bookingOpenDays).toBe(true);
		expect(order.bookingCheckOut).toBe(mon + 5 * DAY_MS);

		const result = await asOwner.mutation(api.bookings.skipPackageDay, {
			orderId: order._id,
			day: mon + 2 * DAY_MS,
		});
		// Wed skipped → the fifth meal is NEXT Monday, not Saturday.
		expect(result).toEqual({ alreadySkipped: false, lastDay: mon + 7 * DAY_MS });
		const after = await getOrder(t, order._id);
		expect(after?.bookingCheckIn).toBe(mon);
		expect(after?.bookingCheckOut).toBe(mon + 8 * DAY_MS);
		expect(after?.bookingSkippedDays).toEqual([
			mon + 2 * DAY_MS,
			mon + 5 * DAY_MS,
			mon + 6 * DAY_MS,
		]);
		expect(after?.bookingCustomerSkips).toEqual([mon + 2 * DAY_MS]);
		// Money never moves.
		expect(after?.total).toBe(order.total);
		expect(after?.items).toEqual(order.items);

		const events = await t.run((ctx) =>
			ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", order._id))
				.collect(),
		);
		const skipEvent = events.find((e) => e.action === "booking_day_skipped");
		expect(skipEvent?.status).toBe("confirmed");
		expect(skipEvent?.actorUserId).toBe(USER);
		expect(skipEvent?.note).toMatch(/^Skipped Wed, .* — last day now Mon, /);
	});

	test("sends no message — nothing is scheduled by a skip or an undo", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await seedKitchen(t);
		const mon = nextMonday();
		const order = await buyPlan(t, retailer._id, productId, mon);
		const scheduled = () =>
			t.run(
				async (ctx) =>
					(await ctx.db.system.query("_scheduled_functions").collect()).length,
			);
		const before = await scheduled();
		await asOwner.mutation(api.bookings.skipPackageDay, {
			orderId: order._id,
			day: mon + DAY_MS,
		});
		await asOwner.mutation(api.bookings.unskipPackageDay, {
			orderId: order._id,
			day: mon + DAY_MS,
		});
		expect(await scheduled()).toBe(before);
	});

	test("a second skip of the same day is a no-op that says so", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await seedKitchen(t);
		const mon = nextMonday();
		const order = await buyPlan(t, retailer._id, productId, mon);
		await asOwner.mutation(api.bookings.skipPackageDay, {
			orderId: order._id,
			day: mon,
		});
		const again = await asOwner.mutation(api.bookings.skipPackageDay, {
			orderId: order._id,
			day: mon,
		});
		expect(again.alreadySkipped).toBe(true);
		expect((await getOrder(t, order._id))?.bookingCustomerSkips).toEqual([mon]);
	});

	test("refuses a weekend, and the listing's cap", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await seedKitchen(t, {
			maxSkips: 1,
		});
		const mon = nextMonday();
		// Thu start: the plan already steps over Sat + Sun.
		const order = await buyPlan(t, retailer._id, productId, mon + 3 * DAY_MS);
		await expect(
			asOwner.mutation(api.bookings.skipPackageDay, {
				orderId: order._id,
				day: mon + 5 * DAY_MS,
			}),
		).rejects.toThrow(/store is closed that day/);
		await asOwner.mutation(api.bookings.skipPackageDay, {
			orderId: order._id,
			day: mon + 3 * DAY_MS,
		});
		await expect(
			asOwner.mutation(api.bookings.skipPackageDay, {
				orderId: order._id,
				day: mon + 4 * DAY_MS,
			}),
		).rejects.toThrow(/The one skip on this plan is used/);
	});

	test("undo reverses only the latest skip and writes its own event", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await seedKitchen(t);
		const mon = nextMonday();
		const order = await buyPlan(t, retailer._id, productId, mon);
		await asOwner.mutation(api.bookings.skipPackageDay, {
			orderId: order._id,
			day: mon + 3 * DAY_MS,
		});
		await asOwner.mutation(api.bookings.skipPackageDay, {
			orderId: order._id,
			day: mon + DAY_MS,
		});
		await expect(
			asOwner.mutation(api.bookings.unskipPackageDay, {
				orderId: order._id,
				day: mon + 3 * DAY_MS,
			}),
		).rejects.toThrow(/Only the latest skip/);
		const undone = await asOwner.mutation(api.bookings.unskipPackageDay, {
			orderId: order._id,
			day: mon + DAY_MS,
		});
		expect(undone.lastDay).toBe(mon + 7 * DAY_MS);
		await asOwner.mutation(api.bookings.unskipPackageDay, {
			orderId: order._id,
			day: mon + 3 * DAY_MS,
		});
		const after = await getOrder(t, order._id);
		// Back to exactly the plan that was sold — the fields unset, not [].
		expect(after?.bookingCheckOut).toBe(mon + 5 * DAY_MS);
		expect(after?.bookingSkippedDays).toBeUndefined();
		expect(after?.bookingCustomerSkips).toBeUndefined();
		const actions = (
			await t.run((ctx) =>
				ctx.db
					.query("orderEvents")
					.withIndex("by_order", (q) => q.eq("orderId", order._id))
					.collect(),
			)
		)
			.map((e) => e.action)
			.filter(Boolean);
		expect(actions).toEqual([
			"booking_day_skipped",
			"booking_day_skipped",
			"booking_day_skip_undone",
			"booking_day_skip_undone",
		]);
	});

	test("a capped listing that's full on the new last day refuses the skip", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await seedKitchen(t, {
			capacityPerNight: 1,
		});
		const mon = nextMonday();
		const order = await buyPlan(t, retailer._id, productId, mon);
		// Someone else holds the only seat from next Monday.
		await buyPlan(t, retailer._id, productId, mon + 7 * DAY_MS, "0123456782");
		await expect(
			asOwner.mutation(api.bookings.skipPackageDay, {
				orderId: order._id,
				day: mon + DAY_MS,
			}),
		).rejects.toThrow(/blocked or fully booked/);
	});

	test("strangers can't skip; an every-day package has no skip at all", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await seedKitchen(t);
		const mon = nextMonday();
		const order = await buyPlan(t, retailer._id, productId, mon);
		await expect(
			t
				.withIdentity({ subject: "someone_else" })
				.mutation(api.bookings.skipPackageDay, { orderId: order._id, day: mon }),
		).rejects.toThrow();

		const passId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "5-day pass",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			kind: "booking" as const,
			booking: { packageLength: 5, packageUnit: "day", autoAccept: true },
			variants: [{ optionValues: [], price: 7500, onHand: 0 }],
		});
		const pass = await buyPlan(t, retailer._id, passId, mon, "0123456783");
		expect(pass.bookingOpenDays).toBe(false);
		expect(
			(await t.query(api.orders.get, { token: pass.trackingToken }))
				?.bookingSkippable,
		).toBeUndefined();
		expect(
			await asOwner.query(api.bookings.skipPlan, { orderId: pass._id }),
		).toBeNull();
		await expect(
			asOwner.mutation(api.bookings.skipPackageDay, {
				orderId: pass._id,
				day: mon,
			}),
		).rejects.toThrow(/Only a package counted in open days/);
		// The open-days plan's control gets the cap + the store's schedule.
		expect(
			await asOwner.query(api.bookings.skipPlan, { orderId: order._id }),
		).toEqual({ maxSkips: undefined, closedWeekdays: [0, 6], closedDates: [] });
	});

	test("an older order without the frozen flag falls back to its listing", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await seedKitchen(t);
		const mon = nextMonday();
		const order = await buyPlan(t, retailer._id, productId, mon);
		await t.run((ctx) => ctx.db.patch(order._id, { bookingOpenDays: undefined }));
		// The buyer's read says so too, so /track isn't silent on it.
		const buyerView = await t.query(api.orders.get, {
			token: order.trackingToken,
		});
		expect(buyerView?.bookingSkippable).toBe(true);
		const result = await asOwner.mutation(api.bookings.skipPackageDay, {
			orderId: order._id,
			day: mon,
		});
		expect(result.alreadySkipped).toBe(false);
	});
});

describe("products — the per-package skip cap", () => {
	test("round-trips, 0 clears, and an every-day package refuses it", async () => {
		const t = setup();
		const { asOwner, retailer, productId } = await seedKitchen(t, {
			maxSkips: 3,
		});
		expect((await t.run((ctx) => ctx.db.get(productId)))?.booking?.maxSkips).toBe(
			3,
		);
		await asOwner.mutation(api.products.update, {
			productId,
			booking: {
				packageLength: 5,
				packageUnit: "day",
				skipsClosedDays: true,
				maxSkips: 0,
			},
		});
		expect(
			(await t.run((ctx) => ctx.db.get(productId)))?.booking?.maxSkips,
		).toBeUndefined();
		await expect(
			asOwner.mutation(api.products.create, {
				retailerId: retailer._id,
				name: "Every-day pass",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 2,
				kind: "booking" as const,
				booking: { packageLength: 5, packageUnit: "day", maxSkips: 2 },
				variants: [{ optionValues: [], price: 100, onHand: 0 }],
			}),
		).rejects.toThrow(/Only a package counted in open days can be skipped/);
		await expect(
			asOwner.mutation(api.products.update, {
				productId,
				booking: {
					packageLength: 5,
					packageUnit: "day",
					skipsClosedDays: true,
					maxSkips: 2.5,
				},
			}),
		).rejects.toThrow(/whole number between 1 and 99/);
	});
});
