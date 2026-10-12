/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { PAYMENTS_PAUSED_HEADING } from "./lib/buyerPayments";
import schema from "./schema";
import { buyerPaymentsPausedFor } from "./subscriptions";

// Buyer payments pause while a store is lapsed (z8r3fdr6gg). The rule is one
// predicate; these tests pin the predicate's edges and then prove that EVERY
// payment door asks it — so deleting any one gate turns a test here red.

const modules = import.meta.glob("./**/*.ts");
const OWNER = "user_owner";
const PAUSED = /isn't taking payments on Kedaipal right now/;

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

type T = ReturnType<typeof setup>;

async function seedOrder(t: T) {
	const asOwner = t.withIdentity({ subject: OWNER });
	await asOwner.mutation(api.retailers.createRetailer, {
		storeName: "Dapur Nadia",
		slug: "dapur-nadia",
	});
	const retailer = await asOwner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await t.run((ctx) =>
		ctx.db.patch(retailer._id, {
			paymentMethods: [
				{
					type: "bank",
					label: "Maybank",
					bankName: "Maybank",
					bankAccountName: "Dapur Nadia",
					bankAccountNumber: "5123 4567 8901",
					sortOrder: 0,
				},
			],
		}),
	);
	const productId = await asOwner.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Kek lapis",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 5000, onHand: 10 }],
	});
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId: retailer._id,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Ali", waPhone: "60123456789" },
		deliveryAddress: {
			line1: "12 Jln Mawar 3",
			city: "Petaling Jaya",
			state: "Selangor",
			postcode: "47301",
		},
	});
	const order = await t.run((ctx) =>
		ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first(),
	);
	if (!order?.trackingToken) throw new Error("order seed failed");
	return {
		retailerId: retailer._id,
		orderId: order._id,
		shortId,
		token: order.trackingToken,
	};
}

/** Put the store's subscription into a state (default: lapsed). */
async function setSub(
	t: T,
	retailerId: Id<"retailers">,
	patch: Partial<Doc<"subscriptions">> = { status: "past_due" },
) {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no subscription row");
		await ctx.db.patch(sub._id, patch);
	});
}

function storeImage(t: T) {
	return t.run((ctx) =>
		ctx.storage.store(new Blob(["proof"], { type: "image/png" })),
	);
}

describe("buyerPaymentsPausedFor — the one rule", () => {
	const row = (
		patch: Partial<Doc<"subscriptions">>,
	): Doc<"subscriptions"> =>
		({
			_id: "sub" as Id<"subscriptions">,
			_creationTime: 0,
			retailerId: "r" as Id<"retailers">,
			plan: "pro",
			status: "active",
			billingCycle: "monthly",
			orderCap: 0,
			userCap: 0,
			broadcastQuota: 0,
			createdAt: 0,
			updatedAt: 0,
			...patch,
		}) as Doc<"subscriptions">;

	test("pauses a lapsed store: past due, or a comp an admin turned off", () => {
		expect(buyerPaymentsPausedFor(row({ status: "past_due" }))).toBe(true);
		expect(
			buyerPaymentsPausedFor(row({ status: "past_due", compEndedAt: 1 })),
		).toBe(true);
	});

	test("keeps payments open for every other state", () => {
		for (const status of ["trialing", "active", "on_hold"] as const) {
			expect(buyerPaymentsPausedFor(row({ status }))).toBe(false);
		}
		// A comp is never lapsed, whatever status the row keeps.
		expect(
			buyerPaymentsPausedFor(row({ status: "past_due", comped: true })),
		).toBe(false);
		// A missing row fails OPEN, like resolveAccess.
		expect(buyerPaymentsPausedFor(null)).toBe(false);
	});
});

