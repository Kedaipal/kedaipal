/// <reference types="vite/client" />
// Credits T3.1 (z8r3fdmg4h): the PER-ORDER credit gate + the balance notices.
// Which writes carry the guard is pinned by creditLockCoverage.test.ts; the
// invisibility half (what a gated row may contain) is pinned by
// orderGate.test.ts. This file proves the gate's behaviour end to end.
//
// The thing to hold onto when reading these tests: a gated order is one whose
// OWN debit went below zero, which means the balance has to be taken down
// BEFORE the order is created. An order placed while the store had credit is
// funded for life and no amount of later debt touches it — that is the whole
// point of T3.1, and `fundedOrder` vs `gatedOrder` below is the distinction.
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
const GATED = /waiting on credits/;

/** A gated write refuses with the TYPED gate error — the sentence plus the way
 * back — never a bare string the dashboard can only print. */
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
	if (isCreditLockErrorData(data)) {
		expect(data.message, name).toMatch(GATED);
		// The refusal names THIS order's place in the queue, never the store's
		// total — a seller topping up one credit has to know what it opens.
		expect(data.creditsToUnlock, `${name} names the order's position`).toBeGreaterThan(0);
	}
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

/** An order the gate is HOLDING: the balance is taken to zero first, so this
 * order's own debit is the one that went into debt. */
async function gatedOrder(
	t: T,
	s: { retailerId: Id<"retailers">; productId: Id<"products"> },
) {
	await setBalance(t, s.retailerId, 0);
	return storefrontOrder(t, s.retailerId, s.productId);
}

/** An order that PAID for its credit — placed while the store had credit. It
 * stays workable for life, whatever the balance does afterwards. */
