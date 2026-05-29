/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
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

async function seedRetailer(t: ReturnType<typeof convexTest>, userId: string) {
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
	overrides: Partial<{
		name: string;
		price: number;
		currency: string;
		stock: number;
	}> = {},
) {
	const asUser = t.withIdentity({ subject: userId });
	return asUser.mutation(api.products.create, {
		retailerId,
		name: overrides.name ?? "Tent 2P",
		price: overrides.price ?? 12000,
		currency: overrides.currency ?? "MYR",
		stock: overrides.stock ?? 100,
		imageStorageIds: [],
		sortOrder: 0,
	});
}

async function getProductStock(
	t: ReturnType<typeof convexTest>,
	productId: Id<"products">,
): Promise<number> {
	const p = await t.run(async (ctx) => ctx.db.get(productId));
	if (!p) throw new Error("product missing");
	return p.stock;
}

const customer = { name: "Ali", waPhone: "60123456789" };

const validAddress = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

describe("orders", () => {
	test("create returns shortId in ORD-XXXX format", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		expect(shortId).toMatch(/^ORD-[A-Z2-9]{4}$/);
	});

	test("computes correct subtotal and total", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const p1 = await seedProduct(t, USER_A, retailer._id, { price: 10000 });
		const p2 = await seedProduct(t, USER_A, retailer._id, {
			name: "Stove",
			price: 5000,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [
				{ productId: p1, quantity: 2 },
				{ productId: p2, quantity: 3 },
			],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		expect(order?.subtotal).toBe(35000);
		expect(order?.total).toBe(35000);
	});

	test("snapshots product name and price at order time", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			price: 10000,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		// Mutate product price after order creation.
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.products.update, { productId, price: 99999 });
		const order = await t.query(api.orders.get, { shortId });
		expect(order?.items[0].price).toBe(10000);
	});

	test("rejects product from a different retailer", async () => {
		const t = setup();
		const retailerA = await seedRetailer(t, USER_A);
		const retailerB = await seedRetailer(t, USER_B);
		const productB = await seedProduct(t, USER_B, retailerB._id);

		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailerA._id,
				items: [{ productId: productB, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/does not belong/);
	});

	test("rejects archived product", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.products.archive, { productId });

		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/not available/);
	});

	test("creates initial pending orderEvent", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		const events = await t.run(async (ctx) =>
			ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", order!._id))
				.collect(),
		);
		expect(events).toHaveLength(1);
		expect(events[0].status).toBe("pending");
	});

	test("updateStatus patches status and appends event", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.orders.updateStatus, {
			orderId: order!._id,
			status: "confirmed",
		});

		const updated = await t.query(api.orders.get, { shortId });
		expect(updated?.status).toBe("confirmed");

		const events = await t.run(async (ctx) =>
			ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", order!._id))
				.collect(),
		);
		expect(events).toHaveLength(2);
	});

	test("updateStatus by non-owner throws Forbidden", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		const asB = t.withIdentity({ subject: USER_B });
		await expect(
			asB.mutation(api.orders.updateStatus, {
				orderId: order!._id,
				status: "confirmed",
			}),
		).rejects.toThrow(/Forbidden/);
	});

	test("listByRetailer filters by status", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });

		const r1 = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const r2 = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});

		const o1 = await t.query(api.orders.get, { shortId: r1.shortId });
		const o2 = await t.query(api.orders.get, { shortId: r2.shortId });
		await asA.mutation(api.orders.updateStatus, {
			orderId: o1!._id,
			status: "confirmed",
		});
		await asA.mutation(api.orders.updateStatus, {
			orderId: o2!._id,
			status: "confirmed",
		});

		const page = await asA.query(api.orders.listByRetailer, {
			retailerId: retailer._id,
			status: "confirmed",
			paginationOpts: { numItems: 10, cursor: null },
		});
		expect(page.page).toHaveLength(2);
	});

	test("rejects currency mismatch", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			currency: "MYR",
		});
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "SGD",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/Currency mismatch/);
	});

	test("allows order without customer waPhone (webhook stamps it later)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Ali" },
			deliveryAddress: validAddress,
		});
		expect(shortId).toBeTruthy();
	});

	test("rejects when customer waPhone is invalid", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer: { name: "Ali", waPhone: "abc" },
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/WhatsApp number/);
	});

	test("create decrements product stock by ordered quantity", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			stock: 10,
		});
		await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 3 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		expect(await getProductStock(t, productId)).toBe(7);
	});

	test("create rejects when quantity exceeds stock", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			stock: 3,
		});
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 5 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/in stock/);
		// Stock unchanged
		expect(await getProductStock(t, productId)).toBe(3);
	});

	test("create with two line items on same product sums and decrements once", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			stock: 10,
		});
		await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [
				{ productId, quantity: 2 },
				{ productId, quantity: 3 },
			],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		expect(await getProductStock(t, productId)).toBe(5);
	});

	test("create rolls back stock on later validation failure", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productA = await seedProduct(t, USER_A, retailer._id, {
			name: "A",
			stock: 10,
		});
		const productB = await seedProduct(t, USER_A, retailer._id, {
			name: "B",
			currency: "SGD",
			stock: 10,
		});
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [
					{ productId: productA, quantity: 2 },
					{ productId: productB, quantity: 1 },
				],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/Currency mismatch/);
		// First product's stock must NOT have been decremented
		expect(await getProductStock(t, productA)).toBe(10);
		expect(await getProductStock(t, productB)).toBe(10);
	});

	test("cancelling an order restores stock", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			stock: 10,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 4 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		expect(await getProductStock(t, productId)).toBe(6);
		const order = await t.query(api.orders.get, { shortId });
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.orders.updateStatus, {
			orderId: order!._id,
			status: "cancelled",
		});
		expect(await getProductStock(t, productId)).toBe(10);
	});

	test("cancelling an already-cancelled order is a no-op for stock", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			stock: 10,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 4 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.orders.updateStatus, {
			orderId: order!._id,
			status: "cancelled",
		});
		await asA.mutation(api.orders.updateStatus, {
			orderId: order!._id,
			status: "cancelled",
		});
		// Restored once, not twice
		expect(await getProductStock(t, productId)).toBe(10);
	});

	test("non-cancel transitions do not change stock", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			stock: 10,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 3 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		const asA = t.withIdentity({ subject: USER_A });
		for (const status of [
			"confirmed",
			"packed",
			"shipped",
			"delivered",
		] as const) {
			await asA.mutation(api.orders.updateStatus, {
				orderId: order!._id,
				status,
			});
			expect(await getProductStock(t, productId)).toBe(7);
		}
	});

	test("create with delivery method and no address rejects", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryMethod: "delivery",
			}),
		).rejects.toThrow(/Delivery address is required/);
	});

	test("create with self_collect and address rejects", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryMethod: "self_collect",
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/should not include an address/);
	});

	test("create persists sanitized address with whitespace trimmed", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: {
				line1: "  12 Jln Mawar 3  ",
				line2: "   ",
				city: "Petaling Jaya",
				state: "Selangor",
				postcode: "47301",
				notes: "  Pintu pagar biru  ",
			},
		});
		const order = await t.query(api.orders.get, { shortId });
		expect(order?.deliveryAddress?.line1).toBe("12 Jln Mawar 3");
		expect(order?.deliveryAddress?.line2).toBeUndefined();
		expect(order?.deliveryAddress?.notes).toBe("Pintu pagar biru");
	});

	test("create rejects invalid postcode", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: { ...validAddress, postcode: "abcde" },
			}),
		).rejects.toThrow(/Postcode must be 5 digits/);
	});

	test("create rejects unknown state", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: { ...validAddress, state: "Atlantis" },
			}),
		).rejects.toThrow(/Unknown state/);
	});

	test("updateDeliveryAddress patches address while pending", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const newAddress = {
			line1: "99 Jln Cempaka",
			city: "Shah Alam",
			state: "Selangor",
			postcode: "40000",
		};
		await t.mutation(api.orders.updateDeliveryAddress, {
			shortId,
			deliveryAddress: newAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		expect(order?.deliveryAddress?.line1).toBe("99 Jln Cempaka");
		expect(order?.deliveryAddress?.postcode).toBe("40000");
	});

	test("updateDeliveryAddress on confirmed order throws", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.orders.updateStatus, {
			orderId: order!._id,
			status: "confirmed",
		});
		await expect(
			t.mutation(api.orders.updateDeliveryAddress, {
				shortId,
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/while the order is pending/);
	});

	test("updateDeliveryAddress on self_collect order throws", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryMethod: "self_collect",
		});
		await expect(
			t.mutation(api.orders.updateDeliveryAddress, {
				shortId,
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/Self-collect orders/);
	});

	test("updateDeliveryAddress writes an audit event", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		await t.mutation(api.orders.updateDeliveryAddress, {
			shortId,
			deliveryAddress: { ...validAddress, line1: "new address line" },
		});
		const events = await t.run(async (ctx) =>
			ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", order!._id))
				.collect(),
		);
		const updateEvent = events.find((e) => e.note === "address_updated");
		expect(updateEvent).toBeTruthy();
		expect(updateEvent?.status).toBe("pending");
	});

	describe("payment handshake", () => {
		test("claimPayment patches paymentStatus, writes event, schedules email", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});

			await t.mutation(api.orders.claimPayment, {
				shortId,
				reference: "TXN-12345",
			});

			const order = await t.query(api.orders.get, { shortId });
			expect(order?.paymentStatus).toBe("claimed");
			expect(order?.paymentReference).toBe("TXN-12345");
			expect(order?.paymentClaimedAt).toBeTypeOf("number");
			// Status untouched — payment is independent of fulfilment.
			expect(order?.status).toBe("pending");

			const events = await t.run(async (ctx) =>
				ctx.db
					.query("orderEvents")
					.withIndex("by_order", (q) => q.eq("orderId", order!._id))
					.collect(),
			);
			const claimEvent = events.find((e) => e.note === "payment_claimed");
			expect(claimEvent).toBeTruthy();
		});

		test("claimPayment without reference or proof still succeeds", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});
			await t.mutation(api.orders.claimPayment, { shortId });
			const order = await t.query(api.orders.get, { shortId });
			expect(order?.paymentStatus).toBe("claimed");
			expect(order?.paymentReference).toBeUndefined();
		});

		test("claimPayment is idempotent — second claim overwrites reference", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});

			await t.mutation(api.orders.claimPayment, {
				shortId,
				reference: "first",
			});
			await t.mutation(api.orders.claimPayment, {
				shortId,
				reference: "second",
			});
			const order = await t.query(api.orders.get, { shortId });
			expect(order?.paymentStatus).toBe("claimed");
			expect(order?.paymentReference).toBe("second");
		});

		test("claimPayment rejects unknown shortId", async () => {
			const t = setup();
			await expect(
				t.mutation(api.orders.claimPayment, { shortId: "ORD-NOPE" }),
			).rejects.toThrow(/Order not found/);
		});

		test("claimPayment rejects when payment already received", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});
			const order = await t.query(api.orders.get, { shortId });
			await t.run(async (ctx) => {
				await ctx.db.patch(order!._id, { paymentStatus: "received" });
			});
			await expect(
				t.mutation(api.orders.claimPayment, { shortId }),
			).rejects.toThrow(/already confirmed/);
		});

		test("claimPayment rejects oversized reference", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});
			await expect(
				t.mutation(api.orders.claimPayment, {
					shortId,
					reference: "x".repeat(81),
				}),
			).rejects.toThrow(/characters or fewer/);
		});

		test("markPaymentReceived sets paymentStatus and auto-confirms pending", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});
			const order = await t.query(api.orders.get, { shortId });
			const asA = t.withIdentity({ subject: USER_A });
			await asA.mutation(api.orders.markPaymentReceived, {
				orderId: order!._id,
			});
			const updated = await t.query(api.orders.get, { shortId });
			expect(updated?.paymentStatus).toBe("received");
			expect(updated?.paymentReceivedAt).toBeTypeOf("number");
			expect(updated?.status).toBe("confirmed");

			const events = await t.run(async (ctx) =>
				ctx.db
					.query("orderEvents")
					.withIndex("by_order", (q) => q.eq("orderId", order!._id))
					.collect(),
			);
			const autoConfirmEvent = events.find(
				(e) => e.note === "payment_received_auto_confirm",
			);
			expect(autoConfirmEvent?.status).toBe("confirmed");
		});

		test("markPaymentReceived does not auto-confirm if already past pending", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});
			const order = await t.query(api.orders.get, { shortId });
			const asA = t.withIdentity({ subject: USER_A });
			await asA.mutation(api.orders.updateStatus, {
				orderId: order!._id,
				status: "confirmed",
			});
			await asA.mutation(api.orders.updateStatus, {
				orderId: order!._id,
				status: "packed",
			});

			await asA.mutation(api.orders.markPaymentReceived, {
				orderId: order!._id,
			});
			const updated = await t.query(api.orders.get, { shortId });
			expect(updated?.paymentStatus).toBe("received");
			// Status preserved at packed — payment-received did not bump it back
			// or further along the pipeline.
			expect(updated?.status).toBe("packed");
		});

		test("markPaymentReceived requires authentication", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});
			const order = await t.query(api.orders.get, { shortId });
			await expect(
				t.mutation(api.orders.markPaymentReceived, { orderId: order!._id }),
			).rejects.toThrow(/Not authenticated/);
		});

		test("markPaymentReceived rejects non-owner retailer", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			await seedRetailer(t, USER_B);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});
			const order = await t.query(api.orders.get, { shortId });
			const asB = t.withIdentity({ subject: USER_B });
			await expect(
				asB.mutation(api.orders.markPaymentReceived, { orderId: order!._id }),
			).rejects.toThrow(/Forbidden/);
		});

		test("markPaymentReceived is idempotent — second call is no-op", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});
			const order = await t.query(api.orders.get, { shortId });
			const asA = t.withIdentity({ subject: USER_A });
			await asA.mutation(api.orders.markPaymentReceived, {
				orderId: order!._id,
			});
			const firstReceivedAt = (await t.query(api.orders.get, { shortId }))
				?.paymentReceivedAt;
			await asA.mutation(api.orders.markPaymentReceived, {
				orderId: order!._id,
			});
			const secondReceivedAt = (await t.query(api.orders.get, { shortId }))
				?.paymentReceivedAt;
			expect(secondReceivedAt).toBe(firstReceivedAt);
		});

		test("generateOrderProofUploadUrl returns an upload URL for valid order", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});
			const url = await t.mutation(api.orders.generateOrderProofUploadUrl, {
				shortId,
			});
			expect(url).toMatch(/^https?:\/\//);
		});

		test("generateOrderProofUploadUrl rejects unknown shortId", async () => {
			const t = setup();
			await expect(
				t.mutation(api.orders.generateOrderProofUploadUrl, {
					shortId: "ORD-NOPE",
				}),
			).rejects.toThrow(/Order not found/);
		});

		test("generateOrderProofUploadUrl rejects after payment received", async () => {
			const t = setup();
			const retailer = await seedRetailer(t, USER_A);
			const productId = await seedProduct(t, USER_A, retailer._id);
			const { shortId } = await t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			});
			const order = await t.query(api.orders.get, { shortId });
			await t.run(async (ctx) => {
				await ctx.db.patch(order!._id, { paymentStatus: "received" });
			});
			await expect(
				t.mutation(api.orders.generateOrderProofUploadUrl, { shortId }),
			).rejects.toThrow(/already confirmed/);
		});
	});
});

