/// <reference types="vite/client" />
/**
 * Seller MCP tool layer (z8r3fdff6p). The critical block is TENANT ISOLATION:
 * `resolveMcpContext` is the only bridge from a verified Clerk user to a
 * retailerId, so these tests prove it can only ever hand back the caller's
 * own store — delete that resolution (or widen it) and the isolation tests go
 * red, per the mutation-test-your-guards rule.
 */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import { capsForPlan, type Plan } from "./lib/plans";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const OWNER_A = "user_mcp_owner_a";
const OWNER_B = "user_mcp_owner_b";

const address = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

async function seedStore(t: ReturnType<typeof setup>, userId = OWNER_A) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `MCP Store ${userId.slice(-1).toUpperCase()}`,
		slug: `mcp-store-${userId.replace(/[^a-z0-9]/g, "")}`,
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
	status: "active" | "past_due" = "active",
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

type SeededOrder = {
	shortId: string;
	status: string;
	total: number;
	paymentStatus?: string;
	securityDeposit?: number;
	createdAt?: number;
	fulfilmentDate?: number;
	source?: "storefront" | "counter" | "claim";
	deliveryMethod?: "delivery" | "self_collect" | "booking";
	bookingCheckIn?: number;
	bookingCheckOut?: number;
	customerName?: string;
};

let orderSeq = 0;

async function insertOrders(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	orders: SeededOrder[],
) {
	await t.run(async (ctx) => {
		for (const o of orders) {
			orderSeq++;
			const createdAt = o.createdAt ?? Date.now();
			await ctx.db.insert("orders", {
				retailerId,
				shortId: o.shortId,
				trackingToken: `mcptok${String(orderSeq).padStart(19, "0")}`,
				items: [
					{ productId, name: "Kuih Box", price: o.total, quantity: 1 },
				],
				subtotal: o.total,
				total: o.total,
				securityDeposit: o.securityDeposit,
				currency: "MYR",
				status: o.status as "pending",
				paymentStatus: (o.paymentStatus ?? "unpaid") as "unpaid",
				channel: "whatsapp",
				customer: { name: o.customerName ?? "Aisha", waPhone: "60123456789" },
				deliveryMethod: o.deliveryMethod ?? "delivery",
				deliveryAddress: o.deliveryMethod === "booking" ? undefined : address,
				bookingCheckIn: o.bookingCheckIn,
				bookingCheckOut: o.bookingCheckOut,
				fulfilmentDate: o.fulfilmentDate,
				source: o.source,
				createdAt,
				updatedAt: createdAt,
			});
		}
	});
}

describe("resolveMcpContext (the tenant boundary + gates)", () => {
	test("resolves a Pro owner to their own store", async () => {
		const t = setup();
		const { retailer } = await seedStore(t);
		await setPlan(t, retailer._id, "pro");
		const context = await t.query(internal.sellerTools.resolveMcpContext, {
			clerkUserId: OWNER_A,
		});
		expect(context).toMatchObject({
			ok: true,
			retailerId: retailer._id,
			currency: "MYR",
		});
	});

	test("ISOLATION: each Clerk user resolves to their own store, never another's", async () => {
		const t = setup();
		const { retailer: storeA } = await seedStore(t, OWNER_A);
		const { retailer: storeB } = await seedStore(t, OWNER_B);
		await setPlan(t, storeA._id, "pro");
		await setPlan(t, storeB._id, "pro");
		const contextB = await t.query(internal.sellerTools.resolveMcpContext, {
			clerkUserId: OWNER_B,
		});
		expect(contextB.ok).toBe(true);
		if (!contextB.ok) throw new Error("unreachable");
		expect(contextB.retailerId).toBe(storeB._id);
		expect(contextB.retailerId).not.toBe(storeA._id);
	});

	test("a Clerk user with no store gets no_store, not someone else's data", async () => {
		const t = setup();
		await seedStore(t, OWNER_A);
		const context = await t.query(internal.sellerTools.resolveMcpContext, {
			clerkUserId: "user_with_no_store",
		});
		expect(context).toEqual({ ok: false, reason: "no_store" });
	});

	test("Starter is refused with the plan reason", async () => {
		const t = setup();
		const { retailer } = await seedStore(t);
		await setPlan(t, retailer._id, "starter");
		const context = await t.query(internal.sellerTools.resolveMcpContext, {
			clerkUserId: OWNER_A,
		});
		expect(context).toEqual({ ok: false, reason: "plan" });
	});

	test("a past_due sub is refused as frozen — and frozen OUTRANKS the plan pitch", async () => {
		const t = setup();
		const { retailer } = await seedStore(t);
		// Even a Starter that is past_due should hear "pay your invoice", not an
		// upsell — the gate order in resolveMcpContext is deliberate.
		await setPlan(t, retailer._id, "starter", "past_due");
		const context = await t.query(internal.sellerTools.resolveMcpContext, {
			clerkUserId: OWNER_A,
		});
		expect(context).toEqual({ ok: false, reason: "frozen" });
	});
});

