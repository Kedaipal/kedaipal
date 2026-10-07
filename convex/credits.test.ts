/// <reference types="vite/client" />
// Kedaipal Credits T1 (86eye2ccu, docs/credits.md): the order-credit ledger —
// accounts, the debit on every order, the "never got going" refund rule, the
// monthly refresh by subscription status, billing lifecycle grants, admin
// adjustments, lot expiry, the backfill and the audit.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	addPurchasedCredits,
	debitCreditForOrder,
	ensureCreditAccount,
	refundCreditForOrder,
} from "./credits";
import type { CancelCause } from "./lib/credits";
import type { Plan } from "./lib/plans";
import { SELLER_CANCEL_REFUNDS_PER_PERIOD } from "./lib/plans";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}
type T = ReturnType<typeof setup>;

const OWNER = "user_credits_owner";
const ADMIN = "user_credits_admin";
const MEMBER = "user_credits_member";
const DAY = 24 * 60 * 60 * 1000;
/** Noon MYT on 10 Oct 2026 — mid-month, far from any boundary. */
const OCT_10 = Date.parse("2026-10-10T12:00:00+08:00");
/** 00:10 MYT on 1 Nov 2026 — just past the boundary, after the 00:05 sweep. */
const NOV_1 = Date.parse("2026-11-01T00:10:00+08:00");

let prevAdminEnv: string | undefined;
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(OCT_10);
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function signUp(t: T, userId = OWNER) {
	const slug = `cr-${userId.replace(/[^a-z0-9]/g, "")}`;
	await t
		.withIdentity({ subject: userId })
		.mutation(api.retailers.createRetailer, { storeName: `Store ${slug}`, slug });
	return t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.first();
		const sub = r
			? await ctx.db
					.query("subscriptions")
					.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
					.first()
			: null;
		if (!r || !sub) throw new Error("seed failed");
		return { retailerId: r._id, subId: sub._id };
	});
}

/** A store on a given status/plan, with its credit account opened FRESH under
 * that state (the signup account is the trial's, so it's discarded). */
async function makeStore(
	t: T,
	sub: Partial<Doc<"subscriptions">>,
	opts: { userId?: string; founding?: boolean } = {},
) {
	const ids = await signUp(t, opts.userId ?? OWNER);
	await t.run(async (ctx) => {
		await ctx.db.patch(ids.subId, sub);
		if (opts.founding)
			await ctx.db.patch(ids.retailerId, { isFoundingMember: true });
		for (const row of await ctx.db
			.query("creditLedger")
			.withIndex("by_retailer_created", (q) => q.eq("retailerId", ids.retailerId))
			.collect())
			await ctx.db.delete(row._id);
		const account = await ctx.db
			.query("creditAccounts")
			.withIndex("by_retailer", (q) => q.eq("retailerId", ids.retailerId))
			.first();
		if (account) await ctx.db.delete(account._id);
		await ensureCreditAccount(ctx, ids.retailerId, Date.now());
	});
	return ids;
}

const account = (t: T, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("creditAccounts")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first(),
	);

const ledger = (t: T, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("creditLedger")
			.withIndex("by_retailer_created", (q) => q.eq("retailerId", retailerId))
			.collect(),
	);

const lots = (t: T, retailerId: Id<"retailers">) =>
	t.run((ctx) =>
		ctx.db
			.query("creditLots")
			.withIndex("by_retailer_open_expiry", (q) => q.eq("retailerId", retailerId))
			.collect(),
	);

let orderSeq = 0;
async function rawOrder(
	t: T,
	retailerId: Id<"retailers">,
	status: Doc<"orders">["status"] = "pending",
) {
	orderSeq += 1;
	const shortId = `ORD-C${String(orderSeq).padStart(3, "0")}`;
	const orderId = await t.run((ctx) => {
		const now = Date.now();
		return ctx.db.insert("orders", {
			retailerId,
			shortId,
			items: [],
			subtotal: 1000,
			total: 1000,
			currency: "MYR",
			status,
			channel: "whatsapp",
			customer: { name: "Aina" },
			deliveryMethod: "delivery",
			createdAt: now,
			updatedAt: now,
		});
	});
	return { orderId, shortId };
}

/** An order created AND debited through the seam every channel uses. */
async function order(
	t: T,
	retailerId: Id<"retailers">,
	status: Doc<"orders">["status"] = "pending",
) {
	const o = await rawOrder(t, retailerId, status);
	await t.run((ctx) =>
		debitCreditForOrder(ctx, {
			retailerId,
			orderId: o.orderId,
			orderShortId: o.shortId,
			now: Date.now(),
		}),
	);
	return o;
}

async function cancel(t: T, orderId: Id<"orders">, cause: CancelCause) {
	await t.run(async (ctx) => {
		const o = await ctx.db.get(orderId);
		if (!o) throw new Error("no order");
		await refundCreditForOrder(ctx, { order: o, cause, now: Date.now() });
		await ctx.db.patch(orderId, { status: "cancelled" });
	});
}

/** Settle a plan invoice exactly the way money lands (the admin mark-paid
 * path shares `settleInvoicePaid` with every gateway). */
