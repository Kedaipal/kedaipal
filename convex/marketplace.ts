import { v } from "convex/values";
import { storeLanes } from "./crossBorder";
import { type CrossBorderLane, shipsAbroad } from "./lib/crossBorder";
import { takesBuyerOrders } from "./lib/storeAvailability";
import { availabilityResolver, storeAvailabilityOf } from "./storeAvailability";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { adminUserIds, requireRetailerAccess } from "./lib/auth";
import { isExcludedRetailer } from "./lib/businessReport";
import type { ClosedDateRange } from "./lib/closedDates";
import {
	type Country,
	countryValidator,
	DEFAULT_COUNTRY,
} from "./lib/country";
import {
	highlightSource,
	isInternalStore,
	isListableRow,
} from "./lib/marketplaceListing";
import { isUnclaimed } from "./lib/unclaimedStore";
import type { OpeningHours } from "./lib/openingHours";
import { hiddenFromStorefront } from "./lib/productEvent";
import { type FeaturedIn, featuredIn } from "./lib/showcaseFeatured";
import { loadSubscription } from "./subscriptions";

/**
 * The public store directory's card payload (z8r3fdkmyp) — the marketplace
 * home at kedaipal.com/stores.
 *
 * Card fields ONLY. Nothing here may leak what the storefront payload keeps
 * private: no subscription state, no contact numbers, no payment or courier
 * config. `openingHours`/`closedDates` ride along (both already public on the
 * by-slug payload) so the card's live "Open now" line shares ONE author with
 * the storefront header (`openNowStatus` + `opening-hours-line.tsx`) instead
 * of a server-frozen snapshot that goes stale while the page sits open.
 */
export type MarketplaceStoreCard = {
	slug: string;
	storeName: string;
	storeDescription?: string;
	/** Seller-typed area line ("Ampang, KL") — see schema `storeArea`. */
	storeArea?: string;
	country: Country;
	logoUrl?: string;
	/** Only populated on a sponsored card — the highlight rail is the one
	 * surface that renders covers, so everyone else skips the storage read. */
	coverImageUrl?: string;
	/** Resolved: undefined means TRUE (legacy stores always delivered) — same
	 * rule as the storefront reads it. Drives the "Delivers" filter chip. */
	offersDelivery: boolean;
	openingHours?: OpeningHours;
	closedDates?: ClosedDateRange[];
	isFoundingMember?: boolean;
	foundingMemberRank?: number;
	/** On the "Store highlights" rail — a live paid window, or comped as a
	 * highlight kind (`highlightSource`). Renders WITH a visible "Sponsored"
	 * label either way: the label tells the buyer the position is promoted,
	 * not earned by ranking, which is true of both. The reason stays
	 * server-side (it would reveal billing state). */
	sponsored: boolean;
	/** Off-Season Hold — the card says "browse only" instead of "Open now",
	 * matching what the buyer will find on the storefront itself. */
	orderingPaused: boolean;
	/** Set when the card is listed in ANOTHER country's directory because the
	 * store delivers there (z8r3fdr5yy) — the "Ships from Malaysia" chip. */
	shipsFrom?: Country;
	createdAt: number;
};

/**
 * Does the store have at least one product a buyer would actually see on its
 * storefront? Same visibility rules as `products.list` — active, not hidden,
 * not hidden-by-category, not a finished event — because "listed on the
 * directory, empty on arrival" is a dead end we send buyers into.
 *
 * Walks the index and returns on the first hit, like the sitemap's
 * `storefrontIndex.hasVisibleProduct` — a window (`take(20)`) was wrong once
 * a predicate ran AFTER it (PR #431 review): a frozen seller whose oldest 20
 * visible products stay home vanished from the other country's directory
 * though newer dry goods could make the trip. The scan is bounded by the
 * catalogue cap, and the common case still reads ~1 document.
 */
export async function hasVisibleProduct(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
	/** Narrow "visible" further — the cross-border listing asks for a visible
	 * product that can also go abroad (z8r3fdr5yy). */
	alsoRequire: (row: Doc<"products">) => boolean = () => true,
): Promise<boolean> {
	for await (const row of ctx.db
		.query("products")
		.withIndex("by_retailer_active", (q) =>
			q.eq("retailerId", retailerId).eq("active", true),
		)
		.filter((q) =>
			q.and(
				q.neq(q.field("hidden"), true),
				q.neq(q.field("hiddenByCategory"), true),
			),
		)) {
		if (!hiddenFromStorefront(row) && alsoRequire(row)) return true;
	}
	return false;
}

/**
 * Kedaipal's own or a test store? The server half of `isInternalStore` — it
 * needs the admin allowlist and the subscription's comp kind. Shared by the
 * directory, the seller card's readiness answer and the admin console, so
 * "is this store on /stores?" has exactly one answer everywhere.
 */
