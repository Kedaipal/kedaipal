/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { todayMytMidnight } from "./lib/fulfilmentDate";
import schema from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

/**
 * Resolve an order's high-entropy tracking token (the buyer capability) from its
 * human shortId, for buyer-facing endpoint calls. Returns a guaranteed-
 * non-matching sentinel when no order exists, so negative-path tests (unknown
 * order) still exercise the "not found" branch.
 */
async function tk(
	t: ReturnType<typeof setup>,
	shortId: string,
): Promise<string> {
	return await t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) return "__no_such_order__";
		if (o.trackingToken) return o.trackingToken;
		// Order hand-inserted by a test without a token — backfill a deterministic
		// one so the buyer-capability path is exercisable.
		const token = `tok_${shortId}`;
		await ctx.db.patch(o._id, { trackingToken: token });
		return token;
	});
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

	test("custom-line order is labelled with customLabel and gates on mockup", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const productId = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Cake",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [
				{ optionValues: [], price: 2000, onHand: 5 },
				{ optionValues: [], price: 0, onHand: 0, isCustom: true, customLabel: "Bespoke" },
			],
		});
		const customVariantId = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", productId))
				.collect();
			const c = rows.find((r) => r.isCustom);
			if (!c) throw new Error("no custom variant");
			return c._id;
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId: customVariantId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.run(async (ctx) =>
			ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first(),
		);
		// Labelled by its custom name (not an unlabelled row), and the custom line's
		// requiresProof puts the whole order into the mockup-approval gate.
		expect(order?.items[0]?.variantLabel).toBe("Bespoke");
		expect(order?.mockupStatus).toBe("pending");
	});

	test("getPaymentMethods returns the methods array; null when none", async () => {
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

		// Nothing configured → null (track page hides the section).
		expect(await t.query(api.orders.getPaymentMethods, { token: await tk(t, shortId) })).toBeNull();

		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				paymentMethods: [
					{
						type: "bank",
						label: "Maybank",
						bankName: "Maybank",
						bankAccountNumber: "5123-4567",
						sortOrder: 0,
					},
					{
						type: "bank",
						label: "CIMB",
						bankName: "CIMB",
						bankAccountNumber: "8001-2233",
						sortOrder: 1,
					},
				],
			});
		});
		const methods = await t.query(api.orders.getPaymentMethods, { token: await tk(t, shortId) });
		expect(methods).toHaveLength(2);
		expect(methods?.[0].label).toBe("Maybank");
		expect(methods?.[1].bankAccountNumber).toBe("8001-2233");

		// Legacy single object is still read (synthesized into one method).
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, {
				paymentMethods: undefined,
				paymentInstructions: {
					bankName: "Hong Leong",
					bankAccountNumber: "  9000-1111  ",
				},
			});
		});
		const legacy = await t.query(api.orders.getPaymentMethods, { token: await tk(t, shortId) });
		expect(legacy).toHaveLength(1);
		expect(legacy?.[0].label).toBe("Hong Leong");
		expect(legacy?.[0].bankAccountNumber).toBe("9000-1111"); // trimmed

		// Unknown order → null.
		expect(
			await t.query(api.orders.getPaymentMethods, { token: await tk(t, "ORD-ZZZZ") }),
		).toBeNull();
	});
	
	test("persists a trimmed customerNote; whitespace-only → undefined", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);

		const withNote = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
			customerNote: "  no onions, deliver after 5pm  ",
		});
		expect(
			(await t.query(api.orders.get, { token: await tk(t, withNote.shortId) }))
				?.customerNote,
		).toBe("no onions, deliver after 5pm");

		const blankNote = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
			customerNote: "   \n  ",
		});
		expect(
			(await t.query(api.orders.get, { token: await tk(t, blankNote.shortId) }))
				?.customerNote,
		).toBeUndefined();

		// Omitted entirely → undefined (legacy-safe).
		const noNote = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		
		expect(
			(await t.query(api.orders.get, { token: await tk(t, noNote.shortId) }))?.customerNote,
		).toBeUndefined();
	});

	test("rejects a customerNote over the length cap", async () => {
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
				deliveryAddress: validAddress,
				customerNote: "x".repeat(501),
			}),
		).rejects.toThrow(/500 characters or fewer/i);
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.orders.updateStatus, {
			orderId: order!._id,
			status: "confirmed",
		});

		const updated = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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

		const o1 = await t.query(api.orders.get, { token: await tk(t, r1.shortId) });
		const o2 = await t.query(api.orders.get, { token: await tk(t, r2.shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
			token: await tk(t, shortId),
			deliveryAddress: newAddress,
		});
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.orders.updateStatus, {
			orderId: order!._id,
			status: "confirmed",
		});
		await expect(
			t.mutation(api.orders.updateDeliveryAddress, {
				token: await tk(t, shortId),
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
				token: await tk(t, shortId),
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		await t.mutation(api.orders.updateDeliveryAddress, {
			token: await tk(t, shortId),
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
				token: await tk(t, shortId),
				reference: "TXN-12345",
			});

			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
			await t.mutation(api.orders.claimPayment, { token: await tk(t, shortId) });
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
				token: await tk(t, shortId),
				reference: "first",
			});
			await t.mutation(api.orders.claimPayment, {
				token: await tk(t, shortId),
				reference: "second",
			});
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
			expect(order?.paymentStatus).toBe("claimed");
			expect(order?.paymentReference).toBe("second");
		});

		test("claimPayment rejects unknown shortId", async () => {
			const t = setup();
			await expect(
				t.mutation(api.orders.claimPayment, { token: await tk(t, "ORD-NOPE") }),
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
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
			await t.run(async (ctx) => {
				await ctx.db.patch(order!._id, { paymentStatus: "received" });
			});
			await expect(
				t.mutation(api.orders.claimPayment, { token: await tk(t, shortId) }),
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
					token: await tk(t, shortId),
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
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
			const asA = t.withIdentity({ subject: USER_A });
			await asA.mutation(api.orders.markPaymentReceived, {
				orderId: order!._id,
			});
			const updated = await t.query(api.orders.get, { token: await tk(t, shortId) });
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

		test("markPaymentReceived records an optional payment method", async () => {
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
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
			const asA = t.withIdentity({ subject: USER_A });
			await asA.mutation(api.orders.markPaymentReceived, {
				orderId: order!._id,
				paymentMethod: "duitnow",
			});
			const updated = await t.query(api.orders.get, {
				token: await tk(t, shortId),
			});
			expect(updated?.paymentMethod).toBe("duitnow");
		});

		test("markPaymentReceived leaves method undefined when not provided", async () => {
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
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
			await t.withIdentity({ subject: USER_A }).mutation(
				api.orders.markPaymentReceived,
				{ orderId: order!._id },
			);
			const updated = await t.query(api.orders.get, {
				token: await tk(t, shortId),
			});
			expect(updated?.paymentMethod).toBeUndefined();
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
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
			const updated = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
			const asA = t.withIdentity({ subject: USER_A });
			await asA.mutation(api.orders.markPaymentReceived, {
				orderId: order!._id,
			});
			const firstReceivedAt = (await t.query(api.orders.get, { token: await tk(t, shortId) }))
				?.paymentReceivedAt;
			await asA.mutation(api.orders.markPaymentReceived, {
				orderId: order!._id,
			});
			const secondReceivedAt = (await t.query(api.orders.get, { token: await tk(t, shortId) }))
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
				token: await tk(t, shortId),
			});
			expect(url).toMatch(/^https?:\/\//);
		});

		test("generateOrderProofUploadUrl rejects unknown shortId", async () => {
			const t = setup();
			await expect(
				t.mutation(api.orders.generateOrderProofUploadUrl, {
					token: "__no_such_order__",
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
			const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
			await t.run(async (ctx) => {
				await ctx.db.patch(order!._id, { paymentStatus: "received" });
			});
			await expect(
				t.mutation(api.orders.generateOrderProofUploadUrl, { token: await tk(t, shortId) }),
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(order?.pickupLocationId).toBe(pickupLocationId);
		expect(order?.pickupSnapshot).toEqual({
			label: "Main",
			address: "12 Jln Tun Razak, 50400 KL",
			locationType: "self_collect",
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
		const reread = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
			token: await tk(t, shortId),
			pickupLocationId: secondId,
		});

		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
				token: await tk(t, shortId),
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		await asUser.mutation(api.orders.updateStatus, {
			orderId: order!._id,
			status: "confirmed",
		});
		await expect(
			t.mutation(api.orders.updatePickupLocation, {
				token: await tk(t, shortId),
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
				token: await tk(t, shortId),
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		return { retailer, shortId, order: order! };
	}

	const asA = (t: ReturnType<typeof setup>) =>
		t.withIdentity({ subject: USER_A });

	test("an order with a requiresProof item starts at mockupStatus pending", async () => {
		const t = setup();
		const { order } = await gatedOrder(t);
		expect(order.mockupStatus).toBe("pending");
	});

	test("submitMockup stores multiple images + keeps the singular in sync", async () => {
		const t = setup();
		const { order } = await gatedOrder(t);
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageIds: ["m1", "m2", "m3"],
		});
		const fresh = await t.run((ctx) => ctx.db.get(order._id));
		expect(fresh?.mockupImageStorageIds).toEqual(["m1", "m2", "m3"]);
		// Singular stays as [0] for legacy readers (WhatsApp send + quote guard).
		expect(fresh?.mockupImageStorageId).toBe("m1");
		expect(fresh?.mockupStatus).toBe("submitted");
	});

	test("submitMockup accepts a single storageId (back-compat) → array of one", async () => {
		const t = setup();
		const { order } = await gatedOrder(t);
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "solo",
		});
		const fresh = await t.run((ctx) => ctx.db.get(order._id));
		expect(fresh?.mockupImageStorageIds).toEqual(["solo"]);
		expect(fresh?.mockupImageStorageId).toBe("solo");
	});

	test("submitMockup rejects more than 5 images, and an empty set", async () => {
		const t = setup();
		const { order } = await gatedOrder(t);
		await expect(
			asA(t).mutation(api.orders.submitMockup, {
				orderId: order._id,
				storageIds: ["a", "b", "c", "d", "e", "f"],
			}),
		).rejects.toThrow(/at most 5 mockup images/i);
		await expect(
			asA(t).mutation(api.orders.submitMockup, {
				orderId: order._id,
				storageIds: [],
			}),
		).rejects.toThrow(/missing mockup image/i);
	});

	test("discardMockupUploads deletes orphaned blobs but protects a live mockup", async () => {
		const t = setup();
		const { order } = await gatedOrder(t);
		// One blob we'll attach (referenced), one left orphaned by a failed upload.
		const liveId = await t.run((ctx) =>
			ctx.storage.store(new Blob(["live"], { type: "image/png" })),
		);
		const orphanId = await t.run((ctx) =>
			ctx.storage.store(new Blob(["orphan"], { type: "image/png" })),
		);
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageIds: [liveId],
		});

		await asA(t).mutation(api.orders.discardMockupUploads, {
			orderId: order._id,
			storageIds: [liveId, orphanId],
		});

		const liveUrl = await t.run((ctx) => ctx.storage.getUrl(liveId));
		const orphanUrl = await t.run((ctx) => ctx.storage.getUrl(orphanId));
		expect(liveUrl).not.toBeNull(); // referenced by the order → protected
		expect(orphanUrl).toBeNull(); // unreferenced → deleted
	});

	test("discardMockupUploads is owner-only", async () => {
		const t = setup();
		const { order } = await gatedOrder(t);
		await expect(
			t
				.withIdentity({ subject: "someone-else" })
				.mutation(api.orders.discardMockupUploads, {
					orderId: order._id,
					storageIds: ["x"],
				}),
		).rejects.toThrow(/forbidden/i);
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		await t.mutation(api.orders.approveMockup, { token: await tk(t, shortId) });
		const approved = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(approved?.mockupStatus).toBe("approved");

		// Now packing succeeds.
		await asA(t).mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "packed",
		});
		expect((await t.query(api.orders.get, { token: await tk(t, shortId) }))?.status).toBe("packed");
	});

	test("the gate blocks seller markPaymentReceived until approved", async () => {
		const t = setup();
		const { shortId, order } = await gatedOrder(t);

		// Gated (mockupStatus pending): seller can't mark payment received.
		await expect(
			asA(t).mutation(api.orders.markPaymentReceived, { orderId: order._id }),
		).rejects.toThrow(/Approve or remove the custom item/i);

		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "mock-1",
		});
		await t.mutation(api.orders.approveMockup, { token: await tk(t, shortId) });

		// Gate open → marking payment received now succeeds.
		await asA(t).mutation(api.orders.markPaymentReceived, {
			orderId: order._id,
		});
		expect((await t.query(api.orders.get, { token: await tk(t, shortId) }))?.paymentStatus).toBe(
			"received",
		);
	});

	test("the gate blocks buyer claimPayment until approved", async () => {
		const t = setup();
		const { shortId, order } = await gatedOrder(t);

		await expect(
			t.mutation(api.orders.claimPayment, { token: await tk(t, shortId) }),
		).rejects.toThrow(/approve the mockup before paying/i);

		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "mock-1",
		});
		await t.mutation(api.orders.approveMockup, { token: await tk(t, shortId) });

		await t.mutation(api.orders.claimPayment, { token: await tk(t, shortId) });
		expect((await t.query(api.orders.get, { token: await tk(t, shortId) }))?.paymentStatus).toBe(
			"claimed",
		);
	});

	test("a waived order lets the seller mark payment received", async () => {
		const t = setup();
		const { shortId, order } = await gatedOrder(t);
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "mock-1",
		});
		// Force the grace window to have elapsed (48h grace), then waive.
		await t.run(async (ctx) => {
			await ctx.db.patch(order._id, {
				mockupSubmittedAt: Date.now() - 49 * 60 * 60 * 1000,
			});
		});
		await asA(t).mutation(api.orders.waiveMockup, { orderId: order._id });

		await asA(t).mutation(api.orders.markPaymentReceived, {
			orderId: order._id,
		});
		expect((await t.query(api.orders.get, { token: await tk(t, shortId) }))?.paymentStatus).toBe(
			"received",
		);
	});

	test("submit → request changes → resubmit loops back to submitted", async () => {
		const t = setup();
		const { shortId, order } = await gatedOrder(t);
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "mock-1",
		});
		await t.mutation(api.orders.requestMockupChanges, {
			token: await tk(t, shortId),
			note: "make it bigger",
		});
		let o = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(o?.mockupStatus).toBe("changes_requested");
		expect(o?.mockupChangeNote).toBe("make it bigger");

		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "mock-2",
		});
		o = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(o?.mockupStatus).toBe("submitted");
		expect(o?.mockupChangeNote).toBeUndefined(); // cleared on resubmit
	});

	test("approveMockup rejects when nothing is awaiting approval", async () => {
		const t = setup();
		const { shortId } = await gatedOrder(t); // still 'pending', no mockup sent
		await expect(
			t.mutation(api.orders.approveMockup, { token: await tk(t, shortId) }),
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
		const waived = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		expect((await t.query(api.orders.get, { token: await tk(t, shortId) }))?.status).toBe("packed");
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
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

describe("orders — custom quote + decline", () => {
	const asA = (t: ReturnType<typeof setup>) => t.withIdentity({ subject: USER_A });

	// A mixed art-print: one fixed-size stock item + one made-to-order "Custom"
	// (RM0 storefront price, requiresProof). Returns both variants + a seeded
	// order containing the requested lines.
	async function seedOrder(
		t: ReturnType<typeof setup>,
		opts: { fixedQty?: number; customQty?: number } = {},
	) {
		const retailer = await seedRetailer(t, USER_A);
		const productId = await asA(t).mutation(api.products.create, {
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
					onHand: 5,
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
		const items: { variantId: Id<"productVariants">; quantity: number }[] = [];
		if (opts.fixedQty) items.push({ variantId: fixed._id, quantity: opts.fixedQty });
		if (opts.customQty)
			items.push({ variantId: custom._id, quantity: opts.customQty });
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items,
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = (await t.query(api.orders.get, { token: await tk(t, shortId) }))!;
		return { retailer, productId, fixed, custom, shortId, order };
	}

	/** Read a customer's denormalized totalSpent by phone. */
	async function totalSpent(
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
	): Promise<number> {
		return t.run(async (ctx) => {
			const c = await ctx.db
				.query("customers")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			return c?.totalSpent ?? 0;
		});
	}

	test("submitMockup with a quote raises the order total", async () => {
		const t = setup();
		const { order, shortId } = await seedOrder(t, { fixedQty: 1, customQty: 1 });
		expect(order.total).toBe(5000); // custom line is RM0 at checkout
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "mock-1",
			quotedAmount: 12000,
		});
		const after = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(after?.mockupQuotedAmount).toBe(12000);
		expect(after?.subtotal).toBe(5000);
		expect(after?.total).toBe(17000);
	});

	test("re-pricing across rounds: latest quote wins in the total", async () => {
		const t = setup();
		const { order, shortId } = await seedOrder(t, { fixedQty: 1, customQty: 1 });
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "m1",
			quotedAmount: 12000,
		});
		await t.mutation(api.orders.requestMockupChanges, { token: await tk(t, shortId), note: "bigger" });
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "m2",
			quotedAmount: 15000,
		});
		const after = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(after?.mockupQuotedAmount).toBe(15000);
		expect(after?.total).toBe(20000);
	});

	test("updateMockupQuote re-prices without re-pinging or resetting the waiver clock", async () => {
		const t = setup();
		const { order, shortId } = await seedOrder(t, { fixedQty: 1, customQty: 1 });
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "m1",
			quotedAmount: 12000,
		});
		const submitted = await t.query(api.orders.get, { token: await tk(t, shortId) });
		const submittedAt = submitted?.mockupSubmittedAt;
		expect(submittedAt).toBeDefined();

		// Count the WA mockup-submit jobs already scheduled (one from submitMockup).
		const jobsBefore = await t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect(),
		);
		const pingsBefore = jobsBefore.filter((j) =>
			j.name.includes("notifyMockupSubmitted"),
		).length;

		await asA(t).mutation(api.orders.updateMockupQuote, {
			orderId: order._id,
			quotedAmount: 18000,
		});

		const after = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(after?.mockupQuotedAmount).toBe(18000);
		expect(after?.total).toBe(23000); // 5000 fixed + 18000 quote
		// Status + waiver clock untouched — the buyer sees the price live.
		expect(after?.mockupStatus).toBe("submitted");
		expect(after?.mockupSubmittedAt).toBe(submittedAt);
		// No new "review your mockup" WhatsApp ping scheduled.
		const jobsAfter = await t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect(),
		);
		const pingsAfter = jobsAfter.filter((j) =>
			j.name.includes("notifyMockupSubmitted"),
		).length;
		expect(pingsAfter).toBe(pingsBefore);
	});

	test("updateMockupQuote keeps the customer's totalSpent in step", async () => {
		const t = setup();
		const { retailer, order } = await seedOrder(t, { fixedQty: 1, customQty: 1 });
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "m1",
			quotedAmount: 12000,
		});
		expect(await totalSpent(t, retailer._id)).toBe(17000);
		await asA(t).mutation(api.orders.updateMockupQuote, {
			orderId: order._id,
			quotedAmount: 9000,
		});
		expect(await totalSpent(t, retailer._id)).toBe(14000);
	});

	test("updateMockupQuote rejects before a mockup is sent and after approval", async () => {
		const t = setup();
		const { order, shortId } = await seedOrder(t, { fixedQty: 1, customQty: 1 });
		// No mockup image yet → rejected.
		await expect(
			asA(t).mutation(api.orders.updateMockupQuote, {
				orderId: order._id,
				quotedAmount: 9000,
			}),
		).rejects.toThrow(/Send the mockup before pricing/i);

		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "m1",
			quotedAmount: 12000,
		});
		await t.mutation(api.orders.approveMockup, { token: await tk(t, shortId) });
		// Approved → locked, can't re-price.
		await expect(
			asA(t).mutation(api.orders.updateMockupQuote, {
				orderId: order._id,
				quotedAmount: 9000,
			}),
		).rejects.toThrow(/already approved/i);
	});

	test("approve locks the quoted total", async () => {
		const t = setup();
		const { order, shortId } = await seedOrder(t, { fixedQty: 1, customQty: 1 });
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "m1",
			quotedAmount: 12000,
		});
		await t.mutation(api.orders.approveMockup, { token: await tk(t, shortId) });
		const after = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(after?.mockupStatus).toBe("approved");
		expect(after?.total).toBe(17000);
	});

	test("the quote keeps the customer's totalSpent in step", async () => {
		const t = setup();
		const { retailer, order } = await seedOrder(t, { fixedQty: 1, customQty: 1 });
		expect(await totalSpent(t, retailer._id)).toBe(5000);
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "m1",
			quotedAmount: 12000,
		});
		expect(await totalSpent(t, retailer._id)).toBe(17000);
	});

	test("decline on a mixed order drops the custom line, recomputes, opens the gate", async () => {
		const t = setup();
		const { retailer, order, shortId, fixed } = await seedOrder(t, {
			fixedQty: 2,
			customQty: 1,
		});
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "m1",
			quotedAmount: 12000,
		});
		// total = 2*5000 + 12000 = 22000; totalSpent tracks it.
		expect(await totalSpent(t, retailer._id)).toBe(22000);

		await t.mutation(api.orders.declineMockupItem, { token: await tk(t, shortId) });
		const after = await t.query(api.orders.get, { token: await tk(t, shortId) });
		// Custom line gone, quote cleared, total back to the fixed items.
		expect(after?.items).toHaveLength(1);
		expect(after?.items[0].variantId).toBe(fixed._id);
		expect(after?.total).toBe(10000);
		expect(after?.mockupQuotedAmount).toBeUndefined();
		expect(after?.mockupStatus).toBeUndefined();
		expect(after?.status).not.toBe("cancelled");
		expect(await totalSpent(t, retailer._id)).toBe(10000);

		// The buyer is nudged to pay for the remaining ready-made items over
		// WhatsApp (the gate just opened on a still-unpaid order).
		const jobs = await t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect(),
		);
		expect(
			jobs.some(
				(j) =>
					j.name.includes("notifyPaymentDue") &&
					(j.args as Array<{ reason?: string }>)[0]?.reason === "declined",
			),
		).toBe(true);

		// Gate is open — the order can now be packed.
		await asA(t).mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "confirmed",
		});
		await asA(t).mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "packed",
		});
		expect((await t.query(api.orders.get, { token: await tk(t, shortId) }))?.status).toBe("packed");
	});

	test("decline on a custom-only order cancels it", async () => {
		const t = setup();
		const { retailer, order, shortId } = await seedOrder(t, { customQty: 1 });
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "m1",
			quotedAmount: 12000,
		});
		await t.mutation(api.orders.declineMockupItem, { token: await tk(t, shortId) });
		const after = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(after?.status).toBe("cancelled");
		expect(after?.mockupStatus).toBeUndefined();
		// Aggregates fully reversed for the cancelled order.
		expect(await totalSpent(t, retailer._id)).toBe(0);

		// Nothing left to pay for → no payment nudge (unlike the mixed-order case).
		const jobs = await t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect(),
		);
		expect(jobs.some((j) => j.name.includes("notifyPaymentDue"))).toBe(false);
	});

	test("decline is rejected once the mockup is approved", async () => {
		const t = setup();
		const { order, shortId } = await seedOrder(t, { fixedQty: 1, customQty: 1 });
		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "m1",
			quotedAmount: 12000,
		});
		await t.mutation(api.orders.approveMockup, { token: await tk(t, shortId) });
		await expect(
			t.mutation(api.orders.declineMockupItem, { token: await tk(t, shortId) }),
		).rejects.toThrow(/already been approved/i);
	});

	test("submitMockup rejects a negative or oversized quote", async () => {
		const t = setup();
		const { order } = await seedOrder(t, { fixedQty: 1, customQty: 1 });
		await expect(
			asA(t).mutation(api.orders.submitMockup, {
				orderId: order._id,
				storageId: "m1",
				quotedAmount: -100,
			}),
		).rejects.toThrow(/non-negative/i);
		await expect(
			asA(t).mutation(api.orders.submitMockup, {
				orderId: order._id,
				storageId: "m1",
				quotedAmount: 100_000_001,
			}),
		).rejects.toThrow(/unrealistically large/i);
	});
});