async function pay(
	t: T,
	ids: { retailerId: Id<"retailers">; subId: Id<"subscriptions"> },
	plan: Plan,
	opts: { cycle?: "monthly" | "annual"; kind?: "plan" | "hold" } = {},
) {
	const invoiceId = await t.run((ctx) => {
		const now = Date.now();
		return ctx.db.insert("invoices", {
			retailerId: ids.retailerId,
			subscriptionId: ids.subId,
			invoiceNumber: `INV-CR-${now}-${Math.random()}`,
			plan,
			billingCycle: opts.cycle ?? "monthly",
			kind: opts.kind,
			amount: 1000,
			total: 1000,
			currency: "MYR",
			periodStart: now,
			periodEnd: now + 30 * DAY,
			dueDate: now + 14 * DAY,
			status: "pending",
			createdAt: now,
		});
	});
	await t
		.withIdentity({ subject: ADMIN })
		.mutation(api.invoices.markPaid, { invoiceId });
}

async function adjust(
	t: T,
	retailerId: Id<"retailers">,
	bucket: "plan" | "purchased",
	amount: number,
	note = "test adjustment",
) {
	return t
		.withIdentity({ subject: ADMIN })
		.mutation(api.credits.adminAdjust, { retailerId, bucket, amount, note });
}

const balances = async (t: T, retailerId: Id<"retailers">) => {
	const a = await account(t, retailerId);
	return { plan: a?.planBalance, purchased: a?.purchasedBalance };
};

// ---------------------------------------------------------------------------

describe("opening an account", () => {
	test("a new store opens with the one-off trial allowance at signup", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		const a = await account(t, retailerId);
		expect(a).toMatchObject({
			planBalance: 200,
			purchasedBalance: 0,
			periodKey: "2026-10",
			periodGrant: 200,
		});
		const rows = await ledger(t, retailerId);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			type: "grant",
			bucket: "plan",
			amount: 200,
			reason: "trial",
			planAfter: 200,
		});
	});

	test("an account opens with what the status earns today — no welcome credits", async () => {
		const t = setup();
		const starter = await makeStore(t, { status: "active", plan: "starter" });
		expect(await balances(t, starter.retailerId)).toEqual({ plan: 100, purchased: 0 });
		const pro = await makeStore(
			t,
			{ status: "active", plan: "pro" },
			{ userId: "user_credits_pro" },
		);
		expect(await balances(t, pro.retailerId)).toEqual({ plan: 200, purchased: 0 });
		const lapsed = await makeStore(
			t,
			{ status: "past_due", plan: "pro" },
			{ userId: "user_credits_lapsed" },
		);
		const a = await account(t, lapsed.retailerId);
		expect(a).toMatchObject({ planBalance: 0, periodGrant: 0 });
		expect(a?.exhaustedAt).toBe(OCT_10);
		expect(await ledger(t, lapsed.retailerId)).toHaveLength(0);
	});
});

describe("debit on order creation", () => {
	test("a storefront order uses one credit through the real checkout", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		const productId = await t
			.withIdentity({ subject: OWNER })
			.mutation(api.products.create, {
				retailerId,
				name: "Kuih Box",
				currency: "MYR",
				imageStorageIds: [],
				sortOrder: 0,
				blockWhenOutOfStock: false,
				requiresProof: false,
				variants: [{ optionValues: [], price: 2500, onHand: 100 }],
			});
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
		expect(await balances(t, retailerId)).toEqual({ plan: 199, purchased: 0 });
		const debit = (await ledger(t, retailerId)).find((r) => r.type === "debit");
		expect(debit).toMatchObject({
			bucket: "plan",
			amount: -1,
			reason: "order",
			refLabel: shortId,
			periodKey: "2026-10",
		});
		expect(debit?.refId).toBe(debit?.orderId);
	});

	test("idempotent: a retried debit for the same order charges once", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		const o = await order(t, retailerId);
		await t.run((ctx) =>
			debitCreditForOrder(ctx, {
				retailerId,
				orderId: o.orderId,
				orderShortId: o.shortId,
				now: Date.now(),
			}),
		);
		expect(await balances(t, retailerId)).toEqual({ plan: 199, purchased: 0 });
	});

	test("plan first, then the OLDEST purchased lot, then the plan bucket goes below zero", async () => {
		const t = setup();
		const { retailerId } = await makeStore(t, { status: "active", plan: "starter" });
		await adjust(t, retailerId, "plan", -99); // plan 1
		await adjust(t, retailerId, "purchased", 2); // lot A
		vi.setSystemTime(OCT_10 + DAY);
		await adjust(t, retailerId, "purchased", 2); // lot B, expires a day later

		const buckets: string[] = [];
		for (let i = 0; i < 6; i++) {
			const o = await order(t, retailerId);
			const row = (await ledger(t, retailerId)).find(
				(r) => r.type === "debit" && r.orderId === o.orderId,
			);
			buckets.push(row?.bucket ?? "?");
		}
		expect(buckets).toEqual([
			"plan",
			"purchased",
			"purchased",
			"purchased",
			"purchased",
			"plan",
		]);
		expect(await balances(t, retailerId)).toEqual({ plan: -1, purchased: 0 });
		const [a, b] = (await lots(t, retailerId)).sort((x, y) => x.expiresAt - y.expiresAt);
		expect(a).toMatchObject({ remaining: 0, open: false });
		expect(b).toMatchObject({ remaining: 0, open: false });
	});

	test("the balance may go below zero — the order still goes through; exhaustedAt marks it and clears on the way back", async () => {
		const t = setup();
		const { retailerId } = await makeStore(t, { status: "active", plan: "starter" });
		await adjust(t, retailerId, "plan", -100); // exactly zero
		const zero = await account(t, retailerId);
		expect(zero?.exhaustedAt).toBe(OCT_10);
		await order(t, retailerId);
		await order(t, retailerId);
		expect(await balances(t, retailerId)).toEqual({ plan: -2, purchased: 0 });
		// A pack nets against the debt: the meter reads the SUM.
		await adjust(t, retailerId, "purchased", 50);
		const a = await account(t, retailerId);
		expect((a?.planBalance ?? 0) + (a?.purchasedBalance ?? 0)).toBe(48);
		expect(a?.exhaustedAt).toBeUndefined();
	});

	test("non-transferable: one store's orders never touch another store's balance", async () => {
		const t = setup();
		const a = await signUp(t, OWNER);
		const b = await signUp(t, "user_credits_other");
		await order(t, a.retailerId);
		await order(t, a.retailerId);
		expect(await balances(t, a.retailerId)).toEqual({ plan: 198, purchased: 0 });
		expect(await balances(t, b.retailerId)).toEqual({ plan: 200, purchased: 0 });
	});
});

