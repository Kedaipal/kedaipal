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

/**
 * Seed a single-variant product. Returns the productId (order tests pass it as
 * the item key — orders.create resolves the sole variant). Defaults to
 * blockWhenOutOfStock so the stock-decrement/rejection tests exercise the hard
 * stock path; made-to-order products never decrement.
 */
async function seedProduct(
	t: ReturnType<typeof convexTest>,
	userId: string,
	retailerId: Id<"retailers">,
	overrides: Partial<{
		name: string;
		price: number;
		currency: string;
		stock: number;
		blockWhenOutOfStock: boolean;
		requiresProof: boolean;
	}> = {},
): Promise<Id<"products">> {
	const asUser = t.withIdentity({ subject: userId });
	return asUser.mutation(api.products.create, {
		retailerId,
		name: overrides.name ?? "Tent 2P",
		currency: overrides.currency ?? "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: overrides.blockWhenOutOfStock ?? true,
		requiresProof: overrides.requiresProof ?? false,
		variants: [
			{
				optionValues: [],
				price: overrides.price ?? 12000,
				onHand: overrides.stock ?? 100,
			},
		],
	});
}

/** Read on-hand stock from a single-variant product's default variant. */
async function getProductStock(
	t: ReturnType<typeof setup>,
	productId: Id<"products">,
): Promise<number> {
	return t.run(async (ctx) => {
		const vr = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.first();
		if (!vr) throw new Error("variant missing");
		return vr.onHand;
	});
}

/** Resolve a single-variant product's default variant id (for direct edits). */
async function defaultVariantId(
	t: ReturnType<typeof setup>,
	productId: Id<"products">,
): Promise<Id<"productVariants">> {
	return t.run(async (ctx) => {
		const vr = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.first();
		if (!vr) throw new Error("variant missing");
		return vr._id;
	});
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
		// Mutate the variant price after order creation — snapshot must hold.
		const asA = t.withIdentity({ subject: USER_A });
		const variantId = await defaultVariantId(t, productId);
		await asA.mutation(api.products.updateVariant, { variantId, price: 99999 });
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

	test("made-to-order product sells at zero stock and does not decrement", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			stock: 0,
			blockWhenOutOfStock: false,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 3 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		expect(shortId).toBeTruthy();
		// onHand untouched — made-to-order products don't track depletion.
		expect(await getProductStock(t, productId)).toBe(0);
	});

	test("order by explicit variantId snapshots the variant label", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const productId = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Salmon",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			blockWhenOutOfStock: true,
			options: [{ name: "Weight", values: ["500g", "1kg"] }],
			variants: [
				{ optionValues: ["500g"], price: 4500, onHand: 5 },
				{ optionValues: ["1kg"], price: 8500, onHand: 5 },
			],
		});
		const oneKg = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", productId))
				.collect();
			return rows.find((r) => r.optionValues[0] === "1kg")!;
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId: oneKg._id, quantity: 2 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		expect(order?.items[0].variantLabel).toBe("1kg");
		expect(order?.items[0].price).toBe(8500);
		expect(order?.total).toBe(17000);
		// Decremented the 1kg variant only.
		const after = await t.run(async (ctx) => ctx.db.get(oneKg._id));
		expect(after?.onHand).toBe(3);
	});

	test("ordering a multi-variant product by bare productId is rejected", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const productId = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tee",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [{ name: "Size", values: ["S", "M"] }],
			variants: [
				{ optionValues: ["S"], price: 5000, onHand: 5 },
				{ optionValues: ["M"], price: 5000, onHand: 5 },
			],
		});
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/multiple variants/);
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

	test("cancelling a made-to-order order does not change stock (never decremented)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			stock: 0,
			blockWhenOutOfStock: false,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 4 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		expect(await getProductStock(t, productId)).toBe(0); // not decremented
		const order = await t.query(api.orders.get, { shortId });
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.orders.updateStatus, {
			orderId: order!._id,
			status: "cancelled",
		});
		// Made-to-order variants are never restocked (they were never decremented).
		expect(await getProductStock(t, productId)).toBe(0);
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

