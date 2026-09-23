/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import schema from "./schema";

/**
 * Event RSVP (`z8r3fdff9u`) — the date lock, the seat cap, and the edit rules
 * that protect guests who have already RSVP'd.
 *
 * Its own file rather than more tests in `orders.test.ts`: the feature is one
 * story told across `products`, `orders`, `counterCheckout` and `orderClaims`,
 * and reading it in one place is what makes the invariants legible.
 */

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_event_host";
const customer = { name: "Ali", waPhone: "60123456789" };
const validAddress = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

/** The event date used throughout: far enough out that "today" never drifts
 * into it mid-run, and past any store notice window a test sets. */
const EVENT_DATE = todayMytMidnight() + 9 * DAY_MS;
/** 8:00 AM — the breakfast this feature was built for. */
const EVENT_TIME = 8 * 60;

async function seedStore(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Huff & Puff",
		slug: "huff-and-puff",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	// Every event is collected at the venue, so a pickup point is a hard
	// prerequisite — the same shape a real event store must be in.
	await asUser.mutation(api.retailers.updateSettings, { offerSelfCollect: true });
	const { pickupLocationId } = await asUser.mutation(
		api.pickupLocations.create,
		{
			retailerId: retailer._id,
			label: "The Studio",
			address: "12 Jln Tun Razak, 50400 KL",
		},
	);
	return { asUser, retailer, pickupLocationId };
}

/** A two-option event product ("Set A" / "Set B") — the food choice the whole
 * feature exists to tally. */
async function seedEventProduct(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	opts: { seats?: number; date?: number; price?: number } = {},
): Promise<Id<"products">> {
	const asUser = t.withIdentity({ subject: USER });
	return asUser.mutation(api.products.create, {
		retailerId,
		name: "BNI Breakfast",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		options: [{ name: "Set", values: ["A", "B"] }],
		event: {
			date: opts.date ?? EVENT_DATE,
			timeMinutes: EVENT_TIME,
			seats: opts.seats,
		},
		variants: [
			{ optionValues: ["A"], price: opts.price ?? 0, onHand: 0 },
			{ optionValues: ["B"], price: opts.price ?? 0, onHand: 0 },
		],
	});
}

async function variantFor(
	t: ReturnType<typeof setup>,
	productId: Id<"products">,
	set: "A" | "B",
): Promise<Id<"productVariants">> {
	return t.run(async (ctx) => {
		const rows = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.collect();
		const hit = rows.find((r) => r.optionValues[0] === set);
		if (!hit) throw new Error(`variant ${set} missing`);
		return hit._id;
	});
}