describe("salesSummary (agrees with Insights semantics)", () => {
	test("deposit-net earned, collected only when received, pending/cancelled excluded", async () => {
		const t = setup();
		const { retailer, productId } = await seedStore(t);
		const today = todayMytMidnight(Date.now());
		const at = today + 60_000;
		await insertOrders(t, retailer._id, productId, [
			{ shortId: "ORD-D1", status: "delivered", total: 10000, paymentStatus: "received", createdAt: at },
			{ shortId: "ORD-C1", status: "confirmed", total: 5000, createdAt: at + 1 },
			{
				shortId: "ORD-B1",
				status: "confirmed",
				total: 30000,
				securityDeposit: 10000,
				paymentStatus: "received",
				deliveryMethod: "booking",
				bookingCheckIn: today + DAY_MS,
				bookingCheckOut: today + 3 * DAY_MS,
				createdAt: at + 2,
			},
			{ shortId: "ORD-P1", status: "pending", total: 7000, createdAt: at + 3 },
			{ shortId: "ORD-X1", status: "cancelled", total: 9000, createdAt: at + 4 },
		]);
		const summary = await t.query(internal.sellerTools.salesSummary, {
			retailerId: retailer._id,
			from: today,
			toExclusive: today + DAY_MS,
		});
		expect(summary.earned).toBe(350); // 100 + 50 + (300 − 100 deposit)
		expect(summary.depositsExcluded).toBe(100);
		expect(summary.collected).toBe(300); // the two received orders, deposit-net
		expect(summary.orderCount).toBe(3);
		expect(summary.averageOrderValue).toBe(116.67);
		expect(summary.topProducts[0]?.name).toBe("Kuih Box");
		expect(summary.capped).toBe(false);
	});

	test("ISOLATION: one store's summary never contains another store's orders", async () => {
		const t = setup();
		const { retailer: storeA, productId: productA } = await seedStore(t, OWNER_A);
		const { retailer: storeB } = await seedStore(t, OWNER_B);
		const today = todayMytMidnight(Date.now());
		await insertOrders(t, storeA._id, productA, [
			{ shortId: "ORD-A1", status: "delivered", total: 10000, paymentStatus: "received", createdAt: today + 1 },
		]);
		const summaryB = await t.query(internal.sellerTools.salesSummary, {
			retailerId: storeB._id,
			from: today,
			toExclusive: today + DAY_MS,
		});
		expect(summaryB.orderCount).toBe(0);
		expect(summaryB.earned).toBe(0);
	});
});

describe("orderCounts (inbox-bucket semantics)", () => {
	test("buckets via orderBucket; unpaid counts OPEN orders; counter never dueToday", async () => {
		const t = setup();
		const { retailer, productId } = await seedStore(t);
		const today = todayMytMidnight(Date.now());
		await insertOrders(t, retailer._id, productId, [
			{ shortId: "ORD-N1", status: "pending", total: 7000 },
			{ shortId: "ORD-I1", status: "confirmed", total: 5000, fulfilmentDate: today },
			{ shortId: "ORD-I2", status: "packed", total: 4000, paymentStatus: "received" },
			{ shortId: "ORD-K1", status: "delivered", total: 3000, paymentStatus: "received" },
			{ shortId: "ORD-X1", status: "cancelled", total: 9000 },
			// Counter order due today — must NOT count toward dueToday (its date
			// is defaulted, not buyer-chosen), but its unpaid state still counts.
			{ shortId: "ORD-CT1", status: "confirmed", total: 2000, source: "counter", fulfilmentDate: today },
		]);
		const counts = await t.query(internal.sellerTools.orderCounts, {
			retailerId: retailer._id,
		});
		expect(counts.needsAttention).toBe(1);
		expect(counts.inProgress).toBe(3);
		expect(counts.completed).toBe(1);
		expect(counts.cancelled).toBe(1);
		expect(counts.unpaidOpenOrders).toBe(3); // pending + confirmed + counter
		expect(counts.unpaidAmount).toBe(140); // 70 + 50 + 20
		expect(counts.dueToday).toBe(1); // the storefront confirmed order only
		expect(counts.capped).toBe(false);
	});
});

describe("unpaidOrders", () => {
	test("open unpaid only, newest first, limit respected", async () => {
		const t = setup();
		const { retailer, productId } = await seedStore(t);
		const now = Date.now();
		await insertOrders(t, retailer._id, productId, [
			{ shortId: "ORD-U1", status: "pending", total: 1000, createdAt: now - 3000 },
			{ shortId: "ORD-U2", status: "confirmed", total: 2000, createdAt: now - 2000 },
			{ shortId: "ORD-U3", status: "confirmed", total: 3000, createdAt: now - 1000 },
			{ shortId: "ORD-PAID", status: "confirmed", total: 4000, paymentStatus: "received", createdAt: now },
			{ shortId: "ORD-DONE", status: "delivered", total: 5000, createdAt: now },
			{ shortId: "ORD-GONE", status: "cancelled", total: 6000, createdAt: now },
		]);
		const result = await t.query(internal.sellerTools.unpaidOrders, {
			retailerId: retailer._id,
			limit: 2,
		});
		expect(result.totalUnpaid).toBe(3);
		expect(result.unpaidAmount).toBe(60);
		expect(result.orders.map((o) => o.orderId)).toEqual(["ORD-U3", "ORD-U2"]);
		expect(result.orders[0]?.customer).toBe("Aisha");
	});
});

