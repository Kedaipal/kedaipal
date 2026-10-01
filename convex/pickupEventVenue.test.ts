/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * Event venues (`z8r3fdm32x`) — an address that HOSTS events and is never a
 * checkout option.
 *
 * Before `eventsOnly` existed, a seller expressed this by DEACTIVATING the
 * point, which overloaded `isActive` with two unrelated meanings. These tests
 * pin the separation: a venue is active (it is in use) and simultaneously not
 * choosable, and every surface that asks "can a buyer collect here?" agrees.
 *
 * Its own file rather than another describe in `pickupLocations.test.ts`: that
 * file is already 1200+ lines of CRUD, and this is one invariant crossing four
 * call sites.
 */

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_venue";

async function seedRetailer(t: ReturnType<typeof convexTest>) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Test Store",
		slug: "venue-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function addPoint(
	t: ReturnType<typeof convexTest>,
	retailerId: Id<"retailers">,
	label: string,
	eventsOnly?: boolean,
): Promise<Id<"pickupLocations">> {
	const { pickupLocationId } = await t
		.withIdentity({ subject: USER })
		.mutation(api.pickupLocations.create, {
			retailerId,
			label,
			address: "12 Jln Tun Razak, 50400 Kuala Lumpur",
			eventsOnly,
		});
	return pickupLocationId;
}

describe("an event venue is live, but never a checkout option", () => {
	test("the storefront picker omits it while keeping the ordinary points", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await addPoint(t, retailer._id, "Main Store");
		await addPoint(t, retailer._id, "Community Hall", true);

		const offered = await t.query(api.pickupLocations.listActivePublicBySlug, {
			slug: retailer.slug,
		});
		expect(offered.map((p) => p.label)).toEqual(["Main Store"]);
	});

	test("it stays ACTIVE — the seller never has to retire it to hide it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const venueId = await addPoint(t, retailer._id, "Community Hall", true);

		const rows = await t
			.withIdentity({ subject: USER })
			.query(api.pickupLocations.listForRetailer, { retailerId: retailer._id });
		const venue = rows.find((r) => r._id === venueId);
		// The whole point of the flag: "in use" and "offered at checkout" stop
		// being the same bit.
		expect(venue?.isActive).toBe(true);
		expect(venue?.eventsOnly).toBe(true);
	});

	/**
	 * The dangerous half. `orders.create` asks "does this store offer pickup?"
	 * before demanding a `pickupLocationId`. If venues counted, a venue-only
	 * store would demand a point the buyer was never shown and checkout would
	 * dead-end on "Pick a pickup location to continue".
	 */
	test("a venue-only store reads as offering no pickup at all", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await addPoint(t, retailer._id, "Community Hall", true);

		const asUser = t.withIdentity({ subject: USER });
		expect(
			await asUser.query(api.pickupLocations.hasAnyActive, {
				retailerId: retailer._id,
			}),
		).toEqual({ hasAny: false });
		expect(
			await t.query(api.pickupLocations.listActivePublicBySlug, {
				slug: retailer.slug,
			}),
		).toEqual([]);
	});

	test("adding a real pickup point alongside flips it back on", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await addPoint(t, retailer._id, "Community Hall", true);
		await addPoint(t, retailer._id, "Main Store");

		expect(
			await t
				.withIdentity({ subject: USER })
				.query(api.pickupLocations.hasAnyActive, { retailerId: retailer._id }),
		).toEqual({ hasAny: true });
	});
});

describe("the flag moves a point between the two lists", () => {
	test("update can promote an ordinary point to a venue", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const id = await addPoint(t, retailer._id, "Main Store");
		const asUser = t.withIdentity({ subject: USER });

		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId: id,
			eventsOnly: true,
		});
		expect(
			await t.query(api.pickupLocations.listActivePublicBySlug, {
				slug: retailer.slug,
			}),
		).toEqual([]);
	});

	/**
	 * `false` CLEARS the field rather than storing it, so "moved back" and
	 * "never was one" are a single state — every reader treats absent and false
	 * alike, and a stored `false` would be a second spelling of the same answer.
	 */
	test("passing false sends it back to checkout and leaves no stored false", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const id = await addPoint(t, retailer._id, "Main Store", true);
		const asUser = t.withIdentity({ subject: USER });

		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId: id,
			eventsOnly: false,
		});

		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].eventsOnly).toBeUndefined();
		expect(
			(
				await t.query(api.pickupLocations.listActivePublicBySlug, {
					slug: retailer.slug,
				})
			).map((p) => p.label),
		).toEqual(["Main Store"]);
	});

	test("omitting the flag on update leaves it alone", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const id = await addPoint(t, retailer._id, "Community Hall", true);
		const asUser = t.withIdentity({ subject: USER });

		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId: id,
			label: "Renamed Hall",
		});

		const rows = await asUser.query(api.pickupLocations.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows[0].label).toBe("Renamed Hall");
		expect(rows[0].eventsOnly).toBe(true);
	});
});

describe("legacy rows", () => {
	test("a point created without the flag is choosable, with nothing stored", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await addPoint(t, retailer._id, "Main Store");

		const rows = await t
			.withIdentity({ subject: USER })
			.query(api.pickupLocations.listForRetailer, { retailerId: retailer._id });
		// No backfill needed: absent reads as false everywhere.
		expect(rows[0].eventsOnly).toBeUndefined();
		expect(
			await t.query(api.pickupLocations.listActivePublicBySlug, {
				slug: retailer.slug,
			}),
		).toHaveLength(1);
	});
});

/**
 * The fulfilment invariant — a storefront must keep at least one WORKING way
 * to receive orders. An event venue is active but nobody can choose it, so it
 * must never be the thing that counts as "pickup works". Three guards enforce
 * this and all three used to count raw active rows.
 */
describe("an event venue can never prop up the fulfilment invariant", () => {
	test("a venue doesn't let a pickup-only store turn its last real point off", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const asUser = t.withIdentity({ subject: USER });
		const realPoint = await addPoint(t, retailer._id, "Main Store");
		await addPoint(t, retailer._id, "Community Hall", true);
		// Pickup-only: delivery off, so the last choosable point is load-bearing.
		await asUser.mutation(api.retailers.updateSettings, {
			retailerId: retailer._id,
			offerSelfCollect: true,
		});
		await asUser.mutation(api.retailers.updateSettings, {
			retailerId: retailer._id,
			offerDelivery: false,
		});

		// Two rows are active, but only ONE is choosable.
		await expect(
			asUser.mutation(api.pickupLocations.setActive, {
				pickupLocationId: realPoint,
				isActive: false,
			}),
		).rejects.toThrow(/no way to receive orders/i);
	});

	test("a venue doesn't let a store switch to pickup-only with nothing to pick", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const asUser = t.withIdentity({ subject: USER });
		await addPoint(t, retailer._id, "Community Hall", true);

		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				retailerId: retailer._id,
				offerSelfCollect: true,
				offerDelivery: false,
			}),
		).rejects.toThrow(/pickup location|no way to receive orders/i);
	});

	test("a real point alongside the venue allows the same switch", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const asUser = t.withIdentity({ subject: USER });
		await addPoint(t, retailer._id, "Community Hall", true);
		await addPoint(t, retailer._id, "Main Store");

		await asUser.mutation(api.retailers.updateSettings, {
			retailerId: retailer._id,
			offerSelfCollect: true,
			offerDelivery: false,
		});
		const r = await asUser.query(api.retailers.getMyRetailer);
		expect(r?.offerSelfCollect).toBe(true);
		expect(r?.offerDelivery).toBe(false);
	});
});
