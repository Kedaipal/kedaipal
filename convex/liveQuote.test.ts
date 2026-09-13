/// <reference types="vite/client" />
// Provider-aware checkout pricing (z8r3fdbvdy) — the wiring the pure rule
// can't cover: which providers get asked at all, and what the store's own
// config does to that. The RULE itself is pinned in lib/liveQuote.test.ts.
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { loadCheckoutDeliveryQuote } from "./orders";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const USER = "user_live_quote_tests";

async function seedStore(
	t: ReturnType<typeof setup>,
	over: {
		mode?: "live" | "flat";
		lalamove?: boolean;
		delyva?: boolean;
		defaultItemType?: "PARCEL" | "CHILLED" | "FROZEN";
		pickupAddress?: boolean;
		customerId?: number;
	} = {},
) {
	const asUser = t.withIdentity({ subject: USER });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: "Live Quote Co",
		slug: `live-quote-${Math.abs(Date.parse("2026-09-04")) % 100000}`,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	await t.run(async (ctx) => {
		await ctx.db.patch(retailer._id, {
			currency: "MYR",
			deliveryConfig:
				(over.mode ?? "live") === "live"
					? { mode: "live", onUnquotable: "block" }
					: { mode: "flat", fee: 500 },
			businessAddress: {
				label: "Store",
				latitude: 3.139,
				longitude: 101.687,
			},
			deliveryBooking: over.lalamove
				? {
						enabled: true,
						vehicleType: "MOTORCYCLE",
						apiKey: "pk_test_x",
						apiSecret: "secret",
					}
				: undefined,
			delyva: over.delyva
				? {
						enabled: true,
						apiKey: "dx-key",
						apiSecret: "dx-secret",
						apiKeyHint: "-key",
						customerId: over.customerId ?? 128399,
						defaultItemType: over.defaultItemType ?? "PARCEL",
						pickupAddress:
							over.pickupAddress === false
								? undefined
								: {
										address1: "12 Jalan Ampang",
										city: "Kuala Lumpur",
										state: "Kuala Lumpur",
										postcode: "50450",
									},
						connectedAt: Date.now(),
					}
				: undefined,
		});
	});
	return retailer._id as Id<"retailers">;
}

async function context(t: ReturnType<typeof setup>, retailerId: Id<"retailers">) {
	return t.query(internal.liveQuote.getLiveQuoteContext, { retailerId });
}

describe("only the live mode routes here", () => {
	test("a flat-fee store resolves no context — no provider is ever called", async () => {
		const t = setup();
		const id = await seedStore(t, { mode: "flat", lalamove: true, delyva: true });
		expect(await context(t, id)).toBeNull();
	});

	test("a live store resolves one", async () => {
		const t = setup();
		const id = await seedStore(t, { lalamove: true });
		expect(await context(t, id)).not.toBeNull();
	});
});

describe("which providers are asked to bid", () => {
	test("both, when both are armed", async () => {
		const t = setup();
		const id = await seedStore(t, { lalamove: true, delyva: true });
		const c = await context(t, id);
		expect(c?.lalamoveArmed).toBe(true);
		expect(c?.delyva).not.toBeNull();
	});

	test("a paused Delyva doesn't bid", async () => {
		const t = setup();
		const id = await seedStore(t, { lalamove: true, delyva: true });
		await t.run(async (ctx) => {
			const r = await ctx.db.get(id);
			if (!r?.delyva) throw new Error("seed");
			await ctx.db.patch(id, { delyva: { ...r.delyva, enabled: false } });
		});
		expect((await context(t, id))?.delyva).toBeNull();
	});

	test("a Delyva with no pickup address doesn't bid — it would 400", async () => {
		const t = setup();
		const id = await seedStore(t, { delyva: true, pickupAddress: false });
		expect((await context(t, id))?.delyva).toBeNull();
	});

	test("a half-connected Delyva (no customerId) doesn't bid either", async () => {
		const t = setup();
		const id = await seedStore(t, { delyva: true });
		await t.run(async (ctx) => {
			const r = await ctx.db.get(id);
			if (!r?.delyva) throw new Error("seed");
			await ctx.db.patch(id, {
				delyva: { ...r.delyva, customerId: undefined },
			});
		});
		expect((await context(t, id))?.delyva).toBeNull();
	});
});

