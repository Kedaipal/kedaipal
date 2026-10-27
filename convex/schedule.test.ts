/// <reference types="vite/client" />
/**
 * Orders → Schedule (`z8r3fdjv0d`): the query's window, its two plan/role
 * gates, and the counts it hands back against the RSVP panel's own numbers.
 * The grouping rules themselves are pinned in `lib/scheduleRows.test.ts`; this
 * file is about what reaches them.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ensureCreditAccount } from "./credits";
import { settleScheduled } from "./lib/convexTestSettle";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

let current: ReturnType<typeof convexTest> | undefined;
afterEach(async () => {
	const t = current;
	current = undefined;
	if (t) await settleScheduled(t);
});

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	current = t;
	return t;
}

type T = ReturnType<typeof setup>;

const OWNER = "user_schedule_owner";
const today = () => todayMytMidnight();
const day = (n: number) => today() + n * DAY_MS;
const customer = { name: "Masturah", waPhone: "60123456789" };

async function seedStore(t: T, plan: "pro" | "starter" = "pro") {
	const asOwner = t.withIdentity({ subject: OWNER });
	await asOwner.mutation(api.retailers.createRetailer, {
		storeName: "Dr Niki Trainings",
		slug: "dr-niki",
	});
	const retailer = await asOwner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await asOwner.mutation(api.retailers.updateSettings, { offerSelfCollect: true });
	const { pickupLocationId } = await asOwner.mutation(api.pickupLocations.create, {
		retailerId: retailer._id,
		label: "Ballroom",
		address: "12 Jln Tun Razak, 50400 KL",
	});
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.first();
		if (sub) await ctx.db.patch(sub._id, { status: "active", plan });
	});
	return { asOwner, retailerId: retailer._id, pickupLocationId };
}

async function seedEvent(
	t: T,
	retailerId: Id<"retailers">,
	opts: { name: string; date: number; seats?: number; price?: number },
) {
	const productId = await t
		.withIdentity({ subject: OWNER })
		.mutation(api.products.create, {
			retailerId,
			name: opts.name,
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			event: { date: opts.date, timeMinutes: 12 * 60, seats: opts.seats },
			variants: [{ optionValues: [], price: opts.price ?? 15000, onHand: 0 }],
		});
	const variantId = await t.run(async (ctx) => {
		const v = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.first();
		if (!v) throw new Error("variant missing");
		return v._id;
	});
	return { productId, variantId };
}

async function rsvp(
	t: T,
	store: Awaited<ReturnType<typeof seedStore>>,
	variantId: Id<"productVariants">,
	quantity = 1,
) {
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId: store.retailerId,
		items: [{ variantId, quantity }],
		currency: "MYR",
		channel: "whatsapp",
		customer,
		deliveryMethod: "self_collect",
		pickupLocationId: store.pickupLocationId,
	});
	return shortId;
}

async function patchOrder(
	t: T,
	shortId: string,
	patch: Record<string, unknown>,
) {
	await t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error("order missing");
		await ctx.db.patch(o._id, patch);
	});
}

const ask = (t: T, retailerId: Id<"retailers">, from = day(0), to = day(90)) =>
	t
		.withIdentity({ subject: OWNER })
		.query(api.schedule.byDate, { retailerId, fromMyt: from, toMyt: to });

describe("schedule.byDate", () => {
	test("registered and paid agree with the listing's own RSVP panel", async () => {
		const t = setup();
		const store = await seedStore(t);
		const { productId, variantId } = await seedEvent(t, store.retailerId, {
			name: "Luncheon",
			date: day(5),
			seats: 30,
		});
		const a = await rsvp(t, store, variantId, 3);
		const b = await rsvp(t, store, variantId);
		const c = await rsvp(t, store, variantId);
		await patchOrder(t, a, { paymentStatus: "received" });
		await patchOrder(t, b, { paymentStatus: "claimed" });
		await patchOrder(t, c, { status: "cancelled" });

		const { rows, truncated } = await ask(t, store.retailerId);
		expect(truncated).toBe(false);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			productId,
			name: "Luncheon",
			date: day(5),
			seats: 30,
			registered: 4,
			paid: 3,
			claimed: 1,
			unpaid: 0,
		});
		const head = await t
			.withIdentity({ subject: OWNER })
			.query(api.products.eventHeadcount, { productId });
		expect(head?.taken).toBe(rows[0].registered);
	});

	test("an event with nobody registered yet still has its row", async () => {
		const t = setup();
		const store = await seedStore(t);
		await seedEvent(t, store.retailerId, { name: "PSI B7", date: day(15) });
		const { rows } = await ask(t, store.retailerId);
		expect(rows).toEqual([
			expect.objectContaining({ name: "PSI B7", registered: 0 }),
		]);
		// No cap set: the field is absent (the UI reads that as "no cap").
		expect(rows[0].seats).toBeUndefined();
	});

	test("only the asked window — tomorrow's event is outside a today-only ask", async () => {
		const t = setup();
		const store = await seedStore(t);
		await seedEvent(t, store.retailerId, { name: "Today", date: day(0) });
		await seedEvent(t, store.retailerId, { name: "Tomorrow", date: day(1) });
		const { rows } = await ask(t, store.retailerId, day(0), day(0));
		expect(rows.map((r) => r.name)).toEqual(["Today"]);
	});

	test("a multi-day event that began yesterday is on today's schedule, counts included", async () => {
		const t = setup();
		const store = await seedStore(t);
		const { productId, variantId } = await seedEvent(t, store.retailerId, {
			name: "RPJ 5.0",
			date: day(3),
		});
		await rsvp(t, store, variantId, 2);
		// Move the whole event (and its RSVP) back a day, as the calendar will
		// have done by the seminar's second morning.
		await t.run(async (ctx) => {
			await ctx.db.patch(productId, {
				event: { date: day(-1), endDate: day(0), timeMinutes: 9 * 60 },
			});
			const orders = await ctx.db.query("orders").collect();
			for (const o of orders) await ctx.db.patch(o._id, { fulfilmentDate: day(-1) });
		});
		const { rows } = await ask(t, store.retailerId);
		expect(rows).toEqual([
			expect.objectContaining({
				name: "RPJ 5.0",
				date: day(-1),
				endDate: day(0),
				registered: 2,
			}),
		]);
	});

	test("a free event's RSVPs are registered, never owing", async () => {
		const t = setup();
		const store = await seedStore(t);
		const { variantId } = await seedEvent(t, store.retailerId, {
			name: "Open house",
			date: day(4),
			price: 0,
		});
		await rsvp(t, store, variantId, 2);
		const { rows } = await ask(t, store.retailerId);
		expect(rows[0]).toMatchObject({ registered: 2, free: 2, unpaid: 0 });
	});

	test("free means isFreeOrder — a RM0 order still awaiting its price is owing", async () => {
		const t = setup();
		const store = await seedStore(t);
		const { variantId } = await seedEvent(t, store.retailerId, {
			name: "Open house",
			date: day(4),
			price: 0,
		});
		const settled = await rsvp(t, store, variantId);
		const unpriced = await rsvp(t, store, variantId);
		// The seller hasn't quoted this one yet: zero today, not zero for good.
		await patchOrder(t, unpriced, { mockupStatus: "pending" });
		const { rows } = await ask(t, store.retailerId);
		expect(rows[0]).toMatchObject({ registered: 2, free: 1, unpaid: 1 });
		expect(settled).not.toBe(unpriced);
	});

	test("an archived event with RSVPs keeps its row", async () => {
		const t = setup();
		const store = await seedStore(t);
		const { productId, variantId } = await seedEvent(t, store.retailerId, {
			name: "Archived luncheon",
			date: day(6),
		});
		await rsvp(t, store, variantId);
		await t.run(async (ctx) => {
			await ctx.db.patch(productId, { active: false });
		});
		const { rows } = await ask(t, store.retailerId);
		expect(rows).toEqual([
			expect.objectContaining({ name: "Archived luncheon", registered: 1 }),
		]);
	});

	test("an order waiting on credits is counted as waiting, not by its payment", async () => {
		const t = setup();
		const store = await seedStore(t);
		await t.run((ctx) => ensureCreditAccount(ctx, store.retailerId, Date.now()));
		const { variantId } = await seedEvent(t, store.retailerId, {
			name: "Luncheon",
			date: day(5),
		});
		const shortId = await rsvp(t, store, variantId);
		await patchOrder(t, shortId, { neverFunded: true, paymentStatus: "received" });
		const { rows } = await ask(t, store.retailerId);
		expect(rows[0]).toMatchObject({ registered: 1, waitingOnCredits: 1, paid: 0 });
	});

	test("a store with only dated-less products has no rows", async () => {
		const t = setup();
		const store = await seedStore(t);
		await t.withIdentity({ subject: OWNER }).mutation(api.products.create, {
			retailerId: store.retailerId,
			name: "Kuih box",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 2000, onHand: 10 }],
		});
		expect((await ask(t, store.retailerId)).rows).toEqual([]);
	});

	test("Starter is refused — the schedule is gated with the inbox", async () => {
		const t = setup();
		const store = await seedStore(t, "starter");
		await expect(ask(t, store.retailerId)).rejects.toThrow(/Pro plan/);
	});

	test("a stranger can't read another store's schedule", async () => {
		const t = setup();
		const store = await seedStore(t);
		await expect(
			t.withIdentity({ subject: "user_stranger" }).query(api.schedule.byDate, {
				retailerId: store.retailerId,
				fromMyt: day(0),
				toMyt: day(1),
			}),
		).rejects.toThrow();
	});

	test("the window is bounded — a mid-day edge or a year-long ask is refused", async () => {
		const t = setup();
		const store = await seedStore(t);
		await expect(ask(t, store.retailerId, day(0) + 1, day(5))).rejects.toThrow(
			/MYT midnights/,
		);
		await expect(ask(t, store.retailerId, day(0), day(365))).rejects.toThrow(
			/must span/,
		);
		await expect(ask(t, store.retailerId, day(5), day(0))).rejects.toThrow(
			/must span/,
		);
	});
});

describe("schedule.hasDatedListings", () => {
	test("true for an event store, false for a store selling only goods", async () => {
		const t = setup();
		const store = await seedStore(t);
		const asOwner = t.withIdentity({ subject: OWNER });
		await asOwner.mutation(api.products.create, {
			retailerId: store.retailerId,
			name: "Kuih box",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 2000, onHand: 10 }],
		});
		expect(
			await asOwner.query(api.schedule.hasDatedListings, {
				retailerId: store.retailerId,
			}),
		).toBe(false);
		await seedEvent(t, store.retailerId, { name: "Luncheon", date: day(5) });
		expect(
			await asOwner.query(api.schedule.hasDatedListings, {
				retailerId: store.retailerId,
			}),
		).toBe(true);
	});
});

describe("inbox `listing` filter — where a Schedule row taps to", () => {
	const inbox = (
		t: T,
		retailerId: Id<"retailers">,
		args: { listing?: string; fulfilmentFrom?: number; fulfilmentTo?: number },
	) =>
		t
			.withIdentity({ subject: OWNER })
			.query(api.orders.searchOrders, { retailerId, ...args });

	test("opens exactly the orders the row counted — not a same-named listing", async () => {
		const t = setup();
		const store = await seedStore(t);
		const lunch = await seedEvent(t, store.retailerId, {
			name: "Luncheon",
			date: day(5),
		});
		// Same day, a name that a search for "Luncheon" would also catch.
		const vip = await seedEvent(t, store.retailerId, {
			name: "Luncheon VIP",
			date: day(5),
		});
		const a = await rsvp(t, store, lunch.variantId, 2);
		const b = await rsvp(t, store, lunch.variantId);
		await rsvp(t, store, vip.variantId);

		const res = await inbox(t, store.retailerId, {
			listing: lunch.productId,
			fulfilmentFrom: day(5),
			fulfilmentTo: day(5),
		});
		expect(res.orders.map((o) => o.shortId).sort()).toEqual([a, b].sort());
		expect(res.listingName).toBe("Luncheon");

		const { rows } = await ask(t, store.retailerId);
		const row = rows.find((r) => r.productId === lunch.productId);
		// 2 orders holding 3 seats — the row counts seats, the inbox lists the
		// two buyers to chase.
		expect(row?.registered).toBe(3);
	});

	test("a hand-edited id lists nothing and names nothing — it never errors", async () => {
		const t = setup();
		const store = await seedStore(t);
		const lunch = await seedEvent(t, store.retailerId, {
			name: "Luncheon",
			date: day(5),
		});
		await rsvp(t, store, lunch.variantId);
		const res = await inbox(t, store.retailerId, { listing: "not-an-id" });
		expect(res.orders).toEqual([]);
		expect(res.listingName).toBeNull();
	});

	test("another store's listing id resolves no name", async () => {
		const t = setup();
		const store = await seedStore(t);
		const asOther = t.withIdentity({ subject: "user_other_store" });
		await asOther.mutation(api.retailers.createRetailer, {
			storeName: "Other",
			slug: "other-store",
		});
		const other = await asOther.query(api.retailers.getMyRetailer);
		if (!other) throw new Error("seed failed");
		const foreign = await asOther.mutation(api.products.create, {
			retailerId: other._id,
			name: "Their secret event",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 100, onHand: 1 }],
		});
		const res = await inbox(t, store.retailerId, { listing: foreign });
		expect(res.listingName).toBeNull();
	});

	test("the listing filter is a Pro inbox filter", async () => {
		const t = setup();
		const store = await seedStore(t, "starter");
		await expect(
			inbox(t, store.retailerId, { listing: "anything" }),
		).rejects.toThrow(/Pro plan/);
	});
});