describe("refunds — only an order that never got going", () => {
	test("a seller cancelling a NEW order through the dashboard gets the credit back", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		const o = await order(t, retailerId, "pending");
		await t
			.withIdentity({ subject: OWNER })
			.mutation(api.orders.updateStatus, { orderId: o.orderId, status: "cancelled" });
		expect(await balances(t, retailerId)).toEqual({ plan: 200, purchased: 0 });
		const refund = (await ledger(t, retailerId)).find((r) => r.type === "refund");
		expect(refund).toMatchObject({ bucket: "plan", amount: 1, cause: "seller" });
		expect((await account(t, retailerId))?.sellerRefunds).toEqual({
			periodKey: "2026-10",
			count: 1,
		});
	});

	test("a seller cancelling an ACCEPTED order keeps the credit spent", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		const o = await order(t, retailerId, "pending");
		const asOwner = t.withIdentity({ subject: OWNER });
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: o.orderId,
			status: "confirmed",
		});
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: o.orderId,
			status: "cancelled",
		});
		expect(await balances(t, retailerId)).toEqual({ plan: 199, purchased: 0 });
		expect((await ledger(t, retailerId)).some((r) => r.type === "refund")).toBe(false);
	});

	test("the monthly allowance: only the first ten seller refunds come back", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		const orders = [];
		for (let i = 0; i <= SELLER_CANCEL_REFUNDS_PER_PERIOD; i++)
			orders.push(await order(t, retailerId, "pending"));
		for (const o of orders) await cancel(t, o.orderId, "seller");
		const refunds = (await ledger(t, retailerId)).filter((r) => r.type === "refund");
		expect(refunds).toHaveLength(SELLER_CANCEL_REFUNDS_PER_PERIOD);
		expect((await account(t, retailerId))?.planBalance).toBe(199);
	});

	test("the allowance resets with the period", async () => {
		const t = setup();
		const { retailerId } = await makeStore(t, { status: "active", plan: "pro" });
		for (let i = 0; i < SELLER_CANCEL_REFUNDS_PER_PERIOD; i++) {
			const o = await order(t, retailerId);
			await cancel(t, o.orderId, "seller");
		}
		vi.setSystemTime(NOV_1);
		const o = await order(t, retailerId);
		await cancel(t, o.orderId, "seller");
		expect((await account(t, retailerId))?.sellerRefunds).toEqual({
			periodKey: "2026-11",
			count: 1,
		});
	});

	test("the system, the buyer and an admin always give it back — even an accepted order, outside the allowance", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		for (const cause of ["system", "buyer", "admin"] as const) {
			const o = await order(t, retailerId, "confirmed");
			await cancel(t, o.orderId, cause);
		}
		expect((await account(t, retailerId))?.planBalance).toBe(200);
		expect((await account(t, retailerId))?.sellerRefunds).toBeUndefined();
	});

	test("an admin hard-deleting a live order gives its credit back", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		const o = await order(t, retailerId, "confirmed");
		await t
			.withIdentity({ subject: ADMIN })
			.mutation(api.orders.deleteOrder, { orderId: o.orderId });
		expect((await account(t, retailerId))?.planBalance).toBe(200);
		const refund = (await ledger(t, retailerId)).find((r) => r.type === "refund");
		expect(refund?.cause).toBe("admin");
	});

	test("a cancel never mints a credit: an order that was never debited refunds nothing", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		const o = await rawOrder(t, retailerId, "pending"); // created before credits
		await cancel(t, o.orderId, "system");
		expect((await account(t, retailerId))?.planBalance).toBe(200);
		expect((await ledger(t, retailerId)).some((r) => r.type === "refund")).toBe(false);
	});

	test("refunding the same order twice is a no-op", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		const o = await order(t, retailerId, "pending");
		await cancel(t, o.orderId, "system");
		await t.run(async (ctx) => {
			const cancelled = await ctx.db.get(o.orderId);
			if (!cancelled) throw new Error("gone");
			await refundCreditForOrder(ctx, {
				order: { ...cancelled, status: "pending" },
				cause: "system",
				now: Date.now(),
			});
		});
		expect((await account(t, retailerId))?.planBalance).toBe(200);
		expect((await ledger(t, retailerId)).filter((r) => r.type === "refund")).toHaveLength(1);
	});

	test("a purchased credit goes back into the lot it came from", async () => {
		const t = setup();
		const { retailerId } = await makeStore(t, { status: "active", plan: "starter" });
		await adjust(t, retailerId, "plan", -100);
		await adjust(t, retailerId, "purchased", 5);
		const o = await order(t, retailerId);
		expect((await lots(t, retailerId))[0]?.remaining).toBe(4);
		await cancel(t, o.orderId, "system");
		expect((await lots(t, retailerId))[0]).toMatchObject({ remaining: 5, open: true });
		expect(await balances(t, retailerId)).toEqual({ plan: 0, purchased: 5 });
	});
});

