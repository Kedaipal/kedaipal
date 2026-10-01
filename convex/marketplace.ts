import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { adminUserIds, requireRetailerAccess } from "./lib/auth";
import { isExcludedRetailer } from "./lib/businessReport";
import type { ClosedDateRange } from "./lib/closedDates";
import { type Country, DEFAULT_COUNTRY } from "./lib/country";
import {
	highlightSource,
	isInternalStore,
	isListableRow,
} from "./lib/marketplaceListing";
import type { OpeningHours } from "./lib/openingHours";
import { hiddenFromStorefront } from "./lib/productEvent";
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
	createdAt: number;
};

/**
 * Does the store have at least one product a buyer would actually see on its
 * storefront? Same visibility rules as `products.list` — active, not hidden,
 * not hidden-by-category, not a finished event — because "listed on the
 * directory, empty on arrival" is a dead end we send buyers into.
 *
 * `take(20)` bounds the read: the first 20 active rows almost always contain
 * a visible one, and a store whose first 20 active products are ALL
 * storefront-hidden (finished events / counter-only) reads as not listable —
 * which is the honest answer for what a buyer would find.
 */
async function hasVisibleProduct(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<boolean> {
	const candidates = await ctx.db
		.query("products")
		.withIndex("by_retailer_active", (q) =>
			q.eq("retailerId", retailerId).eq("active", true),
		)
		.filter((q) =>
			q.and(
				q.neq(q.field("hidden"), true),
				q.neq(q.field("hiddenByCategory"), true),
			),
		)
		.take(20);
	return candidates.some((row) => !hiddenFromStorefront(row));
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
		};
	},
});

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
 * Every listable store, as directory cards. Public + arg-less: the region
 * split (MY/SG) and the filter chips act client-side on the one payload —
 * the table is small (low hundreds), the page needs the counts per region
 * anyway, and one cacheable result beats a query per toggle flip.
 *
 * Full-table `.collect()` is a documented ceiling, not an accident: there is
 * no field to index a "listable" scan on (the rule spans three tables), and
 * at the current store count the read is cheap. The upgrade path — a
 * denormalized `marketplaceListedAt` maintained by the writers — is named in
 * docs/marketplace-home.md so it's a follow-up, not a rediscovery.
 */
export const listStores = query({
	args: {},
	handler: async (ctx): Promise<MarketplaceStoreCard[]> => {
		const now = Date.now();
		const adminIds = adminUserIds();
		const rows = await ctx.db.query("retailers").collect();
		const cards: Array<{ card: MarketplaceStoreCard; row: Doc<"retailers"> }> =
			[];
		for (const row of rows) {
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
				})
			)
				continue;
			if (!(await hasVisibleProduct(ctx, row._id))) continue;
			const sponsored =
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
					country: row.country ?? DEFAULT_COUNTRY,
					logoUrl,
					coverImageUrl,
					offersDelivery: row.offerDelivery !== false,
					openingHours: row.openingHours,
					closedDates: row.closedDates,
					isFoundingMember: row.isFoundingMember,
					foundingMemberRank: row.foundingMemberRank,
					sponsored,
					orderingPaused: row.orderingPausedAt !== undefined,
					createdAt: row.createdAt,
				},
			});
		}
		cards.sort((a, b) => generalOrder(a.row, b.row));
		return cards.map((c) => c.card);
	},
});