/** One RSVP, the way the storefront sends it. */
async function rsvp(
	t: ReturnType<typeof setup>,
	args: {
		retailerId: Id<"retailers">;
		variantId: Id<"productVariants">;
		pickupLocationId: Id<"pickupLocations">;
		quantity?: number;
		/** What a stale tab might send — overridden by the server. */
		fulfilmentDate?: number;
	},
) {
	return t.mutation(api.orders.create, {
		retailerId: args.retailerId,
		items: [{ variantId: args.variantId, quantity: args.quantity ?? 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer,
		deliveryMethod: "self_collect",
		pickupLocationId: args.pickupLocationId,
		fulfilmentDate: args.fulfilmentDate,
	});
}

async function orderByShortId(t: ReturnType<typeof setup>, shortId: string) {
	return t.run(async (ctx) =>
		ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first(),
	);
}

describe("event RSVP — the date lock", () => {
	test("the order takes the EVENT's date and time, not the buyer's", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const variantId = await variantFor(t, productId, "A");

		// A stale tab sends tomorrow. The server must ignore it entirely.
		const { shortId } = await rsvp(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
			fulfilmentDate: todayMytMidnight() + DAY_MS,
		});
		const order = await orderByShortId(t, shortId);
		expect(order?.fulfilmentDate).toBe(EVENT_DATE);
		expect(order?.fulfilmentTimeMinutes).toBe(EVENT_TIME);
	});

	test("an RSVP with no date at all still lands on the event", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const variantId = await variantFor(t, productId, "B");

		const { shortId } = await rsvp(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
		});
		expect((await orderByShortId(t, shortId))?.fulfilmentDate).toBe(EVENT_DATE);
	});

	test("delivery is refused — an event is collected at the venue", async () => {
		const t = setup();
		const { retailer } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const variantId = await variantFor(t, productId, "A");

		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ variantId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryMethod: "delivery",
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/collected at the venue/i);
	});

	test("the store's minimum notice never blocks its own event", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		// A 30-day notice window would put every date inside the next month out
		// of reach — including the seller's own event nine days out.
		await asUser.mutation(api.retailers.updateSettings, {
			minFulfilmentNoticeDays: 30,
		});
		const productId = await seedEventProduct(t, retailer._id);
		const variantId = await variantFor(t, productId, "A");

		const { shortId } = await rsvp(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
		});
		expect((await orderByShortId(t, shortId))?.fulfilmentDate).toBe(EVENT_DATE);
	});

	test("an event whose day has passed refuses new RSVPs", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const variantId = await variantFor(t, productId, "A");
		// Move the event into the past behind the sanitizer's back — the state a
		// stale tab reaches the morning after.
		await t.run(async (ctx) => {
			await ctx.db.patch(productId, {
				event: { date: todayMytMidnight() - 2 * DAY_MS, timeMinutes: EVENT_TIME },
			});
		});

		await expect(
			rsvp(t, { retailerId: retailer._id, variantId, pickupLocationId }),
		).rejects.toThrow(/already taken place/i);
	});

	test("an RSVP can't be rescheduled — its date belongs to the event", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const variantId = await variantFor(t, productId, "A");
		const { shortId } = await rsvp(t, {
			retailerId: retailer._id,
			variantId,
			pickupLocationId,
		});
		const order = await orderByShortId(t, shortId);
		if (!order) throw new Error("order missing");

		await expect(
			asUser.mutation(api.orders.rescheduleFulfilment, {
				orderId: order._id,
				fulfilmentDate: EVENT_DATE + DAY_MS,
			}),
		).rejects.toThrow(/RSVP/i);
	});
});

describe("event RSVP — the seat cap", () => {
	test("two carts race for the last seat; exactly one gets it", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id, { seats: 2 });
		const a = await variantFor(t, productId, "A");
		const b = await variantFor(t, productId, "B");

		await rsvp(t, { retailerId: retailer._id, variantId: a, pickupLocationId });
		// One seat left. Two guests want it.
		const results = await Promise.allSettled([
			rsvp(t, { retailerId: retailer._id, variantId: a, pickupLocationId }),
			rsvp(t, { retailerId: retailer._id, variantId: b, pickupLocationId }),
		]);
		const ok = results.filter((r) => r.status === "fulfilled");
		const refused = results.filter((r) => r.status === "rejected");
		expect(ok).toHaveLength(1);
		expect(refused).toHaveLength(1);
		// And the refusal names the number, not a generic failure.
		expect(String((refused[0] as PromiseRejectedResult).reason)).toMatch(
			/seat|fully booked/i,
		);
	});

	test("seats count QUANTITY, not orders — one guest bringing two colleagues takes three", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id, { seats: 4 });
		const a = await variantFor(t, productId, "A");

		await rsvp(t, {
			retailerId: retailer._id,
			variantId: a,
			pickupLocationId,
			quantity: 3,
		});
		// One seat left, so a party of two is refused.
		await expect(
			rsvp(t, {
				retailerId: retailer._id,
				variantId: a,
				pickupLocationId,
				quantity: 2,
			}),
		).rejects.toThrow(/1 seat left/i);
	});

	test("an uncapped event never refuses on seats", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const a = await variantFor(t, productId, "A");

		for (let i = 0; i < 5; i++) {
			await rsvp(t, {
				retailerId: retailer._id,
				variantId: a,
				pickupLocationId,
				quantity: 20,
			});
		}
		const head = await t
			.withIdentity({ subject: USER })
			.query(api.products.eventHeadcount, { productId });
		expect(head?.taken).toBe(100);
		expect(head?.left).toBeUndefined();
	});

	test("cancelling an RSVP frees its seat immediately", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id, { seats: 1 });
		const a = await variantFor(t, productId, "A");
		const { shortId } = await rsvp(t, {
			retailerId: retailer._id,
			variantId: a,
			pickupLocationId,
		});
		// Full.
		await expect(
			rsvp(t, { retailerId: retailer._id, variantId: a, pickupLocationId }),
		).rejects.toThrow(/fully booked|seat/i);

		const order = await orderByShortId(t, shortId);
		if (!order) throw new Error("order missing");
		await asUser.mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "cancelled",
		});
		// The seat is back, with no extra bookkeeping.
		await expect(
			rsvp(t, { retailerId: retailer._id, variantId: a, pickupLocationId }),
		).resolves.toBeTruthy();
	});
});