describe("usage periods", () => {
	test("at the boundary a positive leftover is forfeited (no rollover) and the new grant lands", async () => {
		const t = setup();
		const { retailerId } = await makeStore(t, { status: "active", plan: "starter" });
		for (let i = 0; i < 30; i++) await order(t, retailerId);
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		const a = await account(t, retailerId);
		expect(a).toMatchObject({ planBalance: 100, periodKey: "2026-11", periodGrant: 100 });
		const rows = await ledger(t, retailerId);
		const forfeit = rows.find((r) => r.type === "expire");
		expect(forfeit).toMatchObject({ amount: -70, reason: "plan", periodKey: "2026-10" });
		expect(rows.at(-1)).toMatchObject({ type: "grant", amount: 100, periodKey: "2026-11" });
	});

	test("a debt carries into the refresh — at -15, Starter refreshes to 85", async () => {
		const t = setup();
		const { retailerId } = await makeStore(t, { status: "active", plan: "starter" });
		await adjust(t, retailerId, "plan", -115);
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect((await account(t, retailerId))?.planBalance).toBe(85);
	});

	test("an order on the 1st rolls its own account before the sweep runs", async () => {
		const t = setup();
		const { retailerId } = await makeStore(t, { status: "active", plan: "pro" });
		await order(t, retailerId);
		vi.setSystemTime(Date.parse("2026-11-01T00:01:00+08:00"));
		await order(t, retailerId);
		expect(await account(t, retailerId)).toMatchObject({
			planBalance: 199,
			periodKey: "2026-11",
		});
	});

	test("the one-off trial allowance is NOT re-granted at a month boundary", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		for (let i = 0; i < 20; i++) await order(t, retailerId);
		const before = (await ledger(t, retailerId)).length;
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect(await account(t, retailerId)).toMatchObject({
			planBalance: 180,
			periodKey: "2026-11",
		});
		expect(await ledger(t, retailerId)).toHaveLength(before);
	});

	test("past_due: no grant at the boundary — it lands when the invoice is paid", async () => {
		const t = setup();
		const ids = await makeStore(t, { status: "active", plan: "pro" });
		for (let i = 0; i < 10; i++) await order(t, ids.retailerId);
		await t.run((ctx) => ctx.db.patch(ids.subId, { status: "past_due" }));
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect(await account(t, ids.retailerId)).toMatchObject({
			planBalance: 0,
			periodGrant: 0,
		});
		// Orders keep coming while past_due, and keep debiting.
		await order(t, ids.retailerId);
		await pay(t, ids, "pro");
		expect(await account(t, ids.retailerId)).toMatchObject({
			planBalance: 199,
			periodGrant: 200,
		});
	});

	test("on hold: no grant at the boundary — the full grant lands with the resume", async () => {
		const t = setup();
		const ids = await makeStore(t, {
			status: "on_hold",
			plan: "pro",
			heldAt: OCT_10,
		});
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect((await account(t, ids.retailerId))?.planBalance).toBe(0);
		await t
			.withIdentity({ subject: OWNER })
			.mutation(api.subscriptions.setSeasonalHold, {
				retailerId: ids.retailerId,
				hold: false,
			});
		expect(await account(t, ids.retailerId)).toMatchObject({
			planBalance: 200,
			periodGrant: 200,
		});
	});

	test("a comped store is metered on the monthly grant", async () => {
		const t = setup();
		const comped = await makeStore(t, {
			status: "active",
			plan: "starter",
			comped: true,
		});
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect((await account(t, comped.retailerId))?.planBalance).toBe(100);
	});

	test("founding Pro is granted 300 a month", async () => {
		const t = setup();
		const { retailerId } = await makeStore(
			t,
			{ status: "active", plan: "pro", currentPeriodEnd: OCT_10 + 20 * DAY },
			{ founding: true },
		);
		expect((await account(t, retailerId))?.planBalance).toBe(300);
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect((await account(t, retailerId))?.planBalance).toBe(300);
	});
});

// ---------------------------------------------------------------------------
// Unmetered stores (z8r3fdp4er)
// ---------------------------------------------------------------------------

