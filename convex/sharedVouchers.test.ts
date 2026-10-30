/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import { releaseOrderVoucher } from "./lib/voucherRedemption";
import schema from "./schema";

/**
 * Shared voucher codes (`z8r3fducfm`): one seller-named code, many buyers,
 * bounded by a cap, an end time, or both. Everything here is what differs from
 * a single-use voucher — issuing a WORD, counting instead of flipping, the
 * cap race, the hand-back on cancel, and the three doors spending the same
 * row. The single-use suites (`vouchers.test.ts`, `voucherRedemption.test.ts`)
 * stay untouched by design: a shared code rides their seam, it doesn't fork it.
 */

const modules = import.meta.glob("./**/*.ts");

const OWNER = "user_shared_owner";
const OTHER = "user_shared_other";

const customer = { name: "Ali", waPhone: "60123456789" };
const address = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

async function seedRetailer(t: ReturnType<typeof setup>, userId: string) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Shared Code Store",
		slug: `shared-${userId.replace(/[^a-z0-9]/g, "")}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedProduct(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	price = 5000,
) {
	const productId = await t
		.withIdentity({ subject: userId })
		.mutation(api.products.create, {
			retailerId,
			name: "Kek Batik",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			blockWhenOutOfStock: false,
			variants: [{ optionValues: [], price, onHand: 100 }],
		});
	const variantId = await t.run(async (ctx) => {
		const v = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.first();
		if (!v) throw new Error("variant seed failed");
		return v._id;
	});
	return { productId, variantId };
}

/** Mint one shared code. Defaults to a cap of 2 and no end time. */
async function mintShared(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	over: {
		code?: string;
		kind?: "fixed" | "percent";
		value?: number;
		maxRedemptions?: number;
		endsAt?: number;
		userId?: string;
	} = {},
) {
	const { vouchers } = await t
		.withIdentity({ subject: over.userId ?? OWNER })
		.mutation(api.vouchers.create, {
			retailerId,
			usage: "shared",
			code: over.code ?? "SALE345",
			kind: over.kind ?? "fixed",
			value: over.value ?? 1000,
			maxRedemptions: "maxRedemptions" in over ? over.maxRedemptions : 2,
			endsAt: over.endsAt,
		});
	return vouchers[0];
}

async function placeOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	voucherCode?: string,
) {
	return t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer,
		deliveryAddress: address,
		voucherCode,
	});
}

async function orderIdOf(t: ReturnType<typeof setup>, shortId: string) {
	return t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error(`no order ${shortId}`);
		return o._id;
	});
}

async function readVoucher(t: ReturnType<typeof setup>, id: Id<"vouchers">) {
	const row = await t.run((ctx) => ctx.db.get(id));
	if (!row) throw new Error("voucher gone");
	return row;
}

async function redemptionRows(t: ReturnType<typeof setup>, id: Id<"vouchers">) {
	return t.run((ctx) =>
		ctx.db
			.query("voucherRedemptions")
			.withIndex("by_voucher", (q) => q.eq("voucherId", id))
			.collect(),
	);
}

/** A store, a product and a live shared code with a cap of 2. */
async function scene(t: ReturnType<typeof setup>) {
	const retailer = await seedRetailer(t, OWNER);
	const { productId, variantId } = await seedProduct(t, OWNER, retailer._id);
	const code = await mintShared(t, retailer._id);
	return { retailer, productId, variantId, code };
}

// ---------------------------------------------------------------------------
// Issuing a word
// ---------------------------------------------------------------------------

describe("creating a shared code", () => {
	test("one row, the word canonicalised, counting from zero", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const { vouchers, batchId } = await t
			.withIdentity({ subject: OWNER })
			.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				usage: "shared",
				code: "happyhour",
				kind: "percent",
				value: 20,
				maxRedemptions: 50,
				endsAt: Date.now() + DAY_MS,
				note: "Friday 5–7",
			});
		expect(vouchers).toHaveLength(1);
		expect(batchId).toBeUndefined();
		expect(vouchers[0]).toMatchObject({
			code: "HAPPYHOUR",
			usage: "shared",
			status: "active",
			maxRedemptions: 50,
			redeemedCount: 0,
			note: "Friday 5–7",
		});
		expect(vouchers[0].endsAt).toBeTypeOf("number");
	});

	test("a shared code needs at least one bound — a public code can't run forever", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await expect(
			mintShared(t, retailer._id, { maxRedemptions: undefined }),
		).rejects.toThrow(/how many|when it ends/i);
	});

	test("the word is validated with the form's own rule", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await expect(mintShared(t, retailer._id, { code: "ab" })).rejects.toThrow(
			/at least/i,
		);
		await expect(
			mintShared(t, retailer._id, { code: "SALE 20" }),
		).rejects.toThrow(/letters and numbers/i);
		// A word the single-use parser would claim can never be found as shared.
		await expect(
			mintShared(t, retailer._id, { code: "SALEDEAL" }),
		).rejects.toThrow(/single-use/i);
		await expect(mintShared(t, retailer._id, { code: "" })).rejects.toThrow(
			/type a code/i,
		);
	});

	test("arguments that belong to a single-use voucher are refused, not guessed at", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const asOwner = t.withIdentity({ subject: OWNER });
		await expect(
			asOwner.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				usage: "shared",
				code: "SALE20",
				kind: "fixed",
				value: 1000,
				maxRedemptions: 5,
				count: 20,
			}),
		).rejects.toThrow(/one code/i);
		await expect(
			asOwner.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				usage: "shared",
				code: "SALE20",
				kind: "fixed",
				value: 1000,
				maxRedemptions: 5,
				expiresAt: todayMytMidnight(),
			}),
		).rejects.toThrow(/ends at a time/i);
	});

	test("a word is unique per store among LIVE codes, and free again once the old one is dead", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const first = await mintShared(t, retailer._id, { code: "SALE20" });
		await expect(
			mintShared(t, retailer._id, { code: "sale20" }),
		).rejects.toThrow(/already running/i);
		// Another store may run the same word — it is public by design.
		const other = await seedRetailer(t, OTHER);
		await expect(
			mintShared(t, other._id, { code: "SALE20", userId: OTHER }),
		).resolves.toMatchObject({ code: "SALE20" });
		// Void the first; the word is free, and the history row keeps its own id.
		await t
			.withIdentity({ subject: OWNER })
			.mutation(api.vouchers.voidVoucher, { voucherId: first.id });
		const second = await mintShared(t, retailer._id, { code: "SALE20" });
		expect(second.id).not.toBe(first.id);
	});

	test("sharedCodeAvailable answers the form the same way the mutation would", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const asOwner = t.withIdentity({ subject: OWNER });
		const free = await asOwner.query(api.vouchers.sharedCodeAvailable, {
			retailerId: retailer._id,
			code: "sale20",
		});
		expect(free).toEqual({ available: true, code: "SALE20" });
		await mintShared(t, retailer._id, { code: "SALE20" });
		const taken = await asOwner.query(api.vouchers.sharedCodeAvailable, {
			retailerId: retailer._id,
			code: "SALE20",
		});
		expect(taken).toEqual({ available: false, code: "SALE20" });
		// A word the form would refuse is not "available" either.
		const bad = await asOwner.query(api.vouchers.sharedCodeAvailable, {
			retailerId: retailer._id,
			code: "SALEDEAL",
		});
		expect(bad.available).toBe(false);
	});

	test("issuing a shared code is Pro, like every voucher", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		await t.run(async (ctx) => {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
				.first();
			if (!sub) throw new Error("no subscription");
			await ctx.db.patch(sub._id, { plan: "starter", status: "active" });
		});
		await expect(mintShared(t, retailer._id)).rejects.toThrow(/pro/i);
	});
});

// ---------------------------------------------------------------------------
// The buyer's check
// ---------------------------------------------------------------------------

describe("checking a shared code", () => {
	test("a word typed any way comes back canonical with its terms", async () => {
		const t = setup();
		const { retailer } = await scene(t);
		const res = await t.mutation(api.vouchers.checkCode, {
			retailerId: retailer._id,
			code: "sale 345",
		});
		expect(res).toEqual({
			ok: true,
			code: "SALE345",
			terms: { kind: "fixed", value: 1000 },
		});
	});

	test("another store's word is not found here — never confirmed to exist", async () => {
		const t = setup();
		const { retailer } = await scene(t);
		const other = await seedRetailer(t, OTHER);
		const res = await t.mutation(api.vouchers.checkCode, {
			retailerId: other._id,
			code: "SALE345",
		});
		expect(res).toMatchObject({ ok: false, refusal: "not_found" });
		// …and the owner's own store still finds it.
		expect(
			await t.mutation(api.vouchers.checkCode, {
				retailerId: retailer._id,
				code: "SALE345",
			}),
		).toMatchObject({ ok: true });
	});

	test("the checkout shows the field once a shared code exists", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const before = await t.query(api.retailers.getRetailerBySlug, {
			slug: retailer.slug,
		});
		if (before.status !== "ok") throw new Error("store not ok");
		expect(before.retailer.acceptsVouchers).toBe(false);
		await mintShared(t, retailer._id);
		const after = await t.query(api.retailers.getRetailerBySlug, {
			slug: retailer.slug,
		});
		if (after.status !== "ok") throw new Error("store not ok");
		expect(after.retailer.acceptsVouchers).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Spending it — the storefront door, the cap, the clock
// ---------------------------------------------------------------------------

describe("the storefront spends a shared code by counting", () => {
	test("each order takes one use; the row stays active until the cap", async () => {
		const t = setup();
		const { retailer, productId, code } = await scene(t);
		const first = await placeOrder(t, retailer._id, productId, code.code);
		const firstId = await orderIdOf(t, first.shortId);
		const order = await t.run((ctx) => ctx.db.get(firstId));
		expect(order).toMatchObject({
			voucherId: code.id,
			// `usage` rides in the snapshot so the order page can say what a
			// cancel does without joining the voucher row.
			voucherSnapshot: { code: "SALE345", kind: "fixed", value: 1000, usage: "shared" },
			voucherDiscount: 1000,
			total: 4000,
		});
		let row = await readVoucher(t, code.id);
		expect(row.status).toBe("active"); // never stored redeemed
		expect(row.redeemedCount).toBe(1);
		expect(row.redeemedOrderId).toBeUndefined();
		expect(await redemptionRows(t, code.id)).toHaveLength(1);

		// A second buyer, same word — this is the whole feature.
		await placeOrder(t, retailer._id, productId, "sale345");
		row = await readVoucher(t, code.id);
		expect(row.redeemedCount).toBe(2);
		expect(await redemptionRows(t, code.id)).toHaveLength(2);
	});

	test("the buyer after the cap is told it has RUN OUT, and no order is placed", async () => {
		const t = setup();
		const { retailer, productId, code } = await scene(t);
		await placeOrder(t, retailer._id, productId, code.code);
		await placeOrder(t, retailer._id, productId, code.code);
		await expect(
			placeOrder(t, retailer._id, productId, code.code),
		).rejects.toThrow(/run out/i);
		const orders = await t.run((ctx) => ctx.db.query("orders").collect());
		expect(orders).toHaveLength(2);
		// The seller's list reads it as USED.
		const { vouchers } = await t
			.withIdentity({ subject: OWNER })
			.query(api.vouchers.list, { retailerId: retailer._id });
		expect(vouchers[0]).toMatchObject({
			status: "redeemed",
			redeemedCount: 2,
			maxRedemptions: 2,
		});
		// And the buyer's check says the same, as data.
		expect(
			await t.mutation(api.vouchers.checkCode, {
				retailerId: retailer._id,
				code: "SALE345",
			}),
		).toMatchObject({ ok: false, refusal: "exhausted" });
	});

	test("two checkouts racing the LAST use — exactly one wins", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const { productId } = await seedProduct(t, OWNER, retailer._id);
		const code = await mintShared(t, retailer._id, { maxRedemptions: 1 });
		const results = await Promise.allSettled([
			placeOrder(t, retailer._id, productId, code.code),
			placeOrder(t, retailer._id, productId, code.code),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
		const row = await readVoucher(t, code.id);
		expect(row.redeemedCount).toBe(1);
		expect(await redemptionRows(t, code.id)).toHaveLength(1);
		expect(await t.run((ctx) => ctx.db.query("orders").collect())).toHaveLength(1);
	});

	test("the end instant is exact — one millisecond past it, the code has expired", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const { productId } = await seedProduct(t, OWNER, retailer._id);
		const code = await mintShared(t, retailer._id, {
			maxRedemptions: undefined,
			endsAt: Date.now() + DAY_MS,
		});
		await placeOrder(t, retailer._id, productId, code.code); // fine while live
		// Wind the row back so its end has just passed.
		await t.run((ctx) => ctx.db.patch(code.id, { endsAt: Date.now() - 1 }));
		await expect(
			placeOrder(t, retailer._id, productId, code.code),
		).rejects.toThrow(/expired/i);
		const { vouchers } = await t
			.withIdentity({ subject: OWNER })
			.query(api.vouchers.list, { retailerId: retailer._id });
		expect(vouchers[0].status).toBe("expired");
		expect(vouchers[0].redeemedCount).toBe(1);
	});

	test("a voided shared code refuses every buyer, and orders already placed keep their discount", async () => {
		const t = setup();
		const { retailer, productId, code } = await scene(t);
		const { shortId } = await placeOrder(t, retailer._id, productId, code.code);
		await t
			.withIdentity({ subject: OWNER })
			.mutation(api.vouchers.voidVoucher, { voucherId: code.id });
		await expect(
			placeOrder(t, retailer._id, productId, code.code),
		).rejects.toThrow(/no longer valid/i);
		const placedId = await orderIdOf(t, shortId);
		const order = await t.run((ctx) => ctx.db.get(placedId));
		expect(order?.total).toBe(4000);
		expect(order?.voucherDiscount).toBe(1000);
	});
});

// ---------------------------------------------------------------------------
// Hand-back on cancel
// ---------------------------------------------------------------------------

describe("a cancelled order gives its use back", () => {
	test("the count drops, the row goes, and the word is spendable again", async () => {
		const t = setup();
		const { retailer, productId, code } = await scene(t);
		await placeOrder(t, retailer._id, productId, code.code);
		const { shortId } = await placeOrder(t, retailer._id, productId, code.code);
		expect((await readVoucher(t, code.id)).redeemedCount).toBe(2);

		const orderId = await orderIdOf(t, shortId);
		await t
			.withIdentity({ subject: OWNER })
			.mutation(api.orders.updateStatus, { orderId, status: "cancelled" });

		const row = await readVoucher(t, code.id);
		expect(row.redeemedCount).toBe(1);
		const rows = await redemptionRows(t, code.id);
		expect(rows).toHaveLength(1);
		expect(rows[0].orderId).not.toBe(orderId);
		// The freed use is real: a third buyer gets in under the cap of 2.
		await expect(
			placeOrder(t, retailer._id, productId, code.code),
		).resolves.toBeTruthy();
		expect((await readVoucher(t, code.id)).redeemedCount).toBe(2);
	});

	test("the hand-back is idempotent — the redemption row is the guard", async () => {
		const t = setup();
		const { retailer, productId, code } = await scene(t);
		const { shortId } = await placeOrder(t, retailer._id, productId, code.code);
		const orderId = await orderIdOf(t, shortId);
		const now = Date.now();
		await t.run(async (ctx) => {
			const order = await ctx.db.get(orderId);
			if (!order) throw new Error("order gone");
			await releaseOrderVoucher(ctx, order, now);
			await releaseOrderVoucher(ctx, order, now);
			await releaseOrderVoucher(ctx, order, now);
		});
		expect((await readVoucher(t, code.id)).redeemedCount).toBe(0);
		expect(await redemptionRows(t, code.id)).toHaveLength(0);
	});

	test("a voided code still has its count corrected — the status stays voided", async () => {
		const t = setup();
		const { retailer, productId, code } = await scene(t);
		const { shortId } = await placeOrder(t, retailer._id, productId, code.code);
		await t
			.withIdentity({ subject: OWNER })
			.mutation(api.vouchers.voidVoucher, { voucherId: code.id });
		await t.withIdentity({ subject: OWNER }).mutation(api.orders.updateStatus, {
			orderId: await orderIdOf(t, shortId),
			status: "cancelled",
		});
		const row = await readVoucher(t, code.id);
		expect(row.status).toBe("voided");
		expect(row.redeemedCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// The other two doors
// ---------------------------------------------------------------------------

async function startWalkIn(t: ReturnType<typeof setup>) {
	const asOwner = t.withIdentity({ subject: OWNER });
	const { token } = await asOwner.mutation(
		api.counterCheckout.ensureCounterQrToken,
		{},
	);
	const res = await t.mutation(
		internal.counterCheckout.startSessionFromStoreQr,
		{ token, waPhone: "60123456789", profileName: "Aiman" },
	);
	if (res.result !== "started") throw new Error("walk-in not started");
	return t.run(async (ctx) => {
		const rows = await ctx.db.query("counterCheckoutSessions").collect();
		const s = rows.find((r) => r.status === "buyer_identified");
		if (!s) throw new Error("no bound session");
		return s._id;
	});
}

describe("the counter and the claim link spend the same row", () => {
	test("a counter sale takes one use", async () => {
		const t = setup();
		const { variantId, code } = await scene(t);
		const asOwner = t.withIdentity({ subject: OWNER });
		const sessionId = await startWalkIn(t);
		// The draft keeps the shared word in canonical form too.
		await asOwner.mutation(api.counterCheckout.saveSessionDraft, {
			sessionId,
			draft: { items: [{ variantId, quantity: 1 }], voucherCode: "sale 345" },
		});
		expect(
			(await t.run((ctx) => ctx.db.get(sessionId)))?.draft?.voucherCode,
		).toBe("SALE345");
		const { orderId } = await asOwner.mutation(
			api.counterCheckout.createOrderFromSession,
			{
				sessionId,
				items: [{ variantId, quantity: 1 }],
				paidInPerson: true,
				voucherCode: code.code,
			},
		);
		const order = await t.run((ctx) => ctx.db.get(orderId));
		expect(order?.total).toBe(4000);
		expect((await readVoucher(t, code.id)).redeemedCount).toBe(1);
		expect(await redemptionRows(t, code.id)).toHaveLength(1);
	});

	test("a claim freezes the word at send and spends a use at commit", async () => {
		const t = setup();
		const { variantId, code } = await scene(t);
		const asOwner = t.withIdentity({ subject: OWNER });
		const sessionId = await startWalkIn(t);
		const { token } = await asOwner.mutation(api.orderClaims.sendClaim, {
			sessionId,
			items: [{ variantId, quantity: 1 }],
			windowMinutes: 60,
			voucherCode: code.code,
		});
		// An offer, not a spend.
		expect((await readVoucher(t, code.id)).redeemedCount).toBe(0);
		// The seller's frozen "waiting" view carries the voucher line the
		// buyer's ticket draws — items 5000, SALE345 −1000, locked total 4000.
		const session = await asOwner.query(api.counterCheckout.getCheckoutSession, {
			sessionId,
		});
		expect(session?.liveClaim).toMatchObject({
			total: 4000,
			voucher: { code: "SALE345", discount: 1000 },
		});
		const page = await t.query(api.orderClaims.getByToken, { token });
		expect(page?.open?.voucher).toMatchObject({
			kind: "applied",
			snapshot: { code: "SALE345", kind: "fixed", value: 1000 },
		});
		const { shortId } = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: address,
			fulfilmentDate: todayMytMidnight() + DAY_MS,
		});
		const placedId = await orderIdOf(t, shortId);
		const order = await t.run((ctx) => ctx.db.get(placedId));
		expect(order?.total).toBe(4000);
		expect((await readVoucher(t, code.id)).redeemedCount).toBe(1);
	});

	test("a claim whose word ran out before the buyer opened it DROPS the discount, never dead-ends", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, OWNER);
		const { productId, variantId } = await seedProduct(t, OWNER, retailer._id);
		const code = await mintShared(t, retailer._id, { maxRedemptions: 1 });
		const asOwner = t.withIdentity({ subject: OWNER });
		const sessionId = await startWalkIn(t);
		const { token } = await asOwner.mutation(api.orderClaims.sendClaim, {
			sessionId,
			items: [{ variantId, quantity: 1 }],
			windowMinutes: 60,
			voucherCode: code.code,
		});
		// Someone else takes the last use on the storefront meanwhile.
		await placeOrder(t, retailer._id, productId, code.code);
		const page = await t.query(api.orderClaims.getByToken, { token });
		expect(page?.open?.voucher).toMatchObject({
			kind: "dropped",
			refusal: "exhausted",
		});
		const { shortId } = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: address,
			fulfilmentDate: todayMytMidnight() + DAY_MS,
		});
		const placedId = await orderIdOf(t, shortId);
		const order = await t.run((ctx) => ctx.db.get(placedId));
		expect(order?.total).toBe(5000);
		expect(order?.voucherId).toBeUndefined();
		expect((await readVoucher(t, code.id)).redeemedCount).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// The seller's reads
// ---------------------------------------------------------------------------

describe("who used it", () => {
	test("listRedemptions names the orders newest first, and needs the vouchers grant", async () => {
		const t = setup();
		const { retailer, productId, code } = await scene(t);
		const a = await placeOrder(t, retailer._id, productId, code.code);
		const b = await placeOrder(t, retailer._id, productId, code.code);
		const rows = await t
			.withIdentity({ subject: OWNER })
			.query(api.vouchers.listRedemptions, { voucherId: code.id });
		expect(rows.map((r) => r.shortId)).toEqual([b.shortId, a.shortId]);
		expect(rows[0].total).toBe(4000);
		expect(rows[0].redeemedAt).toBeTypeOf("number");
		await expect(
			t
				.withIdentity({ subject: OTHER })
				.query(api.vouchers.listRedemptions, { voucherId: code.id }),
		).rejects.toThrow();
	});

	test("the list carries the tally and never a redeemedOrder for a shared row", async () => {
		const t = setup();
		const { retailer, productId, code } = await scene(t);
		await placeOrder(t, retailer._id, productId, code.code);
		const { vouchers, counts } = await t
			.withIdentity({ subject: OWNER })
			.query(api.vouchers.list, { retailerId: retailer._id });
		expect(vouchers[0]).toMatchObject({
			usage: "shared",
			status: "active",
			redeemedCount: 1,
			maxRedemptions: 2,
		});
		expect(vouchers[0].redeemedOrder).toBeUndefined();
		expect(counts.active).toBe(1);
	});
});
