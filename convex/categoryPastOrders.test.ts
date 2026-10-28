/// <reference types="vite/client" />
// Filing past orders when a product gains a category. Categories are frozen
// onto order lines at sale (86eyrtz74), so a seller who sets up categories
// AFTER taking orders found every one of them "Uncategorized" in the inbox
// filter with nothing saying why (Dr Niki Trainings, 28 Oct 2026). Adding a
// category now files the product's past lines that recorded none — and never
// touches a line that already carries its own record. See
// docs/product-categories.md.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PAST_ORDER_FILING_PAGE } from "./lib/orderCategoryNames";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER_A = "user_past_orders_a";
const USER_B = "user_past_orders_b";

const validAddress = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Past Orders Store",
		slug: `past-orders-${userId.replace(/[^a-z0-9]/g, "")}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedProduct(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	name: string,
): Promise<Id<"products">> {
	return t.withIdentity({ subject: userId }).mutation(api.products.create, {
		retailerId,
		name,
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 2500, onHand: 1000 }],
	});
}

async function createCategory(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	name: string,
): Promise<Id<"categories">> {
	const { categoryId } = await t
		.withIdentity({ subject: userId })
		.mutation(api.categories.create, {
			retailerId,
			name,
			slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
		});
	return categoryId;
}

let phoneSeq = 0;
async function place(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productIds: Id<"products">[],
): Promise<Id<"orders">> {
	phoneSeq++;
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: productIds.map((productId) => ({ productId, quantity: 1 })),
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Aisha", waPhone: `6012${String(phoneSeq).padStart(7, "0")}` },
		deliveryAddress: validAddress,
	});
	return t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error("order missing");
		return o._id;
	});
}

async function lineNames(
	t: ReturnType<typeof setup>,
	orderId: Id<"orders">,
): Promise<(string[] | undefined)[]> {
	const order = await t.run((ctx) => ctx.db.get(orderId));
	return order?.items.map((i) => i.categoryNames) ?? [];
}

describe("setProductCategories files past orders", () => {
	// The background batches chain through the scheduler; fake timers let a
	// test drive them to the end instead of racing them.
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	test("adding a category files the product's earlier uncategorized orders and says how many", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const combo = await seedProduct(t, USER_A, retailer._id, "Combo 3 Books");
		const first = await place(t, retailer._id, [combo]);
		const second = await place(t, retailer._id, [combo]);
		const categoryId = await createCategory(t, USER_A, retailer._id, "Combo Books");

		const result = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.categories.setProductCategories, {
				productId: combo,
				categoryIds: [categoryId],
			});

		expect(result).toEqual({
			filedOrders: 2,
			filingContinues: false,
			categoryNames: ["Combo Books"],
		});
		expect(await lineNames(t, first)).toEqual([["Combo Books"]]);
		expect(await lineNames(t, second)).toEqual([["Combo Books"]]);
	});

	test("files only that product's line on a mixed order", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const combo = await seedProduct(t, USER_A, retailer._id, "Combo 3 Books");
		const lunch = await seedProduct(t, USER_A, retailer._id, "Luncheon");
		const mixed = await place(t, retailer._id, [combo, lunch]);
		const categoryId = await createCategory(t, USER_A, retailer._id, "Combo Books");

		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.categories.setProductCategories, {
				productId: combo,
				categoryIds: [categoryId],
			});

		const order = await t.run((ctx) => ctx.db.get(mixed));
		const byProduct = new Map(
			order?.items.map((i) => [i.productId, i.categoryNames]),
		);
		expect(byProduct.get(combo)).toEqual(["Combo Books"]);
		expect(byProduct.get(lunch)).toEqual([]);
	});

	test("never rewrites a line that already recorded a category", async () => {
		// The sale-time record is the point of freezing: an order sold under
		// "Kuih" stays "Kuih" when the product later gains "Bestseller".
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const kek = await seedProduct(t, USER_A, retailer._id, "Kek Lapis");
		const kuih = await createCategory(t, USER_A, retailer._id, "Kuih");
		const best = await createCategory(t, USER_A, retailer._id, "Bestseller");
		await asA.mutation(api.categories.setProductCategories, {
			productId: kek,
			categoryIds: [kuih],
		});
		const sold = await place(t, retailer._id, [kek]);

		const result = await asA.mutation(api.categories.setProductCategories, {
			productId: kek,
			categoryIds: [kuih, best],
		});

		expect(result.filedOrders).toBe(0);
		expect(await lineNames(t, sold)).toEqual([["Kuih"]]);
	});

	test("also files a line that predates the field", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const combo = await seedProduct(t, USER_A, retailer._id, "Combo 3 Books");
		const old = await place(t, retailer._id, [combo]);
		await t.run(async (ctx) => {
			const o = await ctx.db.get(old);
			await ctx.db.patch(old, {
				items: o!.items.map(({ categoryNames: _drop, ...line }) => line),
			});
		});
		const categoryId = await createCategory(t, USER_A, retailer._id, "Combo Books");

		const result = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.categories.setProductCategories, {
				productId: combo,
				categoryIds: [categoryId],
			});

		expect(result.filedOrders).toBe(1);
		expect(await lineNames(t, old)).toEqual([["Combo Books"]]);
	});

	test("does not bump the order's updatedAt — filing is a record, not a change to the sale", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const combo = await seedProduct(t, USER_A, retailer._id, "Combo 3 Books");
		const orderId = await place(t, retailer._id, [combo]);
		const before = (await t.run((ctx) => ctx.db.get(orderId)))?.updatedAt;
		const categoryId = await createCategory(t, USER_A, retailer._id, "Combo Books");

		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.categories.setProductCategories, {
				productId: combo,
				categoryIds: [categoryId],
			});

		expect((await t.run((ctx) => ctx.db.get(orderId)))?.updatedAt).toBe(before);
	});

	test("removing a category files nothing and leaves past orders as they were", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const kek = await seedProduct(t, USER_A, retailer._id, "Kek Lapis");
		const kuih = await createCategory(t, USER_A, retailer._id, "Kuih");
		await asA.mutation(api.categories.setProductCategories, {
			productId: kek,
			categoryIds: [kuih],
		});
		const sold = await place(t, retailer._id, [kek]);

		const result = await asA.mutation(api.categories.setProductCategories, {
			productId: kek,
			categoryIds: [],
		});

		expect(result).toEqual({
			filedOrders: 0,
			filingContinues: false,
			categoryNames: [],
		});
		expect(await lineNames(t, sold)).toEqual([["Kuih"]]);
	});

	test("never touches another store's orders", async () => {
		const t = setup();
		const a = await seedRetailer(t, USER_A);
		const b = await seedRetailer(t, USER_B);
		const comboA = await seedProduct(t, USER_A, a._id, "Combo");
		const comboB = await seedProduct(t, USER_B, b._id, "Combo");
		const theirs = await place(t, b._id, [comboB]);
		const categoryId = await createCategory(t, USER_A, a._id, "Combo Books");

		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.categories.setProductCategories, {
				productId: comboA,
				categoryIds: [categoryId],
			});

		expect(await lineNames(t, theirs)).toEqual([[]]);
	});

	test("only walks orders placed after the product existed", async () => {
		// No index reaches an order by its lines, so the walk is bounded by the
		// product's age instead: an order older than the product cannot hold it.
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const older = await seedProduct(t, USER_A, retailer._id, "Older");
		const oldOrder = await place(t, retailer._id, [older]);
		const fresh = await seedProduct(t, USER_A, retailer._id, "Fresh");
		const categoryId = await createCategory(t, USER_A, retailer._id, "New");

		const result = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.categories.setProductCategories, {
				productId: fresh,
				categoryIds: [categoryId],
			});

		expect(result).toEqual({
			filedOrders: 0,
			filingContinues: false,
			categoryNames: ["New"],
		});
		expect(await lineNames(t, oldOrder)).toEqual([[]]);
	});

	test("a store with more orders than one page files the rest in the background", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const combo = await seedProduct(t, USER_A, retailer._id, "Combo 3 Books");
		const template = await place(t, retailer._id, [combo]);
		// Cloned rather than placed: one page of real checkouts is slow, and only
		// the line shape matters here.
		await t.run(async (ctx) => {
			const o = await ctx.db.get(template);
			const { _id, _creationTime, ...doc } = o!;
			for (let i = 0; i < PAST_ORDER_FILING_PAGE + 4; i++) {
				await ctx.db.insert("orders", { ...doc, shortId: `ORD-C${i}` });
			}
		});
		const categoryId = await createCategory(t, USER_A, retailer._id, "Combo Books");

		const result = await t
			.withIdentity({ subject: USER_A })
			.mutation(api.categories.setProductCategories, {
				productId: combo,
				categoryIds: [categoryId],
			});
		expect(result.filedOrders).toBe(PAST_ORDER_FILING_PAGE);
		expect(result.filingContinues).toBe(true);

		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const unfiled = await t.run(async (ctx) =>
			(
				await ctx.db
					.query("orders")
					.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
					.collect()
			).filter((o) => o.items.some((i) => (i.categoryNames ?? []).length === 0)),
		);
		expect(unfiled).toHaveLength(0);
	});
});

describe("orders inbox reports whether the store has categories", () => {
	test("true only while the store has an ACTIVE category", async () => {
		// Archiving every category leaves the seller nothing to file products
		// under, so the empty state should point at setting categories up.
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const inbox = () =>
			asA.query(api.orders.searchOrders, { retailerId: retailer._id });

		expect((await inbox()).storeHasCategories).toBe(false);
		const categoryId = await createCategory(t, USER_A, retailer._id, "Kuih");
		expect((await inbox()).storeHasCategories).toBe(true);
		await asA.mutation(api.categories.setActive, {
			categoryId,
			active: false,
		});
		expect((await inbox()).storeHasCategories).toBe(false);
	});
});
