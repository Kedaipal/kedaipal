/**
 * Seller referrals (z8r3fdetf5, docs/referrals.md) — who referred whom.
 *
 * T1 owns the RECORD: a `referrals` row written at signup when the store
 * behind the `/referral/<slug>` link can refer, the public invite the link's
 * page shows, the referee's own view of it, and the admin fix-up for a
 * referral the link didn't capture. The reward (credits for both sides when
 * the referee's first plan invoice is paid) is T2 (86ey82hke) and reads these
 * rows; the rules both share live in `lib/referral.ts`.
 */

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import {
	requireAdmin,
	requireRetailerAccess,
	resolveMyRetailerFor,
	storeOwnerIsAdmin,
} from "./lib/auth";
import type { ListedPlan } from "./lib/plans";
import { sanitizeReferrerSlug } from "./lib/poweredBy";
import {
	type ReferrerIneligibleReason,
	type ReferrerStanding,
	referralRefereeOffer,
	referrerStanding,
} from "./lib/referral";
import { isUnclaimed } from "./lib/unclaimedStore";
import { loadSubscription } from "./subscriptions";

type AnyCtx = QueryCtx | MutationCtx;

/** Whether `retailer` can refer right now, from its subscription row. */
export async function standingOf(
	ctx: AnyCtx,
	retailer: Doc<"retailers">,
): Promise<ReferrerStanding> {
	const sub = await loadSubscription(ctx, retailer._id);
	return referrerStanding({
		status: sub?.status ?? null,
		comped: sub?.comped === true,
		ownerIsAdmin: storeOwnerIsAdmin(retailer),
		unclaimed: isUnclaimed(retailer),
	});
}

/**
 * The store a referral link names. Shape-checked first (a value that isn't a
 * slug can't name a store), then the CURRENT slug, then a renamed store's
 * parked old slug — so a link shared before a rename keeps working for as
 * long as the old slug is parked (the storefront's own redirect window).
 */
export async function findReferrerBySlug(
	ctx: AnyCtx,
	raw: string | undefined,
): Promise<Doc<"retailers"> | null> {
	const slug = sanitizeReferrerSlug(raw);
	if (!slug) return null;
	const current = await ctx.db
		.query("retailers")
		.withIndex("by_slug", (q) => q.eq("slug", slug))
		.first();
	if (current) return current;
	const parked = await ctx.db
		.query("slugHistory")
		.withIndex("by_old_slug", (q) => q.eq("oldSlug", slug))
		.first();
	if (!parked || parked.expiresAt <= Date.now()) return null;
	return await ctx.db.get(parked.retailerId);
}

/** The referral row for a referee, if any. One per referee by construction. */
export async function referralForReferee(
	ctx: AnyCtx,
	refereeId: Id<"retailers">,
): Promise<Doc<"referrals"> | null> {
	return await ctx.db
		.query("referrals")
		.withIndex("by_referee", (q) => q.eq("refereeId", refereeId))
		.first();
}

/**
 * Whether the store has paid a PLAN invoice — the referral reward's trigger
 * (T2). Past it, the referral can no longer be set or changed: the moment it
 * paid out for (or didn't) is gone. A hold invoice can only follow a paid
 * plan invoice, so any paid row answers; the kind check keeps that honest.
 */
export async function hasPaidPlanInvoice(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<boolean> {
	const invoices = await ctx.db
		.query("invoices")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.collect();
	return invoices.some(
		(inv) => inv.status === "paid" && (inv.kind ?? "plan") === "plan",
	);
}

/**
 * At signup (`retailers.createRetailer`): resolve the referral link the
 * seller arrived with to the store that can refer RIGHT NOW. `null` when the
 * link names nobody, names a store that can't refer (trial, lapsed, paused,
 * unclaimed), or names the new store itself — and then nothing is recorded,
 * because nothing was promised: the invite page only shows the offer for a
 * store that can refer.
 *
 * Resolved BEFORE the new store is inserted (so its own fresh slug can never
 * answer), recorded after (`insertReferral`).
 */
export async function resolveSignupReferrer(
	ctx: MutationCtx,
	raw: string | undefined,
): Promise<Doc<"retailers"> | null> {
	const referrer = await findReferrerBySlug(ctx, raw);
	if (!referrer) return null;
	const standing = await standingOf(ctx, referrer);
	return standing.canRefer ? referrer : null;
}

/** Write a referee's referral row. The caller guarantees there is none yet. */
export async function insertReferral(
	ctx: MutationCtx,
	args: {
		refereeId: Id<"retailers">;
		referrerId: Id<"retailers">;
		via: Doc<"referrals">["via"];
		recordedBy: string;
		now: number;
	},
): Promise<Id<"referrals">> {
	if (args.refereeId === args.referrerId)
		throw new ConvexError("A store can't refer itself.");
	return await ctx.db.insert("referrals", {
		refereeId: args.refereeId,
		referrerId: args.referrerId,
		via: args.via,
		recordedBy: args.recordedBy,
		createdAt: args.now,
	});
}

// ---------------------------------------------------------------------------
// Public: the invite a referral link's page shows
// ---------------------------------------------------------------------------

export type ReferralInvite = {
	/** The referrer's CURRENT slug — what the cookie keeps, so a link shared
	 * before a rename is remembered by the name that resolves today. */
	slug: string;
	storeName: string;
	/** Bonus credits the referee gets when they pay their first invoice, per
	 * tier they might start on. */
	offer: Record<ListedPlan, number>;
};

/**
 * Public, no auth: who is inviting the visitor of `/referral/<slug>`, and
 * what they are offered. `null` when the link names nobody OR a store that
 * can't refer right now — the page then renders the plain landing and
 * promises nothing. Returns the store's public name and slug only; WHY a
 * store can't refer (trial, lapsed, …) is its private billing state and is
 * never said here.
 */
export const invite = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }): Promise<ReferralInvite | null> => {
		const referrer = await findReferrerBySlug(ctx, slug);
		if (!referrer) return null;
		const standing = await standingOf(ctx, referrer);
		if (!standing.canRefer) return null;
		return {
			slug: referrer.slug,
			storeName: referrer.storeName,
			offer: referralRefereeOffer(),
		};
	},
});

