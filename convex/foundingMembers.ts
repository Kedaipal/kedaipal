// Founding Member rank claim + public spots counter. The rank claim runs INSIDE
// the markPaid transaction (Convex mutations are serializable, so reading the
// current count and inserting the next rank is atomic — two admin mark-paid
// events in the same instant can't both get rank 10; the second OCC-retries and
// sees the first). Once claimed, the denormalized retailer flags never revert.
// Benefit revocation (z8r3fdfyw5) lives here too: membership is permanent, the
// ENTITLEMENTS are not. `revokeBenefits` takes the price, the Founding-Pro lock
// and white-glove; it never touches `rank`, `isFoundingMember` or
// `foundingMemberRank`, because the agreement and the billing ribbon both
// promise the seller those "for good". See docs/manual-subscription.md +
// docs/hitpay-recurring.md.

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib/auth";
import {
	FOUNDING_MEMBER_LIMIT,
	foundingBenefitsEndAt,
	foundingBenefitsRevocable,
	foundingBenefitsWarningDue,
} from "./lib/plans";

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

/**
 * Take a member's founding BENEFITS — the 30% price, the Founding-Pro lock and
 * white-glove — leaving the honour untouched. Idempotent: a row already revoked
 * is returned unchanged, so the daily pass can never double-send or restamp.
 *
 * Three writes, and the order does not matter (one serializable transaction):
 *  1. the audit record on the founding row;
 *  2. `retailers.foundingBenefitsRevokedAt` — the denormalized flag every
 *     `foundingPriceEligible` caller reads off the retailer doc it already has;
 *  3. clearing `subscriptions.foundingIntent`.
 *
 * (3) is belt-and-braces, not the guard. `foundingPriceEligible` short-circuits
 * on the revocation flag BEFORE its `foundingIntent` fallback, so the discount
 * is gone whether or not intent is cleared — but intent means "this signup was
 * designated founding, discount its first invoice", which stops being true
 * here, and leaving a stale flag behind is how the next reader gets it wrong.
 * Both are mutation-tested independently.
 *
 * NOT written: `isFoundingMember`, `foundingMemberRank`, `rank`, or the row
 * itself. The badge stays on the storefront, the pill stays in the nav, and the
 * slot stays claimed (`getSpotsRemaining` counts rows) — re-granting is Arif's
 * deliberate act, never a race for a freed spot.
 */
export async function revokeBenefits(
	ctx: MutationCtx,
	row: Doc<"foundingMembers">,
	reason: "lapsed" | "admin",
	note?: string,
): Promise<boolean> {
	if (row.benefitsRevokedAt !== undefined) return false;
	const now = Date.now();
	await ctx.db.patch(row._id, {
		benefitsRevokedAt: now,
		benefitsRevokedReason: reason,
		...(note !== undefined && note !== "" ? { benefitsRevokedNote: note } : {}),
	});
	await ctx.db.patch(row.retailerId, {
		foundingBenefitsRevokedAt: now,
		updatedAt: now,
	});
	const sub = await ctx.db
		.query("subscriptions")
		.withIndex("by_retailer", (q) => q.eq("retailerId", row.retailerId))
		.first();
	// `foundingIntent: undefined` DELETES the field (Convex patch semantics) —
	// which is what we want; `false` would leave a flag that reads as "considered
	// and declined" rather than "not a founding signup".
	// `updatedAt` is deliberately untouched: for a `past_due` row that field is
	// the lock-flip moment the founder report reads (docs/shipped-log.md).
	if (sub?.foundingIntent === true) {
		await ctx.db.patch(sub._id, { foundingIntent: undefined });
	}
	return true;
}

/**
 * Give the benefits back — the escape hatch for a wrong revocation, a member
 * Arif re-grants, or a store that was comped through its own lapse. Clears the
 * audit stamps AND the warning stamp, so a future lapse warns again before it
 * takes anything a second time. Does NOT restore `foundingIntent`: that flag is
 * about the first conversion's invoice, and a restored member's eligibility
 * comes from `isFoundingMember`, which never left.
 */
export async function restoreBenefits(
	ctx: MutationCtx,
	row: Doc<"foundingMembers">,
	note?: string,
): Promise<boolean> {
	if (row.benefitsRevokedAt === undefined) return false;
	await ctx.db.patch(row._id, {
		benefitsRevokedAt: undefined,
		benefitsRevokedReason: undefined,
		benefitsRevokedNote: note !== undefined && note !== "" ? note : undefined,
		benefitsWarningSentForPeriodEnd: undefined,
	});
	await ctx.db.patch(row.retailerId, {
		foundingBenefitsRevokedAt: undefined,
		updatedAt: Date.now(),
	});
	return true;
}

/**
 * The daily founding-benefit pass — scheduled by the daily billing cron
 * (`subscriptions.internalDailyBillingStatus`).
 *
 * It walks the `foundingMembers` table rather than hanging off that cron's
 * subscription loops, and that is not a style choice: those loops cover
 * `trialing`, `active` and `on_hold`, and a lapsed member is `past_due` within
 * ~14 days of their period ending (renewal invoice issued, then overdue). A
 * revocation pass built on them would never fire for the exact population it
 * targets. Walking the ledger is also bounded forever — the cohort is 10 and
 * the programme closed 30 Aug 2026 — so a full `collect()` is correct here.
 *
 * Two independent steps per member, both gated by pure predicates in
 * lib/plans.ts (unit-tested at the day-89/90/91 boundary):
 *  - T-14: warn, once per paid period.
 *  - T-0: revoke. NOT gated on the warning having been sent (Zaki, 18 Sep
 *    2026) — the rule is the rule; with a daily cadence 14 runs sit between the
 *    two, so a member can only miss the warning if this ships inside their
 *    final fortnight, which no member is (the earliest T-14 is 14 Oct 2026).
 */
