// The order-usage meter behind the SOFT orderCap ("X of 100 plan orders used
// this month"). A denormalized per-retailer × MYT-calendar-month counter —
// see the `subscriptionUsage` schema comment for the keying rationale.
//
// Invariants:
//  - WRITE-ONLY from the order pipeline (create / first-cancel). It meters;
//    it NEVER blocks — `orders.create` stays public regardless of usage
//    (docs/manual-subscription.md: pressure on the seller, never the buyer).
//  - A cancel decrements the month the order was CREATED in (not the current
//    month), floored at zero, so late cancellations can't corrupt this
//    month's count or drive it negative.

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { monthStartMyt } from "./lib/usagePeriod";

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

/** Count a freshly created order against the retailer's current month.
 * Called from every order-create site (storefront + counter checkout). */
export async function recordOrderCreated(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	createdAt: number,
): Promise<void> {
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
}

/**
 * Reverse a cancelled order's contribution — keyed by the order's creation
 * time so the right month is decremented. Missing row / zero floor → no-op
 * (pre-meter orders were never counted). Callers must hold the same
 * first-transition-into-cancelled guard as `decrementAggregatesForCancel`, so
 * a double-cancel never double-decrements.
 */
export async function recordOrderCancelled(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	orderCreatedAt: number,
): Promise<void> {
	const monthStart = monthStartMyt(orderCreatedAt);
	const row = await loadUsageRow(ctx, retailerId, monthStart);
	if (!row || row.orders <= 0) return;
	await ctx.db.patch(row._id, {
		orders: row.orders - 1,
		updatedAt: Date.now(),
	});
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