export function storeIsInternal(
	row: Doc<"retailers">,
	sub: Doc<"subscriptions"> | null,
	adminIds: readonly string[],
): boolean {
	// A store nobody owns yet is never on /stores, and this says so
	// STRUCTURALLY rather than leaning on the `internal` comp it also carries
	// (docs/prebuilt-stores.md). The comp is a billing state an admin can edit
	// — comp it `partner` ahead of a deal and the exclusion would evaporate —
	// whereas "has no owner" is the actual reason: a buyer who orders from an
	// unclaimed store is messaging a shop with nobody behind it.
	if (isUnclaimed(row)) return true;
	return isInternalStore(
		isExcludedRetailer(
			{
				id: row._id,
				slug: row.slug,
				userId: row.userId,
				notifyEmail: row.notifyEmail,
				createdAt: row.createdAt,
			},
			adminIds,
		),
		sub?.comp?.kind,
	);
}

/**
 * The seller's own "am I actually on /stores?" answer, for the Settings →
 * Store → Marketplace listing card. The switch alone can't say it: a store
 * that is ON but has no storefront-visible product is NOT listed, and the
 * card telling that seller "Shown in the directory" would be copy that lies
 * to exactly the new seller reading it. A separate query, not a field on
 * `getMyRetailer`, so the product read stays off the dashboard's hot path —
 * only the settings card subscribes to it.
 */
export const myListingReadiness = query({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		hasVisibleProduct: boolean;
		internal: boolean;
		/** An admin took the store off /stores, with their optional note to
		 * the seller — the card says so instead of "Shown in the directory". */
		hidden: { note?: string } | null;
		/** Kedaipal took the store offline (z8r3fdudf7) — off the directory
		 * and every showcase, whatever the switch says. */
		offline: boolean;
		/** Published showcases this store is in (z8r3fdr6mv) — the seller is
		 * TOLD, with the label Kedaipal gave them and the link to share. */
		featuredIn: FeaturedIn[];
	}> => {
		const { retailer } = await requireRetailerAccess(ctx, retailerId, {
			area: "store_settings",
			level: "read",
		});
		// An internal store is never listed, whatever its switch says — the
		// card must not tell Kedaipal's own team "Shown in the directory".
		const sub = await loadSubscription(ctx, retailerId);
		return {
			hasVisibleProduct: await hasVisibleProduct(ctx, retailerId),
			internal: storeIsInternal(retailer, sub, adminUserIds()),
			hidden: retailer.marketplaceHidden
				? { note: retailer.marketplaceHidden.note }
				: null,
			offline: (await storeAvailabilityOf(ctx, retailer)).state === "offline",
			featuredIn: await featuredIn(ctx, retailerId, Date.now()),
		};
	},
});

/**
 * Why a store is NOT on /stores, in the order the listable rule checks them
 * — or `null` when it is listed. The directory's one answer, shared by
 * `listStores` (which only needs the boolean) and by the showcase editor,
 * which must NAME the reason on a member row ("Not shown: seller opted out
 * of /stores") rather than drop the store silently (z8r3fdr6mv).
 */
export type NotListedReason =
	| "internal"
	| "hidden_by_admin"
	| "offline"
	| "opted_out"
	| "purging"
	| "no_visible_product";

export async function notListedReason(
	ctx: QueryCtx,
	row: Doc<"retailers">,
	adminIds: readonly string[],
): Promise<NotListedReason | null> {
	const sub = await loadSubscription(ctx, row._id);
	if (storeIsInternal(row, sub, adminIds)) return "internal";
	if (row.marketplaceHidden !== undefined) return "hidden_by_admin";
	// Kedaipal took the store offline (z8r3fdudf7) — `isListableRow` drops it
	// from the directory, so a showcase must drop it too, or its ticket (and
	// cover) would ride out on /stores while the store itself is gone.
	if ((await storeAvailabilityOf(ctx, row)).state === "offline")
		return "offline";
	if (row.marketplaceUnlistedAt !== undefined) return "opted_out";
	if (row.purgeStartedAt !== undefined) return "purging";
	if (!(await hasVisibleProduct(ctx, row._id))) return "no_visible_product";
	return null;
}

/**
 * General-list order, after the client lifts sponsored + founding into their
 * own shelves: proven stores first (activated — has confirmed at least one
 * order — newest activation first), then the not-yet-activated by newest
 * store. A v1 heuristic, deliberately data-derived rather than hand-curated
 * (docs/storefront-landing.md precedent — curation goes stale); a true
 * recent-order-activity rank needs a denormalized counter and is the named
 * upgrade path in docs/marketplace-home.md.
 */
function generalOrder(a: Doc<"retailers">, b: Doc<"retailers">): number {
	const aActive = a.activatedAt !== undefined;
	const bActive = b.activatedAt !== undefined;
	if (aActive !== bActive) return aActive ? -1 : 1;
	if (aActive && bActive)
		return (b.activatedAt ?? 0) - (a.activatedAt ?? 0);
	return b.createdAt - a.createdAt;
}