describe("orders — mockup-pending filter", () => {
	const asA = (t: ReturnType<typeof setup>) =>
		t.withIdentity({ subject: USER_A });

	// Create one requiresProof order and drive it to a target mockup state.
	// Returns { orderId, shortId }.
	async function gatedOrder(
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
		productId: Id<"products">,
		target: "pending" | "submitted" | "changes_requested" | "approved",
	) {
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		if (!order) throw new Error("order not created");
		if (target !== "pending") {
			await asA(t).mutation(api.orders.submitMockup, {
				orderId: order._id,
				storageId: "mock-1",
			});
		}
		if (target === "changes_requested") {
			await t.mutation(api.orders.requestMockupChanges, { token: await tk(t, shortId) });
		}
		if (target === "approved") {
			await t.mutation(api.orders.approveMockup, { token: await tk(t, shortId) });
		}
		return { orderId: order._id, shortId };
	}

	// Seed every mockup state (+ a non-gated order) and return the actionable set.
	async function seedAllStates(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const proofProduct = await seedProduct(t, USER_A, retailer._id, {
			requiresProof: true,
			blockWhenOutOfStock: false,
		});
		const plainProduct = await seedProduct(t, USER_A, retailer._id, {
			name: "Plain",
		});

		const pending = await gatedOrder(t, retailer._id, proofProduct, "pending");
		const changes = await gatedOrder(
			t,
			retailer._id,
			proofProduct,
			"changes_requested",
		);
		await gatedOrder(t, retailer._id, proofProduct, "submitted");
		await gatedOrder(t, retailer._id, proofProduct, "approved");
		// Non-gated order (mockupStatus undefined) — must never appear.
		await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId: plainProduct, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});

		return { retailer, actionable: new Set([pending.shortId, changes.shortId]) };
	}

	test("listByRetailer mockupPending returns only pending + changes_requested", async () => {
		const t = setup();
		const { retailer, actionable } = await seedAllStates(t);

		const page = await asA(t).query(api.orders.listByRetailer, {
			retailerId: retailer._id,
			mockupPending: true,
			paginationOpts: { numItems: 50, cursor: null },
		});

		expect(page.page).toHaveLength(2);
		expect(new Set(page.page.map((o) => o.shortId))).toEqual(actionable);
		for (const o of page.page) {
			expect(["pending", "changes_requested"]).toContain(o.mockupStatus);
		}
	});

	test("mockupPending ignores the status arg when both are passed", async () => {
		const t = setup();
		const { retailer, actionable } = await seedAllStates(t);
		// status would otherwise restrict to pending fulfilment; mockupPending wins.
		const page = await asA(t).query(api.orders.listByRetailer, {
			retailerId: retailer._id,
			status: "delivered",
			mockupPending: true,
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(new Set(page.page.map((o) => o.shortId))).toEqual(actionable);
	});

	test("countActionable reports the mockup-pending count", async () => {
		const t = setup();
		const { retailer } = await seedAllStates(t);
		const counts = await asA(t).query(api.orders.countActionable, {
			retailerId: retailer._id,
		});
		expect(counts.mockupPending).toBe(2);
	});

	test("no mockup-pending orders → empty page + zero count", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});

		const page = await asA(t).query(api.orders.listByRetailer, {
			retailerId: retailer._id,
			mockupPending: true,
			paginationOpts: { numItems: 50, cursor: null },
		});
		expect(page.page).toHaveLength(0);

		const counts = await asA(t).query(api.orders.countActionable, {
			retailerId: retailer._id,
		});
		expect(counts.mockupPending).toBe(0);
	});
});

