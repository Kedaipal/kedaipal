// Cross-border delivery MY ↔ SG (z8r3fdr5yy) — the reads and writes that
// need the database. The rules themselves live in `./lib/crossBorder` (pure);
// this module answers "which lanes is THIS store taking orders on" with the
// store's real entitlement, and owns the seller's product-eligibility screen.
// See docs/cross-border.md.

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	mutation,
	type MutationCtx,
	query,
	type QueryCtx,
} from "./_generated/server";
import { requireRetailerAccess, storeOwnerIsAdmin } from "./lib/auth";
import { DEFAULT_COUNTRY, type Country } from "./lib/country";
import {
	type CrossBorderLane,
	domesticReason,
	type DomesticReason,
	effectiveLanes,
	hasParcelLeg,
	type LanePause,
	lanePauseFor,
} from "./lib/crossBorder";
import {
	type EasyparcelQuoteBlock,
	loadEasyparcelQuoteBlock,
} from "./lib/easyparcelArming";
import { COUNTRY_CURRENCY } from "./lib/country";
import { rateLimiter } from "./lib/rateLimiter";
import { assertSubscriptionActive, getAccess } from "./subscriptions";

type Ctx = QueryCtx | MutationCtx;

/** Everything a surface needs to know about a store's lanes. */
export type StoreLanes = {
	storeCountry: Country;
	/** As saved — shown in settings even while paused. */
	stored: CrossBorderLane[];
	/** Taking orders right now (empty while paused). */
	effective: CrossBorderLane[];
	/** Why stored lanes aren't live; null when they are (or none are stored). */
	pause: LanePause | null;
	/** Only read for a live (EasyParcel-priced) lane: why EasyParcel can't
	 * quote — the fix the seller is shown. Null otherwise. */
	easyparcelBlock: EasyparcelQuoteBlock | null;
};

/**
 * The store's lanes, judged with its REAL entitlement. An admin-owned store
 * always has every feature (the `assertPlanFeature` posture); everyone else
 * reads the resolved subscription, so a downgrade pauses the lane here, at
 * every door at once, without a settings write.
 */
export async function storeLanes(
	ctx: Ctx,
	retailer: Doc<"retailers">,
): Promise<StoreLanes> {
	const storeCountry = retailer.country ?? DEFAULT_COUNTRY;
	const stored = (retailer.crossBorderLanes as CrossBorderLane[] | undefined) ?? [];
	if (stored.length === 0) {
		return {
			storeCountry,
			stored,
			effective: [],
			pause: null,
			easyparcelBlock: null,
		};
	}
	const planAllows =
		storeOwnerIsAdmin(retailer) ||
		(await getAccess(ctx, retailer._id)).features.crossBorder;
	// One indexed read, and only for a lane EasyParcel prices.
	const easyparcelBlock = stored.some((lane) => lane.pricing.kind === "live")
		? await loadEasyparcelQuoteBlock(
				ctx,
				retailer,
				retailer.currency ?? COUNTRY_CURRENCY[storeCountry],
			)
		: null;
	const facts = {
		planAllows,
		offerDelivery: retailer.offerDelivery,
		easyparcelQuotes: easyparcelBlock === null,
	};
	return {
		storeCountry,
		stored,
		effective: effectiveLanes({ ...facts, lanes: stored, storeCountry }),
		pause: lanePauseFor({
			...facts,
			lane: stored.find((lane) => lane.country !== storeCountry),
		}),
		easyparcelBlock,
	};
}

/** One row of the seller's "which products ship abroad" screen. */
export type LaneProductRow = {
	_id: Id<"products">;
	name: string;
	sku?: string;
	imageUrl?: string;
	categoryIds: Id<"categories">[];
	/** Ticked = goes abroad. False while `reason` explains why it can't. */
	shipsAbroad: boolean;
	/** `no_parcel`: a service / event — never tickable. `seller_choice`: the
	 * seller marked it domestic-only — tickable back on. */
	reason: DomesticReason | null;
};

/**
 * The seller's product-eligibility screen: every live product, grouped by the
 * seller's categories, with whether it goes abroad. The one-time pass when the
 * lane is first switched on, and the screen "Choose products" reopens later.
 */
