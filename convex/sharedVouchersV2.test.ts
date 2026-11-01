/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import { isVoucherRefusalErrorData } from "./lib/vouchers";
import schema from "./schema";

/**
 * Shared voucher codes v2 (`z8r3fdz0pw`): the per-buyer limit, the minimum
 * spend, the per-order discount cap, a scheduled start, and extending a live
 * code. Every rule is proved at the ORDER doors (storefront, counter, claim),
 * never only at `checkCode` — the field's check is for the tick, the door is
 * what decides. `sharedVouchers.test.ts` holds v1 and is untouched.
 */

const modules = import.meta.glob("./**/*.ts");

const OWNER = "user_v2_owner";
const ALI = "60123456789";
const SITI = "60198765432";

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

async function seedRetailer(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: OWNER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "V2 Store",
		slug: "v2-store",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	return retailer;
}

async function seedProduct(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	price = 5000,
) {
	const productId = await t
		.withIdentity({ subject: OWNER })
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

type MintOver = {
	code?: string;
	kind?: "fixed" | "percent";
	value?: number;
	maxRedemptions?: number;
	endsAt?: number;
	startsAt?: number;
	perBuyerLimit?: number;
	minSpend?: number;
	maxDiscount?: number;
};

async function mintShared(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	over: MintOver = {},
) {
	const { vouchers } = await t
		.withIdentity({ subject: OWNER })
		.mutation(api.vouchers.create, {
			retailerId,
			usage: "shared",
			code: over.code ?? "SALE345",
			kind: over.kind ?? "fixed",
			value: over.value ?? 1000,
			maxRedemptions: "maxRedemptions" in over ? over.maxRedemptions : 10,
			endsAt: over.endsAt,
			startsAt: over.startsAt,
			perBuyerLimit: over.perBuyerLimit,
			minSpend: over.minSpend,
			maxDiscount: over.maxDiscount,
		});
	return vouchers[0];
}

async function placeOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	opts: { code?: string; waPhone?: string; quantity?: number } = {},
) {
	return t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: opts.quantity ?? 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer: {
			name: "Ali",
			...("waPhone" in opts ? { waPhone: opts.waPhone } : { waPhone: ALI }),
		},
		deliveryAddress: address,
		voucherCode: opts.code,
	});
}

/** The typed refusal a door threw, or fail. */
async function refusalOf(p: Promise<unknown>) {
	try {
		await p;
	} catch (err) {
		// convex-test hands ConvexError data over as its JSON string.
		const data =
			err instanceof ConvexError && typeof err.data === "string"
				? JSON.parse(err.data)
				: err instanceof ConvexError
					? err.data
					: undefined;
		if (isVoucherRefusalErrorData(data)) return data;
		throw err;
	}
	throw new Error("expected a voucher refusal, got success");
}

async function orderByShortId(t: ReturnType<typeof setup>, shortId: string) {
	const o = await t.run((ctx) =>
		ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first(),
	);
	if (!o) throw new Error(`no order ${shortId}`);
	return o;
}

async function readVoucher(t: ReturnType<typeof setup>, id: Id<"vouchers">) {
	const row = await t.run((ctx) => ctx.db.get(id));
	if (!row) throw new Error("voucher gone");
	return row;
}

async function redemptions(t: ReturnType<typeof setup>, id: Id<"vouchers">) {
	return t.run((ctx) =>
		ctx.db
			.query("voucherRedemptions")
			.withIndex("by_voucher", (q) => q.eq("voucherId", id))
			.collect(),
	);
}

async function startWalkIn(t: ReturnType<typeof setup>, waPhone: string) {
	const asOwner = t.withIdentity({ subject: OWNER });
	const { token } = await asOwner.mutation(
		api.counterCheckout.ensureCounterQrToken,
		{},
	);
	const res = await t.mutation(
		internal.counterCheckout.startSessionFromStoreQr,
		{ token, waPhone, profileName: "Aiman" },
	);
	if (res.result !== "started") throw new Error("walk-in not started");
	return t.run(async (ctx) => {
		const rows = await ctx.db.query("counterCheckoutSessions").collect();
		const s = rows.find(
			(r) => r.status === "buyer_identified" && r.waPhone === waPhone,
		);
		if (!s) throw new Error("no bound session");
		return s._id;
	});
}

// ---------------------------------------------------------------------------
// 1. Per-buyer limit
// ---------------------------------------------------------------------------

