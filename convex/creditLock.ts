// The seller lock at zero credits (Credits T3, ClickUp z8r3fdf8hy,
// docs/credits.md). At a total balance of 0 or below the SELLER can't accept or
// update orders, edit the catalogue, book couriers, print despatch labels or
// hand out receipts — until credits are added by any route (top-up, upgrade,
// the monthly refresh, a paid invoice). Cancelling and refunding, settings,
// billing and every read stay open; order INTAKE never stops (storefront,
// counter, claim links, bookings all keep taking orders and each uses a
// credit); buyers never see a thing.
//
// A SECOND, narrower lock beside the past-due one (`assertSubscriptionActive`,
// which makes a lapsed store fully view-only). The two are deliberately
// separate guards: the credit lock must leave cancel, refund and settings open,
// and cancel runs through the same `updateStatus` as confirm. Which public
// writes carry this guard is a TEST, not prose — creditLockCoverage.test.ts.
//
// CALL IT UNCONDITIONALLY. Both locks let Kedaipal admins through on their own
// `isAdmin` check (identity, `ADMIN_USER_IDS`), which is a SUPERSET of the
// call site's `access.actingAsAdmin` — that flag is set only for an admin
// subject, and misses an admin on their own store, whom both guards also pass.
// So a call site never wraps this guard in an act-as test. Ten sites shipped
// it looking wrapped (PR #320 review, 2 Oct):
//
//   if (!access.actingAsAdmin)
//     await assertSubscriptionActive(ctx, id);
//     await assertCreditsAvailable(ctx, id);   // ← NOT inside the if
//
// Right by accident, and a lie about the control flow in auth-adjacent code.
// Those sites now brace the `if`; `creditLockCoverage.test.ts` fails on the
// dangling shape for any `assert*` guard, and `creditLock.test.ts` pins the
// white-glove bypass itself, so moving it goes red instead of quiet.

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalQuery,
	type MutationCtx,
	type QueryCtx,
	query,
} from "./_generated/server";
import { loadCreditAccount, projectedCredits } from "./credits";
import {
	isAdmin,
	requireRetailerAccess,
	storeOwnerIsAdmin,
	tryRetailerAccess,
} from "./lib/auth";
import {
	CREDIT_LOCK_ENABLED,
	type CreditUnlockRoute,
	cancelRefundDecision,
	creditLockAudience,
	creditLockErrorData,
	creditLockExempt,
	creditUnlockRoute,
	sellerRefundsLeft,
} from "./lib/credits";
import { usagePeriodKey } from "./lib/usagePeriod";

type AnyCtx = QueryCtx | MutationCtx;

/** Cap on the "orders waiting" count — the banner says "99+" past it. */
const WAITING_COUNT_CAP = 99;

/** What the dashboard needs to render the lock — safe for every teammate
 * (no balance numbers; those stay behind the `credits` grant). */
export type CreditLockState = {
	locked: boolean;
	/** What puts credits back — decides the copy and the one button. */
	unlockRoute: CreditUnlockRoute;
	/** When the balance reached zero (null while unlocked). */
	since: number | null;
	/** Live orders that arrived since the store ran out, capped at 99. */
	ordersWaiting: number;
};

/**
 * The ONE lock resolver — the server guards and the dashboard payload both
 * read it. Exempt stores (comped, admin-owned, no subscription row) and a
 * store with no credit account yet are never locked (fail open, like the
 * past-due lock's missing-row fail-safe).
 */
export async function resolveCreditLock(
	ctx: AnyCtx,
	retailer: Doc<"retailers">,
	now: number,
): Promise<CreditLockState> {
	const sub = await ctx.db
		.query("subscriptions")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
		.first();
	const status = sub?.status ?? null;
	const unlockRoute = creditUnlockRoute(status);
	const open: CreditLockState = {
		locked: false,
		unlockRoute,
		since: null,
		ordersWaiting: 0,
	};
	// The lock is built and switched off (CREDIT_LOCK_ENABLED, lib/credits.ts).
	// Gated HERE, at the ONE resolver every guard and the dashboard payload
	// read, so the off state can never disagree with itself — what the seller
	// is told and what the server refuses come from this answer. Turning it on
	// is this line, not a sweep.
	if (!CREDIT_LOCK_ENABLED) return open;
	if (
		creditLockExempt({
			status,
			comped: sub?.comped === true,
			ownerIsAdmin: storeOwnerIsAdmin(retailer),
		})
	)
		return open;
	const account = await loadCreditAccount(ctx, retailer._id);
	if (!account) return open;
	const projected = await projectedCredits(ctx, retailer._id, account, now);
	if (!projected || projected.total > 0) return open;
	const since = account.exhaustedAt ?? now;
	return {
		locked: true,
		unlockRoute,
		since,
		ordersWaiting: await ordersSince(ctx, retailer._id, since),
	};
}

