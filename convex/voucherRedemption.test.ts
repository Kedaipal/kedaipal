/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DAY_MS, todayMytMidnight } from "./lib/fulfilmentDate";
import schema from "./schema";

/**
 * Voucher redemption end to end (`z8r3fdr617`, docs/vouchers.md).
 *
 * The headline risk this file exists for: a voucher is the first SUBTRACTIVE
 * term the order total has ever carried, so a recompute site that drops it
 * charges the buyer FULL PRICE silently. `orderTotalsSeam.test.ts` holds that
 * line structurally; this file proves it behaviourally at all six sites, plus
 * the three redemption doors, the race, the guard rails and the hand-back on
 * cancel.
 */

const modules = import.meta.glob("./**/*.ts");

const USER_A = "user_voucher_a";
const USER_B = "user_voucher_b";

const customer = { name: "Ali", waPhone: "60123456789" };
const validAddress = {
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
		storeName: "Voucher Store",
		slug: `voucher-store-${userId.replace(/[^a-z0-9]/g, "")}`,
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
): Promise<Id<"products">> {
	return t.withIdentity({ subject: userId }).mutation(api.products.create, {
		retailerId,
		name: "Kek Batik",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		variants: [{ optionValues: [], price, onHand: 100 }],
	});
}

/** Mint one voucher and hand back its code. */
async function mintVoucher(
	t: ReturnType<typeof setup>,
	userId: string,
	retailerId: Id<"retailers">,
	terms: { kind: "fixed" | "percent"; value: number },
	expiresAt?: number,
): Promise<{ code: string; id: Id<"vouchers"> }> {
	const { vouchers } = await t
		.withIdentity({ subject: userId })
		.mutation(api.vouchers.create, { retailerId, ...terms, expiresAt });
	return { code: vouchers[0].code, id: vouchers[0].id };
}

async function orderIdOf(
	t: ReturnType<typeof setup>,
	shortId: string,
): Promise<Id<"orders">> {
	return t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		if (!o) throw new Error(`no order ${shortId}`);
		return o._id;
	});
}

async function tk(
	t: ReturnType<typeof setup>,
	shortId: string,
): Promise<string> {
	return t.run(async (ctx) => {
		const o = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first();
		return o?.trackingToken ?? "__none__";
	});
}

async function readOrder(t: ReturnType<typeof setup>, orderId: Id<"orders">) {
	const o = await t.run((ctx) => ctx.db.get(orderId));
	if (!o) throw new Error("order gone");
	return o;
}

async function readVoucher(
	t: ReturnType<typeof setup>,
	voucherId: Id<"vouchers">,
) {
	return t.run((ctx) => ctx.db.get(voucherId));
}

/** A store + product + an active voucher, the shape most tests start from. */
async function scene(
	t: ReturnType<typeof setup>,
	terms: { kind: "fixed" | "percent"; value: number } = {
		kind: "fixed",
		value: 1000,
	},
	price = 5000,
) {
	const retailer = await seedRetailer(t, USER_A);
	const productId = await seedProduct(t, USER_A, retailer._id, price);
	const voucher = await mintVoucher(t, USER_A, retailer._id, terms);
	return { retailer, productId, voucher };
}

async function placeOrder(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	productId: Id<"products">,
	voucherCode?: string,
	extra: Record<string, unknown> = {},
) {
	return t.mutation(api.orders.create, {
		retailerId,
		items: [{ productId, quantity: 1 }],
		currency: "MYR",
		channel: "whatsapp",
		customer,
		deliveryAddress: validAddress,
		voucherCode,
		...extra,
	});
}

// ---------------------------------------------------------------------------
// Door 1 — the storefront
// ---------------------------------------------------------------------------