describe("orders — Phase 2 stage advance (advanceToStage)", () => {
	const asA = (t: ReturnType<typeof setup>) =>
		t.withIdentity({ subject: USER_A });

	async function plainOrder(t: ReturnType<typeof setup>) {
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		if (!order) throw new Error("no order");
		return { retailer, order, shortId };
	}

	async function events(t: ReturnType<typeof setup>, orderId: Id<"orders">) {
		return t.run((ctx) =>
			ctx.db
				.query("orderEvents")
				.withIndex("by_order", (q) => q.eq("orderId", orderId))
				.collect(),
		);
	}

	test("default-synthesis: advancing default:<anchor> derives canonical status + records the stage", async () => {
		const t = setup();
		const { order, shortId } = await plainOrder(t);

		await asA(t).mutation(api.orders.advanceToStage, {
			orderId: order._id,
			stageId: "default:confirmed",
		});
		let o = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(o?.status).toBe("confirmed");
		expect(o?.currentStageId).toBe("default:confirmed");

		await asA(t).mutation(api.orders.advanceToStage, {
			orderId: order._id,
			stageId: "default:packed",
		});
		o = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(o?.status).toBe("packed");
		expect(o?.currentStageId).toBe("default:packed");

		const evs = await events(t, order._id);
		const packed = evs.find((e) => e.stageId === "default:packed");
		expect(packed?.status).toBe("packed");
		expect(packed?.stageLabel).toBe("Packed"); // frozen EN snapshot
	});

	test("rejects an unknown stage id", async () => {
		const t = setup();
		const { order } = await plainOrder(t);
		await expect(
			asA(t).mutation(api.orders.advanceToStage, {
				orderId: order._id,
				stageId: "nope",
			}),
		).rejects.toThrow(/Unknown stage/i);
	});

	test("a cancelled order can't be advanced", async () => {
		const t = setup();
		const { order } = await plainOrder(t);
		await asA(t).mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "cancelled",
		});
		await expect(
			asA(t).mutation(api.orders.advanceToStage, {
				orderId: order._id,
				stageId: "default:confirmed",
			}),
		).rejects.toThrow(/cancelled/i);
	});

	test("mockup gate blocks advancing into a packed stage until approved", async () => {
		const t = setup();
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
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		if (!order) throw new Error("no order");

		await asA(t).mutation(api.orders.advanceToStage, {
			orderId: order._id,
			stageId: "default:confirmed",
		});
		// Gated: can't move into production.
		await expect(
			asA(t).mutation(api.orders.advanceToStage, {
				orderId: order._id,
				stageId: "default:packed",
			}),
		).rejects.toThrow(/mockup/i);
		// Closing the bypass: jumping straight to a shipped-anchored stage is also blocked.
		await expect(
			asA(t).mutation(api.orders.advanceToStage, {
				orderId: order._id,
				stageId: "default:shipped",
			}),
		).rejects.toThrow(/mockup/i);

		await asA(t).mutation(api.orders.submitMockup, {
			orderId: order._id,
			storageId: "m1",
		});
		await t.mutation(api.orders.approveMockup, { token: await tk(t, shortId) });

		await asA(t).mutation(api.orders.advanceToStage, {
			orderId: order._id,
			stageId: "default:packed",
		});
		expect((await t.query(api.orders.get, { token: await tk(t, shortId) }))?.status).toBe("packed");
	});

	test("configured intra-anchor stages keep canonical status but move currentStageId", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await asA(t).mutation(api.retailers.updateSettings, {
			orderStages: [
				{ anchor: "confirmed", label: { en: "Accepted" }, notify: true },
				{ anchor: "packed", label: { en: "Cleaning" }, notify: false },
				{ anchor: "packed", label: { en: "Drying" }, notify: true },
				{ anchor: "delivered", label: { en: "Collected" }, notify: true },
			],
		});
		const me = await asA(t).query(api.retailers.getMyRetailer);
		const stages = me?.orderStages ?? [];
		const cleaning = stages.find((s) => s.label.en === "Cleaning")!;
		const drying = stages.find((s) => s.label.en === "Drying")!;

		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		if (!order) throw new Error("no order");

		await asA(t).mutation(api.orders.advanceToStage, {
			orderId: order._id,
			stageId: cleaning.id,
		});
		let o = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(o?.status).toBe("packed");
		expect(o?.currentStageId).toBe(cleaning.id);

		await asA(t).mutation(api.orders.advanceToStage, {
			orderId: order._id,
			stageId: drying.id,
		});
		o = await t.query(api.orders.get, { token: await tk(t, shortId) });
		expect(o?.status).toBe("packed"); // unchanged within the anchor
		expect(o?.currentStageId).toBe(drying.id);
		expect(o?.orderStages?.length).toBe(4); // surfaced for the timeline
	});
});