describe("event RSVP — the headcount", () => {
	test("tallies per chosen option and excludes cancelled", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id, { seats: 30 });
		const a = await variantFor(t, productId, "A");
		const b = await variantFor(t, productId, "B");

		await rsvp(t, {
			retailerId: retailer._id,
			variantId: a,
			pickupLocationId,
			quantity: 11,
		});
		const seven = await rsvp(t, {
			retailerId: retailer._id,
			variantId: b,
			pickupLocationId,
			quantity: 7,
		});
		let head = await asUser.query(api.products.eventHeadcount, { productId });
		expect(head?.taken).toBe(18);
		expect(head?.left).toBe(12);
		expect(head?.options).toEqual(
			expect.arrayContaining([
				{ label: "A", seats: 11 },
				{ label: "B", seats: 7 },
			]),
		);

		const order = await orderByShortId(t, seven.shortId);
		if (!order) throw new Error("order missing");
		await asUser.mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "cancelled",
		});
		head = await asUser.query(api.products.eventHeadcount, { productId });
		expect(head?.taken).toBe(11);
		expect(head?.options).toEqual([{ label: "A", seats: 11 }]);
	});

	test("a normal product has no headcount at all", async () => {
		const t = setup();
		const { asUser, retailer } = await seedStore(t);
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Cream Puff",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			variants: [{ optionValues: [], price: 800, onHand: 50 }],
		});
		expect(
			await asUser.query(api.products.eventHeadcount, { productId }),
		).toBeNull();
	});
});

describe("event RSVP — editing an event with guests on the list", () => {
	test("the date is immutable once a live RSVP exists", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const a = await variantFor(t, productId, "A");
		await rsvp(t, { retailerId: retailer._id, variantId: a, pickupLocationId });

		await expect(
			asUser.mutation(api.products.update, {
				productId,
				event: { date: EVENT_DATE + DAY_MS, timeMinutes: EVENT_TIME },
			}),
		).rejects.toThrow(/already RSVP'd/i);
	});

	test("turning the event OFF under guests is refused too", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const a = await variantFor(t, productId, "A");
		await rsvp(t, { retailerId: retailer._id, variantId: a, pickupLocationId });

		await expect(
			asUser.mutation(api.products.update, { productId, event: null }),
		).rejects.toThrow(/already RSVP'd/i);
	});

	test("a CANCELLED RSVP doesn't strand the date — orderedAt would have", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const a = await variantFor(t, productId, "A");
		const { shortId } = await rsvp(t, {
			retailerId: retailer._id,
			variantId: a,
			pickupLocationId,
		});
		const order = await orderByShortId(t, shortId);
		if (!order) throw new Error("order missing");
		await asUser.mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "cancelled",
		});
		// `products.orderedAt` is still set (it is never cleared), so gating on it
		// would leave a typo'd date permanently unfixable. The LIVE count is 0, so
		// the seller can fix it.
		await t.run(async (ctx) => {
			const p = await ctx.db.get(productId);
			expect(p?.orderedAt).toBeDefined();
		});
		await asUser.mutation(api.products.update, {
			productId,
			event: { date: EVENT_DATE + DAY_MS, timeMinutes: EVENT_TIME },
		});
		await t.run(async (ctx) => {
			const p = await ctx.db.get(productId);
			expect(p?.event?.date).toBe(EVENT_DATE + DAY_MS);
		});
	});

	test("the seat cap rises freely but never below what's taken", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id, { seats: 10 });
		const a = await variantFor(t, productId, "A");
		await rsvp(t, {
			retailerId: retailer._id,
			variantId: a,
			pickupLocationId,
			quantity: 6,
		});

		// Up is always fine.
		await asUser.mutation(api.products.update, {
			productId,
			event: { date: EVENT_DATE, timeMinutes: EVENT_TIME, seats: 40 },
		});
		// Down to the headcount is fine; below it is not.
		await asUser.mutation(api.products.update, {
			productId,
			event: { date: EVENT_DATE, timeMinutes: EVENT_TIME, seats: 6 },
		});
		await expect(
			asUser.mutation(api.products.update, {
				productId,
				event: { date: EVENT_DATE, timeMinutes: EVENT_TIME, seats: 5 },
			}),
		).rejects.toThrow(/can't go below 6/i);
	});
});

