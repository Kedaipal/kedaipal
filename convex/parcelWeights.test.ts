/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PARCEL_WEIGHTS_BATCH_MAX } from "./lib/weightPricing";
import schema from "./schema";

/**
 * Parcel weight required where pricing depends on it (23 Oct 2026):
 *  - the bulk fill's list and save (`unweighedChoices` / `setParcelWeights`),
 *  - the arming gates — switching ON something that prices by weight
 *    refuses while buyable choices are unweighed, and ONLY the switch,
 *  - the one-kilo floor stamped on a quote row reaching the order.
 */

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const DELYVA = {
	enabled: true,
	apiKey: "dx-test-key",
	apiSecret: "dx-test-secret",
	apiKeyHint: "-key",
	customerId: 128399,
	defaultItemType: "PARCEL" as const,
	pickupAddress: {
		address1: "12 Jalan Ampang",
		city: "Kuala Lumpur",
		state: "Kuala Lumpur",
		postcode: "50450",
	},
	connectedAt: 1,
};

async function seedRetailer(
	t: ReturnType<typeof setup>,
	userId: string,
	over: {
		mode?: "live" | "flat" | "weight";
		delyva?: boolean | { enabled: boolean };
	} = {},
) {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Weight Store",
		slug: `pw-${userId.replace(/[^a-z0-9]/g, "")}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await t.run(async (ctx) => {
		await ctx.db.patch(retailer._id, {
			currency: "MYR",
			deliveryConfig:
				over.mode === "live"
					? { mode: "live", onUnquotable: "block" }
					: over.mode === "weight"
						? {
								mode: "weight",
								zones: [
									{
										name: "West",
										states: ["Selangor"],
										bands: [{ maxKg: 5, fee: 800 }],
									},
								],
								onOutOfBands: "arrange",
								onUnpriceable: "arrange",
							}
						: over.mode === "flat"
							? { mode: "flat", fee: 500 }
							: undefined,
			delyva: over.delyva
				? {
						...DELYVA,
						enabled:
							typeof over.delyva === "object" ? over.delyva.enabled : true,
					}
				: undefined,
			businessAddress: { label: "Store", latitude: 3.139, longitude: 101.687 },
		});
	});
	return { asUser, retailerId: retailer._id as Id<"retailers"> };
}

/** A product with the given choices (each `grams`); 0 = unweighed. */
async function seedProduct(
	t: ReturnType<typeof setup>,
	asUser: ReturnType<ReturnType<typeof setup>["withIdentity"]>,
	retailerId: Id<"retailers">,
	name: string,
	choices: Array<{ value?: string; grams: number; active?: boolean }>,
	opts: { sortOrder?: number; kind?: "service" | "booking"; custom?: boolean } = {},
) {
	const withAxis = choices.some((c) => c.value !== undefined);
	const productId = await asUser.mutation(api.products.create, {
		retailerId,
		name,
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: opts.sortOrder ?? 0,
		blockWhenOutOfStock: false,
		options: withAxis
			? [{ name: "Size", values: choices.map((c) => c.value as string) }]
			: undefined,
		variants: choices.map((c) => ({
			optionValues: c.value === undefined ? [] : [c.value],
			price: 1000,
			onHand: 5,
			parcelWeightG: c.grams,
			active: c.active ?? true,
			isCustom: opts.custom,
		})),
	});
	if (opts.kind) {
		await t.run(async (ctx) => {
			await ctx.db.patch(productId, { kind: opts.kind });
		});
	}
	const variantIds = await t.run(async (ctx) => {
		const rows = await ctx.db
			.query("productVariants")
			.withIndex("by_product", (q) => q.eq("productId", productId))
			.collect();
		return rows.map((r) => r._id);
	});
	return { productId, variantIds };
}

describe("products.unweighedChoices — the bulk fill's list", () => {
	test("lists every live physical product's unweighed buyable choices, in catalogue order, and nothing else", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_list");
		const tees = await seedProduct(
			t,
			asUser,
			retailerId,
			"Oversized Tee",
			[
				{ value: "S", grams: 0 },
				{ value: "M", grams: 250 },
				{ value: "L", grams: 0 },
				{ value: "XL", grams: 0, active: false },
			],
			{ sortOrder: 2 },
		);
		const mug = await seedProduct(t, asUser, retailerId, "Mug", [{ grams: 0 }], {
			sortOrder: 1,
		});
		await seedProduct(t, asUser, retailerId, "Weighed", [{ grams: 500 }]);
		await seedProduct(t, asUser, retailerId, "Wash", [{ grams: 0 }], {
			kind: "service",
		});
		// A calendar booking has nothing to deliver.
		await seedProduct(t, asUser, retailerId, "Campsite", [{ grams: 0 }], {
			kind: "booking",
		});
		// An event RSVP is fulfilled at the venue — never a delivery cart.
		const festival = await seedProduct(t, asUser, retailerId, "Festival", [
			{ grams: 0 },
		]);
		await t.run(async (ctx) => {
			await ctx.db.patch(festival.productId, {
				event: { date: Date.UTC(2026, 11, 1) - 8 * 3600 * 1000 },
			});
		});

		const list = await asUser.query(api.products.unweighedChoices, {
			retailerId,
		});
		expect(list).toEqual([
			{
				productId: mug.productId,
				name: "Mug",
				choices: [{ variantId: mug.variantIds[0], label: "Mug" }],
			},
			{
				productId: tees.productId,
				name: "Oversized Tee",
				choices: [
					{ variantId: tees.variantIds[0], label: "S" },
					{ variantId: tees.variantIds[2], label: "L" },
				],
			},
		]);
		// The notice counts the same rows.
		const missing = await asUser.query(api.products.missingParcelWeights, {
			retailerId,
		});
		expect(missing).toMatchObject({ count: 2, choiceCount: 3 });
	});

	test("another store's seller can't read it", async () => {
		const t = setup();
		const { retailerId } = await seedRetailer(t, "user_pw_list_a");
		const { asUser: stranger } = await seedRetailer(t, "user_pw_list_b");
		await expect(
			stranger.query(api.products.unweighedChoices, { retailerId }),
		).rejects.toThrow();
	});
});

describe("products.setParcelWeights — one bounded save", () => {
	test("writes the weights, and the rows leave the list", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_save");
		const tees = await seedProduct(t, asUser, retailerId, "Tee", [
			{ value: "S", grams: 0 },
			{ value: "M", grams: 0 },
		]);
		const result = await asUser.mutation(api.products.setParcelWeights, {
			retailerId,
			weights: [
				{ variantId: tees.variantIds[0], parcelWeightG: 220 },
				{ variantId: tees.variantIds[1], parcelWeightG: 260 },
			],
		});
		expect(result).toEqual({ updated: 2 });
		expect(
			await asUser.query(api.products.unweighedChoices, { retailerId }),
		).toEqual([]);
		const stored = await t.run(async (ctx) =>
			Promise.all(tees.variantIds.map((id) => ctx.db.get(id))),
		);
		expect(stored.map((v) => v?.parcelWeightG)).toEqual([220, 260]);
	});

	test("refuses a zero, a fraction and a weight past the cap", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_bad");
		const tee = await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		for (const parcelWeightG of [0, -5, 12.5, 1_000_001]) {
			await expect(
				asUser.mutation(api.products.setParcelWeights, {
					retailerId,
					weights: [{ variantId: tee.variantIds[0], parcelWeightG }],
				}),
			).rejects.toThrow(/whole number of grams/);
		}
	});

	test("refuses a batch over the bound", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_bound");
		const tee = await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		await expect(
			asUser.mutation(api.products.setParcelWeights, {
				retailerId,
				weights: Array.from({ length: PARCEL_WEIGHTS_BATCH_MAX + 1 }, () => ({
					variantId: tee.variantIds[0],
					parcelWeightG: 100,
				})),
			}),
		).rejects.toThrow(/at most/);
	});

	test("a choice from another store refuses the WHOLE batch — nothing is written", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_own_a");
		const { asUser: other, retailerId: otherId } = await seedRetailer(
			t,
			"user_pw_own_b",
		);
		const mine = await seedProduct(t, asUser, retailerId, "Mine", [{ grams: 0 }]);
		const theirs = await seedProduct(t, other, otherId, "Theirs", [{ grams: 0 }]);
		await expect(
			asUser.mutation(api.products.setParcelWeights, {
				retailerId,
				weights: [
					{ variantId: mine.variantIds[0], parcelWeightG: 300 },
					{ variantId: theirs.variantIds[0], parcelWeightG: 300 },
				],
			}),
		).rejects.toThrow(/isn't in your store/);
		const [m, th] = await t.run(async (ctx) => [
			await ctx.db.get(mine.variantIds[0]),
			await ctx.db.get(theirs.variantIds[0]),
		]);
		expect(m?.parcelWeightG).toBe(0);
		expect(th?.parcelWeightG).toBe(0);
	});

	test("a stranger can't write a store's weights", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_str_a");
		const { asUser: stranger } = await seedRetailer(t, "user_pw_str_b");
		const tee = await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		await expect(
			stranger.mutation(api.products.setParcelWeights, {
				retailerId,
				weights: [{ variantId: tee.variantIds[0], parcelWeightG: 300 }],
			}),
		).rejects.toThrow();
	});
});

describe("arming a courier on a live store (delyva.updateSettings)", () => {
	test("refuses to switch Delyva ON while buyable choices are unweighed, naming the count and the fix", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_arm", {
			mode: "live",
			delyva: { enabled: false },
		});
		await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		await seedProduct(t, asUser, retailerId, "Cap", [{ grams: 0 }]);
		await expect(
			asUser.mutation(api.delyva.updateSettings, { retailerId, enabled: true }),
		).rejects.toThrow(
			"2 products have no parcel weight — couriers price every order by weight. Set them under Products → Parcel weights first.",
		);
		// And the summary says the toggle is held, with the same count.
		const summary = await asUser.query(api.delyva.getSettings, { retailerId });
		expect(summary.bookingHeldForWeights).toBe(2);
	});

	test("accepts the switch once the catalogue is weighed — the bulk fill is the way through", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_arm_ok", {
			mode: "live",
			delyva: { enabled: false },
		});
		const tee = await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		await asUser.mutation(api.products.setParcelWeights, {
			retailerId,
			weights: [{ variantId: tee.variantIds[0], parcelWeightG: 250 }],
		});
		expect(
			(await asUser.query(api.delyva.getSettings, { retailerId }))
				.bookingHeldForWeights,
		).toBeUndefined();
		await asUser.mutation(api.delyva.updateSettings, { retailerId, enabled: true });
		const retailer = await asUser.query(api.retailers.getMyRetailer);
		expect(retailer?.weightPricing).toBe("courier");
	});

	test("only ARMING is gated: a store already on prices by weight keeps editing, and switching off is always free", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_arm_on", {
			mode: "live",
			delyva: true,
		});
		await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		// Already on: re-sending enabled with a parcel type change is fine.
		await asUser.mutation(api.delyva.updateSettings, {
			retailerId,
			enabled: true,
			defaultItemType: "CHILLED",
		});
		await asUser.mutation(api.delyva.updateSettings, { retailerId, enabled: false });
		expect(
			(await asUser.query(api.delyva.getSettings, { retailerId })).enabled,
		).toBe(false);
	});

	test("a flat-fee store arms Delyva freely — nothing there prices by weight", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_arm_flat", {
			mode: "flat",
			delyva: { enabled: false },
		});
		await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		await asUser.mutation(api.delyva.updateSettings, { retailerId, enabled: true });
		expect(
			(await asUser.query(api.retailers.getMyRetailer))?.weightPricing,
		).toBeUndefined();
	});

	test("connecting on a live store with unweighed products stores the key but holds booking OFF, and says so", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_connect", {
			mode: "live",
		});
		await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		const stored = await t.mutation(internal.delyva.storeConnection, {
			retailerId,
			apiKey: "dx-key",
			apiKeyHint: "-key",
			customerId: 1,
		});
		expect(stored).toEqual({ bookingHeldForWeights: 1 });
		const r = await t.run(async (ctx) => ctx.db.get(retailerId));
		expect(r?.delyva?.enabled).toBe(false);
		expect(r?.delyva?.apiKey).toBe("dx-key");
		// The same connect on a weighed catalogue arms as before.
		const { asUser: b, retailerId: idB } = await seedRetailer(
			t,
			"user_pw_connect_b",
			{ mode: "live" },
		);
		await seedProduct(t, b, idB, "Tee", [{ grams: 300 }]);
		expect(
			await t.mutation(internal.delyva.storeConnection, {
				retailerId: idB,
				apiKey: "dx-key",
				apiKeyHint: "-key",
				customerId: 1,
			}),
		).toEqual({ bookingHeldForWeights: 0 });
		expect((await t.run(async (ctx) => ctx.db.get(idB)))?.delyva?.enabled).toBe(
			true,
		);
	});
});

describe("switching the delivery charge onto weight pricing (retailers.updateSettings)", () => {
	const weightConfig = {
		mode: "weight" as const,
		zones: [
			{
				name: "West",
				states: ["Selangor"],
				bands: [{ maxKg: 5, fee: 800 }],
			},
		],
		onOutOfBands: "arrange" as const,
		onUnpriceable: "arrange" as const,
	};

	test("refuses the move onto the rate card while choices are unweighed", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_rc", {
			mode: "flat",
		});
		await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				deliveryConfig: weightConfig,
			}),
		).rejects.toThrow(/a rate card prices every order by weight/);
	});

	test("a catalogue of only bookings, services and events arms the rate card freely — none of them ships", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_rc_kinds", {
			mode: "flat",
		});
		await seedProduct(t, asUser, retailerId, "Campsite", [{ grams: 0 }], {
			kind: "booking",
		});
		await seedProduct(t, asUser, retailerId, "Tent wash", [{ grams: 0 }], {
			kind: "service",
		});
		const festival = await seedProduct(t, asUser, retailerId, "Festival", [
			{ grams: 0 },
		]);
		await t.run(async (ctx) => {
			await ctx.db.patch(festival.productId, {
				event: { date: Date.UTC(2026, 11, 1) - 8 * 3600 * 1000 },
			});
		});
		expect(
			await asUser.query(api.products.missingParcelWeights, { retailerId }),
		).toMatchObject({ count: 0, choiceCount: 0 });
		await asUser.mutation(api.retailers.updateSettings, {
			deliveryConfig: weightConfig,
		});
		expect(
			(await asUser.query(api.retailers.getMyRetailer))?.deliveryConfig,
		).toMatchObject({ mode: "weight" });
	});

	test("a store already on the rate card keeps saving its zones", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_rc_on", {
			mode: "weight",
		});
		await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		await asUser.mutation(api.retailers.updateSettings, {
			deliveryConfig: {
				...weightConfig,
				zones: [{ ...weightConfig.zones[0], name: "Peninsular" }],
			},
		});
		const r = await asUser.query(api.retailers.getMyRetailer);
		expect(r?.deliveryConfig).toMatchObject({ mode: "weight" });
		expect(r?.weightPricing).toBe("rate_card");
	});

	test("refuses the move onto live pricing while Delyva is armed and choices are unweighed; riders alone move freely", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_live", {
			mode: "flat",
			delyva: true,
		});
		await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				deliveryConfig: { mode: "live", onUnquotable: "block" },
			}),
		).rejects.toThrow(/couriers price every order by weight/);
		// Pause Delyva: live pricing now runs on riders, which never weigh.
		await asUser.mutation(api.delyva.updateSettings, { retailerId, enabled: false });
		await asUser.mutation(api.retailers.updateSettings, {
			deliveryConfig: { mode: "live", onUnquotable: "block" },
		});
		expect(
			(await asUser.query(api.retailers.getMyRetailer))?.deliveryConfig,
		).toMatchObject({ mode: "live" });
	});
});

describe("the one-kilo floor reaches the order (deliveryQuotes → deliverySnapshot)", () => {
	const address = {
		line1: "12 Jln Mawar 3",
		city: "Petaling Jaya",
		state: "Selangor",
		postcode: "47301",
		latitude: 3.15,
		longitude: 101.7,
	};

	test("a Delyva-won quote stamped as floored carries the stamp onto the order", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_floor", {
			mode: "live",
			delyva: true,
		});
		const { productId } = await seedProduct(t, asUser, retailerId, "Tee", [
			{ grams: 0 },
		]);
		const quoteId = await t.mutation(internal.lalamove.saveCheckoutQuote, {
			retailerId,
			provider: "delyva",
			fee: 475,
			currency: "MYR",
			serviceCode: "jnt",
			serviceName: "J&T Express",
			latitude: address.latitude,
			longitude: address.longitude,
			weightFloored: true,
			unweighedLines: 1,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			deliveryMethod: "delivery",
			deliveryAddress: address,
			customer: { name: "Ana", waPhone: "60123456789" },
			deliveryQuoteId: quoteId,
		});
		const order = await t.run(async (ctx) =>
			(await ctx.db.query("orders").collect()).find((o) => o.shortId === shortId),
		);
		expect(order?.deliverySnapshot).toMatchObject({
			mode: "live",
			fee: 475,
			quoteProvider: "delyva",
			weightFloored: true,
			unweighedLines: 1,
		});
	});

	test("a quote without the stamp leaves the snapshot without one", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_nofloor", {
			mode: "live",
			delyva: true,
		});
		const { productId } = await seedProduct(t, asUser, retailerId, "Tee", [
			{ grams: 300 },
		]);
		const quoteId = await t.mutation(internal.lalamove.saveCheckoutQuote, {
			retailerId,
			provider: "delyva",
			fee: 475,
			currency: "MYR",
			latitude: address.latitude,
			longitude: address.longitude,
		});
		const { shortId } = await t.mutation(api.orders.create, {
			retailerId,
			items: [{ productId, quantity: 1 }],
			currency: "MYR",
			channel: "whatsapp",
			deliveryMethod: "delivery",
			deliveryAddress: address,
			customer: { name: "Ben", waPhone: "60123456780" },
			deliveryQuoteId: quoteId,
		});
		const order = await t.run(async (ctx) =>
			(await ctx.db.query("orders").collect()).find((o) => o.shortId === shortId),
		);
		expect(order?.deliverySnapshot?.weightFloored).toBeUndefined();
		expect(order?.deliverySnapshot?.unweighedLines).toBeUndefined();
	});
});

describe("getLiveQuoteContext — the floor facts behind the stamp", () => {
	test("reports a floored cart and its unweighed lines; a weighed cart reports neither", async () => {
		const t = setup();
		const { asUser, retailerId } = await seedRetailer(t, "user_pw_ctx", {
			mode: "live",
			delyva: true,
		});
		const blank = await seedProduct(t, asUser, retailerId, "Tee", [{ grams: 0 }]);
		const heavy = await seedProduct(t, asUser, retailerId, "Jar", [
			{ grams: 1200 },
		]);
		const floored = await t.query(internal.liveQuote.getLiveQuoteContext, {
			retailerId,
			items: [{ variantId: blank.variantIds[0], quantity: 2 }],
		});
		expect(floored).toMatchObject({
			cartWeightKg: 1,
			weightFloored: true,
			unweighedLines: 1,
		});
		const summed = await t.query(internal.liveQuote.getLiveQuoteContext, {
			retailerId,
			items: [{ variantId: heavy.variantIds[0], quantity: 1 }],
		});
		expect(summed).toMatchObject({
			cartWeightKg: 1.2,
			weightFloored: false,
			unweighedLines: 0,
		});
	});
});

describe("delivery.quote — which providers can bid, for the checkout's copy", () => {
	test("a live store with Delyva armed (and a pickup address) says couriers can bid", async () => {
		const t = setup();
		const { retailerId } = await seedRetailer(t, "user_pw_bid", {
			mode: "live",
			delyva: true,
		});
		expect(
			await t.query(api.delivery.quote, { retailerId, subtotal: 1000 }),
		).toEqual({ kind: "live", providerAware: true, riders: false, couriers: true });
	});

	test("a paused Delyva can't bid; the legacy single-provider mode is riders by definition", async () => {
		const t = setup();
		const { retailerId } = await seedRetailer(t, "user_pw_bid_off", {
			mode: "live",
			delyva: { enabled: false },
		});
		expect(
			await t.query(api.delivery.quote, { retailerId, subtotal: 1000 }),
		).toEqual({ kind: "live", providerAware: true, riders: false, couriers: false });
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				deliveryConfig: { mode: "lalamove", onUnquotable: "block" },
				deliveryBooking: {
					enabled: true,
					vehicleType: "MOTORCYCLE",
					apiKey: "pk",
					apiSecret: "sk",
				},
			});
		});
		expect(
			await t.query(api.delivery.quote, { retailerId, subtotal: 1000 }),
		).toEqual({ kind: "live", providerAware: false, riders: true, couriers: false });
	});
});