describe("upcomingFulfilments", () => {
	test("dated open orders in the window; counter skipped; active bookings included", async () => {
		const t = setup();
		const { retailer, productId } = await seedStore(t);
		const today = todayMytMidnight(Date.now());
		await insertOrders(t, retailer._id, productId, [
			{ shortId: "ORD-T1", status: "confirmed", total: 1000, fulfilmentDate: today },
			{ shortId: "ORD-T2", status: "confirmed", total: 1000, fulfilmentDate: today + DAY_MS },
			{ shortId: "ORD-CT", status: "confirmed", total: 1000, source: "counter", fulfilmentDate: today },
			{ shortId: "ORD-XX", status: "cancelled", total: 1000, fulfilmentDate: today },
			{
				shortId: "ORD-BK",
				status: "confirmed",
				total: 20000,
				deliveryMethod: "booking",
				bookingCheckIn: today - DAY_MS,
				bookingCheckOut: today + DAY_MS,
			},
		]);
		const result = await t.query(internal.sellerTools.upcomingFulfilments, {
			retailerId: retailer._id,
			window: "today",
		});
		expect(result.orders.map((o) => o.orderId)).toEqual(["ORD-T1"]);
		expect(result.bookings.map((b) => b.orderId)).toEqual(["ORD-BK"]);
		expect(result.bookings[0]?.active).toBe(true);
	});
});

describe("topCustomers", () => {
	test("ranks by spend or orders off the denormalized aggregates", async () => {
		const t = setup();
		const { retailer } = await seedStore(t);
		const now = Date.now();
		await t.run(async (ctx) => {
			const rows = [
				{ name: "Big Spender", waPhone: "60110000001", orderCount: 2, totalSpent: 50000 },
				{ name: "Frequent", waPhone: "60110000002", orderCount: 9, totalSpent: 18000 },
				{ name: "Never Ordered", waPhone: "60110000003", orderCount: 0, totalSpent: 0 },
			];
			for (const row of rows) {
				await ctx.db.insert("customers", {
					retailerId: retailer._id,
					waPhone: row.waPhone,
					name: row.name,
					searchText: row.name.toLowerCase(),
					orderCount: row.orderCount,
					totalSpent: row.totalSpent,
					firstOrderAt: now - DAY_MS,
					lastOrderAt: now,
					createdAt: now - DAY_MS,
					updatedAt: now,
				});
			}
		});
		const bySpend = await t.query(internal.sellerTools.topCustomers, {
			retailerId: retailer._id,
			by: "spend",
		});
		expect(bySpend.customers.map((c) => c.name)).toEqual([
			"Big Spender",
			"Frequent",
		]);
		expect(bySpend.customers[0]?.totalSpent).toBe(500);
		const byOrders = await t.query(internal.sellerTools.topCustomers, {
			retailerId: retailer._id,
			by: "orders",
		});
		expect(byOrders.customers[0]?.name).toBe("Frequent");
	});
});

describe("lowStock", () => {
	test("stock-tracked variants at/below threshold; made-to-order never appears", async () => {
		const t = setup();
		const { retailer, asUser } = await seedStore(t);
		await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Tracked Tee",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			options: [{ name: "Size", values: ["S", "M"] }],
			blockWhenOutOfStock: true,
			requiresProof: false,
			variants: [
				{ optionValues: ["S"], price: 3000, onHand: 2 },
				{ optionValues: ["M"], price: 3000, onHand: 50 },
			],
		});
		const result = await t.query(internal.sellerTools.lowStock, {
			retailerId: retailer._id,
			threshold: 3,
		});
		// The seed store's made-to-order Kuih Box (blockWhenOutOfStock: false)
		// must not appear however low its number reads.
		expect(result.items).toEqual([
			{ product: "Tracked Tee", variant: "S", onHand: 2 },
		]);
		expect(result.totalMatching).toBe(1);
	});
});

describe("creditBalance (stub until Credits T1 86eye2ccu)", () => {
	test("says credits aren't live yet", async () => {
		const t = setup();
		const { retailer } = await seedStore(t);
		const result = await t.query(internal.sellerTools.creditBalance, {
			retailerId: retailer._id,
		});
		expect(result.available).toBe(false);
		expect(result.message).toContain("aren't live");
	});
});

describe("checkMcpRateLimit", () => {
	test("absorbs a burst of 30 then refuses with a retry hint", async () => {
		const t = setup();
		const { retailer } = await seedStore(t);
		for (let i = 0; i < 30; i++) {
			const ok = await t.mutation(internal.sellerTools.checkMcpRateLimit, {
				retailerId: retailer._id,
			});
			expect(ok.ok).toBe(true);
		}
		const refused = await t.mutation(internal.sellerTools.checkMcpRateLimit, {
			retailerId: retailer._id,
		});
		expect(refused.ok).toBe(false);
		if (refused.ok) throw new Error("unreachable");
		expect(refused.retryAfterMs).toBeGreaterThan(0);
	});
});