export const internalRevokeLapsedBenefits = internalMutation({
	args: {},
	handler: async (
		ctx,
	): Promise<{ warned: number; revoked: number; scanned: number }> => {
		const now = Date.now();
		let warned = 0;
		let revoked = 0;
		const rows = await ctx.db.query("foundingMembers").collect();
		for (const row of rows) {
			if (row.benefitsRevokedAt !== undefined) continue;
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", row.retailerId))
				.first();
			if (!sub) continue;
			const gate = {
				status: sub.status,
				comped: sub.comped === true,
				paidThrough: sub.currentPeriodEnd,
				benefitsRevokedAt: row.benefitsRevokedAt,
				now,
			};
			const endsAt = foundingBenefitsEndAt(sub.currentPeriodEnd);
			if (foundingBenefitsRevocable(gate)) {
				if (await revokeBenefits(ctx, row, "lapsed")) {
					revoked++;
					console.info("[founding] benefits revoked after the lapse window", {
						retailerId: row.retailerId,
						rank: row.rank,
						paidThrough: sub.currentPeriodEnd,
					});
					if (endsAt !== undefined) {
						await ctx.scheduler.runAfter(
							0,
							internal.billingEmail.notifyFoundingBenefitsEmail,
							{
								retailerId: row.retailerId,
								key: "foundingBenefitsEnded",
								endsOnAt: endsAt,
							},
						);
					}
				}
				continue;
			}
			if (
				foundingBenefitsWarningDue({
					...gate,
					sentForPeriodEnd: row.benefitsWarningSentForPeriodEnd,
				}) &&
				endsAt !== undefined
			) {
				await ctx.db.patch(row._id, {
					benefitsWarningSentForPeriodEnd: sub.currentPeriodEnd,
				});
				await ctx.scheduler.runAfter(
					0,
					internal.billingEmail.notifyFoundingBenefitsEmail,
					{
						retailerId: row.retailerId,
						key: "foundingBenefitsEndingSoon",
						endsOnAt: endsAt,
					},
				);
				warned++;
			}
		}
		return { warned, revoked, scanned: rows.length };
	},
});

/** Admin: revoke or restore a member's founding benefits by hand — the
 * deliberate lever beside the automatic rule. Revoking early is Arif's call
 * (a member who has clearly gone); restoring is the escape hatch for a wrong
 * revocation or a re-grant. The rank and badge are untouched either way, so
 * neither direction can strip the honour. No email: a manual move is one Arif
 * is already talking to the seller about. */
export const adminSetBenefits = mutation({
	args: {
		retailerId: v.id("retailers"),
		revoked: v.boolean(),
		note: v.optional(v.string()),
	},
	handler: async (ctx, { retailerId, revoked, note }): Promise<boolean> => {
		await requireAdmin(ctx);
		const row = await ctx.db
			.query("foundingMembers")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (!row) throw new Error("Not a founding member");
		return revoked
			? await revokeBenefits(ctx, row, "admin", note)
			: await restoreBenefits(ctx, row, note);
	},
});

/** Admin: the founding cohort overview — rank, store, and where each one is in the
 * pay cycle (pending payment / active / past due). Ordered by rank. */
export const listForAdmin = query({
	args: {},
	handler: async (
		ctx,
	): Promise<
		Array<{
			retailerId: Id<"retailers">;
			rank: number;
			storeName: string;
			slug: string;
			status?: Doc<"subscriptions">["status"];
			paid: boolean;
			/** Benefits taken: when, why, and Arif's note if it was by hand. */
			benefitsRevokedAt?: number;
			benefitsRevokedReason?: "lapsed" | "admin";
			benefitsRevokedNote?: string;
			/** When benefits END if this member never renews — the same
			 * `foundingBenefitsEndAt` the cron gate and the seller's banner read,
			 * so the console shows the real date, not a second calculation of it.
			 * Undefined once revoked, or for a member with no paid period yet. */
			benefitsEndAt?: number;
			/** The T-14 notice has gone out for the current paid period. */
			warned: boolean;
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
				retailerId: row.retailerId,
				rank: row.rank,
				storeName: r.storeName,
				slug: r.slug,
				status: sub?.status,
				paid: row.paidAt !== undefined,
				benefitsRevokedAt: row.benefitsRevokedAt,
				benefitsRevokedReason: row.benefitsRevokedReason,
				benefitsRevokedNote: row.benefitsRevokedNote,
				benefitsEndAt:
					row.benefitsRevokedAt === undefined
						? foundingBenefitsEndAt(sub?.currentPeriodEnd)
						: undefined,
				warned:
					sub?.currentPeriodEnd !== undefined &&
					row.benefitsWarningSentForPeriodEnd === sub.currentPeriodEnd,
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
	): Promise<{
		rank: number;
		whiteGloveScheduled: boolean;
		benefitsRevoked: boolean;
	} | null> => {
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
			// White-glove onboarding is one of the BENEFITS (the agreement lists it
			// beside the discount), so a revoked member no longer sees the one-time
			// CTA — offering Arif's personal setup session to a store whose
			// entitlements we just took would be the app contradicting itself.
			// The rank it returns is untouched: the honour is not a benefit.
			benefitsRevoked: row.benefitsRevokedAt !== undefined,
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
