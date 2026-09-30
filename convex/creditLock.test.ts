/// <reference types="vite/client" />
// Credits T3 (z8r3fdf8hy): the seller lock at zero credits + the balance
// notices. Which writes carry the guard is pinned by creditLockCoverage.test.ts;
// this file proves the guard's behaviour end to end.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { addPurchasedCredits, ensureCreditAccount } from "./credits";
import { isCreditLockErrorData } from "./lib/credits";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}
type T = ReturnType<typeof setup>;

const OWNER = "user_lock_owner";
const ADMIN = "user_lock_admin";
const MEMBER = "user_lock_member";
const DAY = 24 * 60 * 60 * 1000;
const OCT_10 = Date.parse("2026-10-10T12:00:00+08:00");
const NOV_1 = Date.parse("2026-11-01T00:10:00+08:00");
const LOCKED = /You're out of credits|Your trial's orders are used up|This store is out of credits/;

/** A locked write refuses with the TYPED lock error — the sentence plus the
 * way back — never a bare string the dashboard can only print. */
async function expectCreditLocked(
	run: () => Promise<unknown>,
	name: string,
): Promise<void> {
	const err = await run().then(
		() => null,
		(e: unknown) => e,
	);
	expect(err, `${name} should refuse`).toBeInstanceOf(ConvexError);
	// convex-test hands `data` back as the JSON the wire carries — once per
	// function boundary it crossed (an action's inner query adds one). The real
	// runtime decodes it at each boundary, so a component gets the object.
	let data: unknown = (err as ConvexError<Value>).data;
	while (typeof data === "string") {
		try {
			data = JSON.parse(data);
		} catch {
			break;
		}
	}
	expect(isCreditLockErrorData(data), `${name} error is typed`).toBe(true);
	if (isCreditLockErrorData(data)) expect(data.message, name).toMatch(LOCKED);
}

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

async function store(
	t: T,
	sub: Partial<Doc<"subscriptions">> = { status: "active", plan: "starter" },
	userId = OWNER,
) {
	const slug = `lk-${userId.replace(/[^a-z0-9]/g, "")}`;
	await t
		.withIdentity({ subject: userId })
		.mutation(api.retailers.createRetailer, { storeName: `Store ${slug}`, slug });
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
		await ctx.db.patch(s._id, sub);
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
		return { retailerId: r._id, subId: s._id, slug };
	});
	const productId = await t
		.withIdentity({ subject: userId })
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
	return { ...ids, productId, userId };
}

/** Bring the store's total to exactly `total` through the admin ledger path. */
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