describe("the per-buyer limit", () => {
	test("one number gets its allowance; a second number is unaffected", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, { perBuyerLimit: 1 });

		await placeOrder(t, retailer._id, productId, { code: code.code });
		const refused = await refusalOf(
			placeOrder(t, retailer._id, productId, { code: code.code }),
		);
		expect(refused.refusal).toBe("buyer_limit");
		expect(refused.message).toBe(
			"This WhatsApp number has already used this code — it's 1 per buyer.",
		);
		// Never names the earlier order: the number is typed, not proven.
		expect(refused.message).not.toMatch(/ORD-/);

		await placeOrder(t, retailer._id, productId, {
			code: code.code,
			waPhone: SITI,
		});
		const rows = await redemptions(t, code.id);
		expect(rows.map((r) => r.waPhone).sort()).toEqual([ALI, SITI].sort());
		expect((await readVoucher(t, code.id)).redeemedCount).toBe(2);
	});

	test("a limit above one counts to it, and the sentence says how many", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, { perBuyerLimit: 2 });
		await placeOrder(t, retailer._id, productId, { code: code.code });
		await placeOrder(t, retailer._id, productId, { code: code.code });
		const refused = await refusalOf(
			placeOrder(t, retailer._id, productId, { code: code.code }),
		);
		expect(refused.message).toBe(
			"This WhatsApp number has used this code 2 times — that's the limit per buyer.",
		);
	});

	test("the same number racing two checkouts — exactly one wins", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, { perBuyerLimit: 1 });
		const results = await Promise.allSettled([
			placeOrder(t, retailer._id, productId, { code: code.code }),
			placeOrder(t, retailer._id, productId, { code: code.code }),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
		const orders = await t.run((ctx) => ctx.db.query("orders").collect());
		expect(orders).toHaveLength(1);
		expect(await redemptions(t, code.id)).toHaveLength(1);
	});

	test("the number is matched as the order stores it, however it was typed", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, { perBuyerLimit: 1 });
		await placeOrder(t, retailer._id, productId, {
			code: code.code,
			waPhone: "012-345 6789",
		});
		const refused = await refusalOf(
			placeOrder(t, retailer._id, productId, {
				code: code.code,
				waPhone: "+60 12 345 6789",
			}),
		);
		expect(refused.refusal).toBe("buyer_limit");
	});

	test("a cancelled order gives the buyer's use back, not just the code's", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, { perBuyerLimit: 1 });
		const { shortId } = await placeOrder(t, retailer._id, productId, {
			code: code.code,
		});
		const order = await orderByShortId(t, shortId);
		await t
			.withIdentity({ subject: OWNER })
			.mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "cancelled",
			});
		expect(await redemptions(t, code.id)).toHaveLength(0);
		await placeOrder(t, retailer._id, productId, { code: code.code });
		expect((await readVoucher(t, code.id)).redeemedCount).toBe(1);
	});

	test("the storefront refuses a per-buyer code with no number to count against", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, { perBuyerLimit: 1 });
		const refused = await refusalOf(
			placeOrder(t, retailer._id, productId, {
				code: code.code,
				waPhone: undefined,
			}),
		);
		expect(refused.refusal).toBe("buyer_phone_required");
		// A code WITHOUT a per-buyer limit still works phone-less.
		const open = await mintShared(t, retailer._id, { code: "OPEN20" });
		await placeOrder(t, retailer._id, productId, {
			code: open.code,
			waPhone: undefined,
		});
		expect((await readVoucher(t, open.id)).redeemedCount).toBe(1);
	});

	test("an anonymous counter sale counts against the total only", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { variantId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, {
			perBuyerLimit: 1,
			maxRedemptions: 3,
		});
		const asOwner = t.withIdentity({ subject: OWNER });
		for (let i = 0; i < 2; i++) {
			const { sessionId } = await asOwner.mutation(
				api.counterCheckout.startAnonymousSession,
				{},
			);
			const { orderId } = await asOwner.mutation(
				api.counterCheckout.createOrderFromSession,
				{
					sessionId,
					items: [{ variantId, quantity: 1 }],
					paidInPerson: true,
					voucherCode: code.code,
				},
			);
			expect((await t.run((ctx) => ctx.db.get(orderId)))?.total).toBe(4000);
		}
		const rows = await redemptions(t, code.id);
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.waPhone === undefined)).toBe(true);
		expect((await readVoucher(t, code.id)).redeemedCount).toBe(2);
	});

	test("a counter sale WITH a number is held to the limit like the storefront", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId, variantId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, { perBuyerLimit: 1 });
		await placeOrder(t, retailer._id, productId, { code: code.code });
		const sessionId = await startWalkIn(t, ALI);
		const refused = await refusalOf(
			t
				.withIdentity({ subject: OWNER })
				.mutation(api.counterCheckout.createOrderFromSession, {
					sessionId,
					items: [{ variantId, quantity: 1 }],
					paidInPerson: true,
					voucherCode: code.code,
				}),
		);
		expect(refused.refusal).toBe("buyer_limit");
	});

	test("a claim refuses at SEND for a number that has used it, and DROPS if it is used meanwhile", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId, variantId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, { perBuyerLimit: 1 });
		const asOwner = t.withIdentity({ subject: OWNER });

		// Sent while the number is fresh…
		const sessionId = await startWalkIn(t, ALI);
		const { token } = await asOwner.mutation(api.orderClaims.sendClaim, {
			sessionId,
			items: [{ variantId, quantity: 1 }],
			windowMinutes: 60,
			voucherCode: code.code,
		});
		// …then the same buyer uses it at the storefront before opening the link.
		await placeOrder(t, retailer._id, productId, { code: code.code });
		const page = await t.query(api.orderClaims.getByToken, { token });
		expect(page?.open?.voucher).toMatchObject({
			kind: "dropped",
			refusal: "buyer_limit",
		});
		const { shortId } = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: address,
			fulfilmentDate: todayMytMidnight() + DAY_MS,
		});
		const placed = await orderByShortId(t, shortId);
		expect(placed.total).toBe(5000);
		expect(placed.voucherId).toBeUndefined();

		// A fresh send for the same number now refuses at the counter.
		const again = await startWalkIn(t, ALI);
		const refused = await refusalOf(
			asOwner.mutation(api.orderClaims.sendClaim, {
				sessionId: again,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 60,
				voucherCode: code.code,
			}),
		);
		expect(refused.refusal).toBe("buyer_limit");
	});

	test("checkCode applies a per-buyer code before the number, and judges it once the number arrives", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, { perBuyerLimit: 1 });

		const before = await t.mutation(api.vouchers.checkCode, {
			retailerId: retailer._id,
			code: "sale345",
		});
		expect(before).toMatchObject({
			ok: true,
			conditions: { perBuyerLimit: 1 },
		});
		expect(before.ok && before.checkedFor).toBeUndefined();

		// A half-typed number is no number — never a refusal.
		const partial = await t.mutation(api.vouchers.checkCode, {
			retailerId: retailer._id,
			code: "sale345",
			waPhone: "012",
		});
		expect(partial.ok).toBe(true);

		const fresh = await t.mutation(api.vouchers.checkCode, {
			retailerId: retailer._id,
			code: "sale345",
			waPhone: "012-345 6789",
		});
		expect(fresh).toMatchObject({ ok: true, checkedFor: ALI });

		await placeOrder(t, retailer._id, productId, { code: code.code });
		const used = await t.mutation(api.vouchers.checkCode, {
			retailerId: retailer._id,
			code: "sale345",
			waPhone: "0123456789",
		});
		expect(used).toMatchObject({ ok: false, refusal: "buyer_limit" });
	});

	test("the per-buyer limit is shared-only and can't exceed the total", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await expect(
			t.withIdentity({ subject: OWNER }).mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 1000,
				perBuyerLimit: 1,
			}),
		).rejects.toThrow(/shared codes only/);
		await expect(
			mintShared(t, retailer._id, { maxRedemptions: 2, perBuyerLimit: 3 }),
		).rejects.toThrow(/can't be more than the total/);
	});
});