export const productChoices = query({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		products: LaneProductRow[];
		categories: Array<{ _id: Id<"categories">; name: string }>;
	}> => {
		await requireRetailerAccess(ctx, retailerId, {
			area: "products",
			level: "read",
		});
		const products = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("active", true),
			)
			.collect();
		products.sort(
			(a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt,
		);
		const categories = (
			await ctx.db
				.query("categories")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.collect()
		)
			.filter((c) => c.active)
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((c) => ({ _id: c._id, name: c.name }));
		const junctions = await ctx.db
			.query("productCategories")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		const categoryIdsOf = new Map<string, Id<"categories">[]>();
		for (const j of junctions) {
			const list = categoryIdsOf.get(j.productId) ?? [];
			list.push(j.categoryId);
			categoryIdsOf.set(j.productId, list);
		}
		const rows = await Promise.all(
			products.map(async (product): Promise<LaneProductRow> => {
				const first = product.imageStorageIds[0];
				const imageUrl = first
					? ((await ctx.storage.getUrl(first)) ?? undefined)
					: undefined;
				const reason = domesticReason(product);
				return {
					_id: product._id,
					name: product.name,
					sku: product.sku,
					imageUrl,
					categoryIds: categoryIdsOf.get(product._id) ?? [],
					shipsAbroad: reason === null,
					reason,
				};
			}),
		);
		return { products: rows, categories };
	},
});

/** Bounded like the parcel-weight fill — the screen sends one save of at most
 * this many products (a catalogue is capped at 200 by `productCap`). */
export const LANE_PRODUCTS_BATCH_MAX = 250;

/**
 * Save the eligibility screen in one write: which products stay at home.
 * Every id is checked against the calling store before anything is written,
 * and a product with no parcel leg can't be "turned on" — it has nothing to
 * ship. Writes `domesticOnly` and nothing else (the product editor's switch
 * writes the same field through `products.update`).
 */
export const setDomesticOnly = mutation({
	args: {
		retailerId: v.id("retailers"),
		changes: v.array(
			v.object({ productId: v.id("products"), domesticOnly: v.boolean() }),
		),
		/** The seller finished the "what can go" step for a new lane: clear
		 * its `awaitingProducts` hold in the same transaction as the choices,
		 * so the lane goes live exactly when the products are right. */
		confirmLane: v.optional(v.boolean()),
	},
	handler: async (
		ctx,
		{ retailerId, changes, confirmLane },
	): Promise<{ updated: number }> => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			area: "products",
			level: "write",
		});
		await rateLimiter.limit(ctx, "productWrite", {
			key: access.userId,
			throws: true,
		});
		if (!access.actingAsAdmin) await assertSubscriptionActive(ctx, retailerId);
		if (confirmLane) {
			const lanes = access.retailer.crossBorderLanes as
				| CrossBorderLane[]
				| undefined;
			if (lanes?.some((lane) => lane.awaitingProducts)) {
				await ctx.db.patch(retailerId, {
					crossBorderLanes: lanes.map(
						({ awaitingProducts: _done, ...lane }) => lane,
					),
				});
			}
		}
		if (changes.length === 0) return { updated: 0 };
		if (changes.length > LANE_PRODUCTS_BATCH_MAX)
			throw new ConvexError(
				`Save at most ${LANE_PRODUCTS_BATCH_MAX} products at a time.`,
			);
		const rows = await Promise.all(
			changes.map(async (change) => {
				const product = await ctx.db.get(change.productId);
				if (!product || product.retailerId !== retailerId)
					throw new ConvexError(
						"One of these products isn't in your store any more — reload and try again.",
					);
				if (!change.domesticOnly && !hasParcelLeg(product))
					throw new ConvexError(
						`"${product.name}" has no parcel to ship, so it can't go abroad.`,
					);
				return { product, domesticOnly: change.domesticOnly };
			}),
		);
		const now = Date.now();
		let updated = 0;
		for (const { product, domesticOnly } of rows) {
			if ((product.domesticOnly === true) === domesticOnly) continue;
			// Absent is the default (inherit), so "ships abroad" clears the field
			// rather than storing `false` — one spelling of the default.
			await ctx.db.patch(product._id, {
				domesticOnly: domesticOnly ? true : undefined,
				updatedAt: now,
			});
			updated++;
		}
		return { updated };
	},
});

/** The seller settings page's read: stored lanes, why they're paused, and
 * how much of the catalogue goes abroad (the "38 of 42" line). */
export const settingsOverview = query({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		lanes: StoreLanes;
		products: { total: number; shipsAbroad: number; noParcel: number };
	}> => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			area: "fulfilment",
			level: "read",
		});
		const lanes = await storeLanes(ctx, access.retailer);
		const products = await ctx.db
			.query("products")
			.withIndex("by_retailer_active", (q) =>
				q.eq("retailerId", retailerId).eq("active", true),
			)
			.collect();
		let shipsAbroad = 0;
		let noParcel = 0;
		for (const product of products) {
			const reason = domesticReason(product);
			if (reason === null) shipsAbroad++;
			else if (reason === "no_parcel") noParcel++;
		}
		return {
			lanes,
			products: { total: products.length, shipsAbroad, noParcel },
		};
	},
});
