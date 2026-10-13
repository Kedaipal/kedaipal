/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { HIDDEN_NOTE_MAX, STORE_AREA_MAX } from "./lib/marketplaceListing";
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
		// The storefront's public payload carries the bit — it hides the
		// footer's "Discover more stores" link for an opted-out store.
		const bySlug = await t.query(api.retailers.getRetailerBySlug, {
			slug: "kedai-optout",
		});
		expect(
			bySlug.status === "ok" ? bySlug.retailer.marketplaceUnlisted : null,
		).toBe(true);
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
		).toEqual({ hasVisibleProduct: false, internal: false, hidden: null });

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
		).toEqual({ hasVisibleProduct: true, internal: false, hidden: null });

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

describe("admin sponsorship — set / end", () => {
	test("admin-only, future-only, visible on the directory row, audited by function name", async () => {
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
			asSeller.mutation(api.admin.endMarketplaceSponsorship, { retailerId }),
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
		// The admin directory row carries the window — the pill and the
		// Manage item read it from here.
		const row = (await asAdmin.query(api.admin.listSellersForAdmin, {})).sellers.find(
			(r) => r._id === retailerId,
		);
		expect(row?.marketplace.sponsoredUntil).toBe(future);

		await asAdmin.mutation(api.admin.endMarketplaceSponsorship, { retailerId });
		expect(
			(await t.run(
				async (ctx) =>
					(await ctx.db.get(retailerId))?.marketplaceSponsoredUntil,
			)) ?? null,
		).toBeNull();
		// Ending a window that isn't running is a no-op — no second audit row.
		await asAdmin.mutation(api.admin.endMarketplaceSponsorship, { retailerId });

		const audit = await t.run(async (ctx) =>
			ctx.db.query("adminAuditLog").collect(),
		);
		expect(audit.map((r) => [r.action, r.targetId])).toEqual([
			["admin.setMarketplaceSponsorship", retailerId],
			["admin.endMarketplaceSponsorship", retailerId],
		]);
	});
});

describe("comped stores ride Store highlights; internal stores never list", () => {
	test("partner comp → highlighted; admin switch off/on; revoking the comp ends it", async () => {
		const t = setup();
		const { retailerId } = await seedListableStore(
			t,
			"user_mkt_comp",
			"kedai-comp",
		);
		const asAdmin = t.withIdentity({ subject: ADMIN });
		const card = async () =>
			(await t.query(api.marketplace.listStores)).find(
				(c) => c.slug === "kedai-comp",
			);

		expect((await card())?.sponsored).toBe(false);

		await asAdmin.mutation(api.subscriptions.setComp, {
			retailerId,
			kind: "partner",
		});
		expect((await card())?.sponsored).toBe(true);

		await asAdmin.mutation(api.admin.setCompHighlight, {
			retailerId,
			on: false,
		});
		expect((await card())?.sponsored).toBe(false);
		// Still LISTED — the switch only takes it off the rail.
		expect(await card()).toBeDefined();

		await asAdmin.mutation(api.admin.setCompHighlight, {
			retailerId,
			on: true,
		});
		expect((await card())?.sponsored).toBe(true);

		await asAdmin.mutation(api.subscriptions.revokeComp, { retailerId });
		expect((await card())?.sponsored).toBe(false);

		const audit = await t.run(async (ctx) =>
			ctx.db.query("adminAuditLog").collect(),
		);
		expect(
			audit.filter((r) => r.action === "admin.setCompHighlight"),
		).toHaveLength(2);
	});

	test("setCompHighlight is admin-only and refuses a store that isn't comp-eligible", async () => {
		const t = setup();
		const { retailerId } = await seedListableStore(
			t,
			"user_mkt_ineligible",
			"kedai-plain",
		);
		await expect(
			t
				.withIdentity({ subject: "user_mkt_ineligible" })
				.mutation(api.admin.setCompHighlight, { retailerId, on: false }),
		).rejects.toThrow();
		await expect(
			t
				.withIdentity({ subject: ADMIN })
				.mutation(api.admin.setCompHighlight, { retailerId, on: false }),
		).rejects.toThrow(/featured automatically/);
	});

	test("an internal comp and an admin-owned store are never listed — and their seller card knows", async () => {
		const t = setup();
		const asAdmin = t.withIdentity({ subject: ADMIN });
		const internalComp = await seedListableStore(
			t,
			"user_mkt_internal",
			"kedai-internal",
		);
		await asAdmin.mutation(api.subscriptions.setComp, {
			retailerId: internalComp.retailerId,
			kind: "internal",
		});
		const adminOwned = await seedListableStore(t, ADMIN, "kedai-admin");

		const slugs = (await t.query(api.marketplace.listStores)).map(
			(c) => c.slug,
		);
		expect(slugs).not.toContain("kedai-internal");
		expect(slugs).not.toContain("kedai-admin");

		expect(
			await asAdmin.query(api.marketplace.myListingReadiness, {
				retailerId: adminOwned.retailerId,
			}),
		).toEqual({ hasVisibleProduct: true, internal: true, hidden: null });

		const { sellers: rows } = await asAdmin.query(api.admin.listSellersForAdmin, {});
		expect(
			rows.find((r) => r.slug === "kedai-internal")?.marketplace.internal,
		).toBe(true);
	});
});