async function storefrontOrder(t: T, retailerId: Id<"retailers">, productId: Id<"products">) {
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

const total = async (t: T, retailerId: Id<"retailers">) => {
	const a = await t.run((ctx) =>
		ctx.db
			.query("creditAccounts")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first(),
	);
	return (a?.planBalance ?? 0) + (a?.purchasedBalance ?? 0);
};

// ---------------------------------------------------------------------------

describe("the seller lock at zero credits", () => {
	for (const balance of [0, -5]) {
		test(`every kind of locked write refuses at a balance of ${balance}`, async () => {
			const t = setup();
			const s = await store(t);
			const order = await storefrontOrder(t, s.retailerId, s.productId);
			const category = await t
				.withIdentity({ subject: OWNER })
				.mutation(api.categories.create, {
					retailerId: s.retailerId,
					name: "Snacks",
					slug: "snacks",
				})
				.catch(() => null);
			void category;
			await setBalance(t, s.retailerId, balance);
			const asOwner = t.withIdentity({ subject: OWNER });
			const attempts: Array<[string, () => Promise<unknown>]> = [
				[
					"products.create",
					() =>
						asOwner.mutation(api.products.create, {
							retailerId: s.retailerId,
							name: "New",
							currency: "MYR",
							imageStorageIds: [],
							sortOrder: 1,
							variants: [{ optionValues: [], price: 100, onHand: 1 }],
						}),
				],
				[
					"products.archive",
					() => asOwner.mutation(api.products.archive, { productId: s.productId }),
				],
				[
					"categories.create",
					() =>
						asOwner.mutation(api.categories.create, {
							retailerId: s.retailerId,
							name: "Cakes",
							slug: "cakes",
						}),
				],
				[
					"orders.updateStatus → confirmed",
					() =>
						asOwner.mutation(api.orders.updateStatus, {
							orderId: order._id,
							status: "confirmed",
						}),
				],
				[
					"orders.markPaymentReceived",
					() =>
						asOwner.mutation(api.orders.markPaymentReceived, {
							orderId: order._id,
						}),
				],
				[
					"orders.setShipmentTracking",
					() =>
						asOwner.mutation(api.orders.setShipmentTracking, {
							orderId: order._id,
							courierName: "J&T",
							trackingNo: "JT123",
						}),
				],
				[
					"orders.generateReceiptPdf (seller)",
					() =>
						asOwner.action(api.orders.generateReceiptPdf, {
							shortId: order.shortId,
						}),
				],
			];
			for (const [name, run] of attempts) {
				await expectCreditLocked(run, name);
			}
		});
	}

	test("what always stays open: cancel, the buyer's receipt, settings, customers, and every order channel", async () => {
		const t = setup();
		// Pro: the customer notes below are a Pro feature (CRM).
		const s = await store(t, { status: "active", plan: "pro" });
		const order = await storefrontOrder(t, s.retailerId, s.productId);
		await setBalance(t, s.retailerId, 0);
		const asOwner = t.withIdentity({ subject: OWNER });

		// Order intake never stops — and each order still uses a credit.
		const second = await storefrontOrder(t, s.retailerId, s.productId);
		expect(await total(t, s.retailerId)).toBe(-1);

		// Cancel is open (a never-accepted order: its credit comes back).
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: second._id,
			status: "cancelled",
		});
		expect(await total(t, s.retailerId)).toBe(0);

		// The buyer's own copy of the receipt/invoice is never locked.
		const buyerCopy = await t.action(api.orders.generateReceiptPdf, {
			token: order.trackingToken,
		});
		expect(buyerCopy?.filename).toMatch(/ORD-/);

		// Settings stay open.
		await asOwner.mutation(api.retailers.updateSettings, {
			storeDescription: "Still here",
		});
		const customerId = order.customerId;
		if (customerId)
			await asOwner.mutation(api.customers.updateNotes, {
				customerId,
				notes: "Regular",
			});
	});

	test("every buyer surface reads identically at +50 and −50 — buyers never feel a balance", async () => {
		const t = setup();
		const s = await store(t);
		// A live order for the tracking page, placed before the balance moves.
		const order = await storefrontOrder(t, s.retailerId, s.productId);
		const product = await t.run((ctx) => ctx.db.get(s.productId));
		const reads = async () => ({
			store: await t.query(api.retailers.getRetailerBySlug, { slug: s.slug }),
			products: await t.query(api.products.list, { retailerId: s.retailerId }),
			product: await t.query(api.products.getPublicBySlug, {
				retailerId: s.retailerId,
				slug: product?.slug ?? "",
			}),
			categories: await t.query(api.categories.listActivePublic, {
				retailerId: s.retailerId,
			}),
			tracking: await t.query(api.orders.get, { token: order.trackingToken }),
		});
		await setBalance(t, s.retailerId, 50);
		const flush = await reads();
		await setBalance(t, s.retailerId, -50);
		const owed = await reads();
		expect(flush.product).not.toBeNull();
		expect(flush.tracking).not.toBeNull();
		expect(owed).toEqual(flush);
		expect(JSON.stringify(owed)).not.toMatch(/credit/i);
	});

	test("the dashboard payload says locked, why, and how many orders arrived since", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 0);
		vi.setSystemTime(OCT_10 + 60_000);
		await storefrontOrder(t, s.retailerId, s.productId);
		await storefrontOrder(t, s.retailerId, s.productId);
		const me = await t.withIdentity({ subject: OWNER }).query(api.retailers.getMyRetailer, {});
		expect(me?.creditLock).toMatchObject({
			locked: true,
			unlockRoute: "topup",
			since: OCT_10,
			ordersWaiting: 2,
		});
	});

	test("unlocks by every route that puts credits in: top-up, upgrade, refresh, invoice settle", async () => {
		const t = setup();
		const asOwner = () => t.withIdentity({ subject: OWNER });
		const s = await store(t, { status: "active", plan: "pro" });
		const order = await storefrontOrder(t, s.retailerId, s.productId);
		const confirm = () =>
			asOwner().mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "confirmed",
			});

		// Top-up (a pack lands in the purchased bucket).
		await setBalance(t, s.retailerId, 0);
		await expect(confirm()).rejects.toThrow(LOCKED);
		await t.run((ctx) =>
			addPurchasedCredits(ctx, {
				retailerId: s.retailerId,
				credits: 50,
				source: "purchase",
				type: "purchase",
				reason: "purchase",
				refId: "p1",
				createdBy: OWNER,
				now: Date.now(),
			}),
		);
		await confirm();

		// Monthly refresh.
		await setBalance(t, s.retailerId, -5);
		await expect(
			asOwner().mutation(api.orders.markPaymentReceived, { orderId: order._id }),
		).rejects.toThrow(LOCKED);
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		await asOwner().mutation(api.orders.markPaymentReceived, { orderId: order._id });

		// Upgrade (Pro → Scale lands the difference now).
		await setBalance(t, s.retailerId, -5);
		await expect(
			asOwner().mutation(api.products.archive, { productId: s.productId }),
		).rejects.toThrow(LOCKED);
		const invoiceId = await t.run((ctx) =>
			ctx.db.insert("invoices", {
				retailerId: s.retailerId,
				subscriptionId: s.subId,
				invoiceNumber: "INV-LK-UP",
				plan: "scale",
				billingCycle: "monthly",
				amount: 39900,
				total: 39900,
				currency: "MYR",
				periodStart: Date.now(),
				periodEnd: Date.now() + 30 * DAY,
				dueDate: Date.now() + 14 * DAY,
				status: "pending",
				createdAt: Date.now(),
			}),
		);
		await t.withIdentity({ subject: ADMIN }).mutation(api.invoices.markPaid, { invoiceId });
		expect(await total(t, s.retailerId)).toBe(295);
		await asOwner().mutation(api.products.archive, { productId: s.productId });
	});

	test("a trial out of orders is told to pick a plan; paying the first invoice unlocks it", async () => {
		const t = setup();
		const s = await store(t, { status: "trialing", plan: "pro" });
		await setBalance(t, s.retailerId, 0);
		await expect(
			t.withIdentity({ subject: OWNER }).mutation(api.products.archive, {
				productId: s.productId,
			}),
		).rejects.toThrow(/Your trial's orders are used up.*Pick a plan/);
		const invoiceId = await t.run((ctx) =>
			ctx.db.insert("invoices", {
				retailerId: s.retailerId,
				subscriptionId: s.subId,
				invoiceNumber: "INV-LK-1",
				plan: "starter",
				billingCycle: "monthly",
				amount: 7900,
				total: 7900,
				currency: "MYR",
				periodStart: Date.now(),
				periodEnd: Date.now() + 30 * DAY,
				dueDate: Date.now() + 14 * DAY,
				status: "pending",
				createdAt: Date.now(),
			}),
		);
		await t.withIdentity({ subject: ADMIN }).mutation(api.invoices.markPaid, { invoiceId });
		expect(await total(t, s.retailerId)).toBe(100);
		await t.withIdentity({ subject: OWNER }).mutation(api.products.archive, {
			productId: s.productId,
		});
	});

	test("comped and admin-owned stores are metered but never locked", async () => {
		const t = setup();
		const comped = await store(t, { status: "active", plan: "starter", comped: true });
		await setBalance(t, comped.retailerId, -10);
		await t.withIdentity({ subject: OWNER }).mutation(api.products.archive, {
			productId: comped.productId,
		});
		const own = await store(t, { status: "trialing", plan: "pro" }, ADMIN);
		await setBalance(t, own.retailerId, -10);
		await t.withIdentity({ subject: ADMIN }).mutation(api.products.archive, {
			productId: own.productId,
		});
	});

	test("a teammate who can't buy packs is told to ask the owner", async () => {
		const t = setup();
		const s = await store(t);
		await t.run((ctx) =>
			ctx.db.insert("retailerMembers", {
				retailerId: s.retailerId,
				userId: MEMBER,
				email: "m@example.com",
				status: "active",
				permissions: { products: "write" },
				invitedBy: OWNER,
				invitedAt: Date.now(),
				acceptedAt: Date.now(),
			}),
		);
		await setBalance(t, s.retailerId, 0);
		await expect(
			t.withIdentity({ subject: MEMBER }).mutation(api.products.archive, {
				productId: s.productId,
			}),
		).rejects.toThrow(/This store is out of credits.*Ask the store owner/);
	});

	// T2 lets a teammate holding Credits WRITE buy a pack on HitPay's page, so
	// for them a top-up is a way back they can take — the refusal says so, and
	// is typed `member_topup` so the dashboard offers the button.
	test("a teammate holding Credits write is sent to top up, not to the owner", async () => {
		const t = setup();
		const s = await store(t);
		await t.run((ctx) =>
			ctx.db.insert("retailerMembers", {
				retailerId: s.retailerId,
				userId: MEMBER,
				email: "m@example.com",
				status: "active",
				permissions: { products: "write", credits: "write" },
				invitedBy: OWNER,
				invitedAt: Date.now(),
				acceptedAt: Date.now(),
			}),
		);
		await setBalance(t, s.retailerId, 0);
		const err = await t
			.withIdentity({ subject: MEMBER })
			.mutation(api.products.archive, { productId: s.productId })
			.then(
				() => null,
				(e: unknown) => e,
			);
		let data: unknown = (err as ConvexError<Value>).data;
		while (typeof data === "string") data = JSON.parse(data);
		expect(data).toMatchObject({
			kind: "credits_locked",
			audience: "member_topup",
			unlockRoute: "topup",
		});
		expect((data as { message: string }).message).toMatch(
			/This store is out of credits.*Top up in Settings → Billing/,
		);
	});
});