/** Live orders created at or after `since`, newest first, capped.
 *
 * Walks the `by_retailer` index (insertion order) and stops at the first row
 * older than `since`, which assumes `createdAt` runs with insertion — true for
 * every intake path, none of which backdates it. A backdated row would only
 * end the walk early, undercounting a "99+" banner figure; it can never
 * over-count or affect the lock itself. */
async function ordersSince(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
	since: number,
): Promise<number> {
	let count = 0;
	for await (const order of ctx.db
		.query("orders")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.order("desc")) {
		if (order.createdAt < since) break;
		if (order.status !== "cancelled") count++;
		if (count >= WAITING_COUNT_CAP) break;
	}
	return count;
}

/**
 * The guard for every locked seller write (see the file header). Kedaipal
 * admins pass, as they do the past-due lock — on their own store or acting as
 * a seller. Throws a TYPED `ConvexError` (`CreditLockErrorData`) whose
 * `message` is `creditLockMessage`, so the refusal a seller reads is the
 * sentence the lock surfaces show — and the dashboard can offer the way back.
 */
export async function assertCreditsAvailable(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<void> {
	if (await isAdmin(ctx)) return;
	const retailer = await ctx.db.get(retailerId);
	if (!retailer) return;
	const lock = await resolveCreditLock(ctx, retailer, Date.now());
	if (!lock.locked) return;
	const access = await tryRetailerAccess(ctx, retailerId, { anyMember: true });
	const isMember = access?.role === "member";
	// A teammate holding Credits write may buy a pack (T2), so for them a
	// top-up is a way back they can take themselves.
	const canBuyCredits =
		!isMember ||
		(await tryRetailerAccess(ctx, retailerId, {
			area: "credits",
			level: "write",
		})) !== null;
	throw new ConvexError(
		creditLockErrorData(
			lock.unlockRoute,
			creditLockAudience({
				isMember,
				canBuyCredits,
				route: lock.unlockRoute,
			}),
		),
	);
}

/**
 * The same lock for seller ACTIONS (courier booking, despatch labels, the
 * payment reminder, the seller's receipt), which have no `ctx.db`. OWNER- and
 * MEMBER-gated exactly like `subscriptions.assertWritable`: these run first in
 * public actions, so an anonymous or foreign caller must get the action's own
 * answer, never a lock refusal that would reveal a store's credit state.
 */
export const assertCreditsForAction = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const access = await tryRetailerAccess(ctx, retailerId, {
			anyMember: true,
		});
		if (!access || access.role === "admin") return null;
		await assertCreditsAvailable(ctx, retailerId);
		return null;
	},
});

/** `assertCreditsForAction` for the order actions, which know a `shortId`
 * and nothing else. A shortId that resolves to nothing passes — the action's
 * own "not found" is the clearer answer. Same caller gate, same reason. */
export const assertCreditsForOrder = internalQuery({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.unique();
		if (!order) return null;
		const access = await tryRetailerAccess(ctx, order.retailerId, {
			anyMember: true,
		});
		if (!access || access.role === "admin") return null;
		await assertCreditsAvailable(ctx, order.retailerId);
		return null;
	},
});

/** Whether cancelling THIS order gives its credit back — so the cancel dialog
 * can say so before the tap (no hidden rule). */
export type CancelCreditOutlook =
	| { kind: "refund"; refundsLeftAfter: number }
	| { kind: "kept"; reason: "accepted" | "allowance_used" }
	/** No credit was ever used for this order (placed before credits). */
	| { kind: "not_charged" };

export const cancelOutlook = query({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }): Promise<CancelCreditOutlook | null> => {
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		await requireRetailerAccess(ctx, order.retailerId, {
			area: "orders",
			level: "read",
		});
		if (order.status === "cancelled") return null;
		const rows = await ctx.db
			.query("creditLedger")
			.withIndex("by_retailer_ref_type", (q) =>
				q.eq("retailerId", order.retailerId).eq("refId", order._id),
			)
			.collect();
		const net =
			rows.filter((r) => r.type === "debit").length -
			rows.filter((r) => r.type === "refund").length;
		if (net <= 0) return { kind: "not_charged" };
		const account = await loadCreditAccount(ctx, order.retailerId);
		const periodKey = usagePeriodKey(Date.now());
		const used =
			account?.sellerRefunds?.periodKey === periodKey
				? account.sellerRefunds.count
				: 0;
		const decision = cancelRefundDecision({
			cause: "seller",
			statusAtCancel: order.status,
			sellerRefundsUsed: used,
		});
		return decision.refund
			? { kind: "refund", refundsLeftAfter: sellerRefundsLeft(used + 1) }
			: { kind: "kept", reason: decision.reason };
	},
});