describe("an admin's own store is unmetered", () => {
	test("signing up opens no credit account, and orders spend nothing", async () => {
		const t = setup();
		const admin = await signUp(t, ADMIN);
		for (let i = 0; i < 5; i++) await order(t, admin.retailerId);
		expect(await account(t, admin.retailerId)).toBeNull();
		expect(await ledger(t, admin.retailerId)).toHaveLength(0);
	});

	test("a LEGACY account stops being debited the moment the gate lands", async () => {
		// The path that bites: `ensureCreditAccount` used to shortcut on an
		// existing row before it ever asked for a regime, so a store metered
		// before this change would have kept spending. Seeded by hand because
		// no code path can open one for an admin store any more.
		const t = setup();
		const admin = await signUp(t, ADMIN);
		await t.run((ctx) =>
			ctx.db.insert("creditAccounts", {
				retailerId: admin.retailerId,
				planBalance: 200,
				purchasedBalance: 0,
				periodKey: "2026-09",
				periodGrant: 200,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}),
		);
		await order(t, admin.retailerId);
		expect((await account(t, admin.retailerId))?.planBalance).toBe(200);
		expect(await ledger(t, admin.retailerId)).toHaveLength(0);
		// And the monthly sweep lands no grant on it either.
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		const rolled = await account(t, admin.retailerId);
		expect(rolled?.periodKey).toBe("2026-09");
		expect(rolled?.planBalance).toBe(200);
	});

	test("cancelling an order on a legacy account refunds nothing into it", async () => {
		const t = setup();
		const admin = await signUp(t, ADMIN);
		await t.run((ctx) =>
			ctx.db.insert("creditAccounts", {
				retailerId: admin.retailerId,
				planBalance: 10,
				purchasedBalance: 0,
				periodKey: "2026-10",
				periodGrant: 200,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}),
		);
		const o = await order(t, admin.retailerId);
		await cancel(t, o.orderId, "seller");
		expect((await account(t, admin.retailerId))?.planBalance).toBe(10);
		expect(await ledger(t, admin.retailerId)).toHaveLength(0);
	});

	test("the balance and the activity list are empty, so every meter hides", async () => {
		const t = setup();
		await signUp(t, ADMIN);
		const asAdmin = t.withIdentity({ subject: ADMIN });
		expect(await asAdmin.query(api.credits.getBalance, {})).toBeNull();
		const activity = await asAdmin.query(api.credits.listActivity, {
			paginationOpts: { numItems: 10, cursor: null },
		});
		expect(activity.page).toHaveLength(0);
		// ...and the seller lock can never close on it (the dashboard reads the
		// resolver's answer off the retailer payload).
		const me = await asAdmin.query(api.retailers.getMyRetailer, {});
		expect(me?.creditLock?.locked ?? false).toBe(false);
	});

	test("the admin levers refuse it by name, not with \"Store not found\"", async () => {
		const t = setup();
		const admin = await signUp(t, ADMIN);
		const asAdmin = t.withIdentity({ subject: ADMIN });
		await expect(
			asAdmin.mutation(api.credits.adminAdjust, {
				retailerId: admin.retailerId,
				bucket: "plan",
				amount: 50,
				note: "goodwill",
			}),
		).rejects.toThrow(/aren't metered/);
		await expect(
			asAdmin.mutation(api.credits.adminSetGrantOverride, {
				retailerId: admin.retailerId,
				grant: 500,
			}),
		).rejects.toThrow(/aren't metered/);
	});

	test("a SELLER store is untouched by all of it", async () => {
		const t = setup();
		const seller = await makeStore(t, { status: "active", plan: "pro" });
		await order(t, seller.retailerId);
		expect((await account(t, seller.retailerId))?.planBalance).toBe(199);
		expect(await ledger(t, seller.retailerId)).not.toHaveLength(0);
	});
});

describe("the unmetered purge (operator cleanup)", () => {
	test("dry run reports and deletes nothing; apply clears the store", async () => {
		const t = setup();
		const admin = await signUp(t, ADMIN);
		const seller = await makeStore(t, { status: "active", plan: "pro" });
		await order(t, seller.retailerId);
		await t.run((ctx) =>
			ctx.db.insert("creditAccounts", {
				retailerId: admin.retailerId,
				planBalance: 200,
				purchasedBalance: 0,
				periodKey: "2026-09",
				periodGrant: 200,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}),
		);
		const dry = await t.mutation(internal.migrations.purgeUnmeteredCreditData, {});
		expect(dry.applied).toBe(false);
		expect(dry.stores.map((s) => s.retailerId)).toEqual([admin.retailerId]);
		expect(await account(t, admin.retailerId)).not.toBeNull();

		const applied = await t.mutation(
			internal.migrations.purgeUnmeteredCreditData,
			{ apply: true, retailerIds: dry.stores.map((s) => s.retailerId) },
		);
		expect(applied.applied).toBe(true);
		expect(await account(t, admin.retailerId)).toBeNull();
		// The seller's ledger is never in scope, whatever the flag says.
		expect(await account(t, seller.retailerId)).not.toBeNull();
		expect(await ledger(t, seller.retailerId)).not.toHaveLength(0);
	});

	test("deleting without naming the stores is refused", async () => {
		// The unmetered check alone can't protect the dangerous direction of a
		// mis-set ADMIN_USER_IDS — a seller's id wrongly added makes their
		// store unmetered, and a purge keyed on the same answer would select
		// it. Naming the ids forces the operator through the dry run.
		const t = setup();
		const admin = await signUp(t, ADMIN);
		await t.run((ctx) =>
			ctx.db.insert("creditAccounts", {
				retailerId: admin.retailerId,
				planBalance: 200,
				purchasedBalance: 0,
				periodKey: "2026-09",
				periodGrant: 200,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}),
		);
		await expect(
			t.mutation(internal.migrations.purgeUnmeteredCreditData, {
				apply: true,
			}),
		).rejects.toThrow(/needs the stores named/);
		expect(await account(t, admin.retailerId)).not.toBeNull();
	});

	test("a named id that isn't unmetered rolls the whole run back", async () => {
		const t = setup();
		const admin = await signUp(t, ADMIN);
		const seller = await makeStore(t, { status: "active", plan: "pro" });
		await t.run((ctx) =>
			ctx.db.insert("creditAccounts", {
				retailerId: admin.retailerId,
				planBalance: 200,
				purchasedBalance: 0,
				periodKey: "2026-09",
				periodGrant: 200,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}),
		);
		await expect(
			t.mutation(internal.migrations.purgeUnmeteredCreditData, {
				apply: true,
				retailerIds: [admin.retailerId, seller.retailerId],
			}),
		).rejects.toThrow(/not unmetered stores/);
		// All-or-nothing: the admin store's rows survive the rollback, so a
		// fat-fingered id can never half-purge the book.
		expect(await account(t, admin.retailerId)).not.toBeNull();
		expect(await account(t, seller.retailerId)).not.toBeNull();
	});
});

describe("billing lifecycle", () => {
	test("a trial converting to Starter: the trial's leftover goes and Starter's 100 lands", async () => {
		const t = setup();
		const ids = await signUp(t);
		for (let i = 0; i < 150; i++) await order(t, ids.retailerId);
		await pay(t, ids, "starter");
		expect(await account(t, ids.retailerId)).toMatchObject({
			planBalance: 100,
			periodGrant: 100,
		});
		const rows = await ledger(t, ids.retailerId);
		expect(rows.find((r) => r.type === "expire")).toMatchObject({
			amount: -50,
			reason: "trial",
		});
	});

	test("subscribing always unlocks a trial that ran out — a trial debt carries, nothing more", async () => {
		const t = setup();
		const ids = await signUp(t);
		for (let i = 0; i < 205; i++) await order(t, ids.retailerId);
		expect((await account(t, ids.retailerId))?.exhaustedAt).toBeDefined();
		await pay(t, ids, "pro");
		const a = await account(t, ids.retailerId);
		expect(a?.planBalance).toBe(195);
		expect(a?.exhaustedAt).toBeUndefined();
	});

	test("annual subscribers are granted monthly, never 12 months upfront", async () => {
		const t = setup();
		const ids = await makeStore(t, { status: "active", plan: "pro" });
		await pay(t, ids, "pro", { cycle: "annual" });
		expect((await account(t, ids.retailerId))?.planBalance).toBe(200);
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect((await account(t, ids.retailerId))?.planBalance).toBe(200);
	});

	test("an annual payment locks its grant for the prepaid term; renewal picks up the current one", async () => {
		const t = setup();
		const ids = await makeStore(t, { status: "active", plan: "pro" });
		await pay(t, ids, "pro", { cycle: "annual" });
		const locked = await account(t, ids.retailerId);
		expect(locked?.annualGrant?.grant).toBe(200);
		// Simulate "the constant changed after they paid": the lock still says
		// 250, and inside the term the lock wins over today's table.
		await t.run((ctx) =>
			ctx.db.patch(locked!._id, {
				annualGrant: { grant: 250, until: locked!.annualGrant!.until },
			}),
		);
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect((await account(t, ids.retailerId))?.planBalance).toBe(250);
		// Past the term, today's grant applies.
		vi.setSystemTime(locked!.annualGrant!.until + 40 * DAY);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect((await account(t, ids.retailerId))?.planBalance).toBe(200);
	});

	test("an upgrade mid-period gets the difference now (Starter → Pro)", async () => {
		const t = setup();
		const ids = await makeStore(t, { status: "active", plan: "starter" });
		for (let i = 0; i < 50; i++) await order(t, ids.retailerId);
		await pay(t, ids, "pro");
		expect(await account(t, ids.retailerId)).toMatchObject({
			planBalance: 150,
			periodGrant: 200,
		});
	});

	test("a downgrade waits for the next period and never takes credits back mid-month", async () => {
		const t = setup();
		const ids = await makeStore(t, { status: "active", plan: "pro" });
		for (let i = 0; i < 50; i++) await order(t, ids.retailerId);
		await pay(t, ids, "starter");
		expect(await account(t, ids.retailerId)).toMatchObject({
			planBalance: 150,
			periodGrant: 200,
		});
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect((await account(t, ids.retailerId))?.planBalance).toBe(100);
	});

	test("a hold invoice grants nothing", async () => {
		const t = setup();
		const ids = await makeStore(t, { status: "on_hold", plan: "pro" });
		await pay(t, ids, "pro", { kind: "hold" });
		expect((await account(t, ids.retailerId))?.planBalance).toBe(0);
	});
});

describe("admin", () => {
	test("adjusting needs an admin and a note, and is audited", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		await expect(
			t.withIdentity({ subject: OWNER }).mutation(api.credits.adminAdjust, {
				retailerId,
				bucket: "plan",
				amount: 10,
				note: "please",
			}),
		).rejects.toThrow();
		await expect(adjust(t, retailerId, "plan", 10, "  ")).rejects.toThrow(/note/);
		await expect(adjust(t, retailerId, "plan", 1.5)).rejects.toThrow(/whole number/);
		await adjust(t, retailerId, "plan", 10, "Outage goodwill");
		expect((await account(t, retailerId))?.planBalance).toBe(210);
		const row = (await ledger(t, retailerId)).at(-1);
		expect(row).toMatchObject({ type: "adjust", note: "Outage goodwill", createdBy: ADMIN });
		const audit = await t.run((ctx) =>
			ctx.db
				.query("adminAuditLog")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect(),
		);
		expect(audit.map((a) => a.action)).toContain("credits.adminAdjust");
	});

	test("purchased additions land as a 12-month lot; removals take the oldest first and never overdraw", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		await adjust(t, retailerId, "purchased", 30);
		const [lot] = await lots(t, retailerId);
		expect(lot).toMatchObject({ credits: 30, remaining: 30, source: "adjust" });
		expect(lot?.expiresAt).toBe(Date.parse("2027-10-10T12:00:00+08:00"));
		await expect(adjust(t, retailerId, "purchased", -31)).rejects.toThrow(/at most/);
		await adjust(t, retailerId, "purchased", -10);
		expect(await balances(t, retailerId)).toEqual({ plan: 200, purchased: 20 });
		expect((await lots(t, retailerId))[0]?.remaining).toBe(20);
	});

	test("a custom grant beats the tier; a higher one lands its difference now, clearing it waits for the next period", async () => {
		const t = setup();
		// COMPED: since the Enterprise follow-up (z8r3fdkp8h) a recurring
		// custom allowance is only for sponsored or contracted stores — a
		// comp is the sponsored case this behaviour now belongs to.
		const { retailerId } = await makeStore(t, {
			status: "active",
			plan: "starter",
			comped: true,
		});
		const asAdmin = t.withIdentity({ subject: ADMIN });
		await asAdmin.mutation(api.credits.adminSetGrantOverride, { retailerId, grant: 1000 });
		expect(await account(t, retailerId)).toMatchObject({
			planBalance: 1000,
			periodGrant: 1000,
			grantOverride: 1000,
		});
		await asAdmin.mutation(api.credits.adminSetGrantOverride, { retailerId, grant: null });
		expect((await account(t, retailerId))?.planBalance).toBe(1000);
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect((await account(t, retailerId))?.planBalance).toBe(100);
	});

	test("SETTING a custom grant on a listed plan is refused — that deal is a contract now; clearing a stale one still works", async () => {
		// Zaki, 2 Oct 2026: a Pro store with 1,500 credits is an Enterprise
		// deal with no contract record — the contract can carry Pro's exact
		// fee, so "same price, more credits" is a contract too. Comped stays
		// allowed (sponsored); enterprise edits the contract (covered in
		// enterprise.test.ts).
		const t = setup();
		const { retailerId } = await makeStore(t, { status: "active", plan: "pro" });
		const asAdmin = t.withIdentity({ subject: ADMIN });
		await expect(
			asAdmin.mutation(api.credits.adminSetGrantOverride, {
				retailerId,
				grant: 1000,
			}),
		).rejects.toThrow(/contract record/);
		// A grant that predates the rule must never be trapped behind it.
		await t.run(async (ctx) => {
			const acc = await ctx.db
				.query("creditAccounts")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			if (acc) await ctx.db.patch(acc._id, { grantOverride: 1000 });
		});
		await asAdmin.mutation(api.credits.adminSetGrantOverride, {
			retailerId,
			grant: null,
		});
		expect((await account(t, retailerId))?.grantOverride).toBeUndefined();
	});
});