describe("storefront checkout", () => {
	test("a fixed voucher comes off the total and the row is spent", async () => {
		const t = setup();
		const { retailer, productId, voucher } = await scene(t);
		const { shortId } = await placeOrder(
			t,
			retailer._id,
			productId,
			voucher.code,
		);
		const order = await readOrder(t, await orderIdOf(t, shortId));
		expect(order.subtotal).toBe(5000); // GROSS
		expect(order.voucherDiscount).toBe(1000);
		expect(order.total).toBe(4000);
		expect(order.voucherSnapshot).toEqual({
			code: voucher.code,
			kind: "fixed",
			value: 1000,
		});
		const row = await readVoucher(t, voucher.id);
		expect(row?.status).toBe("redeemed");
		expect(row?.redeemedOrderId).toBe(order._id);
		expect(row?.redeemedAt).toBeTypeOf("number");
	});

	test("a percentage voucher discounts the item subtotal", async () => {
		const t = setup();
		const { retailer, productId, voucher } = await scene(t, {
			kind: "percent",
			value: 15,
		});
		const { shortId } = await placeOrder(
			t,
			retailer._id,
			productId,
			voucher.code,
		);
		const order = await readOrder(t, await orderIdOf(t, shortId));
		expect(order.voucherDiscount).toBe(750);
		expect(order.total).toBe(4250);
	});

	test("the code is normalized — a buyer may type it any way", async () => {
		const t = setup();
		const { retailer, productId, voucher } = await scene(t);
		const typed = voucher.code.toLowerCase().replace(/-/g, " ");
		const { shortId } = await placeOrder(t, retailer._id, productId, typed);
		const order = await readOrder(t, await orderIdOf(t, shortId));
		// Stored canonical, whatever was typed.
		expect(order.voucherSnapshot?.code).toBe(voucher.code);
		expect(order.total).toBe(4000);
	});

	test("no code means no discount and no voucher fields", async () => {
		const t = setup();
		const { retailer, productId } = await scene(t);
		const { shortId } = await placeOrder(t, retailer._id, productId);
		const order = await readOrder(t, await orderIdOf(t, shortId));
		expect(order.total).toBe(5000);
		expect(order.voucherId).toBeUndefined();
		expect(order.voucherSnapshot).toBeUndefined();
		// 0 is never stored (the pickupFee posture).
		expect(order.voucherDiscount).toBeUndefined();
	});

	test("an empty string is not a code attempt", async () => {
		const t = setup();
		const { retailer, productId } = await scene(t);
		const { shortId } = await placeOrder(t, retailer._id, productId, "   ");
		expect((await readOrder(t, await orderIdOf(t, shortId))).total).toBe(5000);
	});

	test("a bad code REFUSES the order — never a silent full-price charge", async () => {
		const t = setup();
		const { retailer, productId } = await scene(t);
		await expect(
			placeOrder(t, retailer._id, productId, "KP-ZZZZ-ZZZZ"),
		).rejects.toThrow();
		// …and nothing was created at the full price behind the buyer's back.
		const orders = await t.run((ctx) => ctx.db.query("orders").collect());
		expect(orders).toHaveLength(0);
	});

	test("a malformed code refuses with its own reason", async () => {
		const t = setup();
		const { retailer, productId } = await scene(t);
		await expect(
			placeOrder(t, retailer._id, productId, "not-a-code"),
		).rejects.toThrow(/KP-XXXX-XXXX/);
	});

	test("an already-spent code names the order it went to", async () => {
		const t = setup();
		const { retailer, productId, voucher } = await scene(t);
		const first = await placeOrder(t, retailer._id, productId, voucher.code);
		await expect(
			placeOrder(t, retailer._id, productId, voucher.code),
		).rejects.toThrow(new RegExp(first.shortId));
	});

	test("an expired code is refused", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const voucher = await mintVoucher(
			t,
			USER_A,
			retailer._id,
			{ kind: "fixed", value: 1000 },
			todayMytMidnight(),
		);
		// Issued for today; wind the row back so today is past its day.
		await t.run((ctx) =>
			ctx.db.patch(voucher.id, { expiresAt: todayMytMidnight() - 3 * DAY_MS }),
		);
		await expect(
			placeOrder(t, retailer._id, productId, voucher.code),
		).rejects.toThrow(/expired/i);
	});

	test("a voided code is refused", async () => {
		const t = setup();
		const { retailer, productId, voucher } = await scene(t);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.vouchers.voidVoucher, { voucherId: voucher.id });
		await expect(
			placeOrder(t, retailer._id, productId, voucher.code),
		).rejects.toThrow(/no longer valid/i);
	});

	test("another store's code can never be spent here", async () => {
		const t = setup();
		const mine = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, mine._id);
		const theirs = await seedRetailer(t, USER_B);
		const theirVoucher = await mintVoucher(t, USER_B, theirs._id, {
			kind: "fixed",
			value: 1000,
		});
		await expect(
			placeOrder(t, mine._id, productId, theirVoucher.code),
		).rejects.toThrow(/isn't valid for this store/i);
		// Still spendable by its own store — refusing here must not consume it.
		expect((await readVoucher(t, theirVoucher.id))?.status).toBe("active");
	});
});

