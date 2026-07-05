/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER_A = "user_activation_a";

const validAddress = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const safe = userId.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Test Store",
		slug: `test-store-${safe}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedProduct(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
) {
	const asUser = t.withIdentity({ subject: userId });
	return asUser.mutation(api.products.create, {
		retailerId,
		name: "Rendang 1kg",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		variants: [{ optionValues: [], price: 10000, onHand: 1000 }],
	});
}

async function placeOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	waPhone = "60123456789",
): Promise<{ shortId: string; orderId: Id<"orders"> }> {
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Aisha", waPhone },
		deliveryAddress: validAddress,
	});
	const orderId = await t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error("order not found");
		return o._id;
	});
	return { shortId, orderId };
}

/**
 * Read the retailer's activation stamp straight from the row. An absent field
 * round-trips through t.run as `null`, so we normalize to null for the "not yet
 * activated" assertions.
 */
async function activatedAt(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
): Promise<number | null> {
	return t.run(
		async (ctx) => (await ctx.db.get(retailerId))?.activatedAt ?? null,
	);
}

beforeEach(() => {
	// Fake timers keep scheduled notifications (runAfter) from auto-firing during
	// the mutation under test — mirrors customers.test.ts. They also let us pin
	// Date.now() to assert the one-time stamp keeps the FIRST timestamp.
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-06-30T00:00:00Z"));
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("activation — activatedAt stamping", () => {
	test("a freshly created (pending) order does NOT activate the store", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId);

		expect(await activatedAt(t, retailer._id)).toBeNull();
	});

	test("confirming via WhatsApp activates the store", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await placeOrder(t, retailer._id, productId);

		await t.mutation(internal.whatsapp.confirmOrderFromWhatsApp, {
			shortId,
			fromPhone: "60123456789",
		});

		expect(await activatedAt(t, retailer._id)).toBe(Date.now());
	});

	test("payment auto-confirm activates the store", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { orderId } = await placeOrder(t, retailer._id, productId);

		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orders.markPaymentReceived, { orderId });

		expect(await activatedAt(t, retailer._id)).toBe(Date.now());
	});

	test("a seller manual status transition activates the store", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { orderId } = await placeOrder(t, retailer._id, productId);

		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orders.updateStatus, { orderId, status: "confirmed" });

		expect(await activatedAt(t, retailer._id)).toBe(Date.now());
	});

	test("counter checkout (born confirmed) activates the store", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const variantId = await t.run(async (ctx) => {
			const v = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", productId))
				.first();
			if (!v) throw new Error("variant not found");
			return v._id;
		});

		// A walk-in scans the store QR → a buyer_identified session appears.
		const { token } = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.ensureCounterQrToken, {});
		await t.mutation(internal.counterCheckout.startSessionFromStoreQr, {
			token,
			waPhone: "60123456789",
			profileName: "Aiman",
		});
		const sessionId = await t.run(async (ctx) => {
			const s = await ctx.db
				.query("counterCheckoutSessions")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", retailer._id).eq("status", "buyer_identified"),
				)
				.unique();
			if (!s) throw new Error("session not found");
			return s._id;
		});
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.counterCheckout.createOrderFromSession, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
				paymentMethod: "cash",
			});

		expect(await activatedAt(t, retailer._id)).toBe(Date.now());
	});

	test("the stamp is one-time — later transitions keep the FIRST timestamp", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId, orderId } = await placeOrder(t, retailer._id, productId);

		const firstConfirm = Date.now();
		await t.mutation(internal.whatsapp.confirmOrderFromWhatsApp, {
			shortId,
			fromPhone: "60123456789",
		});
		expect(await activatedAt(t, retailer._id)).toBe(firstConfirm);

		// Advance time and push the order forward — activatedAt must not move.
		vi.advanceTimersByTime(60_000);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orders.updateStatus, { orderId, status: "packed" });
		expect(await activatedAt(t, retailer._id)).toBe(firstConfirm);
	});

	test("cancelling an order never un-sets activatedAt", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { orderId } = await placeOrder(t, retailer._id, productId);

		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.orders.updateStatus, {
			orderId,
			status: "confirmed",
		});
		const stamp = await activatedAt(t, retailer._id);
		expect(stamp).toBe(Date.now());

		await asUser.mutation(api.orders.updateStatus, {
			orderId,
			status: "cancelled",
		});
		expect(await activatedAt(t, retailer._id)).toBe(stamp);
	});

	test("an order created then cancelled before confirm never activates", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { orderId } = await placeOrder(t, retailer._id, productId);

		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orders.updateStatus, { orderId, status: "cancelled" });

		expect(await activatedAt(t, retailer._id)).toBeNull();
	});
});

describe("activation — markLinkShared", () => {
	test("stamps linkSharedAt once, then is idempotent", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });

		const first = await asUser.mutation(api.retailers.markLinkShared, {});
		expect(first.updated).toBe(true);
		const stamped = await t.run(
			async (ctx) => (await ctx.db.get(retailer._id))?.linkSharedAt,
		);
		expect(stamped).toBe(Date.now());

		vi.advanceTimersByTime(60_000);
		const second = await asUser.mutation(api.retailers.markLinkShared, {});
		expect(second.updated).toBe(false);
		expect(
			await t.run(
				async (ctx) => (await ctx.db.get(retailer._id))?.linkSharedAt,
			),
		).toBe(stamped);
	});

	test("unauthenticated markLinkShared is a graceful no-op", async () => {
		const t = setup();
		const result = await t.mutation(api.retailers.markLinkShared, {});
		expect(result.updated).toBe(false);
	});
});

describe("activation — getMyRetailer exposure", () => {
	test("owner read surfaces activatedAt + linkSharedAt", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await placeOrder(t, retailer._id, productId);
		const asUser = t.withIdentity({ subject: USER_A });

		// Unset before any share / order confirm.
		let me = await asUser.query(api.retailers.getMyRetailer);
		expect(me?.activatedAt).toBeUndefined();
		expect(me?.linkSharedAt).toBeUndefined();

		await asUser.mutation(api.retailers.markLinkShared, {});
		await t.mutation(internal.whatsapp.confirmOrderFromWhatsApp, {
			shortId,
			fromPhone: "60123456789",
		});

		me = await asUser.query(api.retailers.getMyRetailer);
		expect(me?.linkSharedAt).toBe(Date.now());
		expect(me?.activatedAt).toBe(Date.now());
	});
});
