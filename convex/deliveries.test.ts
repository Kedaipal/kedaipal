/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * deliveries.overview (86eye9xd4, 6A) — the Deliveries page and the Home card
 * read one answer. These pin what each list means: a failed booking only
 * needs attention while it is the order's NEWEST and the order is still
 * waiting, and a parcel only waits for a consignment number while nothing
 * else is carrying it.
 */

const modules = import.meta.glob("./**/*.ts");
const USER = "user_deliveries_tests";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

async function seedStore(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Ship Co",
		slug: "ship-co",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return { asUser, retailerId: retailer._id };
}

let n = 0;
async function order(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	over: Partial<Doc<"orders">> = {},
): Promise<Id<"orders">> {
	return t.run((ctx) =>
		ctx.db.insert("orders", {
			retailerId,
			shortId: `ORD-${1000 + n++}`,
			items: [],
			subtotal: 5000,
			total: 5000,
			currency: "MYR",
			status: "packed",
			channel: "whatsapp",
			customer: { name: "Aisha" },
			deliveryMethod: "delivery",
			deliveryAddress: {
				line1: "1 Jalan",
				city: "Kuching",
				state: "Sarawak",
				postcode: "93000",
			},
			createdAt: Date.now(),
			updatedAt: Date.now(),
			...over,
		}),
	);
}

async function job(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	orderId: Id<"orders">,
	over: Partial<Doc<"deliveryJobs">> = {},
) {
	return t.run((ctx) =>
		ctx.db.insert("deliveryJobs", {
			orderId,
			retailerId,
			provider: "lalamove",
			status: "ongoing",
			costActual: 1160,
			quotationId: "q",
			vehicleType: "MOTORCYCLE",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			...over,
		}),
	);
}

describe("deliveries.overview", () => {
	test("a failed booking needs attention only while it's the order's newest and the order still waits", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedStore(t);
		const waiting = await order(t, retailerId);
		const rebooked = await order(t, retailerId);
		const shippedAnyway = await order(t, retailerId, { status: "shipped" });
		await job(t, retailerId, waiting, { status: "rejected", createdAt: 1 });
		await job(t, retailerId, rebooked, { status: "expired", createdAt: 2 });
		await job(t, retailerId, rebooked, { status: "ongoing", createdAt: 3 });
		await job(t, retailerId, shippedAnyway, { status: "canceled", createdAt: 4 });

		const o = await asUser.query(api.deliveries.overview, { retailerId });
		expect(o.counts).toMatchObject({ active: 1, needsAttention: 1 });
		expect(o.booksCouriers).toBe(true);
		const failed = o.jobs.filter((j) => j.group === "failed");
		expect(failed.map((j) => j.orderSettled).sort()).toEqual([false, false, true]);
		// Exactly one failure asks for a rebook — the page and the count agree.
		expect(o.jobs.filter((j) => j.rebookable).map((j) => j.orderId)).toEqual([
			waiting,
		]);
	});

	test("the parcel queue: packed, by courier, no number yet, nothing else carrying it", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedStore(t);
		const ready = await order(t, retailerId, { paymentStatus: "received" });
		await order(t, retailerId, { deliveryMethod: "self_collect" });
		await order(t, retailerId, { deliveryDirection: "collection" });
		await order(t, retailerId, { trackingNo: "JT123" });
		const riderOut = await order(t, retailerId);
		await job(t, retailerId, riderOut);
		// A failed booking puts the order under "to rebook", never ALSO in the
		// queue — one order, one ask.
		const failedBooking = await order(t, retailerId);
		await job(t, retailerId, failedBooking, { status: "expired" });
		await order(t, retailerId, {
			status: "shipped",
			courierName: "J&T",
			trackingNo: "631234567890",
		});

		const o = await asUser.query(api.deliveries.overview, { retailerId });
		expect(o.toShip.map((r) => r.orderId)).toEqual([ready]);
		expect(o.toShip[0]).toMatchObject({
			destination: "Kuching, Sarawak",
			labelReady: true,
			gated: false,
		});
		expect(o.inTransit).toHaveLength(1);
		expect(o.inTransit[0]).toMatchObject({
			courierName: "J&T",
			trackingNo: "631234567890",
		});
		expect(o.counts).toMatchObject({ toShip: 1, inTransit: 1, needsAttention: 1 });
		expect(o.shipsParcels).toBe(true);
		// Nothing switched on to book with: the queue's next step is a number.
		expect(o.bookingArmed).toBe(false);
	});

	test("the month counts what went out or is going, never the failures", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedStore(t);
		const a = await order(t, retailerId, { status: "delivered" });
		await job(t, retailerId, a, { status: "completed", costActual: 1840 });
		await job(t, retailerId, a, { status: "rejected", costActual: 900 });
		await job(t, retailerId, a, {
			status: "completed",
			costActual: 5000,
			createdAt: Date.UTC(2020, 0, 1),
		});
		const o = await asUser.query(api.deliveries.overview, { retailerId });
		expect(o.month).toMatchObject({ bookings: 1, cost: 1840, partial: false });
	});

	test("a radius store with nothing out doesn't get a parcel section", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedStore(t);
		await t.run((ctx) =>
			ctx.db.patch(retailerId, {
				deliveryConfig: {
					mode: "radius",
					bands: [{ maxKm: 5, fee: 500 }],
					outOfRange: "arrange",
				},
			}),
		);
		const o = await asUser.query(api.deliveries.overview, { retailerId });
		expect(o.shipsParcels).toBe(false);
		expect(o.booksCouriers).toBe(false);
	});

	test("another store's seller can't read it", async () => {
		const t = setup();
		const { retailerId } = await seedStore(t);
		await expect(
			t
				.withIdentity({ subject: "user_stranger" })
				.query(api.deliveries.overview, { retailerId }),
		).rejects.toThrow();
	});
});
