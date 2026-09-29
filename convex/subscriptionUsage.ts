// The order-lifecycle billing seams. Every order-create channel (storefront,
// counter, claim link, booking) calls `recordOrderCreated`, and every path
// that ends a live order calls `recordOrderCancelled` — so the three things
// that must see every order hang off these two functions:
//
//  1. The monthly order count — a denormalized per-retailer × MYT-calendar-
//     month counter (see the `subscriptionUsage` schema comment for the keying
//     rationale). It no longer drives a meter of its own (Credits T3 replaced
//     the soft-cap meter with the credit balance); it is what a plan change
//     compares the new allowance against ("you've had 140 this month").
//  2. Kedaipal Credits (86eye2ccu, convex/credits.ts): the order's one credit
//     is used at creation and given back only if the order never got going.
//  3. Start-when-you-sell (z8r3fday24): the store's first order ends its free
//     period and fires the first invoice. See
//     subscriptions.endFreePeriodOnFirstOrder.
//
// Invariants:
//  - WRITE-ONLY from the order pipeline. They meter; they NEVER block —
//    `orders.create` stays public regardless of usage or credit balance
//    (pressure on the seller, never the buyer). A failure in the credit
//    ledger is logged and swallowed rather than allowed to fail an order.
//  - A cancel decrements the month the order was CREATED in (not the current
//    month), floored at zero, so late cancellations can't corrupt this
//    month's count or drive it negative.

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { debitCreditForOrder, refundCreditForOrder } from "./credits";
import type { CancelCause } from "./lib/credits";
import { monthStartMyt } from "./lib/usagePeriod";
import { endFreePeriodOnFirstOrder } from "./subscriptions";

async function loadUsageRow(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
	monthStart: number,
) {
	return ctx.db
		.query("subscriptionUsage")
		.withIndex("by_retailer_month", (q) =>
			q.eq("retailerId", retailerId).eq("monthStart", monthStart),
		)
		.unique();
}

/** Count a freshly created order against the retailer's current month, use
 * its credit, and let the store's FIRST order end its free period
 * (start-when-you-sell). Called from every order-create site (storefront,
 * counter checkout, claim link, booking), right after the order is inserted. */
export async function recordOrderCreated(
	ctx: MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		orderId: Id<"orders">;
		orderShortId: string;
		createdAt: number;
	},
): Promise<void> {
	const { retailerId, createdAt } = args;
	await endFreePeriodOnFirstOrder(ctx, retailerId, createdAt);
	const monthStart = monthStartMyt(createdAt);
	const row = await loadUsageRow(ctx, retailerId, monthStart);
	if (row) {
		await ctx.db.patch(row._id, {
			orders: row.orders + 1,
			updatedAt: createdAt,
		});
	} else {
		await ctx.db.insert("subscriptionUsage", {
			retailerId,
			monthStart,
			orders: 1,
			createdAt,
			updatedAt: createdAt,
		});
	}
	try {
		await debitCreditForOrder(ctx, {
			retailerId,
			orderId: args.orderId,
			orderShortId: args.orderShortId,
			now: createdAt,
		});
	} catch (err) {
		// The buyer's order outranks the meter: never let a ledger fault fail
		// checkout. `credits:internalRecomputeBalance` finds any drift.
		console.error("[credits] debit failed — order kept", {
			retailerId,
			orderId: args.orderId,
			err,
		});
	}
}

/**
 * Reverse a cancelled order's contribution — keyed by the order's creation
 * time so the right month is decremented — and give its credit back when the
 * order never got going (`cancelRefundDecision`). `order` must be the doc as
 * it was BEFORE the cancel (its status decides the refund). Missing row /
 * zero floor → no-op (pre-meter orders were never counted). Callers must hold
 * the same first-transition-into-cancelled guard as
 * `decrementAggregatesForCancel`, so a double-cancel never double-decrements;
 * the credit refund is idempotent on its own ledger history regardless.
 */
export async function recordOrderCancelled(
	ctx: MutationCtx,
	args: { order: Doc<"orders">; cause: CancelCause; now: number },
): Promise<void> {
	const { order } = args;
	const monthStart = monthStartMyt(order.createdAt);
	const row = await loadUsageRow(ctx, order.retailerId, monthStart);
	if (row && row.orders > 0) {
		await ctx.db.patch(row._id, {
			orders: row.orders - 1,
			updatedAt: args.now,
		});
	}
	try {
		await refundCreditForOrder(ctx, args);
	} catch (err) {
		console.error("[credits] refund failed — cancel kept", {
			retailerId: order.retailerId,
			orderId: order._id,
			err,
		});
	}
}

/** Orders counted for the retailer's CURRENT MYT month (0 when no row yet).
 * Read by the owner/admin dashboard payload — never by the order pipeline. */
export async function ordersThisMonth(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
	now: number = Date.now(),
): Promise<number> {
	const row = await loadUsageRow(ctx, retailerId, monthStartMyt(now));
	return row?.orders ?? 0;
}
