/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { STORE_AREA_MAX } from "./lib/marketplaceListing";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	return t;
}

const ADMIN = "user_marketplace_admin";
let prevAdminEnv: string | undefined;
beforeEach(() => {
	prevAdminEnv = process.env.ADMIN_USER_IDS;
	process.env.ADMIN_USER_IDS = ADMIN;
});
afterEach(() => {
	process.env.ADMIN_USER_IDS = prevAdminEnv;
});

/** A store with one storefront-visible product — the minimum listable unit. */
async function seedListableStore(
	t: ReturnType<typeof setup>,
	userId: string,
	slug: string,
): Promise<{ retailerId: Id<"retailers">; productId: Id<"products"> }> {
	const asUser = t.withIdentity({ subject: userId });
	await asUser.mutation(api.retailers.createRetailer, {
		storeName: `Store ${slug}`,
		slug,
	});
	const retailer = await asUser.query(api.retailers.getMyRetailer);
	if (!retailer) throw new Error("seed failed");
	const productId = await asUser.mutation(api.products.create, {
		retailerId: retailer._id,
		name: "Rendang 1kg",
		currency: "MYR",
		imageStorageIds: [],
		sortOrder: 0,
		variants: [{ optionValues: [], price: 10000, onHand: 10 }],
	});
	return { retailerId: retailer._id, productId };
}

describe("marketplace.listStores — the listable rule end to end", () => {
	test("a store with a visible product lists; slugs and card fields ride along", async () => {
		const t = setup();
		await seedListableStore(t, "user_mkt_a", "kedai-a");
		const cards = await t.query(api.marketplace.listStores);
		expect(cards.map((c) => c.slug)).toEqual(["kedai-a"]);
		expect(cards[0].storeName).toBe("Store kedai-a");
		expect(cards[0].country).toBe("MY");
		expect(cards[0].sponsored).toBe(false);
		expect(cards[0].orderingPaused).toBe(false);
		expect(cards[0].offersDelivery).toBe(true);
	});

	test("no products — not listed (an empty storefront is a dead end)", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: "user_mkt_empty" });
		await asUser.mutation(api.retailers.createRetailer, {
			storeName: "Empty Store",
			slug: "kedai-kosong",
		});
		expect(await t.query(api.marketplace.listStores)).toEqual([]);
	});

	test("only hidden / inactive products — not listed", async () => {
		const t = setup();
		const { productId } = await seedListableStore(
			t,
			"user_mkt_hidden",
			"kedai-sorok",
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(productId, { hidden: true });
		});
		expect(await t.query(api.marketplace.listStores)).toEqual([]);
	});

	test("the seller's opt-out delists, and relisting brings the store back", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: "user_mkt_opt" });
		await seedListableStore(t, "user_mkt_opt", "kedai-optout");
		await asUser.mutation(api.retailers.updateSettings, {
			marketplaceListed: false,
		});
		expect(await t.query(api.marketplace.listStores)).toEqual([]);
		await asUser.mutation(api.retailers.updateSettings, {
			marketplaceListed: true,
		});
		expect(
			(await t.query(api.marketplace.listStores)).map((c) => c.slug),
		).toEqual(["kedai-optout"]);
	});

	test("opting out twice keeps the FIRST stamp — 'since when' never rewrites", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: "user_mkt_stamp" });
		const { retailerId } = await seedListableStore(
			t,
			"user_mkt_stamp",
			"kedai-stamp",
		);
		await asUser.mutation(api.retailers.updateSettings, {
			marketplaceListed: false,
		});
		const first = await t.run(
			async (ctx) => (await ctx.db.get(retailerId))?.marketplaceUnlistedAt,
		);
		expect(first).toBeDefined();
		await asUser.mutation(api.retailers.updateSettings, {
			marketplaceListed: false,
		});
		const second = await t.run(
			async (ctx) => (await ctx.db.get(retailerId))?.marketplaceUnlistedAt,
		);
		expect(second).toBe(first);
	});

	test("a purging store vanishes from the directory", async () => {
		const t = setup();
		const { retailerId } = await seedListableStore(
			t,
			"user_mkt_purge",
			"kedai-purge",
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, { purgeStartedAt: Date.now() });
		});
		expect(await t.query(api.marketplace.listStores)).toEqual([]);
	});

	test("a live sponsorship window flags the card; an expired one does not", async () => {
		const t = setup();
		const { retailerId } = await seedListableStore(
			t,
			"user_mkt_spon",
			"kedai-spon",
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				marketplaceSponsoredUntil: Date.now() + 60_000,
			});
		});
		expect((await t.query(api.marketplace.listStores))[0].sponsored).toBe(true);
		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				marketplaceSponsoredUntil: Date.now() - 1,
			});
		});
		expect((await t.query(api.marketplace.listStores))[0].sponsored).toBe(
			false,
		);
	});

	test("the payload never carries private storefront facts", async () => {
		const t = setup();
		await seedListableStore(t, "user_mkt_leak", "kedai-leak");
		const [card] = await t.query(api.marketplace.listStores);
		for (const key of [
			"waPhone",
			"notifyEmail",
			"subscription",
			"paymentMethods",
			"deliveryBooking",
			"hitpay",
			"businessAddress",
			"_id",
		]) {
			expect(key in card, `card leaks ${key}`).toBe(false);
		}
	});

	test("activated stores rank above never-activated ones", async () => {
		const t = setup();
		const a = await seedListableStore(t, "user_mkt_rank_a", "kedai-rank-a");
		await seedListableStore(t, "user_mkt_rank_b", "kedai-rank-b");
		await t.run(async (ctx) => {
			await ctx.db.patch(a.retailerId, { activatedAt: Date.now() });
		});
		const cards = await t.query(api.marketplace.listStores);
		expect(cards.map((c) => c.slug)).toEqual(["kedai-rank-a", "kedai-rank-b"]);
	});
});