describe("the cart's item type comes from the store, not the client", () => {
	test("an ambient store prices ambient", async () => {
		const t = setup();
		const id = await seedStore(t, { delyva: true, defaultItemType: "PARCEL" });
		const c = await context(t, id);
		expect(c?.itemType).toBe("PARCEL");
		expect(c?.cold).toBe(false);
	});

	test("a frozen store prices frozen — never silently ambient", async () => {
		const t = setup();
		const id = await seedStore(t, { delyva: true, defaultItemType: "FROZEN" });
		const c = await context(t, id);
		expect(c?.itemType).toBe("FROZEN");
		expect(c?.cold).toBe(true);
	});

	test("a store with no Delyva at all still resolves a type", async () => {
		const t = setup();
		const id = await seedStore(t, { lalamove: true });
		expect((await context(t, id))?.itemType).toBe("PARCEL");
	});
});

describe("cart weight is summed from the variants, never trusted from the client", () => {
	async function seedVariant(
		t: ReturnType<typeof setup>,
		retailerId: Id<"retailers">,
		parcelWeightG: number,
	) {
		return t.run(async (ctx) => {
			const now = Date.now();
			const productId = await ctx.db.insert("products", {
				retailerId,
				name: "Kuih",
				currency: "MYR",
				imageStorageIds: [],
				options: [],
				active: true,
				channel: "whatsapp",
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			return ctx.db.insert("productVariants", {
				retailerId,
				productId,
				optionValues: [],
				price: 500,
				onHand: 10,
				reserved: 0,
				parcelWeightG,
				imageStorageIds: [],
				active: true,
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
		});
	}

	test("sums the real weights", async () => {
		const t = setup();
		const id = await seedStore(t, { delyva: true });
		const variantId = await seedVariant(t, id, 400);
		const c = await t.query(internal.liveQuote.getLiveQuoteContext, {
			retailerId: id,
			items: [{ variantId, quantity: 3 }],
		});
		expect(c?.cartWeightKg).toBeCloseTo(1.2);
	});

	test("an unweighed product yields no weight — never a silent under-weigh", async () => {
		const t = setup();
		const id = await seedStore(t, { delyva: true });
		const variantId = await seedVariant(t, id, 0);
		const c = await t.query(internal.liveQuote.getLiveQuoteContext, {
			retailerId: id,
			items: [{ variantId, quantity: 1 }],
		});
		expect(c?.cartWeightKg).toBeNull();
	});

	test("a variant from another store is weightless, not borrowed", async () => {
		const t = setup();
		const id = await seedStore(t, { delyva: true });
		const other = await t.withIdentity({ subject: "someone_else" });
		await other.mutation(api.retailers.createRetailer, {
			storeName: "Other",
			slug: "other-live-quote",
		});
		const otherRetailer = await other.query(api.retailers.getMyRetailer);
		if (!otherRetailer) throw new Error("seed failed");
		const foreign = await seedVariant(t, otherRetailer._id, 5000);
		const c = await t.query(internal.liveQuote.getLiveQuoteContext, {
			retailerId: id,
			items: [{ variantId: foreign, quantity: 1 }],
		});
		expect(c?.cartWeightKg).toBeNull();
	});
});

describe("the legacy action refuses provider-aware stores (PR #253 review)", () => {
	// A Lalamove-only row minted for a "live" store is an adversarial buyer's
	// way around charge-the-higher — and on a cold store, a rider price for a
	// frozen cart. The refusal happens before any network call.
	test("lalamove.quoteForCheckout answers unavailable for a live-mode store", async () => {
		const t = setup();
		const retailerId = await seedStore(t, { mode: "live", lalamove: true });
		const result = await t.action(api.lalamove.quoteForCheckout, {
			retailerId,
			latitude: 3.15,
			longitude: 101.7,
			address: "12 Jalan Ampang",
		});
		expect(result.status).toBe("unavailable");
	});

	test("…and still serves a legacy lalamove-mode store", async () => {
		// The pre-migration store keeps working — a deploy alone changes
		// nobody's pricing path. (It proceeds past the mode gate; the fetch
		// itself then fails in this offline test, which is fine — the point is
		// it was not refused by the gate.)
		const t = setup();
		const retailerId = await seedStore(t, { mode: "flat", lalamove: true });
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				deliveryConfig: { mode: "lalamove", onUnquotable: "block" },
			});
		});
		const result = await t.action(api.lalamove.quoteForCheckout, {
			retailerId,
			latitude: 3.15,
			longitude: 101.7,
			address: "12 Jalan Ampang",
		});
		// Offline: the provider call fails as a transient, NOT as the
		// deliberate providerAware refusal path having fired first — both spell
		// "unavailable", so distinguish by the context flag.
		const context = await t.query(internal.lalamove.getQuoteContext, {
			retailerId,
		});
		expect(context?.providerAware).toBe(false);
		expect(result.status).toBe("unavailable");
	});
})

