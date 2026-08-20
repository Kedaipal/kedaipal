/// <reference types="vite/client" />
// Despatch labels (86eyp63mp) — the server side: who may print, what gets left
// out of a batch and why, and the two ceilings.
//
// The PDF's own correctness is proven elsewhere (convex/lib/pdf/awb.test.ts for
// the view-model, qr/barcode.test.ts for the encoders, render.test.ts for the
// bytes). What is only provable here is the plumbing: auth, the plan gate, the
// skip counts, the ready-to-ship queue and the batch cap.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AWB_BATCH_MAX } from "./lib/pdf/awb";
import { capsForPlan, type Plan } from "./lib/plans";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const OWNER = "user_awb_owner";
const STRANGER = "user_awb_stranger";
const ADMIN = "user_awb_admin";

let prevAdminEnv: string | undefined;
beforeEach(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

const customer = { name: "Aisha", waPhone: "60123456789" };
const address = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

async function seedStore(t: ReturnType<typeof setup>, userId = OWNER) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Label Store",
		slug: `label-store-${userId.replace(/[^a-z0-9]/g, "")}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	const productId = await asUser.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Kuih Box",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 2500, onHand: 500 }],
	});
	return { retailer, productId, asUser };
}

async function setPlan(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	plan: Plan,
) {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no subscription row");
		const caps = capsForPlan(plan);
		await ctx.db.patch(sub._id, {
			plan,
			status: "active",
			orderCap: caps.orderCap,
			userCap: caps.userCap,
			broadcastQuota: caps.broadcastQuota,
			updatedAt: Date.now(),
		});
	});
}

type PlacedOrder = { id: Id<"orders">; shortId: string };

async function placeOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	opts: { selfCollect?: boolean } = {},
): Promise<PlacedOrder> {
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer,
		...(opts.selfCollect
			? { deliveryMethod: "self_collect" as const }
			: { deliveryAddress: address }),
	});
	const id = await t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error("order missing");
		return o._id;
	});
	return { id, shortId };
}

/** Move an order straight to the state a test needs, without walking the
 * WhatsApp-sending transitions. */
async function patchOrder(
	t: ReturnType<typeof setup>,
	orderId: Id<"orders">,
	patch: Record<string, unknown>,
) {
	await t.run(async (ctx) => {
		await ctx.db.patch(orderId, patch);
	});
}

function isPdf(pdf: ArrayBuffer): boolean {
	const b = new Uint8Array(pdf);
	return String.fromCharCode(b[0], b[1], b[2], b[3]) === "%PDF";
}

// ---------------------------------------------------------------------------
// Single label
// ---------------------------------------------------------------------------

describe("generateAwbPdf (one order)", () => {
	test("the owner gets a PDF named after the order", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		const order = await placeOrder(t, retailer._id, productId);

		const res = await asUser.action(api.awb.generateAwbPdf, {
			shortId: order.shortId,
		});
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(isPdf(res.pdf)).toBe(true);
		expect(res.filename).toBe(`Label-${order.shortId}.pdf`);
	});

	test("stays available on Starter — shipping a parcel is not an upsell", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		await setPlan(t, retailer._id, "starter");
		const order = await placeOrder(t, retailer._id, productId);

		const res = await asUser.action(api.awb.generateAwbPdf, {
			shortId: order.shortId,
		});
		expect(res.ok).toBe(true);
	});

	test("another seller can't print your customer's address", async () => {
		const t = setup();
		const { retailer, productId } = await seedStore(t);
		const order = await placeOrder(t, retailer._id, productId);

		await expect(
			t
				.withIdentity({ subject: STRANGER })
				.action(api.awb.generateAwbPdf, { shortId: order.shortId }),
		).rejects.toThrow(/forbidden/i);
	});

	test("a buyer's tracking token is not a way in (seller document)", async () => {
		const t = setup();
		const { retailer, productId } = await seedStore(t);
		const order = await placeOrder(t, retailer._id, productId);
		await expect(
			t.action(api.awb.generateAwbPdf, { shortId: order.shortId }),
		).rejects.toThrow(/not authenticated/i);
	});

	test("a self-collect order says why it has no label", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		await asUser.mutation(api.retailers.updateSettings, {
			retailerId: retailer._id,
			offerSelfCollect: true,
		});
		const order = await placeOrder(t, retailer._id, productId, {
			selfCollect: true,
		});
		const res = await asUser.action(api.awb.generateAwbPdf, {
			shortId: order.shortId,
		});
		expect(res).toEqual({ ok: false, reason: "no_address" });
	});

	test("a cancelled order says why it has no label", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		const order = await placeOrder(t, retailer._id, productId);
		await patchOrder(t, order.id, { status: "cancelled" });
		const res = await asUser.action(api.awb.generateAwbPdf, {
			shortId: order.shortId,
		});
		expect(res).toEqual({ ok: false, reason: "cancelled" });
	});
});

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

describe("generateAwbBatchPdf (a selection)", () => {
	test("merges the selection into one PDF", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		const a = await placeOrder(t, retailer._id, productId);
		const b = await placeOrder(t, retailer._id, productId);

		const res = await asUser.action(api.awb.generateAwbBatchPdf, {
			retailerId: retailer._id,
			orderIds: [a.id, b.id],
		});
		expect(res.count).toBe(2);
		expect(isPdf(res.pdf)).toBe(true);
		expect(res.filename).toMatch(/^labels-\d{4}-\d{2}-\d{2}\.pdf$/);
		expect(res.skipped).toEqual({ cancelled: 0, no_address: 0, not_found: 0 });
	});

	test("counts what it left out, by reason — never a silent drop", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		await asUser.mutation(api.retailers.updateSettings, {
			retailerId: retailer._id,
			offerSelfCollect: true,
		});
		const printable = await placeOrder(t, retailer._id, productId);
		const pickup = await placeOrder(t, retailer._id, productId, {
			selfCollect: true,
		});
		const cancelled = await placeOrder(t, retailer._id, productId);
		await patchOrder(t, cancelled.id, { status: "cancelled" });

		const res = await asUser.action(api.awb.generateAwbBatchPdf, {
			retailerId: retailer._id,
			orderIds: [printable.id, pickup.id, cancelled.id],
		});
		expect(res.count).toBe(1);
		expect(res.skipped).toEqual({ cancelled: 1, no_address: 1, not_found: 0 });
	});

	test("drops another store's ids instead of printing its addresses", async () => {
		const t = setup();
		const mine = await seedStore(t, OWNER);
		const theirs = await seedStore(t, STRANGER);
		const foreign = await placeOrder(t, theirs.retailer._id, theirs.productId);
		const ours = await placeOrder(t, mine.retailer._id, mine.productId);

		const res = await mine.asUser.action(api.awb.generateAwbBatchPdf, {
			retailerId: mine.retailer._id,
			orderIds: [ours.id, foreign.id],
		});
		expect(res.count).toBe(1);
		expect(res.skipped.not_found).toBe(1);
	});

	test("an empty selection returns a valid (explanatory) PDF, not a crash", async () => {
		const t = setup();
		const { retailer, asUser } = await seedStore(t);
		const res = await asUser.action(api.awb.generateAwbBatchPdf, {
			retailerId: retailer._id,
			orderIds: [],
		});
		expect(res.count).toBe(0);
		expect(isPdf(res.pdf)).toBe(true);
	});

	test("refuses a selection over the cap rather than truncating it", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		const one = await placeOrder(t, retailer._id, productId);
		const tooMany = Array.from({ length: AWB_BATCH_MAX + 1 }, () => one.id);

		await expect(
			asUser.action(api.awb.generateAwbBatchPdf, {
				retailerId: retailer._id,
				orderIds: tooMany,
			}),
		).rejects.toThrow(new RegExp(`up to ${AWB_BATCH_MAX} labels`, "i"));
	});

	test("bulk printing rides the Order Inbox plan gate, like CSV export", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		await setPlan(t, retailer._id, "starter");
		const order = await placeOrder(t, retailer._id, productId);

		await expect(
			asUser.action(api.awb.generateAwbBatchPdf, {
				retailerId: retailer._id,
				orderIds: [order.id],
			}),
		).rejects.toThrow(/pro/i);
	});

	test("an admin acting-as bypasses the plan gate", async () => {
		const t = setup();
		const { retailer, productId } = await seedStore(t);
		await setPlan(t, retailer._id, "starter");
		const order = await placeOrder(t, retailer._id, productId);

		const res = await t
			.withIdentity({ subject: ADMIN })
			.action(api.awb.generateAwbBatchPdf, {
				retailerId: retailer._id,
				orderIds: [order.id],
			});
		expect(res.count).toBe(1);
	});

	test("a stranger can't batch-print another store", async () => {
		const t = setup();
		const { retailer, productId } = await seedStore(t);
		const order = await placeOrder(t, retailer._id, productId);

		await expect(
			t
				.withIdentity({ subject: STRANGER })
				.action(api.awb.generateAwbBatchPdf, {
					retailerId: retailer._id,
					orderIds: [order.id],
				}),
		).rejects.toThrow(/forbidden/i);
	});

	test("every sort produces the same label count", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		const a = await placeOrder(t, retailer._id, productId);
		const b = await placeOrder(t, retailer._id, productId);
		for (const sort of ["fulfilment", "status", "courier", "area"] as const) {
			const res = await asUser.action(api.awb.generateAwbBatchPdf, {
				retailerId: retailer._id,
				orderIds: [a.id, b.id],
				sort,
			});
			expect(res.count, sort).toBe(2);
		}
	});
});

// ---------------------------------------------------------------------------
// Ready to ship — the one-click despatch run
// ---------------------------------------------------------------------------

describe("generateAwbBatchPdf (ready to ship)", () => {
	/** Packed + paid + parcel delivery = ready. */
	async function seedReady(
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
		productId: Id<"products">,
	) {
		const order = await placeOrder(t, retailerId, productId);
		await patchOrder(t, order.id, {
			status: "packed",
			paymentStatus: "received",
		});
		return order;
	}

	test("prints exactly the packed-and-paid parcel orders", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		await seedReady(t, retailer._id, productId);
		await seedReady(t, retailer._id, productId);
		// Not ready: packed but unpaid, and paid but not packed yet.
		const unpaid = await placeOrder(t, retailer._id, productId);
		await patchOrder(t, unpaid.id, { status: "packed" });
		const notPacked = await placeOrder(t, retailer._id, productId);
		await patchOrder(t, notPacked.id, { paymentStatus: "received" });

		const res = await asUser.action(api.awb.generateAwbBatchPdf, {
			retailerId: retailer._id,
		});
		expect(res.count).toBe(2);
		expect(res.remaining).toBe(0);
		expect(res.filename).toMatch(/^labels-ready-to-ship-/);
	});

	test("the inbox count agrees with what actually prints", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		await seedReady(t, retailer._id, productId);
		await seedReady(t, retailer._id, productId);
		await placeOrder(t, retailer._id, productId); // pending, not ready

		const inbox = await asUser.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			limit: 1,
		});
		const printed = await asUser.action(api.awb.generateAwbBatchPdf, {
			retailerId: retailer._id,
		});
		expect(inbox.counts.readyToShip).toBe(2);
		expect(printed.count).toBe(inbox.counts.readyToShip);
	});

	test("printing does NOT advance anything to shipped", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		const ready = await seedReady(t, retailer._id, productId);

		await asUser.action(api.awb.generateAwbBatchPdf, {
			retailerId: retailer._id,
		});
		const after = await t.run(async (ctx) => ctx.db.get(ready.id));
		expect(after?.status).toBe("packed");
	});

	test("an empty queue is an empty (valid) PDF, never an error", async () => {
		const t = setup();
		const { retailer, asUser } = await seedStore(t);
		const res = await asUser.action(api.awb.generateAwbBatchPdf, {
			retailerId: retailer._id,
		});
		expect(res.count).toBe(0);
		expect(res.remaining).toBe(0);
		expect(isPdf(res.pdf)).toBe(true);
	});

	test("collection orders stay out of the queue (the rider goes the other way)", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		const collection = await seedReady(t, retailer._id, productId);
		await patchOrder(t, collection.id, { deliveryDirection: "collection" });

		const res = await asUser.action(api.awb.generateAwbBatchPdf, {
			retailerId: retailer._id,
		});
		expect(res.count).toBe(0);
		// …but an explicit selection still prints one (with swapped parties).
		const explicit = await asUser.action(api.awb.generateAwbBatchPdf, {
			retailerId: retailer._id,
			orderIds: [collection.id],
		});
		expect(explicit.count).toBe(1);
	});

	test("over the cap it prints a full batch and reports the remainder", async () => {
		const t = setup();
		const { retailer, productId, asUser } = await seedStore(t);
		// Rows are inserted directly here: `orders.create` is rate-limited per
		// storefront (correctly — it's a public endpoint), and this test is about
		// the batch ceiling, not the checkout path.
		await t.run(async (ctx) => {
			const now = Date.now();
			for (let i = 0; i < AWB_BATCH_MAX + 2; i++) {
				await ctx.db.insert("orders", {
					retailerId: retailer._id,
					shortId: `ORD-CAP${String(i).padStart(3, "0")}`,
					trackingToken: `tok${String(i).padStart(21, "0")}`,
					items: [{ productId, name: "Kuih Box", price: 2500, quantity: 1 }],
					subtotal: 2500,
					total: 2500,
					currency: "MYR",
					status: "packed",
					paymentStatus: "received",
					channel: "whatsapp",
					customer,
					deliveryMethod: "delivery",
					deliveryAddress: address,
					createdAt: now + i,
					updatedAt: now + i,
				});
			}
		});
		const res = await asUser.action(api.awb.generateAwbBatchPdf, {
			retailerId: retailer._id,
		});
		expect(res.count).toBe(AWB_BATCH_MAX);
		expect(res.remaining).toBe(2);
	});

	test("the queue rides the Order Inbox plan gate too", async () => {
		const t = setup();
		const { retailer, asUser } = await seedStore(t);
		await setPlan(t, retailer._id, "starter");
		await expect(
			asUser.action(api.awb.generateAwbBatchPdf, { retailerId: retailer._id }),
		).rejects.toThrow(/pro/i);
	});
});