describe("event RSVP — the storefront hides a finished event", () => {
	test("visible on the day, gone the morning after", async () => {
		const t = setup();
		const { retailer } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id, {
			date: todayMytMidnight(),
		});

		const listedToday = await t.query(api.products.list, {
			retailerId: retailer._id,
		});
		expect(listedToday.map((p) => p._id)).toContain(productId);

		// The next morning, with no cron and no seller action.
		await t.run(async (ctx) => {
			await ctx.db.patch(productId, {
				event: { date: todayMytMidnight() - DAY_MS, timeMinutes: EVENT_TIME },
			});
		});
		const listedAfter = await t.query(api.products.list, {
			retailerId: retailer._id,
		});
		expect(listedAfter.map((p) => p._id)).not.toContain(productId);
		// ...and its page 404s rather than taking an RSVP for a day that's gone.
		expect(
			await t.query(api.products.getPublicBySlug, {
				retailerId: retailer._id,
				slug: "bni-breakfast",
			}),
		).toBeNull();
	});

	test("a multi-day event stays up — and keeps taking RSVPs — until its LAST day", async () => {
		// Helinox's 3-day camp: on day 2 the listing must not have vanished, a
		// late registrant must still get in, and their order keeps the CHECK-IN
		// day (endDate is display-only, never the tally's key).
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const checkIn = todayMytMidnight() - DAY_MS;
		const lastDay = todayMytMidnight() + DAY_MS;
		await t.run(async (ctx) => {
			await ctx.db.patch(productId, {
				event: { date: checkIn, timeMinutes: EVENT_TIME, endDate: lastDay },
			});
		});

		const listed = await t.query(api.products.list, {
			retailerId: retailer._id,
		});
		expect(listed.map((p) => p._id)).toContain(productId);

		const { shortId } = await rsvp(t, {
			retailerId: retailer._id,
			variantId: await variantFor(t, productId, "A"),
			pickupLocationId,
		});
		const order = await orderByShortId(t, shortId);
		expect(order?.fulfilmentDate).toBe(checkIn);

		// The buyer's tracking read carries the last day, so the page reads the
		// whole range rather than only the check-in day the order froze.
		const tracked = await t.query(api.orders.get, {
			token: order?.trackingToken,
		});
		expect(tracked?.eventLocked).toBe(true);
		expect(tracked?.eventEndDate).toBe(lastDay);
	});

	test("the seller still sees it, with the tally — history is a real question", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id, {
			date: todayMytMidnight(),
		});
		const a = await variantFor(t, productId, "A");
		await rsvp(t, {
			retailerId: retailer._id,
			variantId: a,
			pickupLocationId,
			quantity: 4,
		});
		// Age the whole scenario by a day — the event AND the RSVPs that landed on
		// it. Moving only the event would model a date change the server refuses
		// precisely because it orphans the guests from the tally.
		await t.run(async (ctx) => {
			await ctx.db.patch(productId, {
				event: { date: todayMytMidnight() - DAY_MS, timeMinutes: EVENT_TIME },
			});
			for (const o of await ctx.db.query("orders").collect()) {
				await ctx.db.patch(o._id, {
					fulfilmentDate: todayMytMidnight() - DAY_MS,
				});
			}
		});

		const listed = await asUser.query(api.products.listAll, {
			retailerId: retailer._id,
		});
		expect(listed.map((p) => p._id)).toContain(productId);
		const head = await asUser.query(api.products.eventHeadcount, { productId });
		expect(head?.taken).toBe(4);
		expect(head?.passed).toBe(true);
	});
});