describe("a quote row is bound to the cart it priced (PR #253 review)", () => {
	// Delyva bids on summed weight: a row minted for a light cart must not be
	// redeemable against a heavier one. The comparator itself is pinned in
	// lib/liveQuote.test.ts — this exercises the WIRED guard in
	// loadCheckoutDeliveryQuote, alongside its existing coord/age checks.
	async function seedRowWithCart(t: ReturnType<typeof setup>) {
		const retailerId = await seedStore(t, { mode: "live", delyva: true });
		return t.run(async (ctx) => {
			const now = Date.now();
			const productId = await ctx.db.insert("products", {
				retailerId,
				name: "Beku",
				currency: "MYR",
				imageStorageIds: [],
				active: true,
				options: [],
				channel: "whatsapp",
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			const variantId = await ctx.db.insert("productVariants", {
				productId,
				retailerId,
				optionValues: [],
				price: 1000,
				onHand: 10,
				reserved: 0,
				parcelWeightG: 500,
				imageStorageIds: [],
				active: true,
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			});
			const quoteId = await ctx.db.insert("deliveryQuotes", {
				retailerId,
				provider: "delyva",
				fee: 475,
				currency: "MYR",
				lines: [{ variantId, quantity: 1 }],
				latitude: 3.15,
				longitude: 101.7,
				quotedAt: now,
			});
			return { retailerId, variantId, quoteId };
		});
	}

	test("redeems against the same cart; refuses a heavier one", async () => {
		const t = setup();
		const { retailerId, variantId, quoteId } = await seedRowWithCart(t);
		const address = { latitude: 3.15, longitude: 101.7 };

		// Different quantity — the guard refuses BEFORE consuming the row.
		const mismatch = await t.run(async (ctx) =>
			loadCheckoutDeliveryQuote(ctx as never, retailerId, quoteId, address, [
				{ variantId, quantity: 3 },
			]),
		);
		// t.run serializes the mutation-ctx return, so undefined → null.
		expect(mismatch ?? undefined).toBeUndefined();

		// Identical cart — redeems (and consumes the row).
		const match = await t.run(async (ctx) =>
			loadCheckoutDeliveryQuote(ctx as never, retailerId, quoteId, address, [
				{ variantId, quantity: 1 },
			]),
		);
		expect(match?.fee).toBe(475);
	});

	test("a legacy row without lines skips the cart check — rider prices ignore the cart", async () => {
		const t = setup();
		const { retailerId, variantId, quoteId } = await seedRowWithCart(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(quoteId, { lines: undefined });
		});
		const redeemed = await t.run(async (ctx) =>
			loadCheckoutDeliveryQuote(
				ctx as never,
				retailerId,
				quoteId,
				{ latitude: 3.15, longitude: 101.7 },
				[{ variantId, quantity: 99 }],
			),
		);
		expect(redeemed?.fee).toBe(475);
	});
})
