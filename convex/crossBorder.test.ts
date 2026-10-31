/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { CROSS_BORDER_MIN_NOTICE_DAYS } from "./lib/crossBorder";
import { fulfilmentDateBounds } from "./lib/fulfilmentDate";
import schema from "./schema";

// Cross-border delivery MY ↔ SG (z8r3fdr5yy) through the real doors: the
// settings write that opens a lane, the public quote checkout reads, the
// order create that freezes it, the buyer's address edit, the product
// opt-out and the /stores listing. The pure rules live in
// lib/crossBorder.test.ts; this file proves every door ASKS them.

const modules = import.meta.glob("./**/*.ts");
const OWNER = "user_owner";

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

type T = ReturnType<typeof setup>;

const MY_ADDRESS = {
	line1: "12 Jln Mawar 3",
	city: "Petaling Jaya",
	state: "Selangor",
	postcode: "47301",
};
const SG_ADDRESS = {
	line1: "Blk 123 Bedok North Ave 3",
	city: "Singapore",
	state: "Singapore",
	postcode: "460123",
	country: "SG" as const,
};

/** A MY store on a flat RM8 domestic fee, with one ambient product (keropok,
 * 500 g) and one frozen one (lekor, 1 kg). */
async function seedStore(t: T) {
	const asOwner = t.withIdentity({ subject: OWNER });
	await asOwner.mutation(api.retailers.createRetailer, {
		storeName: "Lekor Mr Ganu",
		slug: "lekor",
	});
	const retailer = await asOwner.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await asOwner.mutation(api.retailers.updateSettings, {
		deliveryConfig: { mode: "flat", fee: 800 },
	});
	const keropok = await asOwner.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Keropok (ambient pack)",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 1500, onHand: 50, parcelWeightG: 500 }],
	});
	const lekor = await asOwner.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Frozen lekor",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 1,
		blockWhenOutOfStock: false,
		requiresProof: false,
		variants: [{ optionValues: [], price: 2000, onHand: 50, parcelWeightG: 1000 }],
	});
	return { asOwner, retailerId: retailer._id, keropok, lekor };
}

/** Save a lane and confirm its products — the seller's two steps. A new
 * lane is HELD until the second (Zaki, 30 Oct). */
async function openLane(
	asOwner: ReturnType<T["withIdentity"]>,
	pricing:
		| { kind: "flat"; fee: number; freeAbove?: number }
		| { kind: "weight"; bands: Array<{ maxKg: number; fee: number }> }
		| { kind: "free" } = { kind: "flat", fee: 2500 },
) {
	await asOwner.mutation(api.retailers.updateSettings, {
		crossBorderLanes: [{ country: "SG", pricing }],
	});
	const mine = await asOwner.query(api.retailers.getMyRetailer);
	if (!mine) throw new Error("no store");
	await asOwner.mutation(api.crossBorder.setDomesticOnly, {
		retailerId: mine._id,
		changes: [],
		confirmLane: true,
	});
}

async function placeOrder(
	t: T,
	retailerId: Id<"retailers">,
	productIds: Id<"products">[],
	deliveryAddress: typeof MY_ADDRESS | typeof SG_ADDRESS,
) {
	return t.mutation(api.orders.create, {
		retailerId,
		items: productIds.map((productId) => ({ productId, quantity: 1 })),
		currency: "MYR",
		channel: "whatsapp",
		customer: { name: "Mei Ling", waPhone: "6598765432", waDialCountry: "SG" },
		deliveryAddress,
	});
}

async function orderByShortId(t: T, shortId: string) {
	const order = await t.run((ctx) =>
		ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.first(),
	);
	if (!order) throw new Error("order not found");
	return order;
}

async function setPlan(t: T, retailerId: Id<"retailers">, plan: "starter" | "pro") {
	await t.run(async (ctx) => {
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!sub) throw new Error("no subscription");
		await ctx.db.patch(sub._id, { plan, status: "active" });
	});
}