describe("marketplace.myListingReadiness — the seller card's truth", () => {
	test("false with no products, true once one is visible; strangers refused", async () => {
		const t = setup();
		const asOwner = t.withIdentity({ subject: "user_mkt_ready" });
		await asOwner.mutation(api.retailers.createRetailer, {
			storeName: "Ready Store",
			slug: "kedai-ready",
		});
		const retailer = await asOwner.query(api.retailers.getMyRetailer);
		if (!retailer) throw new Error("seed failed");
		expect(
			await asOwner.query(api.marketplace.myListingReadiness, {
				retailerId: retailer._id,
			}),
		).toEqual({ hasVisibleProduct: false });

		await asOwner.mutation(api.products.create, {
			retailerId: retailer._id,
			name: "Kuih lapis",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 500, onHand: 5 }],
		});
		expect(
			await asOwner.query(api.marketplace.myListingReadiness, {
				retailerId: retailer._id,
			}),
		).toEqual({ hasVisibleProduct: true });

		await expect(
			t
				.withIdentity({ subject: "user_mkt_stranger" })
				.query(api.marketplace.myListingReadiness, {
					retailerId: retailer._id,
				}),
		).rejects.toThrow();
	});
});

describe("updateSettings — storeArea", () => {
	test("sets, collapses, clears, and refuses over-cap", async () => {
		const t = setup();
		const asUser = t.withIdentity({ subject: "user_mkt_area" });
		const { retailerId } = await seedListableStore(
			t,
			"user_mkt_area",
			"kedai-area",
		);
		await asUser.mutation(api.retailers.updateSettings, {
			storeArea: "  Ampang,   KL ",
		});
		expect(
			await t.run(async (ctx) => (await ctx.db.get(retailerId))?.storeArea),
		).toBe("Ampang, KL");
		expect(
			(await t.query(api.marketplace.listStores))[0].storeArea,
		).toBe("Ampang, KL");
		await asUser.mutation(api.retailers.updateSettings, { storeArea: "  " });
		// `t.run` serializes undefined to null — either spelling means "unset".
		expect(
			(await t.run(
				async (ctx) => (await ctx.db.get(retailerId))?.storeArea,
			)) ?? null,
		).toBeNull();
		await expect(
			asUser.mutation(api.retailers.updateSettings, {
				storeArea: "x".repeat(STORE_AREA_MAX + 1),
			}),
		).rejects.toThrow(/exceeds/);
	});
});

describe("admin.setMarketplaceSponsorship", () => {
	test("admin-only, future-only, audited, clearable", async () => {
		const t = setup();
		const { retailerId } = await seedListableStore(
			t,
			"user_mkt_adm",
			"kedai-adm",
		);
		const asSeller = t.withIdentity({ subject: "user_mkt_adm" });
		const asAdmin = t.withIdentity({ subject: ADMIN });
		const future = Date.now() + 7 * 24 * 60 * 60 * 1000;

		await expect(
			asSeller.mutation(api.admin.setMarketplaceSponsorship, {
				retailerId,
				until: future,
			}),
		).rejects.toThrow();

		await expect(
			asAdmin.mutation(api.admin.setMarketplaceSponsorship, {
				retailerId,
				until: Date.now() - 1,
			}),
		).rejects.toThrow(/future/);

		await asAdmin.mutation(api.admin.setMarketplaceSponsorship, {
			retailerId,
			until: future,
		});
		expect(
			await t.run(
				async (ctx) => (await ctx.db.get(retailerId))?.marketplaceSponsoredUntil,
			),
		).toBe(future);

		await asAdmin.mutation(api.admin.setMarketplaceSponsorship, {
			retailerId,
			until: null,
		});
		expect(
			(await t.run(
				async (ctx) =>
					(await ctx.db.get(retailerId))?.marketplaceSponsoredUntil,
			)) ?? null,
		).toBeNull();

		const audit = await t.run(async (ctx) =>
			ctx.db.query("adminAuditLog").collect(),
		);
		expect(audit.map((r) => r.action)).toEqual([
			"marketplace.sponsor.set",
			"marketplace.sponsor.clear",
		]);
	});
});
