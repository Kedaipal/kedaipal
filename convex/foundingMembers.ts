// Founding Member rank claim + public spots counter. The rank claim runs INSIDE
// the markPaid transaction (Convex mutations are serializable, so reading the
// current count and inserting the next rank is atomic — two admin mark-paid
// events in the same instant can't both get rank 10; the second OCC-retries and
// sees the first). Once claimed, the denormalized retailer flags never revert.
// See docs/manual-subscription.md.

import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { FOUNDING_MEMBER_LIMIT, planQualifiesForFounding } from "./lib/plans";

/**
 * Claim a Founding rank for `retailerId` if eligible, inside the caller's
 * transaction. Returns the assigned rank (1..10) or null when no claim happens.
 *
 * Eligible iff: plan qualifies (Pro at v1) AND the retailer has no prior rank AND
 * the cohort isn't full (≤ 10). `comped` retailers are filtered by the caller
 * (markPaid) before reaching here. No-ops idempotently on a second paid invoice.
 */
export async function claimRankIfEligible(
	ctx: MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		firstInvoiceId: Id<"invoices">;
		plan: Doc<"subscriptions">["plan"];
		paidAt: number;
	},
): Promise<number | null> {
	if (!planQualifiesForFounding(args.plan)) return null;

	// Already claimed? (idempotent — second paid invoice no-ops.)
	const existing = await ctx.db
		.query("foundingMembers")
		.withIndex("by_retailer", (q) => q.eq("retailerId", args.retailerId))
		.first();
	if (existing) return null;

	// Cohort full? Count current rows; next rank = count + 1.
	const claimed = await ctx.db.query("foundingMembers").collect();
	if (claimed.length >= FOUNDING_MEMBER_LIMIT) return null;
	const rank = claimed.length + 1;

	await ctx.db.insert("foundingMembers", {
		retailerId: args.retailerId,
		rank,
		// Only pro/scale reach here; narrow for the table's union.
		plan: args.plan === "scale" ? "scale" : "pro",
		paidAt: args.paidAt,
		firstInvoiceId: args.firstInvoiceId,
	});
	// Denormalize onto the retailer for fast storefront reads (never reverts).
	await ctx.db.patch(args.retailerId, {
		isFoundingMember: true,
		foundingMemberRank: rank,
		updatedAt: args.paidAt,
	});
	return rank;
}

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
