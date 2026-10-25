/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * Heavy carts and Lalamove's vehicles (25 Oct 2026). Lalamove prices by
 * vehicle, never by weight, and never refuses an overweight trip — so a
 * motorcycle store was quoted a motorcycle for 25 kg. The rider quote and the
 * dispatch default now pick the smallest vehicle, from the seller's own, that
 * Lalamove's published `/v3/cities` load says can carry the cart.
 *
 * Measured on the MY sandbox the same day: motorcycle 10 kg, car 40 kg; 25
 * mugs (10 kg) quoted a motorcycle at RM 27.40, 26 mugs (10.4 kg) a car at
 * RM 44.80.
 */

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_lalamove_heavy";
const MY_LOADS = [
	{ key: "CAR", loadKg: 40 },
	{ key: "MOTORCYCLE", loadKg: 10 },
];
const KL = {
	latitude: 3.1478,
	longitude: 101.6953,
	address: "Jalan Ampang, 50450 Kuala Lumpur",
};

afterEach(() => {
	vi.unstubAllGlobals();
});

/** A live-priced store with Lalamove riders armed (MOTORCYCLE) and one 1 kg
 * product; Delyva deliberately absent so the rider is the only bidder. */
async function seedStore(t: ReturnType<typeof setup>) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Beras Borong",
		slug: "beras-borong-heavy",
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await t.run(async (ctx) => {
		await ctx.db.patch(retailer._id, {
			currency: "MYR",
			waPhone: "60198765432",
			deliveryConfig: { mode: "live", onUnquotable: "block" },
			businessAddress: { label: "Kedai", latitude: 3.139, longitude: 101.6869 },
			deliveryBooking: {
				enabled: true,
				vehicleType: "MOTORCYCLE",
				apiKey: "pk_test_heavy",
				apiSecret: "sk_test_heavy",
				env: "sandbox",
			},
		});
	});
	const productId = await asUser.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Beras 1kg",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		blockWhenOutOfStock: false,
		variants: [{ optionValues: [], price: 500, onHand: 100, parcelWeightG: 1000 }],
	});
	const variantId = await t.run(async (ctx) => {
		const v = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.first();
		if (!v) throw new Error("no variant");
		return v._id;
	});
	return { asUser, retailerId: retailer._id as Id<"retailers">, productId, variantId };
}

async function cacheLoads(t: ReturnType<typeof setup>, fetchedAt = Date.now()) {
	await t.run(async (ctx) => {
		await ctx.db.insert("lalamoveVehicleLoads", {
			market: "MY",
			env: "sandbox",
			loads: MY_LOADS,
			fetchedAt,
		});
	});
}

/** Routes Lalamove calls: `/v3/cities` answers the MY catalogue (or fails),
 * `/v3/quotations` records the vehicle it was asked for. */
function stubLalamove(opts: { citiesFail?: boolean } = {}) {
	const quotedVehicles: string[] = [];
	const paths: string[] = [];
	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url).pathname;
		paths.push(path);
		if (path === "/v3/cities") {
			if (opts.citiesFail) return new Response("boom", { status: 500 });
			return new Response(
				JSON.stringify({
					data: [
						{
							locode: "MY KUL",
							services: [
								{ key: "MOTORCYCLE", load: { value: "10", unit: "kg" } },
								{ key: "CAR", load: { value: "40", unit: "kg" } },
							],
						},
					],
				}),
				{ status: 200 },
			);
		}
		const body = JSON.parse(String(init?.body ?? "{}"));
		const vehicle = body?.data?.serviceType as string;
		quotedVehicles.push(vehicle);
		return new Response(
			JSON.stringify({
				data: {
					quotationId: `q-${vehicle}`,
					priceBreakdown: {
						total: vehicle === "CAR" ? "44.80" : "27.40",
						currency: "MYR",
					},
					stops: [{ stopId: "a" }, { stopId: "b" }],
				},
			}),
			{ status: 201 },
		);
	});
	vi.stubGlobal("fetch", fetchMock);
	return { quotedVehicles, paths };
}