describe("orders — inbox search", () => {
	async function mkOrder(
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
		productId: Id<"products">,
		who: { name?: string; waPhone?: string },
	) {
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: who,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		return order!;
	}

	test("buckets + counts + text search (id / name / phone)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, { stock: 100 });
		const asA = t.withIdentity({ subject: USER_A });

		const o1 = await mkOrder(t, retailer._id, productId, {
			name: "Alice",
			waPhone: "60123456789",
		}); // pending → new
		const o2 = await mkOrder(t, retailer._id, productId, {
			name: "Bob",
			waPhone: "60198887777",
		});
		const o3 = await mkOrder(t, retailer._id, productId, { name: "Charlie" });
		const o4 = await mkOrder(t, retailer._id, productId, { name: "Dana" });

		await asA.mutation(api.orders.updateStatus, {
			orderId: o2._id,
			status: "confirmed",
		}); // in_progress
		await asA.mutation(api.orders.updateStatus, {
			orderId: o3._id,
			status: "delivered",
		}); // completed
		await asA.mutation(api.orders.updateStatus, {
			orderId: o4._id,
			status: "cancelled",
		}); // cancelled

		const all = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
		});
		expect(all.counts).toEqual({
			new: 1,
			in_progress: 1,
			completed: 1,
			cancelled: 1,
			mockupPending: 0,
		});
		expect(all.total).toBe(4);

		const news = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "new",
		});
		expect(news.orders.map((o) => o._id)).toEqual([o1._id]);

		const inProgress = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "in_progress",
		});
		expect(inProgress.orders.map((o) => o._id)).toEqual([o2._id]);

		// Name (partial, case-insensitive).
		const byName = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			searchText: "ali",
		});
		expect(byName.orders.map((o) => o._id)).toEqual([o1._id]);

		// Phone trailing digits.
		const byPhone = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			searchText: "8887777",
		});
		expect(byPhone.orders.map((o) => o._id)).toEqual([o2._id]);

		// Order #.
		const byId = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			searchText: o1.shortId,
		});
		expect(byId.orders.map((o) => o._id)).toContain(o1._id);
	});

	test("payment filter treats undefined as unpaid", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });
		const o = await mkOrder(t, retailer._id, productId, { name: "Eve" });

		const unpaid = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			paymentStatuses: ["unpaid"],
		});
		expect(unpaid.orders.map((x) => x._id)).toContain(o._id);

		await t.run((ctx) => ctx.db.patch(o._id, { paymentStatus: "received" }));
		const stillUnpaid = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			paymentStatuses: ["unpaid"],
		});
		expect(stillUnpaid.orders.map((x) => x._id)).not.toContain(o._id);
		const received = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			paymentStatuses: ["received"],
		});
		expect(received.orders.map((x) => x._id)).toContain(o._id);
	});

	test("method filter: concrete method, unspecified, and OR of both", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });
		const tagged = await mkOrder(t, retailer._id, productId, { name: "Tag" });
		const untagged = await mkOrder(t, retailer._id, productId, { name: "Un" });
		await t.run((ctx) => ctx.db.patch(tagged._id, { paymentMethod: "duitnow" }));

		const byMethod = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			paymentMethods: ["duitnow"],
		});
		expect(byMethod.orders.map((x) => x._id)).toEqual([tagged._id]);

		const unspec = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			methodUnspecified: true,
		});
		expect(unspec.orders.map((x) => x._id)).toContain(untagged._id);
		expect(unspec.orders.map((x) => x._id)).not.toContain(tagged._id);

		const both = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			paymentMethods: ["duitnow"],
			methodUnspecified: true,
		});
		const ids = both.orders.map((x) => x._id);
		expect(ids).toContain(tagged._id);
		expect(ids).toContain(untagged._id);
	});

	test("search matches item name (e.g. 'vanilla')", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, {
			name: "Vanilla Cake",
		});
		const o = await mkOrder(t, retailer._id, productId, { name: "Zoe" });
		const byItem = await t
			.withIdentity({ subject: USER_A })
			.query(api.orders.searchOrders, {
				retailerId: retailer._id,
				bucket: "all",
				searchText: "vanilla",
			});
		expect(byItem.orders.map((x) => x._id)).toContain(o._id);
	});

	test("mockupPending filter + count isolate orders awaiting a mockup", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const plainId = await seedProduct(t, USER_A, retailer._id);
		const customId = await seedProduct(t, USER_A, retailer._id, {
			requiresProof: true,
			blockWhenOutOfStock: false,
		});
		const plain = await mkOrder(t, retailer._id, plainId, { name: "A" });
		const needs = await mkOrder(t, retailer._id, customId, { name: "B" });
		const asA = t.withIdentity({ subject: USER_A });

		const all = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
		});
		expect(all.counts.mockupPending).toBe(1);

		const filtered = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			mockupPending: true,
		});
		expect(filtered.orders.map((x) => x._id)).toEqual([needs._id]);
		expect(filtered.orders.map((x) => x._id)).not.toContain(plain._id);
	});

	test("searchOrders is owner-only", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await expect(
			t
				.withIdentity({ subject: "intruder" })
				.query(api.orders.searchOrders, {
					retailerId: retailer._id,
					bucket: "all",
				}),
		).rejects.toThrow(/forbidden/i);
	});
});