// ---------------------------------------------------------------------------
// 2. Minimum spend
// ---------------------------------------------------------------------------

describe("the minimum spend", () => {
	test("judged at the door against the GROSS item subtotal, boundary inclusive", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id, 3000);
		const code = await mintShared(t, retailer._id, { minSpend: 6000 });
		const refused = await refusalOf(
			placeOrder(t, retailer._id, productId, { code: code.code }),
		);
		expect(refused.refusal).toBe("below_min_spend");
		expect(refused.message).toBe(
			"This code needs RM 60.00 of items — add RM 30.00 more.",
		);
		expect(refused.detail).toMatchObject({ minSpend: 6000, shortfall: 3000 });
		const { shortId } = await placeOrder(t, retailer._id, productId, {
			code: code.code,
			quantity: 2,
		});
		expect((await orderByShortId(t, shortId)).total).toBe(5000);
	});

	test("a single-use voucher can carry one too, on the same path", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id, 3000);
		const { vouchers } = await t
			.withIdentity({ subject: OWNER })
			.mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 500,
				minSpend: 5000,
			});
		const refused = await refusalOf(
			placeOrder(t, retailer._id, productId, { code: vouchers[0].code }),
		);
		expect(refused.refusal).toBe("below_min_spend");
		// Refused, so still spendable.
		expect((await readVoucher(t, vouchers[0].id)).status).toBe("active");
	});

	test("the counter is held to it too", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { variantId } = await seedProduct(t, retailer._id, 3000);
		const code = await mintShared(t, retailer._id, { minSpend: 6000 });
		const sessionId = await startWalkIn(t, ALI);
		const refused = await refusalOf(
			t
				.withIdentity({ subject: OWNER })
				.mutation(api.counterCheckout.createOrderFromSession, {
					sessionId,
					items: [{ variantId, quantity: 1 }],
					paidInPerson: true,
					voucherCode: code.code,
				}),
		);
		expect(refused.refusal).toBe("below_min_spend");
	});

	test("NEVER re-judged on a recompute — a given discount is never silently taken back", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, { minSpend: 5000 });
		const { shortId } = await placeOrder(t, retailer._id, productId, {
			code: code.code,
		});
		// Push the code's minimum far past this order's basket. A recompute
		// that re-asked the row would now strip the discount.
		await t.run((ctx) => ctx.db.patch(code.id, { minSpend: 999_999 }));
		const order = await orderByShortId(t, shortId);
		await t.mutation(api.orders.updateDeliveryAddress, {
			token: order.trackingToken ?? "__none__",
			deliveryAddress: { ...address, line1: "99 Jln Cempaka" },
		});
		const after = await orderByShortId(t, shortId);
		expect(after.voucherDiscount).toBe(1000);
		expect(after.total).toBe(4000);
	});

	test("a minimum is validated with the form's own rule", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await expect(
			mintShared(t, retailer._id, { minSpend: 0 }),
		).rejects.toThrow(/least a buyer has to spend/);
	});
});

