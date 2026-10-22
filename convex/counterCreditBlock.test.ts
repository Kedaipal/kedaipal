/// <reference types="vite/client" />
// The counter needs a credit in hand (ClickUp z8r3fdwbbb, docs/credits.md).
//
// Every counter sale uses a credit, like every channel. What this file pins is
// the exception: the counter is the one order door that REFUSES at zero,
// because a counter sale born below zero is born gated — invisible to the
// seller who just served the buyer face to face. The refusal is the seller's
// (they are the one tapping); every door a BUYER drives stays open.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { creditGateFor, isOrderGated } from "./creditLock";
import { ensureCreditAccount } from "./credits";
import {
	type CreditLockErrorData,
	counterSaleCreditsNeeded,
	isCreditLockErrorData,
} from "./lib/credits";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}
type T = ReturnType<typeof setup>;

const OWNER = "user_counter_owner";
const ADMIN = "user_counter_admin";
const MEMBER = "user_counter_member";
const OCT_10 = Date.parse("2026-10-10T12:00:00+08:00");
const CLOSED = /counter can't ring up a sale/;
const MY_ADDRESS = {
	line1: "12 Jalan Ampang",
	city: "Kuala Lumpur",
	state: "Selangor",
	postcode: "40450",
};

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

/** A billed store on Starter (100 credits a month, low line 20). */
async function store(
	t: T,
	sub: Partial<Doc<"subscriptions">> = { status: "active", plan: "starter" },
) {
	const asOwner = t.withIdentity({ subject: OWNER });
	await asOwner.mutation(api.retailers.createRetailer, {
		storeName: "Kedai Counter",
		slug: "kedai-counter",
	});
	const ids = await t.run(async (ctx) => {
		const r = await ctx.db
			.query("retailers")
			.withIndex("by_slug", (q) => q.eq("slug", "kedai-counter"))
			.first();
		const s = r
			? await ctx.db
					.query("subscriptions")
					.withIndex("by_retailer", (q) => q.eq("retailerId", r._id))
					.first()
			: null;
		if (!r || !s) throw new Error("seed");
		await ctx.db.patch(s._id, sub);
		await ensureCreditAccount(ctx, r._id, Date.now());
		return { retailerId: r._id, subId: s._id };
	});
	const productId = await asOwner.mutation(api.products.create, {
		retailerId: ids.retailerId,
		name: "Keropok Lekor",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 1500, onHand: 100 }],
	});
	const variant = await t.run((ctx) =>
		ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.first(),
	);
	if (!variant) throw new Error("variant");
	return { ...ids, variantId: variant._id };
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

async function totalOf(t: T, retailerId: Id<"retailers">) {
	const a = await t.run((ctx) =>
		ctx.db
			.query("creditAccounts")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first(),
	);
	return (a?.planBalance ?? 0) + (a?.purchasedBalance ?? 0);
}

async function walkIn(t: T, subject = OWNER) {
	const { sessionId } = await t
		.withIdentity({ subject })
		.mutation(api.counterCheckout.startAnonymousSession, { name: "Walk-in" });
	return sessionId;
}

function ringUp(
	t: T,
	sessionId: Id<"counterCheckoutSessions">,
	variantId: Id<"productVariants">,
	subject = OWNER,
) {
	return t
		.withIdentity({ subject })
		.mutation(api.counterCheckout.createOrderFromSession, {
			sessionId,
			items: [{ variantId, quantity: 1 }],
			paidInPerson: true,
			paymentMethod: "cash",
		});
}

/** The typed refusal a credit-closed counter throws, unwrapped. */
async function refusal(run: () => Promise<unknown>): Promise<CreditLockErrorData> {
	const err = await run().then(
		() => null,
		(e: unknown) => e,
	);
	expect(err, "should refuse").toBeInstanceOf(ConvexError);
	let data: unknown = (err as ConvexError<Value>).data;
	while (typeof data === "string") {
		try {
			data = JSON.parse(data);
		} catch {
			break;
		}
	}
	if (!isCreditLockErrorData(data)) throw new Error(`untyped refusal: ${data}`);
	expect(data.message).toMatch(CLOSED);
	return data;
}

describe("counterSaleCreditsNeeded — the ledger's own funded rule", () => {
	test("the last credit rings up; zero needs one; debt needs debt + 1", () => {
		expect(counterSaleCreditsNeeded(5)).toBe(0);
		// A store on 1 credit takes the sale: the debit leaves it at 0, funded.
		expect(counterSaleCreditsNeeded(1)).toBe(0);
		expect(counterSaleCreditsNeeded(0)).toBe(1);
		// 3 orders are waiting; the first 3 credits fund them, the 4th is ours.
		expect(counterSaleCreditsNeeded(-3)).toBe(4);
	});
});

