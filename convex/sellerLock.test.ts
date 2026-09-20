/// <reference types="vite/client" />
// The view-only lock (z8r3fdeub2, 19 Sep 2026). A store whose subscription has
// lapsed — an unpaid invoice, or an admin turning a comp upgrade off — can look
// at everything and change nothing. Until this change the lock covered only
// "growth-writes" (products, settings, slug), so a lapsed seller could still RUN
// the shop: move orders to packed/shipped, take payment, book a rider, print
// labels, ring up counter sales. Owner decision: "all actions will be locked,
// it's all view only. BE should also reject it if they try something funny on
// the FE."
//
// The line that makes it a SOFT lock: the buyer never feels it. Their storefront
// is live, they can order, pay, track and fix their own details. And paying
// Kedaipal is never locked, or the seller could not unlock themselves.
//
// `sellerLockCoverage.test.ts` is the other half — it fails when a NEW mutation
// is neither guarded nor deliberately exempted. See docs/manual-subscription.md.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const SELLER = "user_lock_seller";
const ADMIN = "user_lock_admin";

let prevAdminEnv: string | undefined;
beforeEach(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

const customer = { name: "Aisha", waPhone: "60123456789" };
const validAddress = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

type T = ReturnType<typeof setup>;

/** A Pro store, active, with one product and one pending order in its inbox. */
async function seedStore(t: T) {
	const asSeller = t.withIdentity({ subject: SELLER });
	await asSeller.mutation(api.retailers.createRetailer, {
		storeName: "Lock Store",
		slug: "lock-store",
	});
	const retailer = await asSeller.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");

	const productId = await asSeller.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Kuih Box",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 2500, onHand: 100 }],
	});

	// The buyer's own call — unauthenticated, exactly as the storefront makes it.
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId: retailer._id,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer,
		deliveryAddress: validAddress,
	});
	const order = await t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error("order missing");
		return o;
	});

	await setStatus(t, retailer._id, "active");
	return { retailer, productId, orderId: order._id, shortId, asSeller };
}

/** Point the seeded subscription at a status (signup mints a Pro trial). */
async function setStatus(
	t: T,
	retailerId: Id<"retailers">,
	status: "trialing" | "active" | "past_due",
	extra: Record<string, unknown> = {},
) {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no subscription row");
		await ctx.db.patch(sub._id, { status, ...extra });
	});
}

// ---------------------------------------------------------------------------
// The headline: order actions are locked now, and they weren't before
// ---------------------------------------------------------------------------