describe("the payment doors while a store is lapsed", () => {
	test("getPaymentMethods withholds the bank details and says why", async () => {
		const t = setup();
		const { retailerId, token } = await seedOrder(t);

		const open = await t.query(api.orders.getPaymentMethods, { token });
		expect(open?.paymentsPaused).toBe(false);
		expect(open?.methods.map((m) => m.bankAccountNumber)).toEqual([
			"5123 4567 8901",
		]);

		await setSub(t, retailerId);
		const paused = await t.query(api.orders.getPaymentMethods, { token });
		expect(paused).toEqual({
			methods: [],
			gatewayAvailable: false,
			paymentsPaused: true,
		});
	});

	test("payments reopen on the same order the moment the store is active", async () => {
		const t = setup();
		const { retailerId, token } = await seedOrder(t);
		await setSub(t, retailerId);
		await setSub(t, retailerId, { status: "active" });
		const info = await t.query(api.orders.getPaymentMethods, { token });
		expect(info?.paymentsPaused).toBe(false);
		expect(info?.methods).toHaveLength(1);
	});

	test("a new 'I've paid' claim and its upload URL are refused", async () => {
		const t = setup();
		const { retailerId, token } = await seedOrder(t);
		const proof = await storeImage(t);
		await setSub(t, retailerId);

		await expect(
			t.mutation(api.orders.generateOrderProofUploadUrl, { token }),
		).rejects.toThrow(PAUSED);
		await expect(
			t.mutation(api.orders.claimPayment, { token, proofStorageId: proof }),
		).rejects.toThrow(PAUSED);
	});

	test("an order claimed BEFORE the pause can still update its proof", async () => {
		const t = setup();
		const { retailerId, orderId, token } = await seedOrder(t);
		await t.mutation(api.orders.claimPayment, {
			token,
			proofStorageId: await storeImage(t),
		});
		await setSub(t, retailerId);

		await t.mutation(api.orders.generateOrderProofUploadUrl, { token });
		await t.mutation(api.orders.claimPayment, {
			token,
			reference: "MBB-0042",
		});
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.paymentStatus).toBe("claimed");
		expect(order?.paymentReference).toBe("MBB-0042");
	});

	test("HitPay refuses a checkout — before it would reuse a live link", async () => {
		const t = setup();
		const { retailerId, orderId, token } = await seedOrder(t);
		// A link minted before the lapse and still inside the reuse window: the
		// gate must come first, or the old URL walks straight through it.
		await t.run((ctx) =>
			ctx.db.patch(orderId, {
				gatewayRequestId: "req_1",
				gatewayCheckoutUrl: "https://hitpay.test/pay/req_1",
				gatewayRequestedAmount: 5000,
				gatewayRequestedCurrency: "MYR",
				gatewayRequestedAt: Date.now(),
			}),
		);
		await setSub(t, retailerId);
		const context = await t.query(internal.hitpay.getCheckoutContext, {
			token,
		});
		expect(context?.paymentsPaused).toBe(true);
		await expect(
			t.action(api.hitpay.createCheckout, { token }),
		).rejects.toThrow(PAUSED);
	});

	test("the buyer's order read never carries a minted HitPay URL", async () => {
		const t = setup();
		const { orderId, token } = await seedOrder(t);
		await t.run((ctx) =>
			ctx.db.patch(orderId, {
				gatewayCheckoutUrl: "https://hitpay.test/pay/req_1",
			}),
		);
		const buyer = await t.query(api.orders.get, { token });
		expect(buyer?.gatewayCheckoutUrl).toBeUndefined();
	});
});

describe("what each side is told", () => {
	test("the storefront payload carries one bit — never the status", async () => {
		const t = setup();
		const { retailerId } = await seedOrder(t);
		const before = await t.query(api.retailers.getRetailerBySlug, {
			slug: "dapur-nadia",
		});
		expect(before.status === "ok" && before.retailer.paymentsPaused).toBe(
			false,
		);

		await setSub(t, retailerId);
		const after = await t.query(api.retailers.getRetailerBySlug, {
			slug: "dapur-nadia",
		});
		if (after.status !== "ok") throw new Error("store vanished");
		expect(after.retailer.paymentsPaused).toBe(true);
		expect(after.retailer.subscription).toBeUndefined();
		// Ordering itself is untouched — the buyer can still place the order.
		expect(after.retailer.orderingPaused).toBe(false);
	});

	test("an unpaid invoice PDF prints the paused notice, not the account number", async () => {
		const t = setup();
		const { retailerId, token } = await seedOrder(t);
		await setSub(t, retailerId);
		const inputs = await t.query(internal.orders.receiptPdfInputs, { token });
		expect(inputs?.data.paymentBlocks).toEqual([
			{
				label: PAYMENTS_PAUSED_HEADING,
				lines: [expect.stringMatching(PAUSED)],
			},
		]);
		expect(JSON.stringify(inputs?.data)).not.toContain("5123 4567 8901");
	});

	test("a PAID receipt is unchanged by the pause", async () => {
		const t = setup();
		const { retailerId, orderId, token } = await seedOrder(t);
		await t.run((ctx) =>
			ctx.db.patch(orderId, {
				paymentStatus: "received",
				paymentReceivedAt: Date.now(),
			}),
		);
		await setSub(t, retailerId);
		const inputs = await t.query(internal.orders.receiptPdfInputs, { token });
		expect(inputs?.data.paymentBlocks[0]?.label).toBe("Maybank");
	});

	test("the WhatsApp confirm reply knows the store is paused", async () => {
		const t = setup();
		const { retailerId, shortId } = await seedOrder(t);
		const open = await t.query(internal.whatsapp.getRetailerLocaleForOrder, {
			shortId,
		});
		expect(open?.paymentsPaused).toBe(false);
		await setSub(t, retailerId);
		const paused = await t.query(internal.whatsapp.getRetailerLocaleForOrder, {
			shortId,
		});
		expect(paused?.paymentsPaused).toBe(true);
	});

	test("a lapsed store's buyer can still PLACE an order", async () => {
		const t = setup();
		const { retailerId } = await seedOrder(t);
		await setSub(t, retailerId);
		const productId = await t.run(async (ctx) => {
			const p = await ctx.db
				.query("products")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			if (!p) throw new Error("no product");
			return p._id;
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Siti", waPhone: "60129876543" },
			deliveryAddress: {
				line1: "3 Jln Kenanga",
				city: "Shah Alam",
				state: "Selangor",
				postcode: "40000",
			},
		});
		expect(shortId).toMatch(/^ORD-/);
	});
});