describe("bought credits never stand in for a plan (Zaki × Arif, 16 Sep; restated 1 Oct 2026)", () => {
	test("a past-due store holding 150 bought credits still can't work — it's view-only until it pays", async () => {
		const t = setup();
		const s = await store(t, { status: "active", plan: "pro" });
		const order = await storefrontOrder(t, s.retailerId, s.productId);
		await t.run((ctx) =>
			addPurchasedCredits(ctx, {
				retailerId: s.retailerId,
				credits: 150,
				source: "purchase",
				type: "purchase",
				reason: "purchase",
				refId: "p150",
				createdBy: OWNER,
				now: Date.now(),
			}),
		);
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", s.retailerId))
				.first();
			if (sub) await ctx.db.patch(sub._id, { status: "past_due" });
		});
		const asOwner = t.withIdentity({ subject: OWNER });
		// Plenty of credits — and still refused, by the plan, not the balance.
		expect(await total(t, s.retailerId)).toBeGreaterThan(100);
		await expect(
			asOwner.mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "confirmed",
			}),
		).rejects.toThrow(/subscription is past due, so your store is view-only/);
		await expect(
			asOwner.mutation(api.products.archive, { productId: s.productId }),
		).rejects.toThrow(/view-only/);
		// And no pack can be bought to get round it.
		const options = await asOwner.query(api.creditPurchases.topUpOptions, {});
		expect(options?.refusal).toBe("past_due");
		// Buyers are never affected: the storefront still takes orders.
		await storefrontOrder(t, s.retailerId, s.productId);
	});
});

