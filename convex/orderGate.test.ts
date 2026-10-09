/// <reference types="vite/client" />
// Credits T3.1 (z8r3fdmg4h): the INVISIBILITY half of the per-order gate.
//
// `creditLock.test.ts` proves the gate refuses the right writes. This file
// proves the other half, which is the one that actually closes the loophole: a
// gated order must not reach the seller AT ALL. Greying the buttons out while
// leaving the buyer's phone number on screen just moves the sale into WhatsApp
// by hand (Zaki, 6 Oct 2026).
//
// The centrepiece is `expectNoSentinels`. Every buyer-supplied field on the
// seeded order holds a unique sentinel string; the test serialises what each
// seller surface hands back and asserts not one sentinel survives. That is a
// WHOLE-PAYLOAD sweep rather than a field checklist, so it catches:
//
//  - a new field added to `orders` and waved through the allowlist;
//  - a surface that forgets to redact;
//  - a nested object whose contents were never considered.
//
// Which is the failure mode a denylist always has and a list of per-field
// assertions never catches.

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ensureCreditAccount } from "./credits";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}
type T = ReturnType<typeof setup>;

const OWNER = "user_gate_owner";
const ADMIN = "user_gate_admin";
const OCT_10 = Date.parse("2026-10-10T12:00:00+08:00");

/**
 * Every buyer-supplied value on the seeded order, each unique and each
 * absurd enough that it can only have come from here. A seller surface
 * leaking ANY of them is leaking the buyer.
 */
const SENTINEL = {
	name: "ZZSENTINELBUYERNAME",
	phone: "60199999001",
	line1: "ZZSENTINELSTREET",
	line2: "ZZSENTINELUNIT",
	city: "ZZSENTINELCITY",
	postcode: "47999",
	notes: "ZZSENTINELADDRESSNOTE",
	customerNote: "ZZSENTINELORDERNOTE",
	productName: "ZZSENTINELPRODUCT",
	paymentReference: "ZZSENTINELBANKREF",
} as const;

/** The one assertion this file exists for. */
function expectNoSentinels(payload: unknown, surface: string): void {
	const json = JSON.stringify(payload ?? null);
	for (const [field, value] of Object.entries(SENTINEL)) {
		expect(
			json.includes(value),
			`${surface} leaked the buyer's ${field} on a gated order`,
		).toBe(false);
	}
}

let prevAdminEnv: string | undefined;
beforeEach(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

// ---------------------------------------------------------------------------

async function seed(t: T) {
	const slug = "gate-store";
	await t
		.withIdentity({ subject: OWNER })
		.mutation(api.retailers.createRetailer, { storeName: "Gate Store", slug });
	const retailerId = await t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		if (!r) throw new Error("seed");
		// Pro: the inbox filters + the CRM customer surfaces are Pro features,
		// and this file is about the credit gate, not the plan gate.
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
			.first();
		if (sub) await ctx.db.patch(sub._id, { status: "active", plan: "pro" });
		await ensureCreditAccount(ctx, r._id, OCT_10);
		return r._id;
	});
	const productId = await t
		.withIdentity({ subject: OWNER })
		.mutation(api.products.create, {
			retailerId,
			name: SENTINEL.productName,
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			blockWhenOutOfStock: false,
			requiresProof: false,
			variants: [{ optionValues: [], price: 2500, onHand: 100 }],
		});
	return { retailerId, productId, slug };
}

/** Take the balance to exactly zero, so the NEXT order's own debit is the one
 * that goes into debt — which is what makes it gated. */
async function drain(t: T, retailerId: Id<"retailers">) {
	const account = await t.run((ctx) =>
		ctx.db
			.query("creditAccounts")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first(),
	);
	const delta = -((account?.planBalance ?? 0) + (account?.purchasedBalance ?? 0));
	if (delta !== 0)
		await t.withIdentity({ subject: ADMIN }).mutation(api.credits.adminAdjust, {
			retailerId,
			bucket: "plan",
			amount: delta,
			note: "drain to zero for the gate test",
		});
}

async function placeOrder(
	t: T,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
): Promise<Doc<"orders">> {
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: SENTINEL.name, waPhone: SENTINEL.phone },
		customerNote: SENTINEL.customerNote,
		deliveryAddress: {
			line1: SENTINEL.line1,
			line2: SENTINEL.line2,
			city: SENTINEL.city,
			// A real state: the address validator checks it against the Malaysian
			// list, so it can't carry a sentinel — and a value from a fixed list
			// of 16 was never going to identify a buyer anyway.
			state: "Selangor",
			postcode: SENTINEL.postcode,
			notes: SENTINEL.notes,
		},
	});
	const order = await t.run((ctx) =>
		ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.unique(),
	);
	if (!order) throw new Error("order");
	// A bank reference the buyer typed in, so the payment columns are loaded
	// with a sentinel too.
	await t.run((ctx) =>
		ctx.db.patch(order._id, { paymentReference: SENTINEL.paymentReference }),
	);
	const reloaded = await t.run((ctx) => ctx.db.get(order._id));
	if (!reloaded) throw new Error("order");
	return reloaded;
}