function quote(
	t: ReturnType<typeof setup>,
	retailerId: Id<"retailers">,
	variantId: Id<"productVariants">,
	quantity: number,
) {
	return t.action(api.liveQuote.quoteForCheckout, {
		retailerId,
		...KL,
		items: [{ variantId, quantity }],
	});
}

describe("the checkout rider quote picks the vehicle that can carry the cart", () => {
	test("a cart the motorcycle can carry is quoted on the motorcycle", async () => {
		const t = setup();
		const { retailerId, variantId } = await seedStore(t);
		await cacheLoads(t);
		const lm = stubLalamove();
		expect(await quote(t, retailerId, variantId, 10)).toMatchObject({
			status: "quoted",
			fee: 2740,
		});
		expect(lm.quotedVehicles).toEqual(["MOTORCYCLE"]);
	});

	test("over the motorcycle's load it is quoted on a car — and the row says CAR", async () => {
		const t = setup();
		const { retailerId, variantId } = await seedStore(t);
		await cacheLoads(t);
		const lm = stubLalamove();
		const result = await quote(t, retailerId, variantId, 25);
		expect(result).toMatchObject({ status: "quoted", fee: 4480 });
		expect(lm.quotedVehicles).toEqual(["CAR"]);
		const row = await t.run(async (ctx) =>
			ctx.db.get((result as { quoteId: Id<"deliveryQuotes"> }).quoteId),
		);
		expect(row?.vehicleType).toBe("CAR");
	});

	test("over the car's load no rider bids — Lalamove isn't even asked, and the buyer is told why", async () => {
		const t = setup();
		const { retailerId, variantId } = await seedStore(t);
		await cacheLoads(t);
		const lm = stubLalamove();
		expect(await quote(t, retailerId, variantId, 45)).toEqual({
			status: "too_heavy",
		});
		expect(lm.quotedVehicles).toEqual([]);
	});

	test("the first quote in a market fetches Lalamove's loads inline, once, and caches them", async () => {
		const t = setup();
		const { retailerId, variantId } = await seedStore(t);
		const lm = stubLalamove();
		await quote(t, retailerId, variantId, 25);
		expect(lm.paths).toEqual(["/v3/cities", "/v3/quotations"]);
		expect(lm.quotedVehicles).toEqual(["CAR"]);
		const cached = await t.query(internal.lalamove.getVehicleLoads, {
			market: "MY",
			env: "sandbox",
		});
		expect(cached?.loads).toEqual(MY_LOADS);
		// The next quote reads the cache — no second cities call.
		await quote(t, retailerId, variantId, 5);
		expect(lm.paths.filter((p) => p === "/v3/cities")).toHaveLength(1);
	});

	test("if Lalamove's loads can't be read, the seller's vehicle is quoted as before — fail open", async () => {
		const t = setup();
		const { retailerId, variantId } = await seedStore(t);
		const lm = stubLalamove({ citiesFail: true });
		expect(await quote(t, retailerId, variantId, 25)).toMatchObject({
			status: "quoted",
		});
		expect(lm.quotedVehicles).toEqual(["MOTORCYCLE"]);
	});
});