/**
 * Every listable store IN ONE MARKET, as directory cards (z8r3fdwduz). /stores
 * shows a buyer their own market only — Shopee-style, no MY/SG switch — so the
 * market is scoped HERE, not by the client hiding the other half of a payload
 * it already received. The filter chips still act client-side on the result.
 *
 * `country` is optional only so a tab opened before this shipped (calling with
 * `{}`) keeps rendering until it reloads; absent returns every market, the old
 * contract. The page always passes it.
 *
 * Full-table `.collect()` is a documented ceiling, not an accident: there is
 * no field to index a "listable" scan on (the rule spans three tables), and
 * at the current store count the read is cheap. The market check runs FIRST,
 * so the other market's rows cost no subscription/product/storage reads. The
 * upgrade path — a denormalized `marketplaceListedAt` maintained by the
 * writers — is named in docs/marketplace-home.md so it's a follow-up, not a
 * rediscovery.
 */
export const listStores = query({
	args: { country: v.optional(countryValidator) },
	handler: async (ctx, args): Promise<MarketplaceStoreCard[]> => {
		const now = Date.now();
		const adminIds = adminUserIds();
		const rows = await ctx.db.query("retailers").collect();
		const availabilityOf = await availabilityResolver(ctx);
		const cards: Array<{ card: MarketplaceStoreCard; row: Doc<"retailers"> }> =
			[];
		for (const row of rows) {
			const rowCountry = row.country ?? DEFAULT_COUNTRY;
			// A store from the other country is listed here only when it is
			// taking orders TO this country right now (z8r3fdr5yy) — a saved lane
			// is the cheap pre-check before any subscription read.
			const abroad =
				args.country !== undefined && rowCountry !== args.country;
			if (abroad) {
				const country = args.country;
				const savedLane = (
					row.crossBorderLanes as CrossBorderLane[] | undefined
				)?.some((lane) => lane.country === country);
				if (!savedLane) continue;
				const live = (await storeLanes(ctx, row)).effective.some(
					(lane) => lane.country === country,
				);
				if (!live) continue;
			}
			// The subscription is read for TWO store facts — is this an internal
			// store, and is it comped into Store highlights — and never shipped:
			// the card says "sponsored", not why.
			const sub = await loadSubscription(ctx, row._id);
			if (
				!isListableRow({
					marketplaceUnlistedAt: row.marketplaceUnlistedAt,
					purgeStartedAt: row.purgeStartedAt,
					internal: storeIsInternal(row, sub, adminIds),
					hiddenByAdmin: row.marketplaceHidden !== undefined,
					offline: availabilityOf(row).state === "offline",
				})
			)
				continue;
			// Abroad, "something to buy" means something that can make the trip
			// — a store whose whole visible shelf is home-only would be a
			// dead end for this country's buyers.
			if (
				!(await hasVisibleProduct(
					ctx,
					row._id,
					abroad ? shipsAbroad : undefined,
				))
			)
				continue;
			// A highlight is bought for the store's own market; abroad it lists
			// on its merits, with the "Ships from" chip instead.
			const sponsored =
				!abroad &&
				highlightSource(
					{
						sponsoredUntil: row.marketplaceSponsoredUntil,
						comped: sub?.comped === true,
						compKind: sub?.comp?.kind,
						compHighlightOffAt: row.marketplaceCompHighlightOffAt,
					},
					now,
				) !== null;
			let logoUrl: string | undefined;
			if (row.logoStorageId) {
				logoUrl = (await ctx.storage.getUrl(row.logoStorageId)) ?? undefined;
			}
			let coverImageUrl: string | undefined;
			if (sponsored && row.coverImageStorageId) {
				coverImageUrl =
					(await ctx.storage.getUrl(row.coverImageStorageId)) ?? undefined;
			}
			cards.push({
				row,
				card: {
					slug: row.slug,
					storeName: row.storeName,
					storeDescription: row.storeDescription,
					storeArea: row.storeArea,
					country: rowCountry,
					...(abroad ? { shipsFrom: rowCountry } : {}),
					logoUrl,
					coverImageUrl,
					offersDelivery: row.offerDelivery !== false,
					openingHours: row.openingHours,
					closedDates: row.closedDates,
					isFoundingMember: row.isFoundingMember,
					foundingMemberRank: row.foundingMemberRank,
					sponsored,
					// Any pause (seller, hold, Kedaipal) reads "not taking orders"
					// on the card, from the one resolver the order doors use.
					orderingPaused: !takesBuyerOrders(
						availabilityOf(row),
					),
					createdAt: row.createdAt,
				},
			});
		}
		cards.sort((a, b) => generalOrder(a.row, b.row));
		return cards.map((c) => c.card);
	},
});