describe("admin hide from /stores — moderation over the seller's switch", () => {
	test("admin-only; hidden stores drop off, the seller can't relist past it, show brings it back", async () => {
		const t = setup();
		const { retailerId } = await seedListableStore(
			t,
			"user_mkt_hide",
			"kedai-hide",
		);
		const asSeller = t.withIdentity({ subject: "user_mkt_hide" });
		const asAdmin = t.withIdentity({ subject: ADMIN });
		const listed = async () =>
			(await t.query(api.marketplace.listStores)).map((c) => c.slug);

		await expect(
			asSeller.mutation(api.admin.hideFromMarketplace, { retailerId }),
		).rejects.toThrow();
		await expect(
			asSeller.mutation(api.admin.showOnMarketplace, { retailerId }),
		).rejects.toThrow();

		await asAdmin.mutation(api.admin.hideFromMarketplace, {
			retailerId,
			note: "  Add real product photos and we'll relist you.  ",
		});
		expect(await listed()).toEqual([]);

		// The seller's own switch can't undo an admin hide.
		await asSeller.mutation(api.retailers.updateSettings, {
			marketplaceListed: false,
		});
		await asSeller.mutation(api.retailers.updateSettings, {
			marketplaceListed: true,
		});
		expect(await listed()).toEqual([]);

		// The seller's card is told, with the note — trimmed.
		expect(
			await asSeller.query(api.marketplace.myListingReadiness, { retailerId }),
		).toEqual({
			hasVisibleProduct: true,
			internal: false,
			hidden: { note: "Add real product photos and we'll relist you." },
		});
		// …and the admin row carries it for the pill, menu and sheet.
		const row = (await asAdmin.query(api.admin.listSellersForAdmin, {})).sellers.find(
			(r) => r._id === retailerId,
		);
		expect(row?.marketplace.hidden?.note).toBe(
			"Add real product photos and we'll relist you.",
		);
		// Never on the public storefront payload — moderation state stays
		// between Kedaipal and the seller.
		const bySlug = await t.query(api.retailers.getRetailerBySlug, {
			slug: "kedai-hide",
		});
		expect(JSON.stringify(bySlug)).not.toContain("relist");

		await asAdmin.mutation(api.admin.showOnMarketplace, { retailerId });
		expect(await listed()).toEqual(["kedai-hide"]);
		expect(
			(await asSeller.query(api.marketplace.myListingReadiness, { retailerId }))
				.hidden,
		).toBeNull();
	});

	test("idempotent both ways — the first stamp and note stand, the audit log names each act once", async () => {
		const t = setup();
		const { retailerId } = await seedListableStore(
			t,
			"user_mkt_hide2",
			"kedai-hide2",
		);
		const asAdmin = t.withIdentity({ subject: ADMIN });
		await asAdmin.mutation(api.admin.hideFromMarketplace, {
			retailerId,
			note: "first",
		});
		const first = await t.run(
			async (ctx) => (await ctx.db.get(retailerId))?.marketplaceHidden,
		);
		await asAdmin.mutation(api.admin.hideFromMarketplace, {
			retailerId,
			note: "second",
		});
		expect(
			await t.run(
				async (ctx) => (await ctx.db.get(retailerId))?.marketplaceHidden,
			),
		).toEqual(first);
		expect(first?.note).toBe("first");

		await asAdmin.mutation(api.admin.showOnMarketplace, { retailerId });
		await asAdmin.mutation(api.admin.showOnMarketplace, { retailerId });
		const audit = await t.run(async (ctx) =>
			ctx.db.query("adminAuditLog").collect(),
		);
		expect(audit.map((r) => [r.action, r.targetId])).toEqual([
			["admin.hideFromMarketplace", retailerId],
			["admin.showOnMarketplace", retailerId],
		]);
	});

	test("refuses an internal store and an over-long note; a blank note stores none", async () => {
		const t = setup();
		const asAdmin = t.withIdentity({ subject: ADMIN });
		const adminOwned = await seedListableStore(t, ADMIN, "kedai-admin-hide");
		await expect(
			asAdmin.mutation(api.admin.hideFromMarketplace, {
				retailerId: adminOwned.retailerId,
			}),
		).rejects.toThrow(/never listed/);

		const { retailerId } = await seedListableStore(
			t,
			"user_mkt_hide3",
			"kedai-hide3",
		);
		await expect(
			asAdmin.mutation(api.admin.hideFromMarketplace, {
				retailerId,
				note: "x".repeat(HIDDEN_NOTE_MAX + 1),
			}),
		).rejects.toThrow(/exceeds/);
		await asAdmin.mutation(api.admin.hideFromMarketplace, {
			retailerId,
			note: "   ",
		});
		const hidden = await t.run(
			async (ctx) => (await ctx.db.get(retailerId))?.marketplaceHidden,
		);
		expect(hidden && "note" in hidden).toBe(false);
	});
});