describe("orders — bulk status", () => {
	async function mk(
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
		productId: Id<"products">,
	) {
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
		});
		const order = await t.query(api.orders.get, { token: await tk(t, shortId) });
		return order!;
	}

	test("applies the status to all eligible orders and skips no-ops", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, { stock: 100 });
		const asA = t.withIdentity({ subject: USER_A });
		const o1 = await mk(t, retailer._id, productId);
		const o2 = await mk(t, retailer._id, productId);
		const o3 = await mk(t, retailer._id, productId);
		await asA.mutation(api.orders.updateStatus, {
			orderId: o3._id,
			status: "confirmed",
		}); // already confirmed → skipped

		const res = await asA.mutation(api.orders.bulkUpdateStatus, {
			orderIds: [o1._id, o2._id, o3._id],
			status: "confirmed",
		});
		expect(res).toEqual({ updated: 2, skipped: 1 });
		for (const id of [o1._id, o2._id, o3._id]) {
			expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("confirmed");
		}
	});

	test("skips mockup-gated orders when bulking to packed", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const plainId = await seedProduct(t, USER_A, retailer._id, { stock: 100 });
		const gatedId = await seedProduct(t, USER_A, retailer._id, {
			requiresProof: true,
			blockWhenOutOfStock: false,
		});
		const asA = t.withIdentity({ subject: USER_A });
		const plain = await mk(t, retailer._id, plainId);
		const gated = await mk(t, retailer._id, gatedId);
		await asA.mutation(api.orders.updateStatus, {
			orderId: plain._id,
			status: "confirmed",
		});
		await asA.mutation(api.orders.updateStatus, {
			orderId: gated._id,
			status: "confirmed",
		});

		const res = await asA.mutation(api.orders.bulkUpdateStatus, {
			orderIds: [plain._id, gated._id],
			status: "packed",
		});
		expect(res).toEqual({ updated: 1, skipped: 1 });
		expect((await t.run((ctx) => ctx.db.get(plain._id)))?.status).toBe("packed");
		// Gated order is untouched (mockup not approved).
		expect((await t.run((ctx) => ctx.db.get(gated._id)))?.status).toBe(
			"confirmed",
		);
	});

	test("bulk cancel restores stock", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, { stock: 10 });
		const asA = t.withIdentity({ subject: USER_A });
		const o = await mk(t, retailer._id, productId); // 10 → 9
		expect(await getProductStock(t, productId)).toBe(9);
		await asA.mutation(api.orders.bulkUpdateStatus, {
			orderIds: [o._id],
			status: "cancelled",
		});
		expect(await getProductStock(t, productId)).toBe(10); // restored
	});

	test("rejects the batch if any order isn't the caller's", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const retailerB = await seedRetailer(t, USER_B);
		const productB = await seedProduct(t, USER_B, retailerB._id);
		const oB = await mk(t, retailerB._id, productB);
		await expect(
			t.withIdentity({ subject: USER_A }).mutation(api.orders.bulkUpdateStatus, {
				orderIds: [oB._id],
				status: "confirmed",
			}),
		).rejects.toThrow(/forbidden/i);
	});
});

