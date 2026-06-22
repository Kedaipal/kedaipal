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

const USER_A = "user_test_a";
const USER_B = "user_test_b";

const validAddress = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

async function seedRetailer(
	t: ReturnType<typeof convexTest>,
	userId: string,
) {
	const asUser = t.withIdentity({ subject: userId });
	const safeSuffix = userId.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Test Store",
		slug: `test-store-${safeSuffix}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedProduct(
	t: ReturnType<typeof convexTest>,
	userId: string,
	retailerId: Id<"retailers">,
	price = 10000,
) {
	const asUser = t.withIdentity({ subject: userId });
	return asUser.mutation(api.products.create, {
		retailerId,
		name: "Rendang 1kg",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		variants: [{ optionValues: [], price, onHand: 1000 }],
	});
}

async function placeOrder(
	t: ReturnType<typeof convexTest>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	opts: { quantity?: number; name?: string; waPhone?: string },
): Promise<string> {
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: opts.quantity ?? 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: opts.name, waPhone: opts.waPhone },
		deliveryAddress: validAddress,
	});
	return shortId;
}

beforeEach(() => {
	// Fake timers prevent scheduled functions (runAfter) from auto-firing
	// during the test. This avoids a convex-test limitation where scheduled
	// internalActions that call ctx.runQuery crash with "Transaction not started"
	// and interleave with the mutation under test. Mirrors whatsapp.test.ts.
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("customers — order linking", () => {
	test("order with waPhone creates and links a customer with aggregates", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const shortId = await placeOrder(t, retailer._id, productId, {
			name: "Aisha",
			waPhone: "60123456789",
			quantity: 2,
		});

		const asUser = t.withIdentity({ subject: USER_A });
		const order = await t.query(api.orders.get, { shortId });
		expect(order?.customerId).toBeDefined();

		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(list.page).toHaveLength(1);
		const c = list.page[0];
		expect(c.waPhone).toBe("60123456789");
		expect(c.name).toBe("Aisha");
		expect(c.orderCount).toBe(1);
		expect(c.totalSpent).toBe(20000);
		expect(c.firstOrderAt).toBe(c.lastOrderAt);
	});

	test("second order from same phone bumps the same customer", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId, {
			waPhone: "60123456789",
			quantity: 1,
		});
		await placeOrder(t, retailer._id, productId, {
			waPhone: "60123456789",
			quantity: 3,
		});

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "ltv",
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(list.page).toHaveLength(1);
		expect(list.page[0].orderCount).toBe(2);
		expect(list.page[0].totalSpent).toBe(40000);
		expect(list.page[0].lastOrderAt).toBeGreaterThanOrEqual(
			list.page[0].firstOrderAt,
		);
	});

	test("order without waPhone does not create a customer", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const shortId = await placeOrder(t, retailer._id, productId, {
			name: "Walk-in",
		});

		const order = await t.query(api.orders.get, { shortId });
		expect(order?.customerId).toBeUndefined();

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(list.page).toHaveLength(0);
	});
});

describe("customers — queries", () => {
	test("list is auth-scoped to the owning retailer", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const asB = t.withIdentity({ subject: USER_B });
		await expect(
			asB.query(api.customers.list, {
				retailerId: retailer._id,
				sort: "recency",
				paginationOpts: { numItems: 50, cursor: null },
			}),
		).rejects.toThrow(/forbidden/i);
	});

	test("list sorts by lifetime value descending", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId, {
			waPhone: "60111111111",
			quantity: 1,
		});
		await placeOrder(t, retailer._id, productId, {
			waPhone: "60222222222",
			quantity: 5,
		});

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "ltv",
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(list.page.map((c) => c.waPhone)).toEqual([
			"60222222222",
			"60111111111",
		]);
	});

	test("search matches by name and by phone prefix", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId, {
			name: "Aisha",
			waPhone: "60123456789",
		});
		await placeOrder(t, retailer._id, productId, {
			name: "Farah",
			waPhone: "60198765432",
		});

		const asUser = t.withIdentity({ subject: USER_A });
		const byName = await asUser.query(api.customers.search, {
			retailerId: retailer._id,
			term: "aisha",
		});
		expect(byName.map((c) => c.waPhone)).toEqual(["60123456789"]);

		const byPhone = await asUser.query(api.customers.search, {
			retailerId: retailer._id,
			term: "601987",
		});
		expect(byPhone.map((c) => c.waPhone)).toEqual(["60198765432"]);
	});

	test("get returns the customer with average order value", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId, {
			waPhone: "60123456789",
			quantity: 1,
		});
		await placeOrder(t, retailer._id, productId, {
			waPhone: "60123456789",
			quantity: 3,
		});

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		const customerId = list.page[0]._id;
		const detail = await asUser.query(api.customers.get, { customerId });
		expect(detail?.totalSpent).toBe(40000);
		expect(detail?.averageOrderValue).toBe(20000);
	});

	test("ordersByCustomer returns the customer's orders", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId, {
			waPhone: "60123456789",
			quantity: 1,
		});
		await placeOrder(t, retailer._id, productId, {
			waPhone: "60123456789",
			quantity: 2,
		});

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		const customerId = list.page[0]._id;
		const orders = await asUser.query(api.customers.ordersByCustomer, {
			customerId,
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(orders.page).toHaveLength(2);
	});
});

describe("customers — mutations", () => {
	test("updateNotes stores retailer-private notes", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId, { waPhone: "60123456789" });

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		const customerId = list.page[0]._id;
		await asUser.mutation(api.customers.updateNotes, {
			customerId,
			notes: "Allergic to nuts. VIP.",
		});
		const detail = await asUser.query(api.customers.get, { customerId });
		expect(detail?.notes).toBe("Allergic to nuts. VIP.");
	});

	test("updateNotes clears notes when given an empty string", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId, { waPhone: "60123456789" });

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		const customerId = list.page[0]._id;
		await asUser.mutation(api.customers.updateNotes, {
			customerId,
			notes: "temporary",
		});
		await asUser.mutation(api.customers.updateNotes, { customerId, notes: "  " });
		const detail = await asUser.query(api.customers.get, { customerId });
		expect(detail?.notes).toBeUndefined();
	});

	test("updateName sets the override and makes it searchable", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId, { waPhone: "60123456789" });

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		const customerId = list.page[0]._id;
		await asUser.mutation(api.customers.updateName, {
			customerId,
			name: "Kak Long",
		});
		const found = await asUser.query(api.customers.search, {
			retailerId: retailer._id,
			term: "kak",
		});
		expect(found.map((c) => c._id)).toContain(customerId);
	});

	test("updateNotes is auth-scoped", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await seedRetailer(t, USER_B);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId, { waPhone: "60123456789" });

		const asA = t.withIdentity({ subject: USER_A });
		const list = await asA.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		const customerId = list.page[0]._id;

		const asB = t.withIdentity({ subject: USER_B });
		await expect(
			asB.mutation(api.customers.updateNotes, {
				customerId,
				notes: "hijack",
			}),
		).rejects.toThrow(/forbidden/i);
	});
});

describe("customers — WhatsApp late-bind & pushname", () => {
	test("late-bind creates and links a customer from an inbound message", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		// Order arrives with no phone (e.g. link-in-bio checkout).
		const shortId = await placeOrder(t, retailer._id, productId, {
			quantity: 2,
		});

		await t.mutation(internal.whatsapp.confirmOrderFromWhatsApp, {
			shortId,
			fromPhone: "60123456789",
			profileName: "Aisha WA",
		});

		const order = await t.query(api.orders.get, { shortId });
		expect(order?.customerId).toBeDefined();

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(list.page).toHaveLength(1);
		const c = list.page[0];
		expect(c.waPhone).toBe("60123456789");
		expect(c.orderCount).toBe(1);
		expect(c.totalSpent).toBe(20000);
		expect(c.waProfileName).toBe("Aisha WA");
		// No retailer override yet → pushname fills the name.
		expect(c.name).toBe("Aisha WA");
	});

	test("late-bind confirmation is idempotent (no double counting)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const shortId = await placeOrder(t, retailer._id, productId, {
			quantity: 1,
		});

		await t.mutation(internal.whatsapp.confirmOrderFromWhatsApp, {
			shortId,
			fromPhone: "60123456789",
		});
		await t.mutation(internal.whatsapp.confirmOrderFromWhatsApp, {
			shortId,
			fromPhone: "60123456789",
		});

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(list.page).toHaveLength(1);
		expect(list.page[0].orderCount).toBe(1);
	});

	test("pushname never overwrites the retailer-edited name", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		// Order with phone → customer created+linked at checkout.
		const shortId = await placeOrder(t, retailer._id, productId, {
			name: "Aisha",
			waPhone: "60123456789",
		});

		const asUser = t.withIdentity({ subject: USER_A });
		let list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		const customerId = list.page[0]._id;
		await asUser.mutation(api.customers.updateName, {
			customerId,
			name: "Kak Long",
		});

		// Shopper messages in; webhook carries a different pushname.
		await t.mutation(internal.whatsapp.confirmOrderFromWhatsApp, {
			shortId,
			fromPhone: "60123456789",
			profileName: "WhatsApp Aisha",
		});

		list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(list.page[0].name).toBe("Kak Long");
		expect(list.page[0].waProfileName).toBe("WhatsApp Aisha");
	});
});

describe("customers — backfill", () => {
	// Insert an order directly, bypassing orders.create, to simulate
	// pre-migration data that has no customerId link.
	async function insertLegacyOrder(
		t: ReturnType<typeof convexTest>,
		retailerId: Id<"retailers">,
		productId: Id<"products">,
		seq: number,
		waPhone: string | undefined,
		total: number,
		name?: string,
	) {
		const now = Date.now();
		await t.run(async (ctx) =>
			ctx.db.insert("orders", {
				retailerId,
				shortId: `ORD-LEG${seq}`,
				items: [
					{ productId, name: "Rendang 1kg", price: total, quantity: 1 },
				],
				subtotal: total,
				total,
				currency: "MYR",
				status: "confirmed",
				channel: "whatsapp",
				customer: { name, waPhone },
				createdAt: now,
				updatedAt: now,
			}),
		);
	}

	test("backfill creates and links customers for pre-existing orders", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await insertLegacyOrder(t, retailer._id, productId, 1, "60123456789", 10000, "Aisha");
		await insertLegacyOrder(t, retailer._id, productId, 2, "60123456789", 20000);
		await insertLegacyOrder(t, retailer._id, productId, 3, "60198765432", 5000, "Farah");
		await insertLegacyOrder(t, retailer._id, productId, 4, undefined, 9999); // no phone → skipped

		await t.mutation(internal.customers.backfillCustomers, {
			cursor: null,
		});

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "ltv",
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(list.page).toHaveLength(2);
		const aisha = list.page.find((c) => c.waPhone === "60123456789");
		expect(aisha?.orderCount).toBe(2);
		expect(aisha?.totalSpent).toBe(30000);
		expect(aisha?.name).toBe("Aisha");

		// Legacy orders are now linked.
		const linked = await t.query(api.orders.get, { shortId: "ORD-LEG1" });
		expect(linked?.customerId).toBe(aisha?._id);
		const skipped = await t.query(api.orders.get, { shortId: "ORD-LEG4" });
		expect(skipped?.customerId).toBeUndefined();
	});

	test("backfill is idempotent", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await insertLegacyOrder(t, retailer._id, productId, 1, "60123456789", 10000, "Aisha");
		await insertLegacyOrder(t, retailer._id, productId, 2, "60123456789", 20000);

		await t.mutation(internal.customers.backfillCustomers, { cursor: null });
		await t.mutation(internal.customers.backfillCustomers, { cursor: null });

		const asUser = t.withIdentity({ subject: USER_A });
		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(list.page).toHaveLength(1);
		expect(list.page[0].orderCount).toBe(2);
		expect(list.page[0].totalSpent).toBe(30000);
	});
});

describe("customers — cancellation", () => {
	test("cancelling an order decrements the customer aggregates", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId, {
			waPhone: "60123456789",
			quantity: 1,
		});
		const shortId2 = await placeOrder(t, retailer._id, productId, {
			waPhone: "60123456789",
			quantity: 3,
		});

		const asUser = t.withIdentity({ subject: USER_A });
		const order2 = await t.query(api.orders.get, { shortId: shortId2 });
		if (!order2) throw new Error("order missing");
		await asUser.mutation(api.orders.updateStatus, {
			orderId: order2._id,
			status: "cancelled",
		});

		const list = await asUser.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(list.page[0].orderCount).toBe(1);
		expect(list.page[0].totalSpent).toBe(10000);
	});
});

describe("customers — count", () => {
	test("counts distinct customers for the retailer; owner-only", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });

		expect(
			await asA.query(api.customers.count, { retailerId: retailer._id }),
		).toBe(0);

		await placeOrder(t, retailer._id, productId, {
			name: "Ali",
			waPhone: "60123456789",
		});
		await placeOrder(t, retailer._id, productId, {
			name: "Bob",
			waPhone: "60198887777",
		});
		// Same phone → same customer (keyed by (retailerId, waPhone)).
		await placeOrder(t, retailer._id, productId, {
			name: "Ali again",
			waPhone: "60123456789",
		});

		expect(
			await asA.query(api.customers.count, { retailerId: retailer._id }),
		).toBe(2);

		await expect(
			t
				.withIdentity({ subject: USER_B })
				.query(api.customers.count, { retailerId: retailer._id }),
		).rejects.toThrow(/forbidden/i);
	});
});