describe("orders — mockup approval", () => {
	async function gatedOrder(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			requiresProof: true,
			blockWhenOutOfStock: false,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		return { retailer, shortId, order: order! };
	}

	const asA = (t: ReturnType<typeof setup>) =>
		t.withIdentity({ subject: USER_A });

	test("an order with a requiresProof item starts at mockupStatus pending", async () => {
		const t = setup();
		const { order } = await gatedOrder(t);
		expect(order.mockupStatus).toBe("pending");
	});

	test("an order with no requiresProof item is not gated", async () => {
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
		expect(order?.mockupStatus).toBeUndefined();
	});

	test("the gate blocks → packed until approved, then allows it", async () => {
		const t = setup();
		const { shortId, order } = await gatedOrder(t);
		await asA(t).mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "confirmed",
		});
		// Gated: can't pack yet.
		await expect(
			asA(t).mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "packed",
			}),
		).rejects.toThrow(/mockup approval/i);

		// Seller submits, buyer approves.
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "mock-1",
		});
		await t.mutation(api.orders.approveMockup, { shortId });
		const approved = await t.query(api.orders.get, { shortId });
		expect(approved?.mockupStatus).toBe("approved");

		// Now packing succeeds.
		await asA(t).mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "packed",
		});
		expect((await t.query(api.orders.get, { shortId }))?.status).toBe("packed");
	});

	test("submit → request changes → resubmit loops back to submitted", async () => {
		const t = setup();
		const { shortId, order } = await gatedOrder(t);
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "mock-1",
		});
		await t.mutation(api.orders.requestMockupChanges, {
			shortId,
			note: "make it bigger",
		});
		let o = await t.query(api.orders.get, { shortId });
		expect(o?.mockupStatus).toBe("changes_requested");
		expect(o?.mockupChangeNote).toBe("make it bigger");

		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "mock-2",
		});
		o = await t.query(api.orders.get, { shortId });
		expect(o?.mockupStatus).toBe("submitted");
		expect(o?.mockupChangeNote).toBeUndefined(); // cleared on resubmit
	});

	test("approveMockup rejects when nothing is awaiting approval", async () => {
		const t = setup();
		const { shortId } = await gatedOrder(t); // still 'pending', no mockup sent
		await expect(
			t.mutation(api.orders.approveMockup, { shortId }),
		).rejects.toThrow(/awaiting your approval/i);
	});

	test("waive is blocked before the grace window, allowed after", async () => {
		const t = setup();
		const { shortId, order } = await gatedOrder(t);
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "mock-1",
		});
		// Too soon.
		await expect(
			asA(t).mutation(api.orders.waiveMockup, { orderId: order._id }),
		).rejects.toThrow(/after the buyer has had time/i);

		// Backdate the submission past the grace window.
		await t.run(async (ctx) => {
			await ctx.db.patch(order._id, {
				mockupSubmittedAt: Date.now() - 49 * 60 * 60 * 1000,
			});
		});
		await asA(t).mutation(api.orders.waiveMockup, { orderId: order._id });
		const waived = await t.query(api.orders.get, { shortId });
		expect(waived?.mockupWaivedAt).toBeTypeOf("number");

		// Waiver opens the gate.
		await asA(t).mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "confirmed",
		});
		await asA(t).mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "packed",
		});
		expect((await t.query(api.orders.get, { shortId }))?.status).toBe("packed");
	});

	test("a gated order can still be cancelled (the gate only blocks production)", async () => {
		const t = setup();
		const { order } = await gatedOrder(t);
		await asA(t).mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "cancelled",
		});
		// No throw — cancellation isn't gated.
	});

	test("mockup mutations reject a non-owner / unauthenticated caller", async () => {
		const t = setup();
		const { order } = await gatedOrder(t);
		await expect(
			t.mutation(api.orders.submitMockup, {
				orderId: order._id,
				storageId: "x",
			}),
		).rejects.toThrow(/Not authenticated/);
		const asB = t.withIdentity({ subject: USER_B });
		await expect(
			asB.mutation(api.orders.waiveMockup, { orderId: order._id }),
		).rejects.toThrow(/Forbidden/);
	});
});