// ---------------------------------------------------------------------------

describe("a gated order is invisible to the seller, on every surface", () => {
	test("not one buyer field survives any seller read", async () => {
		const t = setup();
		const s = await seed(t);
		await drain(t, s.retailerId);
		const order = await placeOrder(t, s.retailerId, s.productId);
		const asOwner = t.withIdentity({ subject: OWNER });

		const surfaces: Array<[string, () => Promise<unknown>]> = [
			[
				"orders.get (seller door)",
				() => asOwner.query(api.orders.get, { shortId: order.shortId }),
			],
			[
				"orders.searchOrders (the inbox)",
				() => asOwner.query(api.orders.searchOrders, { retailerId: s.retailerId }),
			],
			[
				"orders.searchOrders by the buyer's NAME",
				() =>
					asOwner.query(api.orders.searchOrders, {
						retailerId: s.retailerId,
						searchText: SENTINEL.name,
					}),
			],
			[
				"orders.searchOrders by the buyer's PHONE",
				() =>
					asOwner.query(api.orders.searchOrders, {
						retailerId: s.retailerId,
						searchText: SENTINEL.phone,
					}),
			],
			[
				"orders.listByRetailer (Home's recent strip)",
				() =>
					asOwner.query(api.orders.listByRetailer, {
						retailerId: s.retailerId,
						paginationOpts: { numItems: 20, cursor: null },
					}),
			],
			[
				"orders.getTimeline",
				() => asOwner.query(api.orders.getTimeline, { orderId: order._id }),
			],
			[
				"orders.listPaymentProofs",
				() => asOwner.query(api.orders.listPaymentProofs, { orderId: order._id }),
			],
			[
				"orders.exportOrders (CSV)",
				() => asOwner.action(api.orders.exportOrders, { retailerId: s.retailerId }),
			],
			[
				"customers.list",
				() =>
					asOwner.query(api.customers.list, {
						retailerId: s.retailerId,
						sort: "recency",
						paginationOpts: { numItems: 20, cursor: null },
					}),
			],
			[
				"customers.search by NAME",
				() =>
					asOwner.query(api.customers.search, {
						retailerId: s.retailerId,
						term: SENTINEL.name,
					}),
			],
			[
				"customers.search by PHONE",
				() =>
					asOwner.query(api.customers.search, {
						retailerId: s.retailerId,
						term: SENTINEL.phone,
					}),
			],
			[
				"notifications.latestActivity",
				() =>
					asOwner.query(api.notifications.latestActivity, {
						retailerId: s.retailerId,
					}),
			],
		];

		for (const [surface, read] of surfaces) {
			expectNoSentinels(await read(), surface);
		}

		// The customer DETAIL page and its purchase history, which only exist
		// once the order linked a customer record.
		const customerId = order.customerId;
		expect(customerId, "the order linked a customer").toBeTruthy();
		if (customerId) {
			expectNoSentinels(
				await asOwner.query(api.customers.get, { customerId }),
				"customers.get",
			);
			expectNoSentinels(
				await asOwner.query(api.customers.ordersByCustomer, {
					customerId,
					paginationOpts: { numItems: 20, cursor: null },
				}),
				"customers.ordersByCustomer",
			);
		}
	});

	test("the TRACKING TOKEN never reaches the seller — it would reopen everything", async () => {
		// The sharpest edge of the whole feature. `/track/<token>` is the
		// BUYER's capability: it renders the order in full with no auth. Ship a
		// gated row carrying its token and the seller just opens that page.
		const t = setup();
		const s = await seed(t);
		await drain(t, s.retailerId);
		const order = await placeOrder(t, s.retailerId, s.productId);
		expect(order.trackingToken, "the seed order has a token").toBeTruthy();

		const asOwner = t.withIdentity({ subject: OWNER });
		const detail = await asOwner.query(api.orders.get, {
			shortId: order.shortId,
		});
		expect(detail?.creditGated).toBe(true);
		expect(detail?.trackingToken).toBeUndefined();

		const inbox = await asOwner.query(api.orders.searchOrders, {
			retailerId: s.retailerId,
		});
		expect(JSON.stringify(inbox)).not.toContain(order.trackingToken);
	});

	test("the BUYER still sees their whole order — they never feel the balance", async () => {
		const t = setup();
		const s = await seed(t);
		await drain(t, s.retailerId);
		const order = await placeOrder(t, s.retailerId, s.productId);
		const buyer = await t.query(api.orders.get, {
			token: order.trackingToken as string,
		});
		expect(buyer?.customer?.name).toBe(SENTINEL.name);
		expect(buyer?.customer?.waPhone).toBe(SENTINEL.phone);
		expect(buyer?.items).toHaveLength(1);
		expect(buyer?.creditGated).toBeUndefined();
	});

	test("a gated row still says WHAT it is and what it's worth", async () => {
		// Redaction is not the same as a blank row. The seller has to be able to
		// see that three orders arrived, what they're worth and when they're due
		// — that is both the honest state of the inbox and the reason to top up.
		const t = setup();
		const s = await seed(t);
		await drain(t, s.retailerId);
		const order = await placeOrder(t, s.retailerId, s.productId);
		const row = await t
			.withIdentity({ subject: OWNER })
			.query(api.orders.get, { shortId: order.shortId });
		expect(row).toMatchObject({
			shortId: order.shortId,
			total: order.total,
			currency: "MYR",
			status: order.status,
			creditGated: true,
			creditsToUnlock: 1,
		});
		expect(row?.createdAt).toBe(order.createdAt);
	});

	test("a FUNDED order is handed over untouched — the redaction is per order", async () => {
		const t = setup();
		const s = await seed(t);
		// Placed while the store has its monthly credits: funded.
		const funded = await placeOrder(t, s.retailerId, s.productId);
		// Then bury the store and take a second order, which IS gated.
		await drain(t, s.retailerId);
		const gated = await placeOrder(t, s.retailerId, s.productId);

		const asOwner = t.withIdentity({ subject: OWNER });
		const ok = await asOwner.query(api.orders.get, { shortId: funded.shortId });
		expect(ok?.creditGated).toBeUndefined();
		expect(ok?.customer?.waPhone).toBe(SENTINEL.phone);
		expect(ok?.items).toHaveLength(1);

		const held = await asOwner.query(api.orders.get, { shortId: gated.shortId });
		expect(held?.creditGated).toBe(true);
		expect(held?.items).toHaveLength(0);
	});

	test("the inbox counts the waiting orders and the filter finds exactly them", async () => {
		const t = setup();
		const s = await seed(t);
		const funded = await placeOrder(t, s.retailerId, s.productId);
		await drain(t, s.retailerId);
		const a = await placeOrder(t, s.retailerId, s.productId);
		const b = await placeOrder(t, s.retailerId, s.productId);

		const asOwner = t.withIdentity({ subject: OWNER });
		const all = await asOwner.query(api.orders.searchOrders, {
			retailerId: s.retailerId,
		});
		expect(all.counts.creditGated).toBe(2);
		expect(all.total).toBe(3);

		const waiting = await asOwner.query(api.orders.searchOrders, {
			retailerId: s.retailerId,
			creditGated: true,
		});
		expect(waiting.orders.map((o) => o.shortId).sort()).toEqual(
			[a.shortId, b.shortId].sort(),
		);

		// And its twin — "get the waiting ones out of my way".
		const workable = await asOwner.query(api.orders.searchOrders, {
			retailerId: s.retailerId,
			creditGated: false,
		});
		expect(workable.orders.map((o) => o.shortId)).toEqual([funded.shortId]);
	});

	test("a despatch label refuses for a waiting order and the BATCH names the skip", async () => {
		const t = setup();
		const s = await seed(t);
		const funded = await placeOrder(t, s.retailerId, s.productId);
		await drain(t, s.retailerId);
		const gated = await placeOrder(t, s.retailerId, s.productId);
		const asOwner = t.withIdentity({ subject: OWNER });
		// Both need to be packed + paid to be labelled, which the gated one can
		// never reach — so the batch is driven by an explicit selection.
		const batch = await asOwner.action(api.awb.generateAwbBatchPdf, {
			retailerId: s.retailerId,
			orderIds: [funded._id, gated._id],
		});
		expect(batch.skipped.credit_gated).toBe(1);
		// Never a whole-batch refusal.
		expect(batch.skipped.credit_gated + batch.count).toBeGreaterThan(0);
	});
});