describe("cancel outlook — the dialog says whether the credit comes back", () => {
	test("new order: comes back; accepted: kept; placed before credits: never charged", async () => {
		const t = setup();
		const s = await store(t);
		const asOwner = t.withIdentity({ subject: OWNER });
		const fresh = await storefrontOrder(t, s.retailerId, s.productId);
		expect(
			await asOwner.query(api.creditLock.cancelOutlook, { orderId: fresh._id }),
		).toEqual({ kind: "refund", refundsLeftAfter: 9 });
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: fresh._id,
			status: "confirmed",
		});
		expect(
			await asOwner.query(api.creditLock.cancelOutlook, { orderId: fresh._id }),
		).toEqual({ kind: "kept", reason: "accepted" });
		const legacy = await t.run((ctx) =>
			ctx.db.insert("orders", {
				retailerId: s.retailerId,
				shortId: "ORD-OLD1",
				items: [],
				subtotal: 100,
				total: 100,
				currency: "MYR",
				status: "pending",
				channel: "whatsapp",
				customer: { name: "Old" },
				deliveryMethod: "delivery",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}),
		);
		expect(
			await asOwner.query(api.creditLock.cancelOutlook, { orderId: legacy }),
		).toEqual({ kind: "not_charged" });
	});
});

describe("balance notices", () => {
	const evaluate = (t: T, retailerId: Id<"retailers">) =>
		t.mutation(internal.creditNotices.evaluate, { retailerId, route: "settle" });

	test("running low — the last 20% of the month's credits — fires once a period", async () => {
		const t = setup();
		// Starter: 100 a month, so the line is 20 left.
		const s = await store(t);
		await setBalance(t, s.retailerId, 21);
		expect(await evaluate(t, s.retailerId)).toBeNull();
		await setBalance(t, s.retailerId, 20);
		expect(await evaluate(t, s.retailerId)).toBe("low");
		expect(await evaluate(t, s.retailerId)).toBeNull();
		await setBalance(t, s.retailerId, 7);
		expect(await evaluate(t, s.retailerId)).toBeNull();
	});

	test("the line follows the plan: Pro's 200 runs low at 40, not at a flat 10", async () => {
		const t = setup();
		const s = await store(t, { status: "active", plan: "pro" });
		await setBalance(t, s.retailerId, 40);
		expect(await evaluate(t, s.retailerId)).toBe("low");
	});

	test("a burst from 25 to −3 collapses into ONE 'out of credits' — never a late 'running low'", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 25);
		await setBalance(t, s.retailerId, -3);
		expect(await evaluate(t, s.retailerId)).toBe("locked");
		await setBalance(t, s.retailerId, 5);
		expect(await evaluate(t, s.retailerId)).toBe("unlocked");
		// Back in the low band this period — the low nudge was spent by the lock.
		expect(await evaluate(t, s.retailerId)).toBeNull();
	});

	test("a lock that spans the 1st is not re-announced — the refresh says 'still short'", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, -150);
		expect(await evaluate(t, s.retailerId)).toBe("locked");
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		expect(await total(t, s.retailerId)).toBe(-50);
		expect(await evaluate(t, s.retailerId)).toBe("still_locked");
		expect(await evaluate(t, s.retailerId)).toBeNull();
	});

	test("the ledger schedules the check when a line is crossed", async () => {
		const t = setup();
		const s = await store(t);
		// 21 → 20 crosses Starter's low line.
		await setBalance(t, s.retailerId, 21);
		const before = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
		await storefrontOrder(t, s.retailerId, s.productId);
		const after = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
		const checks = after
			.filter((f) => !before.some((b) => b._id === f._id))
			.filter((f) => f.name.includes("creditNotices"));
		expect(checks).toHaveLength(1);
	});

	test("no notices for comped stores; a custom grant gets no low nudge but does hear about a lock", async () => {
		const t = setup();
		const comped = await store(t, { status: "active", plan: "pro", comped: true });
		await setBalance(t, comped.retailerId, -5);
		expect(await evaluate(t, comped.retailerId)).toBeNull();

		const custom = await store(t, { status: "active", plan: "starter" }, "user_lock_custom");
		await t.withIdentity({ subject: ADMIN }).mutation(api.credits.adminSetGrantOverride, {
			retailerId: custom.retailerId,
			grant: 150,
		});
		await setBalance(t, custom.retailerId, 5);
		expect(await evaluate(t, custom.retailerId)).toBeNull();
		await setBalance(t, custom.retailerId, 0);
		expect(await evaluate(t, custom.retailerId)).toBe("locked");
	});

	test("bought credits get a heads-up 14 days before they expire — once per lot", async () => {
		const t = setup();
		const s = await store(t);
		await t.run((ctx) =>
			addPurchasedCredits(ctx, {
				retailerId: s.retailerId,
				credits: 50,
				source: "purchase",
				type: "purchase",
				reason: "purchase",
				refId: "p1",
				createdBy: OWNER,
				now: Date.now(),
			}),
		);
		vi.setSystemTime(Date.parse("2027-09-20T12:00:00+08:00"));
		expect(await t.mutation(internal.creditNotices.internalExpiryNotices, {})).toEqual({
			stores: 0,
		});
		vi.setSystemTime(Date.parse("2027-09-30T12:00:00+08:00"));
		expect(await t.mutation(internal.creditNotices.internalExpiryNotices, {})).toEqual({
			stores: 1,
		});
		expect(await t.mutation(internal.creditNotices.internalExpiryNotices, {})).toEqual({
			stores: 0,
		});
	});
});
