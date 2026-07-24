/// <reference types="vite/client" />
// Plan-tier gating — the enforcement behind the pricing table's ✓/– rows:
//  - CRM (customers.*) and the Order Inbox surfaces (searchOrders filters,
//    bulkUpdateStatus, CSV export) are Pro+; Starter is rejected server-side.
//  - Admin act-as sees through the plan gates (white-glove support).
//  - The soft order-cap meter (subscriptionUsage) counts creates + reverses
//    cancels, and NEVER blocks order creation.
//  - The past_due soft-lock covers renameSlug + pickupLocations growth-writes.
// See docs/manual-subscription.md.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { capsForPlan, type Plan } from "./lib/plans";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER_A = "user_gating_a";
const ADMIN = "user_gating_admin";

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

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	const safeSuffix = userId.replace(/[^a-z0-9]/g, "");
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Gating Store",
		slug: `gating-store-${safeSuffix}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

/** Flip the seeded retailer's subscription to a given plan/status (signup
 * always creates a Pro trial; tests re-point it to exercise each tier). */
async function setPlan(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	plan: Plan,
	status: "trialing" | "active" | "past_due" = "active",
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
			status,
			orderCap: caps.orderCap,
			userCap: caps.userCap,
			broadcastQuota: caps.broadcastQuota,
			updatedAt: Date.now(),
		});
	});
}

async function seedProduct(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
): Promise<Id<"products">> {
	const asUser = t.withIdentity({ subject: userId });
	return asUser.mutation(api.products.create, {
		retailerId,
		name: "Kuih Box",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 2500, onHand: 100 }],
	});
}

async function placeOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
): Promise<Id<"orders">> {
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer,
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

async function usageOrders(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
): Promise<number> {
	return t.run(async (ctx) => {
		const rows = await ctx.db
			.query("subscriptionUsage")
			.withIndex("by_retailer_month", (q) => q.eq("retailerId", retailerId))
			.collect();
		return rows.reduce((sum, r) => sum + r.orders, 0);
	});
}

// ---------------------------------------------------------------------------
// CRM (customers.*) — Pro+
// ---------------------------------------------------------------------------

describe("plan gating — CRM (Pro+)", () => {
	test("Starter is rejected on every customers surface", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId); // creates the customer row
		await setPlan(t, retailer._id, "starter");
		const asA = t.withIdentity({ subject: USER_A });

		const paginationOpts = { numItems: 10, cursor: null };
		await expect(
			asA.query(api.customers.list, {
				retailerId: retailer._id,
				sort: "recency",
				paginationOpts,
			}),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.query(api.customers.count, { retailerId: retailer._id }),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.query(api.customers.search, {
				retailerId: retailer._id,
				term: "aisha",
			}),
		).rejects.toThrow(/Pro plan/);

		const customerId = await t.run(async (ctx) => {
			const c = await ctx.db
				.query("customers")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.first();
			if (!c) throw new Error("customer missing");
			return c._id;
		});
		await expect(
			asA.query(api.customers.get, { customerId }),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.mutation(api.customers.updateNotes, { customerId, notes: "vip" }),
		).rejects.toThrow(/Pro plan/);
	});

	test("Pro (and trial = Pro) passes; orders still auto-link for Starter", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });

		// Starter: the CRM keeps aggregating in the background even while locked.
		await setPlan(t, retailer._id, "starter");
		await placeOrder(t, retailer._id, productId);

		// Upgrade → data is all there on day one.
		await setPlan(t, retailer._id, "pro");
		const listed = await asA.query(api.customers.list, {
			retailerId: retailer._id,
			sort: "recency",
			paginationOpts: { numItems: 10, cursor: null },
		});
		expect(listed.page).toHaveLength(1);
		expect(listed.page[0].orderCount).toBe(1);
	});

	test("admin act-as sees through the CRM gate on a Starter store", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId);
		await setPlan(t, retailer._id, "starter");

		const asAdmin = t.withIdentity({ subject: ADMIN });
		const count = await asAdmin.query(api.customers.count, {
			retailerId: retailer._id,
		});
		expect(count).toBe(1);
	});

	test("resolveAccess features ride on getMyRetailer for the client gate", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });

		// Trial = Pro features.
		let me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.subscription?.features).toEqual({
			crm: true,
			orderInbox: true,
			chargeablePickup: true,
			categories: true,
			insights: true,
			radiusDelivery: true,
			delivery: true,
		});

		await setPlan(t, retailer._id, "starter");
		me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.subscription?.features).toEqual({
			crm: false,
			orderInbox: false,
			chargeablePickup: false,
			categories: false,
			insights: false,
			radiusDelivery: false,
			delivery: false,
		});
	});

	test("an admin's OWN Starter store still resolves to the highest tier", async () => {
		const t = setup();
		// Store owned by the admin themselves (not an act-as target).
		const retailer = await seedRetailer(t, ADMIN);
		await setPlan(t, retailer._id, "starter");
		const asAdmin = t.withIdentity({ subject: ADMIN });

		// getMyRetailer (owner read) grants full features despite the Starter plan —
		// so no Pro wall / locked control renders in the admin's own dashboard.
		const me = await asAdmin.query(api.retailers.getMyRetailer);
		expect(me?.subscription?.features).toEqual({
			crm: true,
			orderInbox: true,
			chargeablePickup: true,
			categories: true,
			insights: true,
			radiusDelivery: true,
		delivery: true,
		});
		// subscriptions.current (billing nav) resolves the same way.
		const current = await asAdmin.query(api.subscriptions.current, {});
		expect(current?.features.crm).toBe(true);
		// The real plan is still reported (billing page truth).
		expect(me?.subscription?.plan).toBe("starter");
	});

	test("assertPlanFeature bypasses for an admin on their OWN Starter store", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, ADMIN);
		await setPlan(t, retailer._id, "starter");
		// A CRM read on their own store is Pro-gated for a plain Starter seller, but
		// the admin sees through it (not act-as — they own the store).
		const count = await t
			.withIdentity({ subject: ADMIN })
			.query(api.customers.count, { retailerId: retailer._id });
		expect(count).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Radius delivery pricing (86extzdr8) — setting a radius config is Pro+; the
// flat fee and CLEARING any config stay all-tier (downgrade never traps a
// seller into charging fees they can't turn off). See docs/fulfilment.md.
// ---------------------------------------------------------------------------

describe("plan gating — radius delivery pricing (Pro+)", () => {
	const businessAddress = {
		label: "12 Jln Kilang, Shah Alam",
		latitude: 3.0,
		longitude: 101.5,
	};
	const radiusConfig = {
		mode: "radius" as const,
		bands: [{ maxKm: 5, fee: 500 }],
		outOfRange: "arrange" as const,
	};

	test("Starter can set a FLAT fee but not radius bands; Pro can set both", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await setPlan(t, retailer._id, "starter");

		// Flat is the all-tier correctness fix.
		await asA.mutation(api.retailers.updateSettings, {
			deliveryConfig: { mode: "flat", fee: 800 },
		});
		// Radius is the Pro row.
		await expect(
			asA.mutation(api.retailers.updateSettings, {
				businessAddress,
				deliveryConfig: radiusConfig,
			}),
		).rejects.toThrow(/Pro plan/);

		await setPlan(t, retailer._id, "pro");
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress,
			deliveryConfig: radiusConfig,
		});
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.deliveryConfig?.mode).toBe("radius");
		expect(me?.businessAddress?.latitude).toBe(3.0);
	});

	test("downgraded Starter can still CLEAR a radius config (never trapped)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress,
			deliveryConfig: radiusConfig,
		});
		await setPlan(t, retailer._id, "starter");

		await asA.mutation(api.retailers.updateSettings, { deliveryConfig: null });
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.deliveryConfig).toBeUndefined();
	});

	test("admin act-as sets radius pricing on a Starter store (white-glove)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await setPlan(t, retailer._id, "starter");
		const asAdmin = t.withIdentity({ subject: ADMIN });
		await asAdmin.mutation(api.retailers.updateSettings, {
			retailerId: retailer._id,
			businessAddress,
			deliveryConfig: radiusConfig,
		});
		const asA = t.withIdentity({ subject: USER_A });
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.deliveryConfig?.mode).toBe("radius");
	});

	test("radius without a business address is refused; clearing the address under radius is refused", async () => {
		const t = setup();
		await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });

		await expect(
			asA.mutation(api.retailers.updateSettings, {
				deliveryConfig: radiusConfig,
			}),
		).rejects.toThrow(/business address/i);

		await asA.mutation(api.retailers.updateSettings, {
			businessAddress,
			deliveryConfig: radiusConfig,
		});
		await expect(
			asA.mutation(api.retailers.updateSettings, { businessAddress: null }),
		).rejects.toThrow(/uses this address/i);

		// Clearing address + config together is fine.
		await asA.mutation(api.retailers.updateSettings, {
			businessAddress: null,
			deliveryConfig: null,
		});
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.businessAddress).toBeUndefined();
		expect(me?.deliveryConfig).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Product categories — Pro+ builds the structure; the escape hatches
// (archive/restore + clearing assignments) stay all-tier. See 86ey81n63.
// ---------------------------------------------------------------------------

describe("plan gating — Categories (Pro+)", () => {
	/** Seed a Pro-built category setup, then downgrade to Starter. */
	async function seedThenDowngrade(t: ReturnType<typeof setup>) {
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const { categoryId } = await asA.mutation(api.categories.create, {
			retailerId: retailer._id,
			name: "Meals",
			slug: "meals",
		});
		const productId = await seedProduct(t, USER_A, retailer._id);
		await asA.mutation(api.categories.setProductCategories, {
			productId,
			categoryIds: [categoryId],
		});
		await setPlan(t, retailer._id, "starter");
		return { retailer, asA, categoryId, productId };
	}

	test("Starter is rejected on every structure-building write", async () => {
		const t = setup();
		const { retailer, asA, categoryId, productId } = await seedThenDowngrade(t);

		await expect(
			asA.mutation(api.categories.create, {
				retailerId: retailer._id,
				name: "Events",
				slug: "events",
			}),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.mutation(api.categories.update, { categoryId, name: "Renamed" }),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.mutation(api.categories.reorder, {
				retailerId: retailer._id,
				orderedIds: [categoryId],
			}),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.mutation(api.categories.reorderProducts, {
				categoryId,
				orderedProductIds: [productId],
			}),
		).rejects.toThrow(/Pro plan/);
	});

	test("Starter keeps the escape hatches: archive/restore + clearing assignments", async () => {
		const t = setup();
		const { retailer, asA, categoryId, productId } = await seedThenDowngrade(t);

		// Adding an assignment is gated…
		const second = await seedProduct(t, USER_A, retailer._id);
		await expect(
			asA.mutation(api.categories.setProductCategories, {
				productId: second,
				categoryIds: [categoryId],
			}),
		).rejects.toThrow(/Pro plan/);

		// …but clearing is not (a downgraded seller is never trapped)…
		await asA.mutation(api.categories.setProductCategories, {
			productId,
			categoryIds: [],
		});
		expect(
			await asA.query(api.categories.getProductCategoryIds, { productId }),
		).toEqual([]);

		// …and neither is archive/restore or hide/show (storefront visibility is
		// always the seller's to manage, even downgraded).
		await asA.mutation(api.categories.setActive, {
			categoryId,
			active: false,
		});
		await asA.mutation(api.categories.setActive, { categoryId, active: true });
		await asA.mutation(api.categories.setHidden, { categoryId, hidden: true });
		await asA.mutation(api.categories.setHidden, { categoryId, hidden: false });

		// The management list stays readable on Starter (archive must be
		// reachable), as does the picker's data source.
		const rows = await asA.query(api.categories.listForRetailer, {
			retailerId: retailer._id,
		});
		expect(rows.map((r) => r.name)).toEqual(["Meals"]);
	});

	test("admin act-as builds category structure on a Starter store", async () => {
		const t = setup();
		const { retailer, productId } = await seedThenDowngrade(t);
		const asAdmin = t.withIdentity({ subject: ADMIN });

		const { categoryId } = await asAdmin.mutation(api.categories.create, {
			retailerId: retailer._id,
			name: "Events",
			slug: "events",
		});
		await asAdmin.mutation(api.categories.setProductCategories, {
			productId,
			categoryIds: [categoryId],
		});
		// Admin-on-behalf writes are audited.
		const audit = await t.run(async (ctx) =>
			(await ctx.db.query("adminAuditLog").collect()).map((r) => r.action),
		);
		expect(audit).toContain("categories.create");
		expect(audit).toContain("categories.setProductCategories");
	});
});

// ---------------------------------------------------------------------------
// Order Inbox surfaces — Pro+
// ---------------------------------------------------------------------------

describe("plan gating — Order Inbox (Pro+)", () => {
	test("Starter keeps the PLAIN order list (default args)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId);
		await setPlan(t, retailer._id, "starter");
		const asA = t.withIdentity({ subject: USER_A });

		const res = await asA.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "all",
		});
		expect(res.orders).toHaveLength(1);
	});

	test("Starter is rejected on buckets, search and every filter arg", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await setPlan(t, retailer._id, "starter");
		const asA = t.withIdentity({ subject: USER_A });
		const base = { retailerId: retailer._id, bucket: "all" as const };

		await expect(
			asA.query(api.orders.searchOrders, { ...base, bucket: "new" }),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.query(api.orders.searchOrders, { ...base, searchText: "ORD" }),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.query(api.orders.searchOrders, {
				...base,
				paymentStatuses: ["unpaid"],
			}),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.query(api.orders.searchOrders, { ...base, fulfilmentWindow: "today" }),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.query(api.orders.searchOrders, { ...base, mockupPending: true }),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.query(api.orders.searchOrders, { ...base, dateFrom: 0 }),
		).rejects.toThrow(/Pro plan/);
	});

	test("bulkUpdateStatus is Pro+ (single updateStatus stays open)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const orderId = await placeOrder(t, retailer._id, productId);
		await setPlan(t, retailer._id, "starter");
		const asA = t.withIdentity({ subject: USER_A });

		await expect(
			asA.mutation(api.orders.bulkUpdateStatus, {
				orderIds: [orderId],
				status: "confirmed",
			}),
		).rejects.toThrow(/Pro plan/);

		// The pipeline itself is all-tier: one-at-a-time transitions still work.
		await asA.mutation(api.orders.updateStatus, {
			orderId,
			status: "confirmed",
		});
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("confirmed");
	});

	test("CSV export is Pro+ (filter mode and ticked-selection mode)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const orderId = await placeOrder(t, retailer._id, productId);
		await setPlan(t, retailer._id, "starter");
		const asA = t.withIdentity({ subject: USER_A });

		await expect(
			asA.action(api.orders.exportOrders, {
				retailerId: retailer._id,
				bucket: "all",
			}),
		).rejects.toThrow(/Pro plan/);
		await expect(
			asA.action(api.orders.exportOrders, {
				retailerId: retailer._id,
				bucket: "all",
				orderIds: [orderId],
			}),
		).rejects.toThrow(/Pro plan/);

		// Pro exports fine.
		await setPlan(t, retailer._id, "pro");
		const res = await asA.action(api.orders.exportOrders, {
			retailerId: retailer._id,
			bucket: "all",
		});
		expect(res.count).toBe(1);
	});

	test("admin act-as uses the full inbox on a Starter store", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await placeOrder(t, retailer._id, productId);
		await setPlan(t, retailer._id, "starter");

		const asAdmin = t.withIdentity({ subject: ADMIN });
		const res = await asAdmin.query(api.orders.searchOrders, {
			retailerId: retailer._id,
			bucket: "new",
			searchText: "ORD",
		});
		expect(res.total).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Order-usage meter (SOFT cap — counts, never blocks)
// ---------------------------------------------------------------------------

describe("subscription usage meter", () => {
	test("order create increments; cancel reverses once (idempotent)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const asA = t.withIdentity({ subject: USER_A });

		const first = await placeOrder(t, retailer._id, productId);
		await placeOrder(t, retailer._id, productId);
		expect(await usageOrders(t, retailer._id)).toBe(2);

		// getMyRetailer carries the meter for the dashboard nudge + billing tab.
		const me = await asA.query(api.retailers.getMyRetailer);
		expect(me?.ordersThisMonth).toBe(2);

		await asA.mutation(api.orders.updateStatus, {
			orderId: first,
			status: "cancelled",
		});
		expect(await usageOrders(t, retailer._id)).toBe(1);

		// Re-cancelling must not double-decrement (same first-transition guard
		// as the stock restore / customer aggregates).
		await asA.mutation(api.orders.updateStatus, {
			orderId: first,
			status: "cancelled",
		});
		expect(await usageOrders(t, retailer._id)).toBe(1);
	});

	test("orders NEVER block on the cap — a Starter store sails past 100", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		await setPlan(t, retailer._id, "starter");

		// Force the meter over the Starter cap, then place one more order — the
		// public pipeline must not care.
		await t.run(async (ctx) => {
			await ctx.db.insert("subscriptionUsage", {
				retailerId: retailer._id,
				monthStart: 0, // any prior month; the new order lands in its own row
				orders: 150,
				createdAt: 0,
				updatedAt: 0,
			});
		});
		await expect(
			placeOrder(t, retailer._id, productId),
		).resolves.toBeDefined();
	});

	test("cancelling a pre-meter order (no usage row) is a safe no-op", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const orderId = await placeOrder(t, retailer._id, productId);
		// Simulate a pre-meter order: wipe the usage rows the create just wrote.
		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("subscriptionUsage")
				.withIndex("by_retailer_month", (q) =>
					q.eq("retailerId", retailer._id),
				)
				.collect();
			for (const r of rows) await ctx.db.delete(r._id);
		});
		const asA = t.withIdentity({ subject: USER_A });
		await asA.mutation(api.orders.updateStatus, {
			orderId,
			status: "cancelled",
		});
		expect(await usageOrders(t, retailer._id)).toBe(0); // floored, no negative
	});
});

// ---------------------------------------------------------------------------
// past_due soft-lock — renameSlug + pickupLocations growth-writes
// ---------------------------------------------------------------------------

describe("soft-lock — renameSlug + pickup locations", () => {
	test("past_due blocks renameSlug and every pickupLocations write", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asA = t.withIdentity({ subject: USER_A });
		const { pickupLocationId } = await asA.mutation(api.pickupLocations.create, {
			retailerId: retailer._id,
			label: "HQ",
			address: "12 Jln Mawar 3, PJ",
		});

		await setPlan(t, retailer._id, "pro", "past_due");

		await expect(
			asA.mutation(api.retailers.renameSlug, { newSlug: "new-slug-x" }),
		).rejects.toThrow(/past due/);
		await expect(
			asA.mutation(api.pickupLocations.create, {
				retailerId: retailer._id,
				label: "Branch",
				address: "34 Jln Melur 1, Shah Alam",
			}),
		).rejects.toThrow(/past due/);
		await expect(
			asA.mutation(api.pickupLocations.update, {
				pickupLocationId,
				label: "HQ renamed",
			}),
		).rejects.toThrow(/past due/);
		await expect(
			asA.mutation(api.pickupLocations.setActive, {
				pickupLocationId,
				isActive: false,
			}),
		).rejects.toThrow(/past due/);
		await expect(
			asA.mutation(api.pickupLocations.reorder, {
				retailerId: retailer._id,
				orderedIds: [pickupLocationId],
			}),
		).rejects.toThrow(/past due/);
	});

	test("admin act-as bypasses the soft-lock (white-glove on an unpaid store)", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		await setPlan(t, retailer._id, "pro", "past_due");

		const asAdmin = t.withIdentity({ subject: ADMIN });
		const { slug } = await asAdmin.mutation(api.retailers.renameSlug, {
			retailerId: retailer._id,
			newSlug: "admin-renamed",
		});
		expect(slug).toBe("admin-renamed");
		await expect(
			asAdmin.mutation(api.pickupLocations.create, {
				retailerId: retailer._id,
				label: "Admin-added",
				address: "12 Jln Mawar 3, PJ",
			}),
		).resolves.toBeDefined();
	});
});