// ---------------------------------------------------------------------------
// The race — the reason redemption is atomic with the insert
// ---------------------------------------------------------------------------

describe("two checkouts racing one code", () => {
	test("exactly one wins", async () => {
		const t = setup();
		const { retailer, productId, voucher } = await scene(t);
		const results = await Promise.allSettled([
			placeOrder(t, retailer._id, productId, voucher.code),
			placeOrder(t, retailer._id, productId, voucher.code),
		]);
		const won = results.filter((r) => r.status === "fulfilled");
		const lost = results.filter((r) => r.status === "rejected");
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		// One order exists, and it is the one holding the voucher.
		const orders = await t.run((ctx) => ctx.db.query("orders").collect());
		expect(orders).toHaveLength(1);
		expect(orders[0].voucherId).toBe(voucher.id);
		expect(orders[0].total).toBe(4000);
		const row = await readVoucher(t, voucher.id);
		expect(row?.status).toBe("redeemed");
		expect(row?.redeemedOrderId).toBe(orders[0]._id);
	});
});

// ---------------------------------------------------------------------------
// The six recompute sites — a live voucher must survive every one
// ---------------------------------------------------------------------------

describe("the six recompute sites keep the discount", () => {
	test("site 1 — the buyer edits their delivery address", async () => {
		const t = setup();
		const { retailer, productId, voucher } = await scene(t);
		const { shortId } = await placeOrder(
			t,
			retailer._id,
			productId,
			voucher.code,
		);
		await t.mutation(api.orders.updateDeliveryAddress, {
			token: await tk(t, shortId),
			deliveryAddress: { ...validAddress, line1: "99 Jln Cempaka" },
		});
		const order = await readOrder(t, await orderIdOf(t, shortId));
		expect(order.voucherDiscount).toBe(1000);
		expect(order.total).toBe(4000);
	});

	test("site 2 — the seller sets a delivery charge", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const voucher = await mintVoucher(t, USER_A, retailer._id, {
			kind: "fixed",
			value: 1000,
		});
		const { shortId } = await placeOrder(
			t,
			retailer._id,
			productId,
			voucher.code,
		);
		const orderId = await orderIdOf(t, shortId);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orders.setDeliveryFee, { orderId, fee: 800 });
		const order = await readOrder(t, orderId);
		// The fee ADDS, the discount still comes off, and the discount did NOT
		// eat the courier's money.
		expect(order.deliveryFee).toBe(800);
		expect(order.voucherDiscount).toBe(1000);
		expect(order.total).toBe(5000 + 800 - 1000);
	});

	test("site 3 — the buyer switches pickup point", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.retailers.updateSettings, {
			offerSelfCollect: true,
		});
		const { pickupLocationId: firstId } = await asUser.mutation(
			api.pickupLocations.create,
			{ retailerId: retailer._id, label: "Main", address: "12 Jln Tun Razak" },
		);
		const { pickupLocationId: secondId } = await asUser.mutation(
			api.pickupLocations.create,
			{ retailerId: retailer._id, label: "Second", address: "20 Jln Ampang" },
		);
		const productId = await seedProduct(t, USER_A, retailer._id);
		const voucher = await mintVoucher(t, USER_A, retailer._id, {
			kind: "fixed",
			value: 1000,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryMethod: "self_collect",
			pickupLocationId: firstId,
			voucherCode: voucher.code,
		});
		await t.mutation(api.orders.updatePickupLocation, {
			token: await tk(t, shortId),
			pickupLocationId: secondId,
		});
		const order = await readOrder(t, await orderIdOf(t, shortId));
		expect(order.pickupLocationId).toBe(secondId);
		expect(order.voucherDiscount).toBe(1000);
		expect(order.total).toBe(4000);
	});

	test("sites 4 and 5 — the seller submits then re-prices a mockup", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Bespoke cake",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [
				{ optionValues: [], price: 5000, onHand: 10 },
				{
					optionValues: [],
					price: 0,
					onHand: 0,
					isCustom: true,
					customLabel: "Bespoke",
				},
			],
		});
		const { fixed, custom } = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", productId))
				.collect();
			return {
				fixed: rows.find((r) => !r.isCustom)!._id,
				custom: rows.find((r) => r.isCustom)!._id,
			};
		});
		const voucher = await mintVoucher(t, USER_A, retailer._id, {
			kind: "fixed",
			value: 1000,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [
				{ variantId: fixed, quantity: 1 },
				{ variantId: custom, quantity: 1 },
			],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
			voucherCode: voucher.code,
		});
		const orderId = await orderIdOf(t, shortId);
		expect((await readOrder(t, orderId)).total).toBe(4000); // 5000 − 1000

		// Site 4: submit with a quote.
		await asUser.mutation(api.orders.submitMockup, {
			orderId,
			storageIds: ["m1"],
			quotedAmount: 20_000,
		});
		let order = await readOrder(t, orderId);
		expect(order.mockupQuotedAmount).toBe(20_000);
		// The QUOTE is not discountable — the voucher still takes 1000 off the
		// item subtotal only.
		expect(order.voucherDiscount).toBe(1000);
		expect(order.total).toBe(5000 + 20_000 - 1000);

		// Site 5: re-price it.
		await asUser.mutation(api.orders.updateMockupQuote, {
			orderId,
			quotedAmount: 25_000,
		});
		order = await readOrder(t, orderId);
		expect(order.voucherDiscount).toBe(1000);
		expect(order.total).toBe(5000 + 25_000 - 1000);
	});

	test("site 6 — the buyer declines the custom line, keeping the rest", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Mixed",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [
				{ optionValues: [], price: 10_000, onHand: 10 },
				{
					optionValues: [],
					price: 0,
					onHand: 0,
					isCustom: true,
					customLabel: "Bespoke",
				},
			],
		});
		const { fixed, custom } = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", productId))
				.collect();
			return {
				fixed: rows.find((r) => !r.isCustom)!._id,
				custom: rows.find((r) => r.isCustom)!._id,
			};
		});
		// A PERCENTAGE voucher, because this is the site where carrying the terms
		// rather than a frozen sen figure earns its keep.
		const voucher = await mintVoucher(t, USER_A, retailer._id, {
			kind: "percent",
			value: 10,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [
				{ variantId: fixed, quantity: 2 },
				{ variantId: custom, quantity: 1 },
			],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
			voucherCode: voucher.code,
		});
		const orderId = await orderIdOf(t, shortId);
		expect((await readOrder(t, orderId)).voucherDiscount).toBe(2000); // 10% of 20000

		await t.mutation(api.orders.declineMockupItem, {
			token: await tk(t, shortId),
		});
		const order = await readOrder(t, orderId);
		expect(order.status).not.toBe("cancelled");
		// One LINE of two units — items are per line, not per unit.
		expect(order.items).toHaveLength(1);
		expect(order.items[0].quantity).toBe(2);
		expect(order.subtotal).toBe(20_000);
		// The percentage FOLLOWED the basket rather than freezing — still 10%.
		expect(order.voucherDiscount).toBe(2000);
		expect(order.total).toBe(18_000);
	});

	test("a fixed voucher RE-CLAMPS when the basket shrinks under it", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Mixed",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [
				{ optionValues: [], price: 1000, onHand: 10 },
				{
					optionValues: [],
					price: 0,
					onHand: 0,
					isCustom: true,
					customLabel: "Bespoke",
				},
			],
		});
		const { fixed, custom } = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", productId))
				.collect();
			return {
				fixed: rows.find((r) => !r.isCustom)!._id,
				custom: rows.find((r) => r.isCustom)!._id,
			};
		});
		const voucher = await mintVoucher(t, USER_A, retailer._id, {
			kind: "fixed",
			value: 3000,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [
				{ variantId: fixed, quantity: 5 }, // 5000
				{ variantId: custom, quantity: 1 },
			],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
			voucherCode: voucher.code,
		});
		const orderId = await orderIdOf(t, shortId);
		expect((await readOrder(t, orderId)).total).toBe(2000); // 5000 − 3000

		// Seller quotes, then the buyer declines the custom line. Nothing about
		// the voucher changed, but the goods it applies to did not shrink here —
		// so prove the clamp on a basket that IS smaller than the voucher by
		// dropping the quote and the custom line together.
		await t.mutation(api.orders.declineMockupItem, {
			token: await tk(t, shortId),
		});
		const order = await readOrder(t, orderId);
		expect(order.subtotal).toBe(5000);
		expect(order.voucherDiscount).toBe(3000);
		expect(order.total).toBe(2000);
		expect(order.total).toBeGreaterThanOrEqual(0);
	});
});