// ---------------------------------------------------------------------------
// 3. Maximum discount per order
// ---------------------------------------------------------------------------

describe("the per-order discount cap", () => {
	test("clamps a percentage, is frozen into the snapshot, and holds across a recompute", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id, 10_000);
		const code = await mintShared(t, retailer._id, {
			kind: "percent",
			value: 50,
			maxDiscount: 2000,
		});
		const { shortId } = await placeOrder(t, retailer._id, productId, {
			code: code.code,
		});
		const order = await orderByShortId(t, shortId);
		expect(order.voucherDiscount).toBe(2000); // 50% would be 5000
		expect(order.total).toBe(8000);
		expect(order.voucherSnapshot).toMatchObject({
			kind: "percent",
			value: 50,
			maxDiscount: 2000,
		});

		await t.mutation(api.orders.updateDeliveryAddress, {
			token: order.trackingToken ?? "__none__",
			deliveryAddress: { ...address, line1: "99 Jln Cempaka" },
		});
		expect((await orderByShortId(t, shortId)).voucherDiscount).toBe(2000);

		// The seller's delivery charge is the other recompute a live order
		// meets most — still clamped, fee added on top.
		await t
			.withIdentity({ subject: OWNER })
			.mutation(api.orders.setDeliveryFee, {
				orderId: order._id,
				fee: 800,
			});
		const priced = await orderByShortId(t, shortId);
		expect(priced.voucherDiscount).toBe(2000);
		expect(priced.total).toBe(10_000 - 2000 + 800);
	});

	test("under the cap, the percentage is untouched", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id, 2000);
		const code = await mintShared(t, retailer._id, {
			kind: "percent",
			value: 50,
			maxDiscount: 2000,
		});
		const { shortId } = await placeOrder(t, retailer._id, productId, {
			code: code.code,
		});
		expect((await orderByShortId(t, shortId)).voucherDiscount).toBe(1000);
	});

	test("the claim freezes the cap with the terms", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { variantId } = await seedProduct(t, retailer._id, 10_000);
		const code = await mintShared(t, retailer._id, {
			kind: "percent",
			value: 50,
			maxDiscount: 2000,
		});
		const sessionId = await startWalkIn(t, ALI);
		const { token } = await t
			.withIdentity({ subject: OWNER })
			.mutation(api.orderClaims.sendClaim, {
				sessionId,
				items: [{ variantId, quantity: 1 }],
				windowMinutes: 60,
				voucherCode: code.code,
			});
		const { shortId } = await t.mutation(api.orderClaims.commit, {
			token,
			deliveryMethod: "delivery",
			deliveryAddress: address,
			fulfilmentDate: todayMytMidnight() + DAY_MS,
		});
		const placed = await orderByShortId(t, shortId);
		expect(placed.voucherDiscount).toBe(2000);
		expect(placed.voucherSnapshot?.maxDiscount).toBe(2000);
	});

	test("a cap on a FIXED amount is refused — it is already its own cap", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await expect(
			mintShared(t, retailer._id, { kind: "fixed", maxDiscount: 500 }),
		).rejects.toThrow(/already its own limit/);
	});
});