// ---------------------------------------------------------------------------
// Seller: the referee's own view (plan picker / billing tab)
// ---------------------------------------------------------------------------

export type MyReferral = {
	/** The referrer's current name; `null` when that store has since been
	 * deleted (the referral — and the referee's reward — stands). */
	referrerName: string | null;
	offer: Record<ListedPlan, number>;
	/** Whether the referee has already paid their first plan invoice — the
	 * moment the reward lands (T2). */
	firstInvoicePaid: boolean;
};

/**
 * The caller's store as a REFEREE: who referred it and what it gets when it
 * starts its plan. Billing:read, like the rest of the billing tab it renders
 * in; `retailerId` is the admin act-as path (`myInvoices`' shape). `null` =
 * not referred (or no access).
 */
export const mine = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { retailerId }): Promise<MyReferral | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const access = retailerId
			? await requireRetailerAccess(ctx, retailerId, {
					area: "billing",
					level: "read",
				})
			: await resolveMyRetailerFor(ctx, { area: "billing", level: "read" });
		const retailer = access?.retailer ?? null;
		if (!retailer) return null;
		const row = await referralForReferee(ctx, retailer._id);
		if (!row) return null;
		const referrer = await ctx.db.get(row.referrerId);
		return {
			referrerName: referrer?.storeName ?? null,
			offer: referralRefereeOffer(),
			firstInvoicePaid: await hasPaidPlanInvoice(ctx, retailer._id),
		};
	},
});

// ---------------------------------------------------------------------------
// Admin: put right a referral the link didn't capture
// ---------------------------------------------------------------------------

/** What an admin reads when a referrer can't refer — the one author. */
const INELIGIBLE_COPY: Record<ReferrerIneligibleReason, string> = {
	trial: "is still on its free trial — a store refers once its plan is paid",
	paused: "is on an Off-Season Hold, so its referrals are paused",
	lapsed: "has no active plan (past due or cancelled)",
	unclaimed: "hasn't been claimed by its owner yet",
	no_plan: "has no subscription",
};

/** Refuse once the referee has paid its first plan invoice: the reward
 * moment has passed, and a change now could only mislead the ledger. */
async function assertReferralEditable(
	ctx: MutationCtx,
	refereeId: Id<"retailers">,
): Promise<void> {
	if (await hasPaidPlanInvoice(ctx, refereeId))
		throw new ConvexError(
			"This store has already paid its first invoice, so its referral can no longer change. Use a credits adjustment if a reward was missed.",
		);
}

/**
 * Admin: record (or change) who referred a store — for a referral the link
 * didn't capture (the seller signed up in another browser, or the intro was
 * made off-link). Same rules as the link: the referrer must be able to refer
 * now, a store can't refer itself, and the referee must not have paid its
 * first plan invoice yet. Audited.
 */
export const adminSetReferrer = mutation({
	args: { refereeId: v.id("retailers"), referrerSlug: v.string() },
	handler: async (ctx, { refereeId, referrerSlug }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const referee = await ctx.db.get(refereeId);
		if (!referee) throw new ConvexError("Store not found");
		await assertReferralEditable(ctx, refereeId);
		const referrer = await findReferrerBySlug(ctx, referrerSlug);
		if (!referrer)
			throw new ConvexError(
				`No store has the link kedaipal.com/${referrerSlug.trim()}.`,
			);
		if (referrer._id === refereeId)
			throw new ConvexError("A store can't refer itself.");
		const standing = await standingOf(ctx, referrer);
		if (!standing.canRefer)
			throw new ConvexError(
				`${referrer.storeName} can't refer right now: it ${INELIGIBLE_COPY[standing.reason]}.`,
			);
		const now = Date.now();
		const existing = await referralForReferee(ctx, refereeId);
		if (existing) {
			if (existing.referrerId === referrer._id) return;
			await ctx.db.patch(existing._id, {
				referrerId: referrer._id,
				via: "admin",
				recordedBy: adminUserId,
				createdAt: now,
			});
		} else {
			await insertReferral(ctx, {
				refereeId,
				referrerId: referrer._id,
				via: "admin",
				recordedBy: adminUserId,
				now,
			});
		}
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId: refereeId,
			action: "referrals.adminSetReferrer",
			targetId: referrer._id,
			ts: now,
		});
	},
});

/** Admin: remove a store's referral (recorded by mistake). Same editability
 * rule as setting one; idempotent, so a double-click logs nothing twice. */
export const adminClearReferral = mutation({
	args: { refereeId: v.id("retailers") },
	handler: async (ctx, { refereeId }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const existing = await referralForReferee(ctx, refereeId);
		if (!existing) return;
		await assertReferralEditable(ctx, refereeId);
		await ctx.db.delete(existing._id);
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId: refereeId,
			action: "referrals.adminClearReferral",
			targetId: existing.referrerId,
			ts: Date.now(),
		});
	},
});