describe("the counter closes at zero credits", () => {
	test("the LAST credit rings up — and that sale is visible, never gated", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 1);
		const sessionId = await walkIn(t);
		const { orderId } = await ringUp(t, sessionId, s.variantId);
		expect(await totalOf(t, s.retailerId)).toBe(0);
		const gated = await t.run(async (ctx) => {
			const order = await ctx.db.get(orderId);
			if (!order) throw new Error("order");
			return isOrderGated(await creditGateFor(ctx, s.retailerId), order);
		});
		expect(gated).toBe(false);
	});

	test("at zero the sale is refused with the way back, and nothing is created", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 1);
		// Started while the till was open — a sale already in progress when the
		// last credit went elsewhere (another till, an online order).
		const sessionId = await walkIn(t);
		await setBalance(t, s.retailerId, 0);
		const data = await refusal(() => ringUp(t, sessionId, s.variantId));
		expect(data.unlockRoute).toBe("topup");
		expect(data.audience).toBe("owner");
		expect(data.creditsToUnlock).toBe(1);
		// The reassurance travels with the refusal: buyers aren't locked out.
		expect(data.message).toMatch(/storefront keeps taking orders/);
		const after = await t.run(async (ctx) => ({
			orders: await ctx.db
				.query("orders")
				.withIndex("by_retailer", (q) => q.eq("retailerId", s.retailerId))
				.collect(),
			session: await ctx.db.get(sessionId),
		}));
		expect(after.orders).toHaveLength(0);
		// The checkout is kept, cart and all — topping up finishes it.
		expect(after.session?.status).toBe("buyer_identified");
		expect(await totalOf(t, s.retailerId)).toBe(0);
	});

	test("topping up reopens the same checkout", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 1);
		const sessionId = await walkIn(t);
		await setBalance(t, s.retailerId, 0);
		await refusal(() => ringUp(t, sessionId, s.variantId));
		await setBalance(t, s.retailerId, 1);
		const { shortId } = await ringUp(t, sessionId, s.variantId);
		expect(shortId).toMatch(/^ORD-/);
	});

	test("a store in debt is told how many credits reopen it", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 1);
		const sessionId = await walkIn(t);
		await setBalance(t, s.retailerId, -3);
		const data = await refusal(() => ringUp(t, sessionId, s.variantId));
		expect(data.creditsToUnlock).toBe(4);
		expect(data.message).toMatch(/4 credits reopen it/);
	});

	test("a checkout can't be STARTED at zero — no cart that can't finish", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 0);
		await refusal(() => walkIn(t));
		await refusal(() =>
			t
				.withIdentity({ subject: OWNER })
				.mutation(api.counterCheckout.bindSessionManualPhone, {
					waPhone: "60123456789",
					name: "Aina",
				}),
		);
	});

	test("a buyer checking in from the store QR is never refused — the seller's complete is", async () => {
		const t = setup();
		const s = await store(t);
		const { token } = await t
			.withIdentity({ subject: OWNER })
			.mutation(api.counterCheckout.ensureCounterQrToken, {});
		await setBalance(t, s.retailerId, 0);
		const res = await t.mutation(internal.counterCheckout.startSessionFromStoreQr, {
			token,
			waPhone: "60123456789",
		});
		expect(res.result).toBe("started");
		const session = await t.run((ctx) =>
			ctx.db
				.query("counterCheckoutSessions")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", s.retailerId).eq("status", "buyer_identified"),
				)
				.first(),
		);
		if (!session) throw new Error("session");
		await refusal(() => ringUp(t, session._id, s.variantId));
	});

	// (A past-due store never reaches this sentence: it is view-only, and that
	// lock runs first at every counter door.)
	test("the plan's way back is named — a trial whose orders are used is sent to pick a plan", async () => {
		const t = setup();
		const s = await store(t, { status: "trialing", plan: "starter" });
		await setBalance(t, s.retailerId, 1);
		const sessionId = await walkIn(t);
		await setBalance(t, s.retailerId, 0);
		const data = await refusal(() => ringUp(t, sessionId, s.variantId));
		expect(data.unlockRoute).toBe("pick_plan");
		expect(data.message).toMatch(/Pick a plan/);
	});

	test("a teammate without the Credits grant is told to ask the owner", async () => {
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
		await setBalance(t, s.retailerId, 0);
		const data = await refusal(() => walkIn(t, MEMBER));
		expect(data.audience).toBe("member");
		expect(data.message).toMatch(/Ask the store owner/);
		// About THE store throughout — "your storefront" is the owner's.
		expect(data.message).toMatch(/The storefront keeps taking orders/);
	});

	test("a Kedaipal admin acting as the store is refused too — the sale would vanish from the seller's inbox", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 0);
		await refusal(() =>
			t
				.withIdentity({ subject: ADMIN })
				.mutation(api.counterCheckout.startAnonymousSession, {
					retailerId: s.retailerId,
				}),
		);
	});

	test("never closed where credits don't apply: a sponsored store and the missing-subscription fail-safe", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 0);
		await t.run((ctx) => ctx.db.patch(s.subId, { comped: true }));
		const sponsored = await walkIn(t);
		await ringUp(t, sponsored, s.variantId);

		await t.run((ctx) => ctx.db.delete(s.subId));
		const failSafe = await walkIn(t);
		await ringUp(t, failSafe, s.variantId);
	});
});