// ---------------------------------------------------------------------------
// 5. Scheduled start
// ---------------------------------------------------------------------------

describe("a scheduled start", () => {
	test("reads scheduled, refuses with WHEN, then works once it starts", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id);
		const startsAt = Date.now() + 2 * DAY_MS;
		const code = await mintShared(t, retailer._id, { startsAt });
		expect(code.status).toBe("scheduled");

		const list = await t
			.withIdentity({ subject: OWNER })
			.query(api.vouchers.list, { retailerId: retailer._id });
		expect(list.counts.scheduled).toBe(1);
		expect(list.counts.active).toBe(0);

		const checked = await t.mutation(api.vouchers.checkCode, {
			retailerId: retailer._id,
			code: code.code,
		});
		expect(checked).toMatchObject({
			ok: false,
			refusal: "not_started",
			detail: { startsAt },
		});
		const refused = await refusalOf(
			placeOrder(t, retailer._id, productId, { code: code.code }),
		);
		expect(refused.message).toMatch(/^This code starts on .+ — try again then\.$/);

		// Time passes.
		await t.run((ctx) => ctx.db.patch(code.id, { startsAt: Date.now() - 1 }));
		await placeOrder(t, retailer._id, productId, { code: code.code });
		expect((await readVoucher(t, code.id)).redeemedCount).toBe(1);
	});

	test("a scheduled code holds its word — a second code can't take it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await mintShared(t, retailer._id, { startsAt: Date.now() + DAY_MS });
		await expect(mintShared(t, retailer._id)).rejects.toThrow(
			/set up to start later/,
		);
		const available = await t
			.withIdentity({ subject: OWNER })
			.query(api.vouchers.sharedCodeAvailable, {
				retailerId: retailer._id,
				code: "sale345",
			});
		expect(available.available).toBe(false);
	});

	test("a start must be ahead, before the end, and is shared-only", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		await expect(
			mintShared(t, retailer._id, { startsAt: Date.now() - 1000 }),
		).rejects.toThrow(/already passed/);
		await expect(
			mintShared(t, retailer._id, {
				startsAt: Date.now() + 2 * DAY_MS,
				endsAt: Date.now() + DAY_MS,
			}),
		).rejects.toThrow(/start before it ends/);
		await expect(
			t.withIdentity({ subject: OWNER }).mutation(api.vouchers.create, {
				retailerId: retailer._id,
				kind: "fixed",
				value: 1000,
				startsAt: Date.now() + DAY_MS,
			}),
		).rejects.toThrow(/shared codes only/);
	});
});

// ---------------------------------------------------------------------------
// 6. Extending a live code
// ---------------------------------------------------------------------------

