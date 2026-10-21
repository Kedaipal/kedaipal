// The DB side of the storefront index rule (z8r3fdh2ye). The rule itself is
// pure, in `convex/lib/storefrontIndex.ts`; this file gathers its facts. Two
// entry points: one store (the storefront's `robots` meta — on the hottest
// public query, so it stops at the FIRST visible product) and every store
// (the sitemaps, which need the full set and read the availability table
// once instead of per store). See docs/seo.md.
//
// Scale note: the sitemap walk is a full read of `retailers` plus one indexed
// products read per store — fine under ~1k retailers (we are under 100). Past
// that, add `by_status` on subscriptions and page the walk.

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { hiddenFromStorefront } from "./lib/productEvent";
import {
	storefrontIndexable,
	storefrontLastmod,
} from "./lib/storefrontIndex";
import { isUnclaimed } from "./lib/unclaimedStore";
import { offlineStoreIds } from "./storeAvailability";
import { loadSubscription } from "./subscriptions";

/** The products a buyer can see on the storefront — the same filter
 * `products.list` applies, so "has products" means what the page shows. */
export async function visibleProducts(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<Doc<"products">[]> {
	const rows = await ctx.db
		.query("products")
		.withIndex("by_retailer_active", (q) =>
			q.eq("retailerId", retailerId).eq("active", true),
		)
		.collect();
	return rows.filter(isVisible);
}

function isVisible(p: Doc<"products">): boolean {
	return (
		p.hidden !== true && p.hiddenByCategory !== true && !hiddenFromStorefront(p)
	);
}

/**
 * "Has at least one visible product" without reading them all — this sits on
 * `getRetailerBySlug`, which every storefront, category and product load
 * runs (SSR and client), so it walks the index and returns on the first hit:
 * ~1 document in the common case instead of the store's whole catalogue
 * (PR #400 review).
 */
export async function hasVisibleProduct(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<boolean> {
	for await (const p of ctx.db
		.query("products")
		.withIndex("by_retailer_active", (q) =>
			q.eq("retailerId", retailerId).eq("active", true),
		)) {
		if (isVisible(p)) return true;
	}
	return false;
}

export interface IndexableStore {
	retailer: Doc<"retailers">;
	products: Doc<"products">[];
	/** Sitemap `lastmod` — see `storefrontLastmod`. */
	lastmod: number;
}

/** Every store the sitemaps may list, with the facts each sitemap needs. */
export async function indexableStores(
	ctx: QueryCtx,
): Promise<IndexableStore[]> {
	const offline = await offlineStoreIds(ctx);
	const retailers = await ctx.db.query("retailers").collect();
	const out: IndexableStore[] = [];
	for (const retailer of retailers) {
		if (isUnclaimed(retailer) || offline.has(retailer._id)) continue;
		const subscription = await loadSubscription(ctx, retailer._id);
		const products = await visibleProducts(ctx, retailer._id);
		const indexable = storefrontIndexable({
			unclaimed: false,
			offline: false,
			subscriptionStatus: subscription?.status ?? null,
			visibleProductCount: products.length,
		});
		if (!indexable) continue;
		out.push({
			retailer,
			products,
			lastmod: storefrontLastmod({
				retailerUpdatedAt: retailer.updatedAt,
				productUpdatedAts: products.map((p) => p.updatedAt),
			}),
		});
	}
	return out;
}

/** One store's answer, for the storefront's `<meta name="robots">`. */
export async function isStorefrontIndexable(
	ctx: QueryCtx,
	retailer: Doc<"retailers">,
	offline: boolean,
): Promise<boolean> {
	if (isUnclaimed(retailer) || offline) return false;
	const subscription = await loadSubscription(ctx, retailer._id);
	return storefrontIndexable({
		unclaimed: false,
		offline: false,
		subscriptionStatus: subscription?.status ?? null,
		visibleProductCount: (await hasVisibleProduct(ctx, retailer._id)) ? 1 : 0,
	});
}