describe("admin totals (Credits T5)", () => {
	test("sums unused bought credits and orders owed across the book — admin only", async () => {
		const t = setup();
		const a = await makeStore(t, { status: "active", plan: "pro" }, {
			userId: "user_totals_a",
		});
		const b = await makeStore(t, { status: "active", plan: "starter" }, {
			userId: "user_totals_b",
		});
		await makeStore(t, { status: "active", plan: "pro" }, {
			userId: "user_totals_c",
		});
		await adjust(t, a.retailerId, "purchased", 50);
		// Starter's 100, 115 used: 15 orders owed.
		await adjust(t, b.retailerId, "plan", -115);

		const totals = await t
			.withIdentity({ subject: ADMIN })
			.query(api.credits.adminCreditTotals, {});
		expect(totals).toEqual({
			purchasedUnused: 50,
			storesWithPurchased: 1,
			ordersOwed: 15,
			storesOwing: 1,
			accounts: 3,
			truncated: false,
		});

		await expect(
			t
				.withIdentity({ subject: OWNER })
				.query(api.credits.adminCreditTotals, {}),
		).rejects.toThrow(/Not authorized/);
	});
});

describe("purchased-credit expiry", () => {
	test("whatever is left of a lot expires 12 months after it landed — one row per lot", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		await t.run((ctx) =>
			addPurchasedCredits(ctx, {
				retailerId,
				credits: 50,
				source: "purchase",
				type: "purchase",
				reason: "purchase",
				refId: "purchase_1",
				createdBy: OWNER,
				now: Date.now(),
			}),
		);
		vi.setSystemTime(Date.parse("2027-10-09T12:00:00+08:00"));
		await t.mutation(internal.credits.internalExpireLots, {});
		expect((await account(t, retailerId))?.purchasedBalance).toBe(50);
		vi.setSystemTime(Date.parse("2027-10-11T00:10:00+08:00"));
		await t.mutation(internal.credits.internalExpireLots, {});
		expect((await account(t, retailerId))?.purchasedBalance).toBe(0);
		const expiry = (await ledger(t, retailerId)).find((r) => r.reason === "expiry");
		expect(expiry).toMatchObject({ type: "expire", bucket: "purchased", amount: -50, refId: "purchase_1" });
		expect((await lots(t, retailerId))[0]).toMatchObject({ remaining: 0, open: false });
	});
});