describe("event RSVP — its own status pipeline (`z8r3fdff9u` stages)", () => {
	test("an RSVP is born with the frozen eventRsvp marker — both doors", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const { shortId } = await rsvp(t, {
			retailerId: retailer._id,
			variantId: await variantFor(t, productId, "A"),
			pickupLocationId,
		});
		expect((await orderByShortId(t, shortId))?.eventRsvp).toBe(true);

		// Counter door stamps it too.
		const { sessionId } = await asUser.mutation(
			api.counterCheckout.bindSessionManualPhone,
			{ waPhone: "60123456789", name: "Aina Hamzah" },
		);
		const counter = await asUser.mutation(
			api.counterCheckout.createOrderFromSession,
			{
				sessionId,
				items: [{ variantId: await variantFor(t, productId, "B"), quantity: 1 }],
				paidInPerson: false,
			},
		);
		const counterOrder = await orderByShortId(t, counter.shortId);
		expect(counterOrder?.eventRsvp).toBe(true);
		// The VENUE rides a counter RSVP too — the guest leaves and comes back
		// on the event day, and their order page's event note points at the
		// pickup card. A plain counter sale keeps no pickup card (handed over
		// at the counter), which the plain-sale assertion below pins.
		expect(counterOrder?.pickupSnapshot?.label).toBe("The Studio");
		expect(counterOrder?.pickupLocationId).toBeDefined();
		// A plain sale is NOT marked — the marker means exactly one thing.
		const plainId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Plain tote",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			options: [],
			variants: [{ optionValues: [], price: 1200, onHand: 5 }],
		});
		const plainVariant = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", plainId))
				.collect();
			return rows[0]._id;
		});
		const { sessionId: s2 } = await asUser.mutation(
			api.counterCheckout.bindSessionManualPhone,
			{ waPhone: "60123456780", name: "Ben" },
		);
		const plain = await asUser.mutation(
			api.counterCheckout.createOrderFromSession,
			{
				sessionId: s2,
				items: [{ variantId: plainVariant, quantity: 1 }],
				paidInPerson: true,
			},
		);
		const plainOrder = await orderByShortId(t, plain.shortId);
		expect(plainOrder?.eventRsvp).toBeUndefined();
		expect(plainOrder?.pickupSnapshot).toBeUndefined();
	});

	test("a counter RSVP with NO active pickup point refuses — in seller words", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		await t.run(async (ctx) => {
			await ctx.db.patch(pickupLocationId, { isActive: false });
		});
		const { sessionId } = await asUser.mutation(
			api.counterCheckout.bindSessionManualPhone,
			{ waPhone: "60123456789", name: "Aina Hamzah" },
		);
		await expect(
			asUser.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId: await variantFor(t, productId, "A"), quantity: 1 }],
				paidInPerson: false,
			}),
		).rejects.toThrow(/venue.*pickup point/i);
	});

	test("a FREE counter RSVP records NO payment, whatever the client sent", async () => {
		// The round-2 live finding: RM0 RSVP rung up as "Paid now · Cash" showed
		// "PAYMENT RECEIVED · Cash" directly under "Free order — there's nothing
		// to collect". The server now refuses to write the contradiction.
		const t = setup();
		const { asUser, retailer } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const { sessionId } = await asUser.mutation(
			api.counterCheckout.bindSessionManualPhone,
			{ waPhone: "60123456789", name: "Aina Hamzah" },
		);
		const { shortId } = await asUser.mutation(
			api.counterCheckout.createOrderFromSession,
			{
				sessionId,
				items: [{ variantId: await variantFor(t, productId, "A"), quantity: 1 }],
				paidInPerson: true,
				paymentMethod: "cash",
			},
		);
		const order = await orderByShortId(t, shortId);
		expect(order?.total).toBe(0);
		expect(order?.paymentStatus).toBe("unpaid");
		expect(order?.paymentMethod).toBeUndefined();
		expect(order?.paymentReceivedAt).toBeUndefined();
	});

	test("the stepper advances Confirmed → Checked In — Packed never exists", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const { shortId } = await rsvp(t, {
			retailerId: retailer._id,
			variantId: await variantFor(t, productId, "A"),
			pickupLocationId,
		});
		const order = await orderByShortId(t, shortId);
		if (!order) throw new Error("order missing");

		// The event pipeline has exactly two stages, so the packed stage id the
		// delivery flow would offer is UNKNOWN here — the vocabulary is real,
		// not a relabel.
		await expect(
			asUser.mutation(api.orders.advanceToStage, {
				orderId: order._id,
				stageId: "default:packed",
			}),
		).rejects.toThrow(/unknown stage/i);

		await asUser.mutation(api.orders.advanceToStage, {
			orderId: order._id,
			stageId: "default:delivered",
		});
		expect((await orderByShortId(t, shortId))?.status).toBe("delivered");
	});

	test("bulk actions skip an RSVP for stages its flow doesn't have — and say so", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const { shortId } = await rsvp(t, {
			retailerId: retailer._id,
			variantId: await variantFor(t, productId, "A"),
			pickupLocationId,
		});
		const order = await orderByShortId(t, shortId);
		if (!order) throw new Error("order missing");

		const res = await asUser.mutation(api.orders.bulkUpdateStatus, {
			orderIds: [order._id],
			status: "packed",
		});
		expect(res.updated).toBe(0);
		expect(res.skipped).toBe(1);
		expect(res.skippedNoSuchStage).toBe(1);
		// Untouched — this storefront order was born pending and stays there.
		expect((await orderByShortId(t, shortId))?.status).toBe("pending");

		// Cancelling in bulk still works — cancellation belongs to every kind.
		const cancel = await asUser.mutation(api.orders.bulkUpdateStatus, {
			orderIds: [order._id],
			status: "cancelled",
		});
		expect(cancel.updated).toBe(1);
	});
});