describe("a lapsed store is view-only", () => {
	test("every order action the seller used to run is refused", async () => {
		const t = setup();
		const { retailer, orderId, asSeller } = await seedStore(t);
		await setStatus(t, retailer._id, "past_due");

		// Moving the order through its pipeline — the behaviour this change ends.
		await expect(
			asSeller.mutation(api.orders.updateStatus, {
				orderId,
				status: "confirmed",
			}),
		).rejects.toThrow(/past due/);
		await expect(
			asSeller.mutation(api.orders.bulkUpdateStatus, {
				orderIds: [orderId],
				status: "confirmed",
			}),
		).rejects.toThrow(/past due/);
		await expect(
			asSeller.mutation(api.orders.markPaymentReceived, { orderId }),
		).rejects.toThrow(/past due/);
		await expect(
			asSeller.mutation(api.orders.setShipmentTracking, {
				orderId,
				courierName: "J&T",
				trackingNo: "JT123",
			}),
		).rejects.toThrow(/past due/);
		await expect(
			asSeller.mutation(api.orders.rescheduleFulfilment, {
				orderId,
				fulfilmentDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
			}),
		).rejects.toThrow(/past due/);
		await expect(
			asSeller.mutation(api.orders.setPinned, { orderId, pinned: true }),
		).rejects.toThrow(/past due/);
	});

	test("the store itself can't be edited either — products, customers, claims", async () => {
		const t = setup();
		const { retailer, productId, asSeller } = await seedStore(t);
		await setStatus(t, retailer._id, "past_due");

		await expect(
			asSeller.mutation(api.products.archive, { productId }),
		).rejects.toThrow(/past due/);
		await expect(
			asSeller.mutation(api.products.reorder, {
				retailerId: retailer._id,
				orderedIds: [productId],
			}),
		).rejects.toThrow(/past due/);
		await expect(
			asSeller.mutation(api.products.generateUploadUrl, {}),
		).rejects.toThrow(/past due/);
		await expect(
			asSeller.mutation(api.retailers.generateLogoUploadUrl, {}),
		).rejects.toThrow(/past due/);
		await expect(
			asSeller.mutation(api.counterCheckout.startAnonymousSession, {
				retailerId: retailer._id,
			}),
		).rejects.toThrow(/past due/);

		const customerId = await t.run(async (ctx) => {
			const row = await ctx.db
				.query("customers")
				.withIndex("by_retailer_phone", (q) =>
					q.eq("retailerId", retailer._id).eq("waPhone", customer.waPhone),
				)
				.first();
			if (!row) throw new Error("customer missing");
			return row._id;
		});
		await expect(
			asSeller.mutation(api.customers.updateNotes, {
				customerId,
				notes: "VIP",
			}),
		).rejects.toThrow(/past due/);
	});

	test("reading is untouched — the lock hides nothing", async () => {
		const t = setup();
		const { retailer, shortId, asSeller } = await seedStore(t);
		await setStatus(t, retailer._id, "past_due");

		await expect(
			asSeller.query(api.orders.get, { shortId }),
		).resolves.toBeTruthy();
		await expect(
			asSeller.query(api.products.listAll, { retailerId: retailer._id }),
		).resolves.toBeTruthy();
		await expect(asSeller.query(api.retailers.getMyRetailer)).resolves.toBeTruthy();
	});

	test("opening an order still marks it seen — a page view is not an action", async () => {
		const t = setup();
		const { retailer, orderId, asSeller } = await seedStore(t);
		await setStatus(t, retailer._id, "past_due");

		await expect(
			asSeller.mutation(api.orders.markSeen, { orderId }),
		).resolves.toBeNull();
		const seen = await t.run(async (ctx) => (await ctx.db.get(orderId))?.seenAt);
		expect(seen).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// The soft half: the buyer never feels it, and the seller can always pay
// ---------------------------------------------------------------------------

describe("the buyer's side stays live", () => {
	test("a lapsed store still takes orders, payment claims and address edits", async () => {
		const t = setup();
		const { retailer, productId, shortId } = await seedStore(t);
		await setStatus(t, retailer._id, "past_due");

		// Storefront reads + a fresh order, all unauthenticated.
		await expect(
			t.query(api.retailers.getRetailerBySlug, { slug: retailer.slug }),
		).resolves.toBeTruthy();
		const placed = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 2 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		expect(placed.shortId).toBeTruthy();

		// And the buyer can still act on the order they already have.
		const token = await t.run(async (ctx) => {
			const o = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first();
			return o?.trackingToken as string;
		});
		await expect(
			t.mutation(api.orders.updateDeliveryAddress, {
				token,
				deliveryAddress: { ...validAddress, line1: "99 Jln Baru" },
			}),
		).resolves.toBeNull();
		await expect(
			t.mutation(api.orders.claimPayment, { token }),
		).resolves.toBeDefined();
	});

	test("paying the invoice unlocks the store in the same breath", async () => {
		const t = setup();
		const { retailer, orderId, asSeller } = await seedStore(t);
		await setStatus(t, retailer._id, "past_due");
		await expect(
			asSeller.mutation(api.orders.updateStatus, {
				orderId,
				status: "confirmed",
			}),
		).rejects.toThrow(/past due/);

		await setStatus(t, retailer._id, "active");
		await expect(
			asSeller.mutation(api.orders.updateStatus, {
				orderId,
				status: "confirmed",
			}),
		).resolves.toBeNull();
	});

	test("an admin running white-glove is never locked out of a lapsed store", async () => {
		const t = setup();
		const { retailer, orderId } = await seedStore(t);
		await setStatus(t, retailer._id, "past_due");

		const asAdmin = t.withIdentity({ subject: ADMIN });
		await expect(
			asAdmin.mutation(api.orders.updateStatus, {
				orderId,
				status: "confirmed",
			}),
		).resolves.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Comps: on = no lock at all; off = the same view-only store, worded for it
// ---------------------------------------------------------------------------

describe("comp upgrade", () => {
	test("a comped store runs every action a paying one does", async () => {
		const t = setup();
		const { retailer, orderId, asSeller } = await seedStore(t);
		// A comp is granted on a store that has lapsed — the usual case (a
		// sponsor picks up a seller whose trial ran out).
		await setStatus(t, retailer._id, "past_due");
		await t.withIdentity({ subject: ADMIN }).mutation(api.subscriptions.setComp, {
			retailerId: retailer._id,
			kind: "sponsor",
			label: "Sponsored by Maybank SME",
		});

		await expect(
			asSeller.mutation(api.orders.updateStatus, {
				orderId,
				status: "confirmed",
			}),
		).resolves.toBeNull();
		await expect(
			asSeller.mutation(api.orders.setPinned, { orderId, pinned: true }),
		).resolves.toBeNull();
	});

	test("turning the comp off locks the orders too, and says sponsored — not 'pay your invoice'", async () => {
		const t = setup();
		const { retailer, orderId, asSeller } = await seedStore(t);
		const asAdmin = t.withIdentity({ subject: ADMIN });
		await asAdmin.mutation(api.subscriptions.setComp, {
			retailerId: retailer._id,
			kind: "sponsor",
			label: "Sponsored by Maybank SME",
		});
		await asAdmin.mutation(api.subscriptions.revokeComp, {
			retailerId: retailer._id,
		});

		// The lock bites on an ORDER action, not just a product edit…
		await expect(
			asSeller.mutation(api.orders.updateStatus, {
				orderId,
				status: "confirmed",
			}),
		).rejects.toThrow(/sponsored access has ended/i);
		// …and never sends them hunting for a bill that was never issued.
		await expect(
			asSeller.mutation(api.orders.markPaymentReceived, { orderId }),
		).rejects.toThrow(/Choose a plan/i);
		await expect(
			asSeller.mutation(api.orders.markPaymentReceived, { orderId }),
		).rejects.not.toThrow(/invoice/i);
	});
});

// ---------------------------------------------------------------------------
// The lock is not an oracle (PR #279 review): the action guards run BEFORE the
// action's own auth, and public actions are callable by anyone holding the
// deployment URL — so the lock refusal must be visible to the store's OWNER
// and to nobody else. Anyone else gets the action's ordinary auth answer,
// byte-identical to an unlocked store, or shortIds become an enumerable probe
// for order existence and billing state.
// ---------------------------------------------------------------------------

describe("the lock never leaks to anyone but the owner", () => {
	test("anonymous probe of a frozen store's shortId ≡ a shortId that never existed", async () => {
		const t = setup();
		const { retailer, shortId } = await seedStore(t);
		await setStatus(t, retailer._id, "past_due");

		// The guard itself passes silently with no identity…
		await expect(
			t.query(internal.subscriptions.assertWritableForOrder, { shortId }),
		).resolves.toBeNull();

		// …and end to end the action's answer is byte-identical to a ghost
		// shortId — the action's own auth speaks, never the lock.
		const answer = (p: Promise<unknown>) =>
			p.then(
				(v) => `ok:${JSON.stringify(v)}`,
				(e) => `threw:${e instanceof Error ? e.message : String(e)}`,
			);
		const probed = await answer(
			t.action(api.lalamove.prepareBooking, { shortId }),
		);
		const ghost = await answer(
			t.action(api.lalamove.prepareBooking, { shortId: "ORD-NOPE" }),
		);
		expect(probed).toBe(ghost);
		expect(probed).not.toMatch(/view-only|sponsored|past due/i);
	});

	test("a FOREIGN seller probing by retailerId or shortId never sees the lock either", async () => {
		const t = setup();
		const { retailer, shortId } = await seedStore(t);
		await setStatus(t, retailer._id, "past_due");
		const asStranger = t.withIdentity({ subject: "user_lock_stranger" });

		await expect(
			asStranger.query(internal.subscriptions.assertWritable, {
				retailerId: retailer._id,
			}),
		).resolves.toBeNull();
		await expect(
			asStranger.query(internal.subscriptions.assertWritableForOrder, {
				shortId,
			}),
		).resolves.toBeNull();
		// End to end, the batch-AWB probe (caller-supplied retailerId, no
		// enumeration needed) answers with the action's own auth refusal —
		// never the billing state.
		const err = await t
			.action(api.awb.generateAwbBatchPdf, { retailerId: retailer._id })
			.then(
				() => "resolved",
				(e) => (e instanceof Error ? e.message : String(e)),
			);
		expect(err).not.toMatch(/view-only|sponsored|past due/i);
	});

	test("the OWNER still gets the lock refusal, from the guard and from an action", async () => {
		const t = setup();
		const { retailer, shortId, asSeller } = await seedStore(t);
		await setStatus(t, retailer._id, "past_due");

		await expect(
			asSeller.query(internal.subscriptions.assertWritable, {
				retailerId: retailer._id,
			}),
		).rejects.toThrow(/past due/);
		await expect(
			asSeller.query(internal.subscriptions.assertWritableForOrder, {
				shortId,
			}),
		).rejects.toThrow(/past due/);
		await expect(
			asSeller.action(api.orders.sendPaymentReminder, { shortId }),
		).rejects.toThrow(/view-only/);
	});
});
