// Admin Console — the white-glove "act-as seller" surface (ClickUp 86ey25er1,
// docs/admin-console.md). These reads are the seller directory + audit trail
// behind /app/admin/sellers. Every function is `requireAdmin`-gated server-side
// (the client `billing.amIAdmin` check is cosmetic) so a normal seller can never
// reach another store's data here.
//
// The act-as WRITE path does NOT live here — it's the owner-OR-admin
// `requireRetailerAccess` gate threaded through the normal dashboard functions
// (products/orders/customers/retailers/pickupLocations/counterCheckout), with
// `logAdminAction` stamping an `adminAuditLog` row on each admin-on-behalf write.

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { loadSubscription } from "./subscriptions";

/** How many sellers the directory pulls. The Founding cohort is ~10 and the whole
 * book is small for a while yet; 500 is generous headroom without pagination. */
const SELLER_LIMIT = 500;
/** Recent audit rows surfaced per store in the console. */
const AUDIT_LIMIT = 50;

export type AdminSellerRow = {
	_id: Id<"retailers">;
	storeName: string;
	slug: string;
	/** Clerk subject of the owner — shown so an admin can match a store to a person. */
	ownerUserId: string;
	isFoundingMember: boolean;
	foundingMemberRank?: number;
	subscriptionStatus?: Doc<"subscriptions">["status"];
	plan?: Doc<"subscriptions">["plan"];
	createdAt: number;
};

/**
 * Every seller, for the admin act-as directory. Richer than
 * `invoices.listRetailersForAdmin` (which is billing-focused): this carries the
 * owner + founding rank + subscription status the "Manage" flow needs. Sorted
 * Founding Members first (by rank), then newest store first — the onboarding
 * cohort floats to the top.
 */
export const listSellersForAdmin = query({
	args: {},
	handler: async (ctx): Promise<AdminSellerRow[]> => {
		await requireAdmin(ctx);
		const retailers = await ctx.db
			.query("retailers")
			.order("desc")
			.take(SELLER_LIMIT);
		const rows: AdminSellerRow[] = [];
		for (const r of retailers) {
			const sub = await loadSubscription(ctx, r._id);
			rows.push({
				_id: r._id,
				storeName: r.storeName,
				slug: r.slug,
				ownerUserId: r.userId,
				isFoundingMember: r.isFoundingMember === true,
				foundingMemberRank: r.foundingMemberRank,
				subscriptionStatus: sub?.status,
				plan: sub?.plan,
				createdAt: r._creationTime,
			});
		}
		rows.sort((a, b) => {
			// Founding Members first, ordered by rank; everyone else by newest.
			const ra = a.foundingMemberRank;
			const rb = b.foundingMemberRank;
			if (ra !== undefined && rb !== undefined) return ra - rb;
			if (ra !== undefined) return -1;
			if (rb !== undefined) return 1;
			return b.createdAt - a.createdAt;
		});
		return rows;
	},
});

export type AdminAuditRow = {
	_id: Id<"adminAuditLog">;
	adminUserId: string;
	action: string;
	targetId?: string;
	ts: number;
};

/**
 * Recent admin-on-behalf edits for one store — the attributability surface. Lets
 * an admin (and, later, a seller-facing "changes by Kedaipal" view) see exactly
 * what was done on a store during white-glove. Admin-gated; newest first.
 */
export const recentAuditForRetailer = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<AdminAuditRow[]> => {
		await requireAdmin(ctx);
		const rows = await ctx.db
			.query("adminAuditLog")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.take(AUDIT_LIMIT);
		return rows.map((r) => ({
			_id: r._id,
			adminUserId: r.adminUserId,
			action: r.action,
			targetId: r.targetId,
			ts: r.ts,
		}));
	},
});

/**
 * Record that an admin ENTERED a seller's store (act-as session start). Fired by
 * the directory's "Manage" action. This is the read-side attributability trail:
 * individual act-as reads (order history, customer PII, payment proofs, bank
 * details) aren't logged, but the ENTRY into a tenant is — so "who at Kedaipal
 * opened my store, and when?" is always answerable, not just "who edited it".
 * Admin-gated; a no-op for a bogus/missing retailer id. See docs/admin-console.md.
 */
export const startActAsSession = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return; // stale id — the client redirect handles it
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId,
			action: "actAs.sessionStart",
			ts: Date.now(),
		});
	},
});