describe("orders — per-variant flags", () => {
	// The art-on-print case: fixed sizes are normal stock items (hard-block,
	// no proof); the "Custom" variant is made-to-order (never blocks) and needs
	// buyer mockup approval. Both flags are set per-row, not on the product.
	async function seedArtPrint(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Art print",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			options: [{ name: "Size", values: ["10x10", "Custom"] }],
			variants: [
				{
					optionValues: ["10x10"],
					price: 5000,
					onHand: 3,
					blockWhenOutOfStock: true,
					requiresProof: false,
				},
				{
					optionValues: ["Custom"],
					price: 0,
					onHand: 0,
					blockWhenOutOfStock: false,
					requiresProof: true,
				},
			],
		});
		const variants = await t.run(async (ctx) =>
			ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", productId))
				.collect(),
		);
		const fixed = variants.find((v) => v.optionValues[0] === "10x10")!;
		const custom = variants.find((v) => v.optionValues[0] === "Custom")!;
		return { retailer, productId, fixed, custom };
	}

	test("ordering only a fixed-size variant does NOT gate the order", async () => {
		const t = setup();
		const { retailer, fixed } = await seedArtPrint(t);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId: fixed._id, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		expect(order?.mockupStatus).toBeUndefined();
		// Hard-block variant was decremented.
		expect((await t.run(async (ctx) => ctx.db.get(fixed._id)))?.onHand).toBe(2);
	});

	test("ordering the Custom variant gates the order on mockup approval", async () => {
		const t = setup();
		const { retailer, custom } = await seedArtPrint(t);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId: custom._id, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { shortId });
		expect(order?.mockupStatus).toBe("pending");
	});

	test("the Custom (made-to-order) variant sells at zero stock and never decrements", async () => {
		const t = setup();
		const { retailer, custom } = await seedArtPrint(t);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId: custom._id, quantity: 7 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		expect(shortId).toMatch(/^ORD-/);
		// onHand stays at 0 — made-to-order variants are never reserved.
		expect((await t.run(async (ctx) => ctx.db.get(custom._id)))?.onHand).toBe(0);
	});

	test("a fixed-size variant still rejects when it runs out of stock", async () => {
		const t = setup();
		const { retailer, fixed } = await seedArtPrint(t);
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ variantId: fixed._id, quantity: 99 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
			}),
		).rejects.toThrow(/in stock/);
	});

	test("cancelling restores stock only for the hard-block variant in a mixed order", async () => {
		const t = setup();
		const { retailer, fixed, custom } = await seedArtPrint(t);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [
				{ variantId: fixed._id, quantity: 2 },
				{ variantId: custom._id, quantity: 1 },
			],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		// Fixed decremented 3 → 1; custom untouched at 0.
		expect((await t.run(async (ctx) => ctx.db.get(fixed._id)))?.onHand).toBe(1);
		const order = await t.query(api.orders.get, { shortId });
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orders.updateStatus, {
				orderId: order!._id,
				status: "cancelled",
			});
		// Fixed restored to 3; custom still 0 (was never decremented).
		expect((await t.run(async (ctx) => ctx.db.get(fixed._id)))?.onHand).toBe(3);
		expect((await t.run(async (ctx) => ctx.db.get(custom._id)))?.onHand).toBe(0);
	});

	test("storefront inStock is true for a mixed product even when fixed sizes sell out", async () => {
		const t = setup();
		const { productId, fixed } = await seedArtPrint(t);
		// Drain the fixed size to zero.
		await t.run(async (ctx) => ctx.db.patch(fixed._id, { onHand: 0 }));
		const product = await t.query(api.products.get, { productId });
		// The made-to-order Custom variant keeps the product sellable.
		expect(product?.inStock).toBe(true);
	});
});