/**
 * The BOOKING vertical (PR #347 review, 9 Oct 2026).
 *
 * The sweep above walked `orders` and `customers`. It never walked the
 * booking calendar — and a booking REQUEST debits its credit at request time,
 * so a request that lands at or below zero is born gated. `holdsCapacity`
 * keeps every non-cancelled status, so that request sat on the seller's grid
 * with the guest's name and the nights beside it.
 *
 * For a campsite or a homestay that IS the whole bypass: the guest turns up on
 * the date, and the seller never needed a phone number. The `.ics` feed
 * already skipped gated bookings for this reason; these four surfaces are its
 * in-app mirror and were missed.
 */
describe("a gated BOOKING never shows the guest on the seller's calendar", () => {
	const DAY = 24 * 60 * 60 * 1000;
	/** MYT midnight, n days out — the alignment every booking date must hold. */
	const day = (n: number) =>
		Date.parse("2026-11-01T00:00:00+08:00") + n * DAY;

	async function bookingStore(t: T) {
		const asOwner = t.withIdentity({ subject: OWNER });
		await asOwner.mutation(api.retailers.createRetailer, {
			storeName: "Gate Camp",
			slug: "gate-camp",
		});
		const retailer = await asOwner.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.first();
			if (sub) await ctx.db.patch(sub._id, { status: "active", plan: "pro" });
			await ensureCreditAccount(ctx, retailer._id, OCT_10);
		});
		const productId = await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Riverside Plot",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			kind: "booking" as const,
			booking: { capacityPerNight: 5 },
			variants: [{ optionValues: [], price: 8000, onHand: 0 }],
		});
		return { asOwner, retailerId: retailer._id, productId };
	}

	test("the name is gone from the grid, the sheet and both impact lists", async () => {
		const t = setup();
		const { asOwner, retailerId, productId } = await bookingStore(t);
		// A funded guest first, so the assertions below can tell "redacted"
		// apart from "this surface shows nobody".
		await t.mutation(api.bookings.requestBooking, {
			retailerId,
			productId,
			checkIn: day(1),
			checkOut: day(2),
			customer: { name: "Funded Guest", waPhone: "0123456701" },
		});
		await drain(t, retailerId);
		// Born gated: the debit for this one takes the balance below zero.
		await t.mutation(api.bookings.requestBooking, {
			retailerId,
			productId,
			checkIn: day(3),
			checkOut: day(4),
			customer: { name: SENTINEL.name, waPhone: SENTINEL.phone },
		});

		const calendar = await asOwner.query(api.bookingBlocks.sellerCalendar, {
			retailerId,
			from: day(0),
			to: day(10),
		});
		expectNoSentinels(calendar, "bookingBlocks.sellerCalendar");

		const sheet = await asOwner.query(api.bookingBlocks.dayBookings, {
			retailerId,
			date: day(3),
		});
		expectNoSentinels(sheet, "bookingBlocks.dayBookings");

		const block = await asOwner.query(api.bookingBlocks.blockImpact, {
			retailerId,
			startDate: day(3),
			endDate: day(3),
		});
		expectNoSentinels(block, "bookingBlocks.blockImpact");

		const closed = await asOwner.query(api.closedDates.impact, {
			retailerId,
			startDate: day(3),
			endDate: day(3),
		});
		expectNoSentinels(closed, "closedDates.impact");
	});

	test("the NIGHT still counts, so a seller can't block over a guest they can't see", async () => {
		// Skipping the row would have been the easy redaction and the dangerous
		// one: these lists exist to stop a seller closing a date that already
		// has someone on it.
		const t = setup();
		const { asOwner, retailerId, productId } = await bookingStore(t);
		await drain(t, retailerId);
		await t.mutation(api.bookings.requestBooking, {
			retailerId,
			productId,
			checkIn: day(3),
			checkOut: day(4),
			customer: { name: SENTINEL.name, waPhone: SENTINEL.phone },
		});

		const calendar = await asOwner.query(api.bookingBlocks.sellerCalendar, {
			retailerId,
			from: day(0),
			to: day(10),
		});
		const night = calendar.days.find((d) => d.date === day(3));
		expect(night?.booked, "the gated stay still occupies the night").toBe(1);

		const sheet = await asOwner.query(api.bookingBlocks.dayBookings, {
			retailerId,
			date: day(3),
		});
		expect(sheet.length, "the day sheet still lists it").toBe(1);
		expect(sheet[0].customerName).toBe("Waiting on credits");

		const block = await asOwner.query(api.bookingBlocks.blockImpact, {
			retailerId,
			startDate: day(3),
			endDate: day(3),
		});
		expect(block.count, "blocking this date still warns").toBe(1);
	});

	test("a FUNDED guest is untouched — the gate is per order here too", async () => {
		const t = setup();
		const { asOwner, retailerId, productId } = await bookingStore(t);
		await t.mutation(api.bookings.requestBooking, {
			retailerId,
			productId,
			checkIn: day(3),
			checkOut: day(4),
			customer: { name: "Funded Guest", waPhone: "0123456701" },
		});
		const sheet = await asOwner.query(api.bookingBlocks.dayBookings, {
			retailerId,
			date: day(3),
		});
		expect(sheet[0].customerName).toBe("Funded Guest");
	});
});