// ---------------------------------------------------------------------------
// The security-deposit regression the extras seam fixes
// ---------------------------------------------------------------------------

describe("orderExtras also closes a deposit leak found on the way", () => {
	test("a booking order's deposit survives an address re-price", async () => {
		// `updateDeliveryAddress` refuses `self_collect` but NOT `booking`, and
		// every recompute site used to hand-list extras WITHOUT
		// `securityDeposit` — so this path silently deleted a booking's deposit
		// from `total`. Reverting the site to its hand-written literal makes this
		// fail. State built with t.run because the public booking flow is not
		// what is under test here; the mutation is still the real one.
		const t = setup();
		const { retailer, productId, voucher } = await scene(t);
		const { shortId } = await placeOrder(
			t,
			retailer._id,
			productId,
			voucher.code,
		);
		const orderId = await orderIdOf(t, shortId);
		await t.run((ctx) =>
			ctx.db.patch(orderId, {
				deliveryMethod: "booking",
				securityDeposit: 15_000,
				total: 5000 + 15_000 - 1000,
			}),
		);
		await t.mutation(api.orders.updateDeliveryAddress, {
			token: await tk(t, shortId),
			deliveryAddress: { ...validAddress, line1: "99 Jln Cempaka" },
		});
		const order = await readOrder(t, orderId);
		expect(order.securityDeposit).toBe(15_000);
		expect(order.total).toBe(5000 + 15_000 - 1000);
	});
});