describe("orders — buyer custom image", () => {
	test("create stores customerImageStorageId for a custom-line order; getCustomerImageUrl resolves it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		// Custom-line product (requiresProof → mockup-gated, like the storefront).
		const productId = await asA.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Cake",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [
				{ optionValues: [], price: 2000, onHand: 5 },
				{ optionValues: [], price: 0, onHand: 0, isCustom: true },
			],
		});
		const customVariantId = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", productId))
				.collect();
			const c = rows.find((r) => r.isCustom);
			if (!c) throw new Error("no custom variant");
			return c._id;
		});
		const imageId = await t.run((ctx) =>
			ctx.storage.store(new Blob(["ref"], { type: "image/png" })),
		);

		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId: customVariantId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
			customerImageStorageId: imageId,
		});

		const order = await t.run((ctx) =>
			ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first(),
		);
		expect(order?.customerImageStorageId).toBe(imageId);
		const url = await t.query(api.orders.getCustomerImageUrl, { token: await tk(t, shortId) });
		expect(url).not.toBeNull();
	});

	test("create drops a stray image on a non-custom order", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id, { stock: 5 });
		const imageId = await t.run((ctx) =>
			ctx.storage.store(new Blob(["x"], { type: "image/png" })),
		);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
			customerImageStorageId: imageId,
		});
		const order = await t.run((ctx) =>
			ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first(),
		);
		// No custom/proof line → image ignored.
		expect(order?.customerImageStorageId).toBeUndefined();
	});

	test("generateCustomImageUploadUrl requires a real store + returns a url", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const url = await t.mutation(api.orders.generateCustomImageUploadUrl, {
			retailerId: retailer._id,
		});
		expect(typeof url).toBe("string");
	});
});