describe("dispatch defaults to the same vehicle, and says why", () => {
	async function seedHeavyOrder(
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
		productId: Id<"products">,
		variantId: Id<"productVariants">,
		quantity: number,
	) {
		return t.run(async (ctx) => {
			const now = Date.now();
			const id = await ctx.db.insert("orders", {
				retailerId,
				shortId: `ORD-H${quantity}`,
				items: [{ productId, variantId, name: "Beras 1kg", price: 500, quantity }],
				subtotal: 500 * quantity,
				total: 500 * quantity,
				currency: "MYR",
				status: "confirmed",
				channel: "whatsapp",
				customer: { name: "Aisha", waPhone: "60123456789" },
				deliveryMethod: "delivery",
				deliveryAddress: {
					line1: "12 Jln Mawar 3",
					city: "Petaling Jaya",
					state: "Selangor",
					postcode: "47301",
					latitude: 3.1073,
					longitude: 101.6067,
				},
				createdAt: now,
				updatedAt: now,
			});
			return (await ctx.db.get(id))?.shortId ?? "";
		});
	}

	test("a 25 kg order opens on a car, with the reason", async () => {
		const t = setup();
		const { asUser, retailerId, productId, variantId } = await seedStore(t);
		await cacheLoads(t);
		const shortId = await seedHeavyOrder(t, retailerId, productId, variantId, 25);
		const lm = stubLalamove();
		const prepared = await asUser.action(api.lalamove.prepareBooking, { shortId });
		expect(prepared).toMatchObject({
			ok: true,
			vehicleType: "CAR",
			vehicleAdvice: {
				kind: "escalated",
				from: "MOTORCYCLE",
				to: "CAR",
				cartKg: 25,
				fromLoadKg: 10,
			},
		});
		expect(lm.quotedVehicles).toEqual(["CAR"]);
	});

	test("the seller can still switch back to the motorcycle — the advice stays so the card can warn", async () => {
		const t = setup();
		const { asUser, retailerId, productId, variantId } = await seedStore(t);
		await cacheLoads(t);
		const shortId = await seedHeavyOrder(t, retailerId, productId, variantId, 25);
		const lm = stubLalamove();
		const prepared = await asUser.action(api.lalamove.prepareBooking, {
			shortId,
			vehicleType: "MOTORCYCLE",
		});
		expect(prepared).toMatchObject({
			ok: true,
			vehicleType: "MOTORCYCLE",
			vehicleAdvice: { kind: "escalated", from: "MOTORCYCLE" },
		});
		expect(lm.quotedVehicles).toEqual(["MOTORCYCLE"]);
	});

	test("over a car's load the card is told nothing here fits, and still opens on the car", async () => {
		const t = setup();
		const { asUser, retailerId, productId, variantId } = await seedStore(t);
		await cacheLoads(t);
		const shortId = await seedHeavyOrder(t, retailerId, productId, variantId, 60);
		stubLalamove();
		expect(
			await asUser.action(api.lalamove.prepareBooking, { shortId }),
		).toMatchObject({
			ok: true,
			vehicleType: "CAR",
			vehicleAdvice: { kind: "too_heavy", cartKg: 60, maxKg: 40 },
		});
	});

	test("a light order keeps the seller's vehicle and carries no advice", async () => {
		const t = setup();
		const { asUser, retailerId, productId, variantId } = await seedStore(t);
		await cacheLoads(t);
		const shortId = await seedHeavyOrder(t, retailerId, productId, variantId, 3);
		stubLalamove();
		const prepared = await asUser.action(api.lalamove.prepareBooking, { shortId });
		expect(prepared).toMatchObject({ ok: true, vehicleType: "MOTORCYCLE" });
		expect(prepared).not.toHaveProperty("vehicleAdvice.kind");
	});

	test("dispatch never adds a cities call to the booking flow — a cold cache only schedules the refresh", async () => {
		const t = setup();
		const { asUser, retailerId, productId, variantId } = await seedStore(t);
		const shortId = await seedHeavyOrder(t, retailerId, productId, variantId, 25);
		const lm = stubLalamove();
		const prepared = await asUser.action(api.lalamove.prepareBooking, { shortId });
		expect(lm.paths).toEqual(["/v3/quotations"]);
		// Unknown loads: the seller's vehicle, as before.
		expect(prepared).toMatchObject({ ok: true, vehicleType: "MOTORCYCLE" });
	});
});

describe("lalamove.vehicleLoads — what the pricing card reads", () => {
	test("answers the store's market's cached loads, and a stranger can't read it", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedStore(t);
		expect(await asUser.query(api.lalamove.vehicleLoads, { retailerId })).toBeNull();
		await cacheLoads(t);
		expect(
			await asUser.query(api.lalamove.vehicleLoads, { retailerId }),
		).toEqual({ loads: MY_LOADS });
		const stranger = t.withIdentity({ subject: "user_someone_else" });
		await expect(
			stranger.query(api.lalamove.vehicleLoads, { retailerId }),
		).rejects.toThrow();
	});
});