describe("extending a live code", () => {
	test("raises the cap and moves the end later — never the other way", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const endsAt = Date.now() + DAY_MS;
		const code = await mintShared(t, retailer._id, {
			maxRedemptions: 10,
			endsAt,
		});
		const asOwner = t.withIdentity({ subject: OWNER });
		const row = await asOwner.mutation(api.vouchers.extendShared, {
			voucherId: code.id,
			maxRedemptions: 20,
			endsAt: endsAt + DAY_MS,
		});
		expect(row).toMatchObject({ maxRedemptions: 20, endsAt: endsAt + DAY_MS });

		await expect(
			asOwner.mutation(api.vouchers.extendShared, {
				voucherId: code.id,
				maxRedemptions: 5,
				endsAt: endsAt + DAY_MS,
			}),
		).rejects.toThrow(/only raise the total/);
		await expect(
			asOwner.mutation(api.vouchers.extendShared, {
				voucherId: code.id,
				maxRedemptions: 20,
				endsAt,
			}),
		).rejects.toThrow(/only move the end later/);
	});

	test("a value change is impossible — the mutation has no argument for it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const code = await mintShared(t, retailer._id);
		await expect(
			t.withIdentity({ subject: OWNER }).mutation(api.vouchers.extendShared, {
				voucherId: code.id,
				maxRedemptions: 20,
				// @ts-expect-error — the point: there is no `value` to change.
				value: 9000,
			}),
		).rejects.toThrow();
		expect((await readVoucher(t, code.id)).value).toBe(1000);
	});

	test("a bound may be dropped if the other stays; adding one is cutting it short", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const code = await mintShared(t, retailer._id, {
			maxRedemptions: 10,
			endsAt: Date.now() + DAY_MS,
		});
		const asOwner = t.withIdentity({ subject: OWNER });
		await expect(
			asOwner.mutation(api.vouchers.extendShared, { voucherId: code.id }),
		).rejects.toThrow(/can't run forever/);
		const row = await asOwner.mutation(api.vouchers.extendShared, {
			voucherId: code.id,
			maxRedemptions: 10,
		});
		expect(row.endsAt).toBeUndefined();
		await expect(
			asOwner.mutation(api.vouchers.extendShared, {
				voucherId: code.id,
				maxRedemptions: 10,
				endsAt: Date.now() + DAY_MS,
			}),
		).rejects.toThrow(/would cut it short/);
	});

	test("raising the cap revives a code that ran out — unless a newer code took the word", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const { productId } = await seedProduct(t, retailer._id);
		const code = await mintShared(t, retailer._id, { maxRedemptions: 1 });
		await placeOrder(t, retailer._id, productId, { code: code.code });
		const asOwner = t.withIdentity({ subject: OWNER });
		// A later end alone would save and leave it run out — refused, by name.
		await expect(
			asOwner.mutation(api.vouchers.extendShared, {
				voucherId: code.id,
				maxRedemptions: 1,
				endsAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
			}),
		).rejects.toThrow(/raise the total to bring it back/);
		const revived = await asOwner.mutation(api.vouchers.extendShared, {
			voucherId: code.id,
			maxRedemptions: 3,
		});
		expect(revived.status).toBe("active");
		await placeOrder(t, retailer._id, productId, {
			code: code.code,
			waPhone: SITI,
		});

		// Run it out again, let a new code take the word, then try to revive.
		await placeOrder(t, retailer._id, productId, { code: code.code });
		await mintShared(t, retailer._id, { maxRedemptions: 5 });
		await expect(
			asOwner.mutation(api.vouchers.extendShared, {
				voucherId: code.id,
				maxRedemptions: 10,
			}),
		).rejects.toThrow(/in use by a newer code/);
	});

	test("a voided code and a single-use voucher can't be extended", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const asOwner = t.withIdentity({ subject: OWNER });
		const code = await mintShared(t, retailer._id);
		await asOwner.mutation(api.vouchers.voidVoucher, { voucherId: code.id });
		await expect(
			asOwner.mutation(api.vouchers.extendShared, {
				voucherId: code.id,
				maxRedemptions: 20,
			}),
		).rejects.toThrow(/voided/);
		const { vouchers } = await asOwner.mutation(api.vouchers.create, {
			retailerId: retailer._id,
			kind: "fixed",
			value: 1000,
		});
		await expect(
			asOwner.mutation(api.vouchers.extendShared, {
				voucherId: vouchers[0].id,
				maxRedemptions: 20,
			}),
		).rejects.toThrow(/single-use/);
	});

	test("extending needs the vouchers write grant", async () => {
		const t = setup();
		const retailer = await seedRetailer(t);
		const code = await mintShared(t, retailer._id);
		await expect(
			t
				.withIdentity({ subject: "user_stranger" })
				.mutation(api.vouchers.extendShared, {
					voucherId: code.id,
					maxRedemptions: 20,
				}),
		).rejects.toThrow();
	});
});