describe("tracking-link capability (shortId hardening)", () => {
	async function makeOrder(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const created = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Aisha", waPhone: "60123456789" },
			deliveryAddress: validAddress,
		});
		return { ...created, retailer };
	}

	test("create mints a high-entropy tracking token distinct from the shortId", async () => {
		const t = setup();
		const { shortId, trackingToken } = await makeOrder(t);
		expect(trackingToken).toMatch(/^[A-Za-z0-9]{24}$/);
		expect(trackingToken).not.toBe(shortId);
	});

	test("buyer reads an order by its token; an unknown token resolves to null", async () => {
		const t = setup();
		const { shortId, trackingToken } = await makeOrder(t);
		const byToken = await t.query(api.orders.get, { token: trackingToken });
		expect(byToken?.shortId).toBe(shortId);
		expect(
			await t.query(api.orders.get, { token: "definitely-not-a-real-token" }),
		).toBeNull();
	});

	test("shortId path rejects anonymous reads (closes the enumeration hole)", async () => {
		const t = setup();
		const { shortId } = await makeOrder(t);
		await expect(t.query(api.orders.get, { shortId })).rejects.toThrow(
			/Not authenticated/,
		);
	});

	test("shortId path is owner-scoped: non-owner forbidden, owner allowed", async () => {
		const t = setup();
		const { shortId } = await makeOrder(t);
		await seedRetailer(t, USER_B);
		await expect(
			t.withIdentity({ subject: USER_B }).query(api.orders.get, { shortId }),
		).rejects.toThrow(/Forbidden/);
		const owned = await t
			.withIdentity({ subject: USER_A })
			.query(api.orders.get, { shortId });
		expect(owned?.shortId).toBe(shortId);
	});

	test("a buyer mutation (claimPayment) is gated by the token, not the shortId", async () => {
		const t = setup();
		const { shortId, trackingToken } = await makeOrder(t);
		// The shortId is no longer a valid arg for the buyer mutation — only the
		// token is accepted, and confirming via the token works.
		await t.mutation(api.orders.claimPayment, { token: trackingToken });
		const order = await t.query(api.orders.get, { token: trackingToken });
		expect(order?.paymentStatus).toBe("claimed");
		// A guessed shortId-shaped token doesn't resolve to the order.
		await expect(
			t.mutation(api.orders.claimPayment, { token: shortId }),
		).rejects.toThrow(/Order not found/);

	});
});