describe("opening a lane (retailers.updateSettings)", () => {
	test("a Pro store on its own pricing saves a lane, and the storefront offers the country", async () => {
		const t = setup();
		const { asOwner } = await seedStore(t);
		await openLane(asOwner);
		const store = await t.query(api.retailers.getRetailerBySlug, { slug: "lekor" });
		expect(store.status === "ok" && store.retailer.shipsAbroadTo).toEqual(["SG"]);
	});

	test("refuses a lane to the store's own country", async () => {
		const t = setup();
		const { asOwner } = await seedStore(t);
		await expect(
			asOwner.mutation(api.retailers.updateSettings, {
				crossBorderLanes: [{ country: "MY", pricing: { kind: "free" } }],
			}),
		).rejects.toThrow(/another country/);
	});

	test("refuses on Starter — the whole lane is Pro, gated at the address", async () => {
		const t = setup();
		const { asOwner, retailerId } = await seedStore(t);
		await setPlan(t, retailerId, "starter");
		await expect(openLane(asOwner)).rejects.toThrow(/Pro plan/);
	});

	test("live courier pricing at home no longer blocks a lane — it carries its own price (Zaki, 30 Oct)", async () => {
		const t = setup();
		const { asOwner, retailerId } = await seedStore(t);
		await t.run((ctx) =>
			ctx.db.patch(retailerId, {
				deliveryConfig: { mode: "live", onUnquotable: "block" },
			}),
		);
		await openLane(asOwner);
		const store = await t.query(api.retailers.getRetailerBySlug, { slug: "lekor" });
		expect(store.status === "ok" && store.retailer.shipsAbroadTo).toEqual(["SG"]);
	});

	test("a new lane is held until its products are confirmed — then offered (Zaki, 30 Oct)", async () => {
		const t = setup();
		const { asOwner, retailerId } = await seedStore(t);
		await asOwner.mutation(api.retailers.updateSettings, {
			crossBorderLanes: [{ country: "SG", pricing: { kind: "flat", fee: 2500 } }],
		});
		const held = await t.query(api.retailers.getRetailerBySlug, { slug: "lekor" });
		expect(held.status === "ok" && held.retailer.shipsAbroadTo).toEqual([]);
		await asOwner.mutation(api.crossBorder.setDomesticOnly, {
			retailerId,
			changes: [],
			confirmLane: true,
		});
		const live = await t.query(api.retailers.getRetailerBySlug, { slug: "lekor" });
		expect(live.status === "ok" && live.retailer.shipsAbroadTo).toEqual(["SG"]);
		// Editing the price later never re-holds a confirmed lane.
		await asOwner.mutation(api.retailers.updateSettings, {
			crossBorderLanes: [{ country: "SG", pricing: { kind: "flat", fee: 3000 } }],
		});
		const edited = await t.query(api.retailers.getRetailerBySlug, { slug: "lekor" });
		expect(edited.status === "ok" && edited.retailer.shipsAbroadTo).toEqual(["SG"]);
	});

	test("a zero flat fee is refused — free is its own explicit choice", async () => {
		const t = setup();
		const { asOwner } = await seedStore(t);
		await expect(openLane(asOwner, { kind: "flat", fee: 0 })).rejects.toThrow(
			/Delivery fee to Singapore/,
		);
	});

	test("null turns it off, and the storefront stops offering the country", async () => {
		const t = setup();
		const { asOwner } = await seedStore(t);
		await openLane(asOwner);
		await asOwner.mutation(api.retailers.updateSettings, { crossBorderLanes: null });
		const store = await t.query(api.retailers.getRetailerBySlug, { slug: "lekor" });
		expect(store.status === "ok" && store.retailer.shipsAbroadTo).toEqual([]);
	});
});

