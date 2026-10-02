/// <reference types="vite/client" />
// The shipped state of the Credits T3 seller lock: BUILT and SWITCHED OFF
// (CREDIT_LOCK_ENABLED, lib/credits.ts), pending the per-order model.
//
// This file deliberately does NOT mock the switch — it runs against the real
// constant, so it is the thing that goes red if someone deletes the two
// `if (!CREDIT_LOCK_ENABLED)` gates, or flips the constant without meaning to.
// creditLock.test.ts is its mirror: that file forces the switch ON and proves
// the lock's own behaviour, which is what we turn back on.
//
// The two halves of "off" that matter:
//  1. nothing is REFUSED, however negative the balance;
//  2. no BALANCE NOTICE is sent — their copy (email, WhatsApp template, in-app
//     banner alike) all states that order handling pauses, which it does not.
// Metering is untouched: every order still spends a credit and the ledger
// still runs negative, so the history the per-order rule needs is accruing.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ensureCreditAccount } from "./credits";
import { CREDIT_LOCK_ENABLED } from "./lib/credits";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}
type T = ReturnType<typeof setup>;

const OWNER = "user_lockoff_owner";
const ADMIN = "user_lockoff_admin";
const OCT_10 = Date.parse("2026-10-10T12:00:00+08:00");

let prevAdminEnv: string | undefined;
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(OCT_10);
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	vi.useRealTimers();
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

async function store(t: T) {
	const slug = "lockoff-store";
	await t
		.withIdentity({ subject: OWNER })
		.mutation(api.retailers.createRetailer, { storeName: "Lock Off", slug });
	const ids = await t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		const s = r
			? await ctx.db
					.query("subscriptions")
					.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
					.first()
			: null;
		if (!r || !s) throw new Error("seed");
		await ctx.db.patch(s._id, { status: "active", plan: "starter" });
		const a = await ctx.db
			.query("creditAccounts")
			.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
			.first();
		if (a) await ctx.db.delete(a._id);
		for (const row of await ctx.db
			.query("creditLedger")
			.withIndex("by_retailer_created", (q) => q.eq("retailerId", r._id))
			.collect())
			await ctx.db.delete(row._id);
		await ensureCreditAccount(ctx, r._id, Date.now());
		return { retailerId: r._id, subId: s._id };
	});
	const productId = await t
		.withIdentity({ subject: OWNER })
		.mutation(api.products.create, {
			retailerId: ids.retailerId,
			name: "Kuih Box",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			blockWhenOutOfStock: false,
			requiresProof: false,
			variants: [{ optionValues: [], price: 2500, onHand: 100 }],
		});
	return { ...ids, productId };
}

/** Drive the store's total to exactly `total` through the admin ledger path. */
async function setBalance(t: T, retailerId: Id<"retailers">, total: number) {
	const a = await t.run((ctx) =>
		ctx.db
			.query("creditAccounts")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first(),
	);
	const delta = total - ((a?.planBalance ?? 0) + (a?.purchasedBalance ?? 0));
	if (delta !== 0)
		await t.withIdentity({ subject: ADMIN }).mutation(api.credits.adminAdjust, {
			retailerId,
			bucket: "plan",
			amount: delta,
			note: "test balance",
		});
}

async function storefrontOrder(
	t: T,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
) {
	const { shortId } = await t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Aisha", waPhone: "60123456789" },
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
			.unique(),
	);
	if (!order) throw new Error("order");
	return order;
}

describe("the seller lock ships switched off", () => {
	test("the constant is off — the whole point of this file", () => {
		// Stated as its own assertion so flipping the switch on without reading
		// this file fails here, naming the decision, rather than somewhere
		// downstream looking like an unrelated breakage.
		expect(CREDIT_LOCK_ENABLED).toBe(false);
	});

	test("a store deep in debt is not locked, and every guarded write still works", async () => {
		const t = setup();
		const { retailerId, productId } = await store(t);
		const order = await storefrontOrder(t, retailerId, productId);
		await setBalance(t, retailerId, -25);

		const asOwner = t.withIdentity({ subject: OWNER });
		// The dashboard payload carries the lock to every teammate — the same
		// resolver the server guards read, so this is both halves at once.
		const me = await asOwner.query(api.retailers.getMyRetailer, {});
		expect(me?.creditLock?.locked).toBe(false);

		// One write from each class the lock would have refused: moving an
		// order forward, taking payment by hand, and editing the catalogue.
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "confirmed",
		});
		await asOwner.mutation(api.orders.markPaymentReceived, {
			orderId: order._id,
		});
		await asOwner.mutation(api.products.update, {
			productId,
			name: "Kuih Box (big)",
		});

		const after = await t.run((ctx) => ctx.db.get(order._id));
		expect(after?.status).toBe("confirmed");
	});

	test("order intake still SPENDS a credit — the debt the per-order rule will read keeps accruing", async () => {
		const t = setup();
		const { retailerId, productId } = await store(t);
		await setBalance(t, retailerId, 0);
		await storefrontOrder(t, retailerId, productId);

		const account = await t.run((ctx) =>
			ctx.db
				.query("creditAccounts")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first(),
		);
		expect((account?.planBalance ?? 0) + (account?.purchasedBalance ?? 0)).toBe(
			-1,
		);
		const debits = await t.run((ctx) =>
			ctx.db
				.query("creditLedger")
				.withIndex("by_retailer_created", (q) => q.eq("retailerId", retailerId))
				.collect(),
		);
		const debit = debits.find((r) => r.type === "debit");
		// orderId + the running balance after the row ARE the per-order funding
		// history, written from day one so the model needs no backfill.
		expect(debit?.orderId).toBeTruthy();
		expect(debit?.planAfter).toBe(-1);
	});

	test("no balance notice is sent, and no notice marker is written", async () => {
		const t = setup();
		const { retailerId } = await store(t);
		await setBalance(t, retailerId, -3);

		const kind = await t.mutation(internal.creditNotices.evaluate, {
			retailerId,
			route: "topup",
		});
		expect(kind).toBeNull();

		// Nothing recorded as "sent": the day the lock turns on, this store is
		// announced to cleanly instead of carrying a marker for an email it
		// never received.
		const account = await t.run((ctx) =>
			ctx.db
				.query("creditAccounts")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first(),
		);
		expect(account?.notices).toBeUndefined();
	});

	test("running low is silent too — its copy promises a pause that cannot happen", async () => {
		const t = setup();
		const { retailerId } = await store(t);
		// Starter grants 100; 10 left is inside the last fifth.
		await setBalance(t, retailerId, 10);
		expect(
			await t.mutation(internal.creditNotices.evaluate, {
				retailerId,
				route: "topup",
			}),
		).toBeNull();
	});
});