async function fundedOrder(
	t: T,
	s: { retailerId: Id<"retailers">; productId: Id<"products"> },
) {
	await setBalance(t, s.retailerId, 5);
	return storefrontOrder(t, s.retailerId, s.productId);
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

describe("the per-order gate", () => {
	for (const balance of [0, -5]) {
		test(`every kind of gated write refuses on an order that arrived at a balance of ${balance}`, async () => {
			const t = setup();
			const s = await store(t);
			await setBalance(t, s.retailerId, balance);
			const order = await storefrontOrder(t, s.retailerId, s.productId);
			const asOwner = t.withIdentity({ subject: OWNER });
			const attempts: Array<[string, () => Promise<unknown>]> = [
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

	test("the CATALOGUE is never gated — a store in debt still edits products and categories", async () => {
		// Zaki, 6 Oct 2026: products, categories and insights are paid for by the
		// subscription, not by credits. Only the orders a seller hasn't paid the
		// credit for are held, and holding the catalogue as well punishes work
		// that costs Kedaipal nothing. DELETE the gate's absence here and this
		// test goes red — which is the point: the previous release shipped the
		// store-wide version, and nothing but a test stops it coming back.
		const t = setup();
		const s = await store(t, { status: "active", plan: "pro" });
		await setBalance(t, s.retailerId, -20);
		const asOwner = t.withIdentity({ subject: OWNER });

		const productId = await asOwner.mutation(api.products.create, {
			retailerId: s.retailerId,
			name: "Still editable",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 1,
			blockWhenOutOfStock: false,
			requiresProof: false,
			variants: [{ optionValues: [], price: 100, onHand: 1 }],
		});
		expect(productId).toBeTruthy();
		await asOwner.mutation(api.products.archive, { productId });
		const categoryId = await asOwner.mutation(api.categories.create, {
			retailerId: s.retailerId,
			name: "Cakes",
			slug: "cakes",
		});
		expect(categoryId).toBeTruthy();
	});

	test("a FUNDED order stays workable for life — even after the store goes into debt", async () => {
		// The defect T3.1 exists to fix: the store-wide lock held an order whose
		// credit was spent weeks earlier because a LATER order went unfunded.
		const t = setup();
		const s = await store(t);
		const paid = await fundedOrder(t, s);
		// Now bury the store: enough new orders to take it well below zero.
		await setBalance(t, s.retailerId, 0);
		const waiting = await storefrontOrder(t, s.retailerId, s.productId);
		await storefrontOrder(t, s.retailerId, s.productId);
		expect(await total(t, s.retailerId)).toBeLessThan(0);

		const asOwner = t.withIdentity({ subject: OWNER });
		// The order that paid: still fully workable.
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: paid._id,
			status: "confirmed",
		});
		await asOwner.mutation(api.orders.markPaymentReceived, { orderId: paid._id });
		// The ones that arrived in debt: held.
		await expectCreditLocked(
			() =>
				asOwner.mutation(api.orders.updateStatus, {
					orderId: waiting._id,
					status: "confirmed",
				}),
			"the order that arrived in debt",
		);
	});

	test("credits free waiting orders OLDEST FIRST — 101 waiting, a 100-pack opens 100", async () => {
		// Zaki's worked example, 2 Oct 2026. Three orders rather than 101 (same
		// arithmetic, a test that finishes): at −3, two credits open the two
		// oldest and the newest keeps waiting.
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 0);
		const first = await storefrontOrder(t, s.retailerId, s.productId);
		const second = await storefrontOrder(t, s.retailerId, s.productId);
		const third = await storefrontOrder(t, s.retailerId, s.productId);
		expect(await total(t, s.retailerId)).toBe(-3);

		const asOwner = t.withIdentity({ subject: OWNER });
		await t.run(async (ctx) => {
			await addPurchasedCredits(ctx, {
				retailerId: s.retailerId,
				credits: 2,
				source: "adjust",
				type: "adjust",
				refId: `oldest-first-${Date.now()}`,
				reason: "adjust",
				createdBy: "test",
				now: Date.now(),
			});
		});
		// Total reads −1, and exactly one order is still waiting: the newest.
		expect(await total(t, s.retailerId)).toBe(-1);
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: first._id,
			status: "confirmed",
		});
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: second._id,
			status: "confirmed",
		});
		await expectCreditLocked(
			() =>
				asOwner.mutation(api.orders.updateStatus, {
					orderId: third._id,
					status: "confirmed",
				}),
			"the newest order",
		);
	});

	test("an expired lot never un-funds an order already worked", async () => {
		// The watermark only ever RISES, so this is structural rather than a
		// check — but it is the edge case the ticket called out, and a future
		// refactor that recomputed funding from the balance would break it.
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 0);
		const held = await storefrontOrder(t, s.retailerId, s.productId);
		// A pack lands, frees it, then expires a year later.
		await t.run(async (ctx) => {
			await addPurchasedCredits(ctx, {
				retailerId: s.retailerId,
				credits: 5,
				source: "purchase",
				type: "purchase",
				refId: `expiry-${Date.now()}`,
				reason: "purchase",
				createdBy: "test",
				now: Date.now(),
			});
		});
		const asOwner = t.withIdentity({ subject: OWNER });
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: held._id,
			status: "confirmed",
		});
		// Expire every lot: the balance falls back below zero.
		await t.run(async (ctx) => {
			for (const lot of await ctx.db
				.query("creditLots")
				.withIndex("by_retailer_open_expiry", (q) =>
					q.eq("retailerId", s.retailerId).eq("open", true),
				)
				.collect())
				await ctx.db.patch(lot._id, { expiresAt: Date.now() - DAY });
		});
		await t.mutation(internal.credits.internalExpireLots, {});
		expect(await total(t, s.retailerId)).toBeLessThan(0);
		// Still workable — it was paid for.
		await asOwner.mutation(api.orders.markPaymentReceived, { orderId: held._id });
	});

	test("a bulk move on a MIXED selection moves what it can and names what it skipped", async () => {
		const t = setup();
		const s = await store(t, { status: "active", plan: "pro" });
		const paid = await fundedOrder(t, s);
		const waiting = await gatedOrder(t, s);
		const res = await t
			.withIdentity({ subject: OWNER })
			.mutation(api.orders.bulkUpdateStatus, {
				orderIds: [paid._id, waiting._id],
				status: "confirmed",
			});
		expect(res.updated).toBe(1);
		expect(res.skippedCreditGated).toBe(1);
		// Never a whole-batch refusal: the store-wide lock's failure mode.
		expect(res.skipped).toBe(1);
	});

	test("cancelling stays open on a WAITING order — a seller can always release a buyer", async () => {
		const t = setup();
		const s = await store(t, { status: "active", plan: "pro" });
		const waiting = await gatedOrder(t, s);
		const asOwner = t.withIdentity({ subject: OWNER });
		await asOwner.mutation(api.orders.updateStatus, {
			orderId: waiting._id,
			status: "cancelled",
		});
		// And in bulk, which is the release valve for a seller holding forty.
		const second = await storefrontOrder(t, s.retailerId, s.productId);
		const res = await asOwner.mutation(api.orders.bulkUpdateStatus, {
			orderIds: [second._id],
			status: "cancelled",
		});
		expect(res.updated).toBe(1);
		expect(res.skippedCreditGated).toBe(0);
	});

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

	test("the dashboard payload carries the WATERMARK, so the inbox needs no read per row", async () => {
		const t = setup();
		const s = await store(t);
		const paid = await fundedOrder(t, s);
		await setBalance(t, s.retailerId, 0);
		vi.setSystemTime(OCT_10 + 60_000);
		await storefrontOrder(t, s.retailerId, s.productId);
		await storefrontOrder(t, s.retailerId, s.productId);
		const me = await t
			.withIdentity({ subject: OWNER })
			.query(api.retailers.getMyRetailer, {});
		expect(me?.creditGate).toMatchObject({
			exempt: false,
			unlockRoute: "topup",
			creditsOwed: 2,
			ordersWaiting: 2,
		});
		// The watermark sits exactly at the funded order's position, which is
		// what lets the client answer "is this row gated?" by comparison alone.
		expect(me?.creditGate?.fundedThrough).toBe(paid.creditSeq);
	});

	test("a cancelled waiting order stops being counted as waiting", async () => {
		// `creditsOwed` counts queue POSITIONS, and a cancelled order keeps its
		// position (a watermark can only move from the oldest end). The number a
		// seller READS has to mean orders they can act on, so the two differ
		// here on purpose.
		const t = setup();
		const s = await store(t, { status: "active", plan: "pro" });
		await setBalance(t, s.retailerId, 0);
		const a = await storefrontOrder(t, s.retailerId, s.productId);
		await storefrontOrder(t, s.retailerId, s.productId);
		const b = await storefrontOrder(t, s.retailerId, s.productId);
		// Cancel the NEWEST: its refund frees the oldest, leaving one live
		// waiting order and one cancelled one holding a position.
		await t.withIdentity({ subject: OWNER }).mutation(api.orders.updateStatus, {
			orderId: b._id,
			status: "cancelled",
		});
		const me = await t
			.withIdentity({ subject: OWNER })
			.query(api.retailers.getMyRetailer, {});
		expect(me?.creditGate?.creditsOwed).toBe(2);
		expect(me?.creditGate?.ordersWaiting).toBe(1);
		// And the freed one is the OLDEST.
		await t.withIdentity({ subject: OWNER }).mutation(api.orders.updateStatus, {
			orderId: a._id,
			status: "confirmed",
		});
	});

	test("a waiting order opens by every route that puts credits in: top-up, refresh, contract", async () => {
		const t = setup();
		const asOwner = () => t.withIdentity({ subject: OWNER });
		const s = await store(t, { status: "active", plan: "pro" });
		/** A fresh order taken at zero — so its OWN debit is the one in debt —
		 * plus the two assertions each route needs: held, then opened. */
		const waitingOrder = async () => {
			await setBalance(t, s.retailerId, 0);
			const order = await storefrontOrder(t, s.retailerId, s.productId);
			const confirm = () =>
				asOwner().mutation(api.orders.updateStatus, {
					orderId: order._id,
					status: "confirmed",
				});
			await expect(confirm()).rejects.toThrow(GATED);
			return confirm;
		};

		// Top-up (a pack lands in the purchased bucket).
		let open = await waitingOrder();
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
		await open();

		// Monthly refresh.
		open = await waitingOrder();
		vi.setSystemTime(NOV_1);
		await t.mutation(internal.credits.internalRollPeriods, {});
		await open();

		// An Enterprise contract (T6) lands its bigger grant's difference now,
		// like any upgrade: 500 included on a Pro month of 200.
		open = await waitingOrder();
		await t.withIdentity({ subject: ADMIN }).mutation(api.enterprise.setContract, {
			retailerId: s.retailerId,
			baseFeeMinor: 88800,
			includedCredits: 500,
			overageRateMinor: 60,
			blockSize: 5000,
			billingCycle: "monthly",
			contactName: "Contract contact",
		});
		await open();
	});

	test("a trial out of orders is told to pick a plan; paying the first invoice unlocks it", async () => {
		const t = setup();
		const s = await store(t, { status: "trialing", plan: "pro" });
		const order = await gatedOrder(t, s);
		const confirm = () =>
			t.withIdentity({ subject: OWNER }).mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "confirmed",
			});
		await expect(confirm()).rejects.toThrow(
			/waiting on credits.*your trial's orders are used up.*Pick a plan/,
		);
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
		expect(await total(t, s.retailerId)).toBe(99);
		await confirm();
	});

	test("a comped store is metered but never locked", async () => {
		const t = setup();
		const comped = await store(t, { status: "active", plan: "starter", comped: true });
		const compedOrder = await gatedOrder(t, comped);
		await t.withIdentity({ subject: OWNER }).mutation(api.orders.updateStatus, {
			orderId: compedOrder._id,
			status: "confirmed",
		});
	});

	test("an admin's own store has no balance to lock on (z8r3fdp4er)", async () => {
		// Unmetered: there is no account to drive to zero — `setBalance` can't
		// even be used on it, because the adjust lever refuses an unmetered
		// store. The seller write just works.
		const t = setup();
		const own = await store(t, { status: "trialing", plan: "pro" }, ADMIN);
		// No credit account at all — that is what unmetered means.
		expect(
			await t.run((ctx) =>
				ctx.db
					.query("creditAccounts")
					.withIndex("by_retailer", (q) => q.eq("retailerId", own.retailerId))
					.first(),
			),
		).toBeNull();
		// And an ORDER write — what the gate actually covers since T3.1, where
		// `products.archive` no longer does — just works. The order never got a
		// `creditSeq` (no account ⇒ no debit), so it reads as funded: the gate
		// failing open by construction rather than by an exemption branch.
		const ownOrder = await storefrontOrder(t, own.retailerId, own.productId);
		expect(ownOrder.creditSeq).toBeUndefined();
		await t.withIdentity({ subject: ADMIN }).mutation(api.orders.updateStatus, {
			orderId: ownOrder._id,
			status: "confirmed",
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
				permissions: { orders: "write" },
				invitedBy: OWNER,
				invitedAt: Date.now(),
				acceptedAt: Date.now(),
			}),
		);
		const order = await gatedOrder(t, s);
		await expect(
			t.withIdentity({ subject: MEMBER }).mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "confirmed",
			}),
		).rejects.toThrow(/waiting on credits.*Ask the store owner/);
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
				permissions: { orders: "write", credits: "write" },
				invitedBy: OWNER,
				invitedAt: Date.now(),
				acceptedAt: Date.now(),
			}),
		);
		const order = await gatedOrder(t, s);
		const err = await t
			.withIdentity({ subject: MEMBER })
			.mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "confirmed",
			})
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
			/waiting on credits.*Top up in Settings → Billing/,
		);
	});
});