describe("orders.create — a cross-border order", () => {
	test("an SG address on a MY store with a lane: priced by the lane, address stamped SG", async () => {
		const t = setup();
		const { asOwner, retailerId, keropok } = await seedStore(t);
		await openLane(asOwner, { kind: "flat", fee: 2500 });
		const { shortId } = await placeOrder(t, retailerId, [keropok], SG_ADDRESS);
		const order = await orderByShortId(t, shortId);
		expect(order.deliveryAddress?.country).toBe("SG");
		expect(order.deliveryAddress?.postcode).toBe("460123");
		// The lane's RM25, never the domestic RM8.
		expect(order.deliveryFee).toBe(2500);
		expect(order.total).toBe(1500 + 2500);
	});

	test("a domestic order is unchanged, and stamped with the store's country", async () => {
		const t = setup();
		const { asOwner, retailerId, keropok } = await seedStore(t);
		await openLane(asOwner);
		const { shortId } = await placeOrder(t, retailerId, [keropok], MY_ADDRESS);
		const order = await orderByShortId(t, shortId);
		expect(order.deliveryAddress?.country).toBe("MY");
		expect(order.deliveryFee).toBe(800);
	});

	test("refused without a lane — a MY postcode rule can't let an SG address in either", async () => {
		const t = setup();
		const { retailerId, keropok } = await seedStore(t);
		await expect(
			placeOrder(t, retailerId, [keropok], SG_ADDRESS),
		).rejects.toThrow(/isn't delivering to Singapore/);
	});

	test("a cart holding a home-only product is refused, naming it — never split", async () => {
		const t = setup();
		const { asOwner, retailerId, keropok, lekor } = await seedStore(t);
		await openLane(asOwner);
		await asOwner.mutation(api.crossBorder.setDomesticOnly, {
			retailerId,
			changes: [{ productId: lekor, domesticOnly: true }],
		});
		await expect(
			placeOrder(t, retailerId, [keropok, lekor], SG_ADDRESS),
		).rejects.toThrow(/Frozen lekor ships within Malaysia only/);
		// The same cart to a Malaysian address is fine.
		await expect(
			placeOrder(t, retailerId, [keropok, lekor], MY_ADDRESS),
		).resolves.toBeDefined();
	});

	test("a downgrade pauses the lane at every door — no settings write needed", async () => {
		const t = setup();
		const { asOwner, retailerId, keropok } = await seedStore(t);
		await openLane(asOwner);
		await setPlan(t, retailerId, "starter");
		await expect(
			placeOrder(t, retailerId, [keropok], SG_ADDRESS),
		).rejects.toThrow(/isn't delivering to Singapore/);
		// The stored lane survives the pause and revives on upgrade.
		await setPlan(t, retailerId, "pro");
		await expect(
			placeOrder(t, retailerId, [keropok], SG_ADDRESS),
		).resolves.toBeDefined();
	});

	test("a weight-banded lane prices by the cart's parcel weight", async () => {
		const t = setup();
		const { asOwner, retailerId, keropok, lekor } = await seedStore(t);
		await openLane(asOwner, {
			kind: "weight",
			bands: [
				{ maxKg: 1, fee: 1800 },
				{ maxKg: 3, fee: 3200 },
			],
		});
		// 0.5 kg → first band.
		const light = await placeOrder(t, retailerId, [keropok], SG_ADDRESS);
		expect((await orderByShortId(t, light.shortId)).deliveryFee).toBe(1800);
		// 1.5 kg → second band.
		const heavier = await placeOrder(t, retailerId, [keropok, lekor], SG_ADDRESS);
		expect((await orderByShortId(t, heavier.shortId)).deliveryFee).toBe(3200);
	});

	test("free to Singapore: no fee stored", async () => {
		const t = setup();
		const { asOwner, retailerId, keropok } = await seedStore(t);
		await openLane(asOwner, { kind: "free" });
		const { shortId } = await placeOrder(t, retailerId, [keropok], SG_ADDRESS);
		expect((await orderByShortId(t, shortId)).deliveryFee).toBeUndefined();
	});
});

describe("delivery.quote — what checkout shows before submit", () => {
	test("abroad: the lane's price; home-only items named; no lane → no_lane", async () => {
		const t = setup();
		const { asOwner, retailerId, keropok, lekor } = await seedStore(t);
		const variantOf = async (productId: Id<"products">) =>
			(
				await t.run((ctx) =>
					ctx.db
						.query("productVariants")
						.withIndex("by_product", (q) => q.eq("productId", productId))
						.first(),
				)
			)?._id as Id<"productVariants">;
		const keropokVariant = await variantOf(keropok);
		const lekorVariant = await variantOf(lekor);

		expect(
			await t.query(api.delivery.quote, {
				retailerId,
				subtotal: 1500,
				country: "SG",
				items: [{ variantId: keropokVariant, quantity: 1 }],
			}),
		).toEqual({ kind: "no_lane" });

		await openLane(asOwner, { kind: "flat", fee: 2500 });
		expect(
			await t.query(api.delivery.quote, {
				retailerId,
				subtotal: 1500,
				country: "SG",
				items: [{ variantId: keropokVariant, quantity: 1 }],
			}),
		).toEqual({ kind: "fee", fee: 2500 });
		// The domestic quote is untouched by the lane.
		expect(
			await t.query(api.delivery.quote, { retailerId, subtotal: 1500 }),
		).toEqual({ kind: "fee", fee: 800 });

		await asOwner.mutation(api.crossBorder.setDomesticOnly, {
			retailerId,
			changes: [{ productId: lekor, domesticOnly: true }],
		});
		expect(
			await t.query(api.delivery.quote, {
				retailerId,
				subtotal: 3500,
				country: "SG",
				items: [
					{ variantId: keropokVariant, quantity: 1 },
					{ variantId: lekorVariant, quantity: 1 },
				],
			}),
		).toEqual({
			kind: "home_only",
			products: [{ productId: lekor, name: "Frozen lekor" }],
		});
	});
});

describe("the address edit keeps the order's country", () => {
	test("an SG order can be re-addressed within Singapore, never moved to Malaysia", async () => {
		const t = setup();
		const { asOwner, retailerId, keropok } = await seedStore(t);
		await openLane(asOwner);
		const { shortId } = await placeOrder(t, retailerId, [keropok], SG_ADDRESS);
		const order = await orderByShortId(t, shortId);
		const token = order.trackingToken as string;
		await t.mutation(api.orders.updateDeliveryAddress, {
			token,
			deliveryAddress: { ...SG_ADDRESS, postcode: "528523" },
		});
		expect((await orderByShortId(t, shortId)).deliveryAddress?.postcode).toBe(
			"528523",
		);
		await expect(
			t.mutation(api.orders.updateDeliveryAddress, {
				token,
				deliveryAddress: { ...MY_ADDRESS, country: "MY" },
			}),
		).rejects.toThrow(/can't change after ordering/);
	});
});

describe("the product opt-out (crossBorder.setDomesticOnly)", () => {
	test("a service has no parcel — it can't be turned on", async () => {
		const t = setup();
		const { asOwner, retailerId } = await seedStore(t);
		const service = await asOwner.mutation(api.products.create, {
			retailerId,
			name: "Tent wash",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 2,
			kind: "service",
			blockWhenOutOfStock: false,
			requiresProof: false,
			variants: [{ optionValues: [], price: 5000, onHand: 10 }],
		});
		await expect(
			asOwner.mutation(api.crossBorder.setDomesticOnly, {
				retailerId,
				changes: [{ productId: service, domesticOnly: false }],
			}),
		).rejects.toThrow(/no parcel to ship/);
		const choices = await asOwner.query(api.crossBorder.productChoices, {
			retailerId,
		});
		expect(choices.products.find((p) => p._id === service)?.reason).toBe(
			"no_parcel",
		);
	});

	test("turning a product back on clears the field — one spelling of the default", async () => {
		const t = setup();
		const { asOwner, retailerId, lekor } = await seedStore(t);
		await asOwner.mutation(api.crossBorder.setDomesticOnly, {
			retailerId,
			changes: [{ productId: lekor, domesticOnly: true }],
		});
		await asOwner.mutation(api.crossBorder.setDomesticOnly, {
			retailerId,
			changes: [{ productId: lekor, domesticOnly: false }],
		});
		const row = await t.run((ctx) => ctx.db.get(lekor));
		expect(row?.domesticOnly).toBeUndefined();
	});
});

describe("/stores — listed abroad only while delivering there", () => {
	test("a MY store with a live lane is listed in SG with its country; without one, it isn't", async () => {
		const t = setup();
		const { asOwner } = await seedStore(t);
		const sgBefore = await t.query(api.marketplace.listStores, { country: "SG" });
		expect(sgBefore.map((c) => c.slug)).not.toContain("lekor");
		await openLane(asOwner);
		const sg = await t.query(api.marketplace.listStores, { country: "SG" });
		const card = sg.find((c) => c.slug === "lekor");
		expect(card?.shipsFrom).toBe("MY");
		expect(card?.sponsored).toBe(false);
		// At home it's an ordinary card.
		const my = await t.query(api.marketplace.listStores, { country: "MY" });
		expect(my.find((c) => c.slug === "lekor")?.shipsFrom).toBeUndefined();
	});

	test("a store whose whole shelf stays home is not listed abroad", async () => {
		const t = setup();
		const { asOwner, retailerId, keropok, lekor } = await seedStore(t);
		await openLane(asOwner);
		await asOwner.mutation(api.crossBorder.setDomesticOnly, {
			retailerId,
			changes: [
				{ productId: keropok, domesticOnly: true },
				{ productId: lekor, domesticOnly: true },
			],
		});
		const sg = await t.query(api.marketplace.listStores, { country: "SG" });
		expect(sg.map((c) => c.slug)).not.toContain("lekor");
	});

	test("one shippable product behind 20+ home-only ones still lists the store (PR #431 review)", async () => {
		// A frozen seller marks most of the shelf domestic-only; the dry goods
		// that CAN cross are the newest rows. A fixed read window judged only
		// the oldest ones and dropped the store from the other country's
		// directory — the scan must reach the first shippable product.
		const t = setup();
		const { asOwner, retailerId, keropok, lekor } = await seedStore(t);
		await openLane(asOwner);
		await asOwner.mutation(api.crossBorder.setDomesticOnly, {
			retailerId,
			changes: [
				{ productId: keropok, domesticOnly: true },
				{ productId: lekor, domesticOnly: true },
			],
		});
		// 20 more home-only rows, cloned straight into the table: the listing
		// reads products only, and `products.create` is rate-limited to 20/min.
		await t.run(async (ctx) => {
			const { _id, _creationTime, ...template } = (await ctx.db.get(lekor))!;
			for (let i = 0; i < 20; i++) {
				await ctx.db.insert("products", {
					...template,
					name: `Frozen pack ${i}`,
					slug: `frozen-pack-${i}`,
					sortOrder: 2 + i,
				});
			}
		});
		expect(
			(await t.query(api.marketplace.listStores, { country: "SG" })).map(
				(c) => c.slug,
			),
		).not.toContain("lekor");
		await asOwner.mutation(api.products.create, {
			retailerId,
			name: "Dried keropok (newest)",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 99,
			blockWhenOutOfStock: false,
			requiresProof: false,
			variants: [{ optionValues: [], price: 1200, onHand: 50, parcelWeightG: 300 }],
		});
		const sg = await t.query(api.marketplace.listStores, { country: "SG" });
		expect(sg.find((c) => c.slug === "lekor")?.shipsFrom).toBe("MY");
	});
});

describe("a lane priced live by EasyParcel (z8r3fdr5yy)", () => {
	beforeEach(() => {
		vi.stubEnv("EASYPARCEL_CLIENT_ID", "client-id-test");
		vi.stubEnv("EASYPARCEL_CLIENT_SECRET", "client-secret-test");
		vi.stubEnv("CONVEX_SITE_URL", "https://dev-test.convex.site");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	const quotation = (service_id: string, amount: number) => ({
		courier: {
			service_id,
			service_name: `${service_id} (Pick Up) (From Door to Door)`,
			courier_id: "EP-CR0AP",
			courier_name: "SF Express",
			delivery_duration: null,
			is_pickup: true,
			is_dropoff: false,
		},
		pricing: { currency: "MYR", total_amount: amount + 1, seller_payable_amount: amount },
	});

	/** EasyParcel answers every quote with one door service at RM 27.31, and
	 * records what it was asked. */
	function mockQuotes() {
		const asked: Array<Record<string, unknown>> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
				const url = String(input instanceof Request ? input.url : input);
				if (url.endsWith("/shipment/quotations")) {
					asked.push(JSON.parse(String(init?.body ?? "{}")));
					return new Response(
						JSON.stringify({
							status_code: 200,
							data: [{ status: "success", quotations: [quotation("EP-SF", 27.31)] }],
						}),
						{ status: 200 },
					);
				}
				throw new Error(`unmocked fetch ${url}`);
			}),
		);
		return asked;
	}

	async function seedLiveLane(t: T, opts: { revoked?: boolean } = {}) {
		const seeded = await seedStore(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(seeded.retailerId, { waPhone: "60123456789" });
			await ctx.db.insert("easyparcelConnections", {
				retailerId: seeded.retailerId,
				enabled: true,
				accessToken: "access-live",
				refreshToken: "refresh-live",
				accessExpiresAt: Date.now() + 60 * 60 * 1000,
				balanceCurrency: "MYR",
				pickupAddress: {
					address1: "Jalan Stesen Sentral",
					city: "Kuala Lumpur",
					state: "WP Kuala Lumpur",
					postcode: "50470",
				},
				connectedAt: Date.now(),
				updatedAt: Date.now(),
				...(opts.revoked ? { revokedAt: Date.now() } : {}),
			});
		});
		await seeded.asOwner.mutation(api.retailers.updateSettings, {
			crossBorderLanes: [{ country: "SG", pricing: { kind: "live" } }],
		});
		await seeded.asOwner.mutation(api.crossBorder.setDomesticOnly, {
			retailerId: seeded.retailerId,
			changes: [],
			confirmLane: true,
		});
		return seeded;
	}

	async function quote(t: T, retailerId: Id<"retailers">, variantId: Id<"productVariants">, postcode: string) {
		return t.action(api.liveQuote.quoteForCheckout, {
			retailerId,
			address: "Blk 123 Bedok North Ave 3",
			country: "SG",
			state: "Singapore",
			postcode,
			items: [{ variantId, quantity: 1 }],
		});
	}

	async function variantOf(t: T, productId: Id<"products">) {
		const v = await t.run((ctx) =>
			ctx.db
				.query("productVariants")
				.withIndex("by_product", (q) => q.eq("productId", productId))
				.first(),
		);
		if (!v) throw new Error("no variant");
		return v._id;
	}

	test("offered abroad, and checkout is told to fetch EasyParcel's price", async () => {
		const t = setup();
		const { retailerId, keropok } = await seedLiveLane(t);
		const store = await t.query(api.retailers.getRetailerBySlug, { slug: "lekor" });
		expect(store.status === "ok" && store.retailer.shipsAbroadTo).toEqual(["SG"]);
		const preview = await t.query(api.delivery.quote, {
			retailerId,
			subtotal: 1500,
			country: "SG",
			items: [{ variantId: await variantOf(t, keropok), quantity: 1 }],
		});
		expect(preview).toMatchObject({ kind: "live", couriers: true, riders: false });
	});

	test("quoted on the POSTCODE with no pin, to the real receiver country, and frozen at the order door", async () => {
		const t = setup();
		const asked = mockQuotes();
		const { retailerId, keropok } = await seedLiveLane(t);
		const result = await quote(t, retailerId, await variantOf(t, keropok), "460123");
		expect(result).toMatchObject({ status: "quoted", fee: 2731 });
		expect(JSON.stringify(asked[0])).toMatch(/"SG"/);
		if (result.status !== "quoted") throw new Error("not quoted");
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId: keropok, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Mei Ling", waPhone: "6598765432", waDialCountry: "SG" },
			deliveryAddress: SG_ADDRESS,
			deliveryQuoteId: result.quoteId,
		});
		const order = await orderByShortId(t, shortId);
		expect(order.deliveryFee).toBe(2731);
		expect(order.deliverySnapshot?.quoteProvider).toBe("easyparcel");
	});

	test("an order abroad can't be for today or tomorrow — the lane's notice floors the date at the door", async () => {
		// The checkout offered "Today" for an SG→MY parcel (staging test,
		// 31 Oct 2026). The same floor the picker now applies is enforced here,
		// so a stale tab can't promise what no courier can do.
		const t = setup();
		mockQuotes();
		const { retailerId, keropok } = await seedLiveLane(t);
		const result = await quote(t, retailerId, await variantOf(t, keropok), "460123");
		if (result.status !== "quoted") throw new Error("not quoted");
		const DAY_MS = 24 * 60 * 60 * 1000;
		const today = fulfilmentDateBounds(0).min;
		const create = (fulfilmentDate: number) =>
			t.mutation(api.orders.create, {
				retailerId,
				items: [{ productId: keropok, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer: { name: "Mei Ling", waPhone: "6598765432", waDialCountry: "SG" },
				deliveryAddress: SG_ADDRESS,
				deliveryQuoteId: result.quoteId,
				fulfilmentDate,
			});
		await expect(create(today + DAY_MS)).rejects.toThrow(/too soon/i);
		const { shortId } = await create(
			today + CROSS_BORDER_MIN_NOTICE_DAYS * DAY_MS,
		);
		expect((await orderByShortId(t, shortId)).fulfilmentDate).toBe(
			today + CROSS_BORDER_MIN_NOTICE_DAYS * DAY_MS,
		);
	});

	test("a quote for one postcode never prices an order to another", async () => {
		const t = setup();
		mockQuotes();
		const { retailerId, keropok } = await seedLiveLane(t);
		const result = await quote(t, retailerId, await variantOf(t, keropok), "460123");
		if (result.status !== "quoted") throw new Error("not quoted");
		await expect(
			t.mutation(api.orders.create, {
				retailerId,
				items: [{ productId: keropok, quantity: 1 }],
				currency: "MYR",
				channel: "whatsapp",
				customer: { name: "Mei Ling", waPhone: "6598765432", waDialCountry: "SG" },
				deliveryAddress: { ...SG_ADDRESS, postcode: "520123" },
				deliveryQuoteId: result.quoteId,
			}),
		).rejects.toThrow(/re-enter your postal code/);
	});

	// PR #435 review: a stale tab reaching the door with no quote was told to
	// "pick your address from the suggestions" — the overseas checkout has none.
	test("no quote at all: the refusal names the postal code, never a map suggestion", async () => {
		const t = setup();
		mockQuotes();
		const { retailerId, keropok } = await seedLiveLane(t);
		const attempt = t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId: keropok, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			customer: { name: "Mei Ling", waPhone: "6598765432", waDialCountry: "SG" },
			deliveryAddress: SG_ADDRESS,
		});
		await expect(attempt).rejects.toThrow(
			"We couldn't confirm the delivery price to Singapore for this address — re-enter your postal code to get a fresh price, then try again.",
		);
	});

	test("held — never offered — while EasyParcel can't quote, and the seller is told why", async () => {
		const t = setup();
		const { asOwner, retailerId } = await seedLiveLane(t, { revoked: true });
		const store = await t.query(api.retailers.getRetailerBySlug, { slug: "lekor" });
		expect(store.status === "ok" && store.retailer.shipsAbroadTo).toEqual([]);
		const overview = await asOwner.query(api.crossBorder.settingsOverview, {
			retailerId,
		});
		expect(overview.lanes.pause).toBe("courier_unavailable");
		expect(overview.lanes.easyparcelBlock).toBe("reconnect_needed");
	});
});