describe("a pre-built store never lists, however it is comped", () => {
	/** A pre-built store with one storefront-visible product — an admin mid-setup
	 * (docs/prebuilt-stores.md). Products are added through act-as, which is why
	 * the admin identity creates them against the unclaimed store's id. */
	async function seedUnclaimedListable(
		t: ReturnType<typeof setup>,
		slug: string,
	): Promise<Id<"retailers">> {
		const asAdmin = t.withIdentity({ subject: ADMIN });
		const { retailerId } = await asAdmin.mutation(
			api.retailers.createUnclaimedStore,
			{ storeName: `Store ${slug}`, slug },
		);
		await asAdmin.mutation(api.products.create, {
			retailerId,
			name: "Kuih Lapis",
			currency: "MYR",
			imageStorageIds: [],
			sortOrder: 0,
			variants: [{ optionValues: [], price: 10000, onHand: 10 }],
		});
		return retailerId;
	}

	test("a stocked, unclaimed store is absent from /stores and joins once claimed", async () => {
		const t = setup();
		const retailerId = await seedUnclaimedListable(t, "prebuilt-shop");
		await seedListableStore(t, "user_real", "real-shop");
		const before = (await t.query(api.marketplace.listStores, {})).map(
			(c) => c.slug,
		);
		expect(before).toContain("real-shop");
		// It has a product and nothing has hidden it — only "nobody owns this"
		// keeps it off the rail.
		expect(before).not.toContain("prebuilt-shop");

		await t.run(async (ctx) => {
			await ctx.db.patch(retailerId, {
				pendingOwnerEmail: "prebuilt@example.com",
			});
		});
		await t
			.withIdentity({
				subject: "user_prebuilt_vendor",
				email: "prebuilt@example.com",
				emailVerified: true,
			})
			.mutation(api.retailers.claimStore, { acceptedLegal: true });
		const after = (await t.query(api.marketplace.listStores, {})).map(
			(c) => c.slug,
		);
		expect(after).toContain("prebuilt-shop");
	});

	test("comping it `partner` does NOT put it on the rail while it is unclaimed", async () => {
		// The reason the exclusion is structural rather than a side effect of the
		// `internal` comp: a comp is a billing state an admin can edit, and
		// pre-comping a partner deal ahead of handover must not publish a store
		// with nobody behind it.
		const t = setup();
		const retailerId = await seedUnclaimedListable(t, "partner-prebuilt");
		await t.withIdentity({ subject: ADMIN }).mutation(
			api.subscriptions.setComp,
			{ retailerId, kind: "partner", label: "Sponsored by Maybank SME" },
		);
		const slugs = (await t.query(api.marketplace.listStores, {})).map(
			(c) => c.slug,
		);
		expect(slugs).not.toContain("partner-prebuilt");
	});
});