describe("orders — delivery offered gating", () => {
	test("rejects a delivery order when the retailer doesn't offer delivery", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		// Simulate a pickup-only retailer (the updateSettings guard requires an
		// active location to reach this state; patching directly keeps the test
		// focused on orders.create).
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, { offerDelivery: false });
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
		).rejects.toThrow(/offering delivery/i);
	});

	test("allows a delivery order for a legacy retailer (offerDelivery unset)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		// Legacy rows have no offerDelivery field; effective read is `?? true`.
		await t.run(async (ctx) => {
			await ctx.db.patch(retailer._id, { offerDelivery: undefined });
		});
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

	test("allows a self_collect order when delivery is off", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });
		const { pickupLocationId } = await asA.mutation(
			api.pickupLocations.create,
			{
				retailerId: retailer._id,
				label: "Studio",
				address: "12 Jln Tun Razak, 50400 Kuala Lumpur",
			},
		);
		await asA.mutation(api.retailers.updateSettings, { offerDelivery: false });
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryMethod: "self_collect",
			pickupLocationId,
		});
		expect(shortId).toMatch(/^ORD-[A-Z2-9]{4}$/);
	});
});

describe("fulfilment date", () => {
	async function orderByShortId(t: ReturnType<typeof setup>, shortId: string) {
		return t.run(async (ctx) =>
			ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
				.first(),
		);
	}

	test("stores a valid fulfilment date on the order", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const date = todayMytMidnight() + 3 * DAY_MS;
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
			fulfilmentDate: date,
		});
		const order = await orderByShortId(t, shortId);
		expect(order?.fulfilmentDate).toBe(date);
	});

	test("rejects a date sooner than a configured notice", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.retailers.updateSettings, {
			minFulfilmentNoticeDays: 2,
		});
		const productId = await seedProduct(t, USER_A, retailer._id);
		await expect(
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
				fulfilmentDate: todayMytMidnight() + DAY_MS, // tomorrow — too soon with notice 2
			}),
		).rejects.toThrow(/too soon/);
	});

	test("default (unset) notice allows same-day", async () => {
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
			fulfilmentDate: todayMytMidnight(), // today OK — default notice is now 0
		});
		const order = await orderByShortId(t, shortId);
		expect(order?.fulfilmentDate).toBe(todayMytMidnight());
	});

	test("rejects a non-midnight value and a date beyond 30 days", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const base = {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR" as const,
			channel: "whatsapp" as const,
			customer,
			deliveryAddress: validAddress,
		};
		await expect(
			t.mutation(api.orders.create, {
				...base,
				fulfilmentDate: todayMytMidnight() + 3 * DAY_MS + 1,
			}),
		).rejects.toThrow(/whole calendar day/);
		await expect(
			t.mutation(api.orders.create, {
				...base,
				fulfilmentDate: todayMytMidnight() + 31 * DAY_MS,
			}),
		).rejects.toThrow(/30 days/);
	});

	test("notice 0 allows same-day fulfilment", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.retailers.updateSettings, {
			minFulfilmentNoticeDays: 0,
		});
		const productId = await seedProduct(t, USER_A, retailer._id);
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
			fulfilmentDate: todayMytMidnight(), // same-day now allowed
		});
		const order = await orderByShortId(t, shortId);
		expect(order?.fulfilmentDate).toBe(todayMytMidnight());
	});

	test("updateSettings rejects an out-of-range notice", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				minFulfilmentNoticeDays: 99,
			}),
		).rejects.toThrow(/between 0 and 30/);
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				minFulfilmentNoticeDays: -1,
			}),
		).rejects.toThrow(/between 0 and 30/);
	});

	test("inbox sorts by fulfilment date ascending, dateless orders last", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const productId = await seedProduct(t, USER_A, retailer._id);
		const mk = (fulfilmentDate?: number) =>
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
				fulfilmentDate,
			});
		// Insert out of date order: far, then dateless, then soon.
		await mk(todayMytMidnight() + 5 * DAY_MS);
		await mk(undefined);
		await mk(todayMytMidnight() + 2 * DAY_MS);

		const res = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
		});
		const dates = res.orders.map((o) => o.fulfilmentDate);
		expect(dates).toEqual([
			todayMytMidnight() + 2 * DAY_MS,
			todayMytMidnight() + 5 * DAY_MS,
			undefined,
		]);
	});

	test("fulfilmentWindow filter matches today / tomorrow / this_week", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.retailers.updateSettings, {
			minFulfilmentNoticeDays: 0,
		});
		const productId = await seedProduct(t, USER_A, retailer._id);
		const mk = (fulfilmentDate: number) =>
			t.mutation(api.orders.create, {
				retailerId: retailer._id,
				items: [{ productId, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer,
				deliveryAddress: validAddress,
				fulfilmentDate,
			});
		const today = todayMytMidnight();
		await mk(today);
		await mk(today + 1 * DAY_MS);
		await mk(today + 5 * DAY_MS);

		const todayRes = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			fulfilmentWindow: "today",
		});
		expect(todayRes.orders.map((o) => o.fulfilmentDate)).toEqual([today]);

		const tomorrowRes = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			fulfilmentWindow: "tomorrow",
		});
		expect(tomorrowRes.orders.map((o) => o.fulfilmentDate)).toEqual([
			today + 1 * DAY_MS,
		]);

		const weekRes = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
			fulfilmentWindow: "this_week",
		});
		// All three are within the next 7 days, returned soonest-first.
		expect(weekRes.orders.map((o) => o.fulfilmentDate)).toEqual([
			today,
			today + 1 * DAY_MS,
			today + 5 * DAY_MS,
		]);
	});
});