describe("white-glove: an admin acting as a gated store still works", () => {
	/**
	 * The ten call sites fixed in the PR #320 review read
	 * `if (!access.actingAsAdmin) { assertSubscriptionActive } ;
	 * assertOrderCreditAvailable` — the credit guard runs for EVERYONE and lets
	 * admins through on its own `isAdmin` early return, exactly as the past-due
	 * guard does. Nothing pinned that bypass, so moving it would have broken
	 * onboarding-by-act-as silently. This is the pin: delete the admin check
	 * from `resolveCreditGate` and every case below goes red.
	 *
	 * Since T3.1 the admin bypass lives in `resolveCreditGate` rather than at
	 * each guard, so it covers the READS too — a white-glove admin must see a
	 * waiting order in full, or support can't answer "what's in this order?".
	 */
	test("the order work a gated seller can't do, an admin can — and the admin SEES the order", async () => {
		const t = setup();
		const s = await store(t, { status: "active", plan: "pro" });
		const order = await gatedOrder(t, s);
		const asOwner = t.withIdentity({ subject: OWNER });
		const asAdmin = t.withIdentity({ subject: ADMIN });

		// The owner can't move it on…
		await expectCreditLocked(
			() =>
				asOwner.mutation(api.orders.updateStatus, {
					orderId: order._id,
					status: "confirmed",
				}),
			"orders.updateStatus (owner)",
		);
		// …and can't see the buyer either.
		const ownerRead = await asOwner.query(api.orders.get, {
			shortId: order.shortId,
		});
		expect(ownerRead?.creditGated).toBe(true);
		expect(ownerRead?.customer?.waPhone).toBeUndefined();

		// The admin operating that same store is not gated, on either half.
		const adminRead = await asAdmin.query(api.orders.get, {
			shortId: order.shortId,
		});
		expect(adminRead?.creditGated).toBeUndefined();
		expect(adminRead?.customer?.waPhone).toBe("60123456789");
		await asAdmin.mutation(api.orders.updateStatus, {
			orderId: order._id,
			status: "confirmed",
		});

		const after = await t.run((ctx) => ctx.db.get(order._id));
		expect(after?.status).toBe("confirmed");
		// Metered, never excused: the admin's writes spent nothing extra, and the
		// store is still at the balance its own order put it at (−1 — the gated
		// order took its credit on the way in, as every order does).
		expect(await total(t, s.retailerId)).toBe(-1);
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
		// A comped store is UNMETERED (z8r3fdrph7), so it cannot be put at -5
		// through the admin ledger at all — the lever refuses it. Drive the
		// balance down first, THEN comp it: that is also the real-world order
		// (a sponsorship is switched on over a store that was being billed),
		// and it leaves a NEGATIVE balance sitting on the row, which is the
		// state a notice sweep would nudge about if the gate ever slipped.
		const comped = await store(t, { status: "active", plan: "pro" });
		await setBalance(t, comped.retailerId, -5);
		await t.run((ctx) => ctx.db.patch(comped.subId, { comped: true }));
		expect(await evaluate(t, comped.retailerId)).toBeNull();

		// A custom allowance now lives on a CONTRACT (the lever is comps and
		// contracts only since the z8r3fdkp8h follow-up), and an Enterprise
		// store keeps Pro's lock rules — so "no low nudge, but locks at zero"
		// is an Enterprise behaviour now. The contract writes the grant
		// override; the no-nudge guard reads that same field.
		const custom = await store(
			t,
			{ status: "active", plan: "pro" },
			"user_lock_custom",
		);
		await t.withIdentity({ subject: ADMIN }).mutation(api.enterprise.setContract, {
			retailerId: custom.retailerId,
			baseFeeMinor: 88_800,
			includedCredits: 150,
			overageRateMinor: 60,
			blockSize: 5000,
			billingCycle: "monthly",
			contactName: "HSL Food GM",
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