describe("event RSVP — the venue is the event's, never the guest's (round 4)", () => {
	test("a multi-outlet store must name the venue at save; the pick then wins every door", async () => {
		const t = setup();
		const { asUser, retailer, pickupLocationId } = await seedStore(t);
		const { pickupLocationId: outletB } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Outlet B",
				address: "88 Jalan Dua, 50000 KL",
			},
		);

		// Saving an event WITHOUT a venue on a two-outlet store refuses.
		await expect(seedEventProduct(t, retailer._id)).rejects.toThrow(
			/which one hosts/i,
		);

		// With the venue named, the save lands and the order FORCES it — a
		// guest (or stale tab) sending the other outlet is overridden, the
		// exact posture the date lock takes.
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "BNI Breakfast",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [{ name: "Set", values: ["A", "B"] }],
			event: {
				date: EVENT_DATE,
				timeMinutes: EVENT_TIME,
				venueId: pickupLocationId,
			},
			variants: [
				{ optionValues: ["A"], price: 0, onHand: 0 },
				{ optionValues: ["B"], price: 0, onHand: 0 },
			],
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [
				{ variantId: await variantFor(t, productId, "A"), quantity: 1 },
			],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryMethod: "self_collect",
			pickupLocationId: outletB, // the wrong outlet, on purpose
		});
		const order = await orderByShortId(t, shortId);
		expect(order?.pickupLocationId).toBe(pickupLocationId);
		expect(order?.pickupSnapshot?.label).toBe("The Studio");

		// The counter seats the same event at the same venue.
		const { sessionId } = await asUser.mutation(
			api.counterCheckout.bindSessionManualPhone,
			{ waPhone: "60123456789", name: "Aina Hamzah" },
		);
		const counter = await asUser.mutation(
			api.counterCheckout.createOrderFromSession,
			{
				sessionId,
				items: [
					{ variantId: await variantFor(t, productId, "B"), quantity: 1 },
				],
				paidInPerson: false,
			},
		);
		expect(
			(await orderByShortId(t, counter.shortId))?.pickupSnapshot?.label,
		).toBe("The Studio");
	});

	test("single-outlet stores never pick — unset venue resolves to the only point", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const { shortId } = await rsvp(t, {
			retailerId: retailer._id,
			variantId: await variantFor(t, productId, "A"),
			pickupLocationId,
		});
		expect((await orderByShortId(t, shortId))?.pickupSnapshot?.label).toBe(
			"The Studio",
		);
	});
});

describe("event RSVP — the other checkout doors", () => {
	test("a claim link refuses an event product at the seller's door", async () => {
		const t = setup();
		const { asUser, retailer } = await seedStore(t);
		const productId = await seedEventProduct(t, retailer._id);
		const a = await variantFor(t, productId, "A");
		const { sessionId } = await asUser.mutation(
			api.counterCheckout.bindSessionManualPhone,
			{ waPhone: "60123456789", name: "Aina Hamzah" },
		);

		await expect(
			asUser.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId: a, quantity: 1 }],
				windowMinutes: 60,
			}),
		).rejects.toThrow(/storefront link/i);
	});
});
