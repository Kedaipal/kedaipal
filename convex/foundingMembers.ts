// Founding Member rank claim + public spots counter. The rank claim runs INSIDE
// the markPaid transaction (Convex mutations are serializable, so reading the
// current count and inserting the next rank is atomic — two admin mark-paid
// events in the same instant can't both get rank 10; the second OCC-retries and
// sees the first). Once claimed, the denormalized retailer flags never revert.
// See docs/manual-subscription.md.

import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./lib/auth";
import { FOUNDING_MEMBER_LIMIT } from "./lib/plans";

/**
 * RESERVE a Founding slot for `retailerId` (assigns the next rank 1..10), inside
 * the caller's transaction. Returns the rank, or null when a row already exists or
 * the cohort is full. Reserved at the moment founding is *designated* — the
 * founding onboard (signup) or a founding invoice — NOT when payment lands, so
 * Arif can't over-commit past 10 and the badge/spot show immediately. Serializable
 * (two concurrent reserves can't both get rank 10 — the second OCC-retries).
 * `paidAt`/`firstInvoiceId` are filled later by `stampFoundingPaid`.
 */
export async function reserveFoundingRank(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
): Promise<number | null> {
	const existing = await ctx.db
		.query("foundingMembers")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.first();
	if (existing) return null;

	const claimed = await ctx.db.query("foundingMembers").collect();
	if (claimed.length >= FOUNDING_MEMBER_LIMIT) return null;
	const rank = claimed.length + 1;

	await ctx.db.insert("foundingMembers", { retailerId, rank, plan: "pro" });
	// Denormalize onto the retailer for fast storefront reads (never reverts).
	await ctx.db.patch(retailerId, {
		isFoundingMember: true,
		foundingMemberRank: rank,
		updatedAt: Date.now(),
	});
	return rank;
}

/** Stamp the payment fact onto an already-reserved founding row (first time only).
 * Returns the rank if a row exists, else null. */
export async function stampFoundingPaid(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	invoiceId: Id<"invoices">,
	paidAt: number,
): Promise<number | null> {
	const row = await ctx.db
		.query("foundingMembers")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.first();
	if (!row) return null;
	if (row.paidAt === undefined) {
		await ctx.db.patch(row._id, { paidAt, firstInvoiceId: invoiceId });
	}
	return row.rank;
}

/** Admin: the founding cohort overview — rank, store, and where each one is in the
 * pay cycle (pending payment / active / past due). Ordered by rank. */
export const listForAdmin = query({
	args: {},
	handler: async (
		ctx,
	): Promise<
		Array<{
			rank: number;
			storeName: string;
			slug: string;
			status?: Doc<"subscriptions">["status"];
			paid: boolean;
		}>
	> => {
		await requireAdmin(ctx);
		const rows = await ctx.db
			.query("foundingMembers")
			.withIndex("by_rank")
			.collect();
		const out = [];
		for (const row of rows) {
			const r = await ctx.db.get(row.retailerId);
			if (!r) continue;
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", row.retailerId))
				.first();
			out.push({
				rank: row.rank,
				storeName: r.storeName,
				slug: r.slug,
				status: sub?.status,
				paid: row.paidAt !== undefined,
			});
		}
		return out.sort((a, b) => a.rank - b.rank);
	},
});

/** Public counter for the landing page: how many of the 10 founding spots remain. */
export const getSpotsRemaining = query({
	args: {},
	handler: async (ctx): Promise<number> => {
		const claimed = await ctx.db.query("foundingMembers").collect();
		return Math.max(0, FOUNDING_MEMBER_LIMIT - claimed.length);
	},
});

/** The caller's own founding status — drives the one-time dashboard white-glove
 * CTA. Null when the caller isn't a founding member. */
export const myStatus = query({
	args: {},
	handler: async (
		ctx,
	): Promise<{ rank: number; whiteGloveScheduled: boolean } | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return null;
		const row = await ctx.db
			.query("foundingMembers")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.first();
		if (!row) return null;
		return {
			rank: row.rank,
			whiteGloveScheduled: row.whiteGloveScheduledAt !== undefined,
		};
	},
});

/** The caller marks their white-glove call scheduled/dismissed — hides the
 * one-time dashboard CTA. Self-service (the founding retailer themselves). */
export const markWhiteGloveScheduled = mutation({
	args: {},
	handler: async (ctx): Promise<void> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return;
		const row = await ctx.db
			.query("foundingMembers")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.first();
		if (row && row.whiteGloveScheduledAt === undefined) {
			await ctx.db.patch(row._id, { whiteGloveScheduledAt: Date.now() });
		}
	},
});