describe("reads", () => {
	test("the owner reads the balance; a member needs the credits grant", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		const view = await t
			.withIdentity({ subject: OWNER })
			.query(api.credits.getBalance, {});
		expect(view).toMatchObject({
			plan: 200,
			purchased: 0,
			total: 200,
			regime: "trial",
			refreshesAt: null,
			sellerRefundsLeft: SELLER_CANCEL_REFUNDS_PER_PERIOD,
		});
		await t.run((ctx) =>
			ctx.db.insert("retailerMembers", {
				retailerId,
				userId: MEMBER,
				email: "member@example.com",
				status: "active",
				permissions: { orders: "write" },
				invitedBy: OWNER,
				invitedAt: Date.now(),
				acceptedAt: Date.now(),
			}),
		);
		const asMember = t.withIdentity({ subject: MEMBER });
		expect(await asMember.query(api.credits.getBalance, {})).toBeNull();
		await t.run(async (ctx) => {
			const m = await ctx.db
				.query("retailerMembers")
				.withIndex("by_user", (q) => q.eq("userId", MEMBER))
				.first();
			if (m) await ctx.db.patch(m._id, { permissions: { credits: "read" } });
		});
		expect(await asMember.query(api.credits.getBalance, {})).toMatchObject({ total: 200 });
	});

	test("the balance is projected past a boundary the sweep hasn't rolled yet", async () => {
		const t = setup();
		const { retailerId } = await makeStore(t, { status: "active", plan: "starter" });
		for (let i = 0; i < 40; i++) await order(t, retailerId);
		vi.setSystemTime(Date.parse("2026-11-01T00:01:00+08:00"));
		const view = await t
			.withIdentity({ subject: OWNER })
			.query(api.credits.getBalance, {});
		expect(view).toMatchObject({ plan: 100, periodKey: "2026-11", nextGrant: 100 });
		expect(view?.refreshesAt).toBe(Date.parse("2026-12-01T00:00:00+08:00"));
	});

	test("the activity list is newest first and never shows admin notes", async () => {
		const t = setup();
		const { retailerId } = await signUp(t);
		await order(t, retailerId);
		await adjust(t, retailerId, "plan", 5, "internal: comp for the Oct outage");
		const page = await t
			.withIdentity({ subject: OWNER })
			.query(api.credits.listActivity, {
				paginationOpts: { numItems: 10, cursor: null },
			});
		expect(page.page.map((r) => r.type)).toEqual(["adjust", "debit", "grant"]);
		expect(JSON.stringify(page.page)).not.toContain("internal: comp");
	});
});