describe("orders — self-collect pickup invariants", () => {
	async function seedRetailerWithPickup(
		t: ReturnType<typeof convexTest>,
		userId: string,
		opts: { offerSelfCollect: boolean; label?: string } = {
			offerSelfCollect: true,
			label: "Main",
		},
	) {
		const retailer = await seedRetailer(t, userId);
		const asUser = t.withIdentity({ subject: userId });
		if (opts.offerSelfCollect) {
			await asUser.mutation(api.retailers.updateSettings, {
				offerSelfCollect: true,
			});
		}
		const { pickupLocationId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: opts.label ?? "Main",
				address: "12 Jln Tun Razak, 50400 KL",
				mapsUrl: "https://maps.app.goo.gl/abc",
				notes: "Bring your order ID.",
			},
		);
		return { retailer, pickupLocationId };
	}

	test("self_collect order with toggle on and ≥1 location requires pickupLocationId", async () => {
		const t = setup();
		const { retailer } = await seedRetailerWithPickup(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);

		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryMethod: "self_collect",
			}),
		).rejects.toThrow(/Pick a pickup location/);
	});

	test("self_collect order freezes the snapshot at insert time", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedRetailerWithPickup(
			t,
			USER_A,
		);
		const productId = await seedProduct(t, USER_A, retailer._id);

		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryMethod: "self_collect",
			pickupLocationId,
		});
		const order = await t.query(api.orders.get, { shortId });
		expect(order?.pickupLocationId).toBe(pickupLocationId);
		expect(order?.pickupSnapshot).toEqual({
			label: "Main",
			address: "12 Jln Tun Razak, 50400 KL",
			mapsUrl: "https://maps.app.goo.gl/abc",
			notes: "Bring your order ID.",
		});

		// Edit the source location — historical snapshot must not move
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.pickupLocations.update, {
			pickupLocationId,
			label: "Renamed",
			address: "New address",
		});
		const reread = await t.query(api.orders.get, { shortId });
		expect(reread?.pickupSnapshot?.label).toBe("Main");
		expect(reread?.pickupSnapshot?.address).toBe("12 Jln Tun Razak, 50400 KL");
	});

	test("self_collect order rejects an inactive pickupLocationId", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedRetailerWithPickup(
			t,
			USER_A,
		);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asUser = t.withIdentity({ subject: USER_A });

		// Add a second active location so the strict branch still fires after
		// the first is deactivated.
		await asUser.mutation(api.pickupLocations.create, {
			retailerId: retailer._id,
			label: "Other",
			address: "Other addr",
		});
		await asUser.mutation(api.pickupLocations.setActive, {
			pickupLocationId,
			isActive: false,
		});

		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryMethod: "self_collect",
				pickupLocationId,
			}),
		).rejects.toThrow(/no longer available/);
	});

	test("self_collect order rejects a pickupLocationId from another retailer", async () => {
		const t = setup();
		const { retailer: retailerA } = await seedRetailerWithPickup(t, USER_A);
		const { pickupLocationId: foreignId } = await seedRetailerWithPickup(
			t,
			USER_B,
			{ offerSelfCollect: true, label: "B-Main" },
		);
		const productId = await seedProduct(t, USER_A, retailerA._id);

		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailerA._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryMethod: "self_collect",
				pickupLocationId: foreignId,
			}),
		).rejects.toThrow(/not found/);
	});

	test("delivery order with a pickupLocationId is rejected", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedRetailerWithPickup(
			t,
			USER_A,
		);
		const productId = await seedProduct(t, USER_A, retailer._id);

		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
				pickupLocationId,
			}),
		).rejects.toThrow(/should not include a pickup location/);
	});

	test("self_collect with toggle off preserves legacy zero-info path", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		// Note: no pickup locations created, toggle is off → strict branch is
		// closed. The order should succeed and carry no pickup info.
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryMethod: "self_collect",
		});
		const order = await t.query(api.orders.get, { shortId });
		expect(order?.pickupLocationId).toBeUndefined();
		expect(order?.pickupSnapshot).toBeUndefined();
	});

	test("updatePickupLocation swaps the snapshot on a pending order", async () => {
		const t = setup();
		const { retailer, pickupLocationId: firstId } =
			await seedRetailerWithPickup(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asUser = t.withIdentity({ subject: USER_A });
		const { pickupLocationId: secondId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Second",
				address: "20 Jln Ampang, KL",
			},
		);

		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryMethod: "self_collect",
			pickupLocationId: firstId,
		});

		await t.mutation(api.orders.updatePickupLocation, {
			shortId,
			pickupLocationId: secondId,
		});

		const order = await t.query(api.orders.get, { shortId });
		expect(order?.pickupLocationId).toBe(secondId);
		expect(order?.pickupSnapshot?.label).toBe("Second");
		expect(order?.pickupSnapshot?.address).toBe("20 Jln Ampang, KL");
	});

	test("updatePickupLocation rejects inactive target", async () => {
		const t = setup();
		const { retailer, pickupLocationId: firstId } =
			await seedRetailerWithPickup(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asUser = t.withIdentity({ subject: USER_A });
		const { pickupLocationId: secondId } = await asUser.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Second",
				address: "20 Jln Ampang, KL",
			},
		);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryMethod: "self_collect",
			pickupLocationId: firstId,
		});
		await asUser.mutation(api.pickupLocations.setActive, {
			pickupLocationId: secondId,
			isActive: false,
		});
		await expect(
			t.mutation(api.orders.updatePickupLocation, {
				shortId,
				pickupLocationId: secondId,
			}),
		).rejects.toThrow(/no longer available/);
	});

	test("updatePickupLocation refuses non-pending order", async () => {
		const t = setup();
		const { retailer, pickupLocationId: firstId } =
			await seedRetailerWithPickup(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asUser = t.withIdentity({ subject: USER_A });
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryMethod: "self_collect",
			pickupLocationId: firstId,
		});
		const order = await t.query(api.orders.get, { shortId });
		await asUser.mutation(api.orders.updateStatus, {
			orderId: order!._id,
			status: "confirmed",
		});
		await expect(
			t.mutation(api.orders.updatePickupLocation, {
				shortId,
				pickupLocationId: firstId,
			}),
		).rejects.toThrow(/while the order is pending/);
	});

	test("updatePickupLocation refuses delivery order", async () => {
		const t = setup();
		const { retailer, pickupLocationId } = await seedRetailerWithPickup(
			t,
			USER_A,
		);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		await expect(
			t.mutation(api.orders.updatePickupLocation, {
				shortId,
				pickupLocationId,
			}),
		).rejects.toThrow(/Delivery orders/);
	});
});