describe("claim links: the seller's send is refused, the buyer's finish never is", () => {
	async function boundSession(t: T) {
		const { sessionId } = await t
			.withIdentity({ subject: OWNER })
			.mutation(api.counterCheckout.bindSessionManualPhone, {
				waPhone: "60123456789",
				name: "Aina",
			});
		return sessionId;
	}

	test("sending at zero is refused", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 1);
		const sessionId = await boundSession(t);
		await setBalance(t, s.retailerId, 0);
		await refusal(() =>
			t.withIdentity({ subject: OWNER }).mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId: s.variantId, quantity: 1 }],
				windowMinutes: 15,
			}),
		);
	});

	test("a link sent while funded still completes for the buyer at zero", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 1);
		const sessionId = await boundSession(t);
		const { token } = await t
			.withIdentity({ subject: OWNER })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId: s.variantId, quantity: 1 }],
				windowMinutes: 15,
			});
		await setBalance(t, s.retailerId, 0);
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		expect(await totalOf(t, s.retailerId)).toBe(-1);

		// …and the seller's claims list says it is WAITING, not just
		// "completed" — the one remaining way a counter-originated sale can be
		// gated, so the row must not read as a sale they can open.
		const rows = await t
			.withIdentity({ subject: OWNER })
			.query(api.orderClaims.listClaims, {});
		const done = rows.find((r) => r.status === "completed");
		expect(done?.orderShortId).toMatch(/^ORD-/);
		expect(done?.orderCreditsToUnlock).toBe(1);
	});

	test("a link completed while funded carries no wait", async () => {
		const t = setup();
		const s = await store(t);
		await setBalance(t, s.retailerId, 5);
		const sessionId = await boundSession(t);
		const { token } = await t
			.withIdentity({ subject: OWNER })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId: s.variantId, quantity: 1 }],
				windowMinutes: 15,
			});
		await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: MY_ADDRESS,
		});
		const rows = await t
			.withIdentity({ subject: OWNER })
			.query(api.orderClaims.listClaims, {});
		const done = rows.find((r) => r.status === "completed");
		expect(done?.orderShortId).toMatch(/^ORD-/);
		expect(done?.orderCreditsToUnlock).toBeUndefined();
	});
});

describe("counterCreditState — what the counter page shows before the tap", () => {
	test("open, then low (owner only), then closed", async () => {
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
		const read = (subject: string) =>
			t
				.withIdentity({ subject })
				.query(api.creditLock.counterCreditState, { retailerId: s.retailerId });

		await setBalance(t, s.retailerId, 50);
		expect(await read(OWNER)).toMatchObject({
			closedReason: null,
			lowCreditLine: null,
		});

		// Starter's low line is 20 — the rule is spoken while it can be avoided.
		await setBalance(t, s.retailerId, 3);
		expect((await read(OWNER))?.lowCreditLine).toBe(
			"3 orders left — the counter stops ringing up sales at 0.",
		);
		// A front-desk teammate isn't shown the store's balance.
		expect((await read(MEMBER))?.lowCreditLine).toBeNull();

		await setBalance(t, s.retailerId, 0);
		const owner = await read(OWNER);
		expect(owner?.closedReason).toMatch(CLOSED);
		expect(owner?.lowCreditLine).toBeNull();
		expect(owner?.audience).toBe("owner");
		expect((await read(MEMBER))?.closedReason).toMatch(/Ask the store owner/);
	});

	test("lastSale: the next sale spends the last credit — told to every reader, the cashier included", async () => {
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
		const lastSale = async (subject: string) =>
			(
				await t
					.withIdentity({ subject })
					.query(api.creditLock.counterCreditState, {
						retailerId: s.retailerId,
					})
			)?.lastSale;
		await setBalance(t, s.retailerId, 2);
		expect(await lastSale(OWNER)).toBe(false);
		await setBalance(t, s.retailerId, 1);
		expect(await lastSale(OWNER)).toBe(true);
		expect(await lastSale(MEMBER)).toBe(true);
		// Closed is not "last" — there is no sale left to warn about.
		await setBalance(t, s.retailerId, 0);
		expect(await lastSale(OWNER)).toBe(false);
	});

	test("null where credits don't apply", async () => {
		const t = setup();
		const s = await store(t, { status: "active", plan: "starter", comped: true });
		expect(
			await t
				.withIdentity({ subject: OWNER })
				.query(api.creditLock.counterCreditState, { retailerId: s.retailerId }),
		).toBeNull();
	});
});