describe("backfill + audit", () => {
	test("the backfill opens every missing account with what its status earns, once", async () => {
		const t = setup();
		const trial = await signUp(t, OWNER);
		const active = await signUp(t, "user_credits_active");
		await t.run(async (ctx) => {
			await ctx.db.patch(active.subId, { status: "active", plan: "starter" });
			for (const id of [trial.retailerId, active.retailerId]) {
				const a = await ctx.db
					.query("creditAccounts")
					.withIndex("by_retailer", (q) => q.eq("retailerId", id))
					.first();
				if (a) await ctx.db.delete(a._id);
				for (const row of await ctx.db
					.query("creditLedger")
					.withIndex("by_retailer_created", (q) => q.eq("retailerId", id))
					.collect())
					await ctx.db.delete(row._id);
			}
		});
		await t.mutation(internal.migrations.backfillCreditAccounts, {});
		expect((await account(t, trial.retailerId))?.planBalance).toBe(200);
		expect((await account(t, active.retailerId))?.planBalance).toBe(100);
		await t.mutation(internal.migrations.backfillCreditAccounts, {});
		expect(await ledger(t, active.retailerId)).toHaveLength(1);
	});

	test("the cache always agrees with the ledger — and drift is caught and repairable", async () => {
		const t = setup();
		const { retailerId } = await makeStore(t, { status: "active", plan: "pro" });
		await adjust(t, retailerId, "purchased", 20);
		for (let i = 0; i < 5; i++) {
			const o = await order(t, retailerId);
			if (i % 2 === 0) await cancel(t, o.orderId, "system");
		}
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		const clean = await t.mutation(internal.credits.internalRecomputeBalance, {
			retailerId,
		});
		expect(clean.drift).toBe(false);
		const a = await account(t, retailerId);
		await t.run((ctx) => ctx.db.patch(a!._id, { planBalance: 999 }));
		const dirty = await t.mutation(internal.credits.internalRecomputeBalance, {
			retailerId,
			repair: true,
		});
		expect(dirty.drift).toBe(true);
		expect((await account(t, retailerId))?.planBalance).toBe(dirty.ledger.plan);
	});
});

// Every path that can cancel an order must SAY who ended it — the refund rule
// depends on it. The default is the strictest ("seller"), so forgetting can
// only under-refund; this pins that every current caller is explicit anyway.
describe("every cancel names who ended the order", () => {
	test("each applyStatusTransition call that can cancel passes cancelCause", () => {
		const files = ["orders.ts", "bookings.ts", "orderClaims.ts", "lalamove.ts", "delyva.ts"];
		const offenders: string[] = [];
		let checked = 0;
		for (const file of files) {
			const src = readFileSync(resolve(__dirname, file), "utf8");
			const re = /await applyStatusTransition\(([\s\S]*?)\);/g;
			for (const match of src.matchAll(re)) {
				const call = match[1];
				const canCancel = /"cancelled"|\bstatus,/.test(call);
				if (!canCancel) continue;
				checked++;
				if (!/cancelCause:/.test(call)) offenders.push(`${file}: ${call.slice(0, 80)}`);
			}
		}
		expect(checked).toBeGreaterThanOrEqual(5);
		expect(offenders).toEqual([]);
	});
});