// ---------------------------------------------------------------------------
// Guard rails — thresholds judge the PRE-discount subtotal
// ---------------------------------------------------------------------------

describe("guard rails", () => {
	test("a minimum order value judges the subtotal BEFORE the discount", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.retailers.updateSettings, {
			minOrderValue: 5000,
		});
		const productId = await seedProduct(t, USER_A, retailer._id, 5000);
		// A 50% code would take the basket to RM25 — under the RM50 minimum. The
		// order must still be ACCEPTED: the rule is about what the buyer bought,
		// not what the seller chose to knock off.
		const voucher = await mintVoucher(t, USER_A, retailer._id, {
			kind: "percent",
			value: 50,
		});
		const { shortId } = await placeOrder(
			t,
			retailer._id,
			productId,
			voucher.code,
		);
		const order = await readOrder(t, await orderIdOf(t, shortId));
		expect(order.subtotal).toBe(5000);
		expect(order.total).toBe(2500);
	});

	test("a free-delivery threshold judges the subtotal BEFORE the discount", async () => {
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		await asUser.mutation(api.retailers.updateSettings, {
			offerDelivery: true,
			deliveryConfig: { mode: "flat", fee: 800, freeAbove: 5000 },
		});
		const productId = await seedProduct(t, USER_A, retailer._id, 5000);
		const voucher = await mintVoucher(t, USER_A, retailer._id, {
			kind: "fixed",
			value: 1000,
		});
		const { shortId } = await placeOrder(
			t,
			retailer._id,
			productId,
			voucher.code,
		);
		const order = await readOrder(t, await orderIdOf(t, shortId));
		// RM50 subtotal still clears the RM50 free-delivery line even though the
		// buyer pays RM40 — the discount must not claw the fee back.
		expect(order.deliveryFee).toBeUndefined();
		expect(order.total).toBe(4000);
	});

	test("a voucher order still uses exactly one credit", async () => {
		// docs/vouchers.md: a discount is not a discount on METERING —
		// `recordOrderCreated` is unchanged, so a voucher order debits its one
		// credit like any other. Compared against an identical order placed
		// WITHOUT a code, so this measures the voucher's effect rather than the
		// ledger's shape.
		const t = setup();
		const { retailer, productId, voucher } = await scene(t);
		// One order = one credit off the plan balance: a `reason: "order"` row
		// of −1 (convex/credits.ts `applyEntry`).
		const debits = () =>
			t.run(async (ctx) =>
				(await ctx.db.query("creditLedger").collect()).filter(
					(r) => r.reason === "order" && r.amount < 0,
				),
			);
		await placeOrder(t, retailer._id, productId);
		const afterPlain = (await debits()).length;
		await placeOrder(t, retailer._id, productId, voucher.code);
		const afterVoucher = (await debits()).length;
		expect(afterPlain).toBeGreaterThanOrEqual(1);
		expect(afterVoucher - afterPlain).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Hand-back on cancel — every seam, any cause
// ---------------------------------------------------------------------------

describe("a cancelled order returns its voucher", () => {
	test("the seller cancels — back to active, ready to spend again", async () => {
		const t = setup();
		const { retailer, productId, voucher } = await scene(t);
		const { shortId } = await placeOrder(
			t,
			retailer._id,
			productId,
			voucher.code,
		);
		const orderId = await orderIdOf(t, shortId);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orders.updateStatus, { orderId, status: "cancelled" });
		const row = await readVoucher(t, voucher.id);
		expect(row?.status).toBe("active");
		expect(row?.redeemedOrderId).toBeUndefined();
		expect(row?.redeemedAt).toBeUndefined();
		// And it genuinely works again.
		const second = await placeOrder(
			t,
			retailer._id,
			productId,
			voucher.code,
		);
		expect(
			(await readOrder(t, await orderIdOf(t, second.shortId))).total,
		).toBe(4000);
	});

	test("the buyer declines a custom-ONLY order — the other cancel seam", async () => {
		// `declineMockupItem` open-codes its reversal rather than going through
		// `applyStatusTransition`, so it has to hand the voucher back itself.
		const t = setup();
		const retailer = await seedRetailer(t, USER_A);
		const asUser = t.withIdentity({ subject: USER_A });
		const productId = await asUser.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Bespoke only",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [
				{
					optionValues: [],
					price: 4000,
					onHand: 0,
					isCustom: true,
					customLabel: "Bespoke",
				},
			],
		});
		const customId = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", productId))
				.collect();
			return rows[0]._id;
		});
		const voucher = await mintVoucher(t, USER_A, retailer._id, {
			kind: "fixed",
			value: 1000,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId: retailer._id,
			items: [{ variantId: customId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer,
			deliveryAddress: validAddress,
			voucherCode: voucher.code,
		});
		expect((await readVoucher(t, voucher.id))?.status).toBe("redeemed");
		await t.mutation(api.orders.declineMockupItem, {
			token: await tk(t, shortId),
		});
		const order = await readOrder(t, await orderIdOf(t, shortId));
		expect(order.status).toBe("cancelled");
		expect((await readVoucher(t, voucher.id))?.status).toBe("active");
	});

	test("a VOIDED voucher is not resurrected by a cancellation", async () => {
		// The seller withdrew it deliberately; an order ending afterwards must
		// not put it back in play.
		const t = setup();
		const { retailer, productId, voucher } = await scene(t);
		const { shortId } = await placeOrder(
			t,
			retailer._id,
			productId,
			voucher.code,
		);
		const orderId = await orderIdOf(t, shortId);
		// Void it behind the order's back (voidVoucher itself refuses a redeemed
		// row, so this is the state a future feature could produce).
		await t.run((ctx) =>
			ctx.db.patch(voucher.id, { status: "voided", voidedAt: Date.now() }),
		);
		await t
			.withIdentity({ subject: USER_A })
			.mutation(api.orders.updateStatus, { orderId, status: "cancelled" });
		expect((await readVoucher(t, voucher.id))?.status).toBe("voided");
	});

	test("a cancel never steals a voucher another order now holds", async () => {
		const t = setup();
		const { retailer, productId, voucher } = await scene(t);
		const first = await placeOrder(t, retailer._id, productId, voucher.code);
		const firstId = await orderIdOf(t, first.shortId);
		const asUser = t.withIdentity({ subject: USER_A });
		// Cancel → voucher back to active → spent on a second order.
		await asUser.mutation(api.orders.updateStatus, {
			orderId: firstId,
			status: "cancelled",
		});
		const second = await placeOrder(t, retailer._id, productId, voucher.code);
		const secondId = await orderIdOf(t, second.shortId);
		expect((await readVoucher(t, voucher.id))?.redeemedOrderId).toBe(secondId);
		// Re-cancelling the FIRST order must be a no-op on the voucher.
		await asUser.mutation(api.orders.updateStatus, {
			orderId: firstId,
			status: "cancelled",
		});
		const row = await readVoucher(t, voucher.id);
		expect(row?.status).toBe("redeemed");
		expect(row?.redeemedOrderId).toBe(secondId);
	});
});
