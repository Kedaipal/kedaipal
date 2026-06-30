/**
 * Activation funnel helpers. Activation = the retailer's FIRST order reaching
 * confirmed (or beyond) — the milestone that predicts retention, distinct from
 * mere config. Kept here (not inline) because the stamp fires from several
 * confirm sites and must behave identically at each. See
 * docs/activation-checklist.md.
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Stamp `retailers.activatedAt` on the retailer's first confirmed order.
 *
 * One-time set-if-unset: re-reads the row inside the caller's transaction and
 * only writes when `activatedAt` is still undefined, so:
 *  - it NEVER overwrites an earlier stamp (the timestamp stays at the true first
 *    order, even though every later confirm calls this);
 *  - concurrent "first" orders are safe — Convex's OCC re-runs the loser, which
 *    re-reads the now-set field and no-ops (no read-then-write gap);
 *  - it never un-sets on cancellation or product archival (callers only invoke
 *    it on a forward, non-cancel transition).
 *
 * Called from every place an order can become confirmed: WhatsApp confirm,
 * payment auto-confirm, seller status transition, and counter checkout.
 */
export async function stampRetailerActivation(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	now: number,
): Promise<void> {
	const retailer = await ctx.db.get(retailerId);
	if (!retailer || retailer.activatedAt !== undefined) return;
	await ctx.db.patch(retailerId, { activatedAt: now, updatedAt: now });
}
