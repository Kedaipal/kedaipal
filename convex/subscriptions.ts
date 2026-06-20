// Subscription reads + the soft-lock access guard. The whole manual-billing model
// rests on `resolveAccess`: it turns a retailer's subscription into an access
// descriptor that the seller-side dashboard reads (nav pill, disabled-with-reason
// UI) and that `assertSubscriptionActive` enforces on growth-write mutations.
//
// Two invariants the rest of the system depends on:
//  1. FAIL SAFE — a missing subscription row resolves to FULL access (comped),
//     logged, never locked. So a backfill miss degrades to "works", not "locked
//     out" (ticket launch-blocker EC).
//  2. The storefront + order pipeline NEVER call this — they're public and stay
//     live regardless of subscription status. Soft-lock freezes only the seller's
//     dashboard growth-writes (products, settings, future broadcast).
//
// See docs/manual-subscription.md.

import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { capsForPlan, type Plan, PLAN_CAPS } from "./lib/plans";

type AnyCtx = QueryCtx | MutationCtx;

export type SubscriptionStatus =
	| "trialing"
	| "active"
	| "past_due"
	| "cancelled";

export type AccessState = {
	plan: Plan;
	status: SubscriptionStatus;
	comped: boolean;
	trialEndsAt?: number;
	currentPeriodEnd?: number;
	caps: { orderCap: number; userCap: number; broadcastQuota: number };
	/** True when the seller has full dashboard access (not soft-locked). */
	active: boolean;
	/** Soft-lock engaged — dashboard growth-writes must be blocked. */
	frozen: boolean;
};

/** Pure access resolution from a subscription doc (or null). Exported for tests
 * + the getMyRetailer embed. A missing row → comped full access (fail safe). */
export function resolveAccess(sub: Doc<"subscriptions"> | null): AccessState {
	if (!sub) {
		// Fail safe: never lock out a retailer because their subscription row is
		// missing (pre-backfill, or a backfill miss). Treat as comped full access.
		const caps = capsForPlan("pro");
		return {
			plan: "pro",
			status: "active",
			comped: true,
			caps,
			active: true,
			frozen: false,
		};
	}
	const comped = sub.comped === true;
	// Soft-lock only bites a real (non-comped) past_due subscription.
	const frozen = sub.status === "past_due" && !comped;
	return {
		plan: sub.plan,
		status: sub.status,
		comped,
		trialEndsAt: sub.trialEndsAt,
		currentPeriodEnd: sub.currentPeriodEnd,
		caps: {
			orderCap: sub.orderCap,
			userCap: sub.userCap,
			broadcastQuota: sub.broadcastQuota,
		},
		active: !frozen,
		frozen,
	};
}

/** Load a retailer's subscription (or null). Single-source so every reader uses
 * the same index. */
export async function loadSubscription(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<Doc<"subscriptions"> | null> {
	return ctx.db
		.query("subscriptions")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.first();
}

/** Resolve a retailer's access in one call. */
export async function getAccess(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<AccessState> {
	const sub = await loadSubscription(ctx, retailerId);
	if (!sub) {
		console.warn(
			`[subscriptions] no subscription row for retailer ${retailerId} — failing open (comped full access)`,
		);
	}
	return resolveAccess(sub);
}

/**
 * Soft-lock guard for seller dashboard GROWTH-WRITES (product create/update,
 * updateSettings, future broadcast/reminder). Throws a `ConvexError` when the
 * subscription is past_due (and not comped). NEVER call from the storefront or
 * the order pipeline — those must stay live for the buyer.
 */
export async function assertSubscriptionActive(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<void> {
	const access = await getAccess(ctx, retailerId);
	if (access.frozen) {
		throw new ConvexError(
			"Your subscription is past due. Pay your invoice to keep editing your store — your storefront and existing orders stay live in the meantime.",
		);
	}
}

/** Default entitlement caps to denormalize for a plan (used at signup + on
 * mark-paid reconcile). */
export function defaultCapsForPlan(plan: Plan): {
	orderCap: number;
	userCap: number;
	broadcastQuota: number;
} {
	return capsForPlan(plan);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The caller's subscription summary — drives the billing page + nav pill.
 * Returns null when unauthenticated or no retailer/subscription yet. */
export const current = query({
	args: {},
	handler: async (
		ctx,
	): Promise<
		| (AccessState & {
				billingCycle?: "monthly" | "annual";
				createdAt?: number;
		  })
		| null
	> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return null;
		const sub = await loadSubscription(ctx, retailer._id);
		return {
			...resolveAccess(sub),
			billingCycle: sub?.billingCycle,
			createdAt: sub?.createdAt,
		};
	},
});

// Re-export so callers can map a plan → its canonical caps without importing the
// pure module separately.
export { PLAN_CAPS };
