/**
 * The one-bit EasyParcel summary the courier-arming predicate needs
 * (`storeBooksCouriers` / `easyparcelBookingArmed`, lib/courierBooking.ts).
 *
 * The grant lives in `easyparcelConnections`, not on the retailer row, so
 * every caller that judges "does this store book couriers" loads it here — one
 * indexed read. Server-only: it reads `process.env`, which the browser has no
 * equivalent of.
 */

import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Kedaipal's EasyParcel app is configured on this deployment. */
export function easyparcelConfigured(): boolean {
	return Boolean(
		process.env.EASYPARCEL_CLIENT_ID?.trim() &&
			process.env.EASYPARCEL_CLIENT_SECRET?.trim() &&
			process.env.CONVEX_SITE_URL?.trim(),
	);
}

export async function loadEasyparcelArming(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<{ connected: boolean; enabled: boolean }> {
	const conn = await ctx.db
		.query("easyparcelConnections")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.unique();
	return {
		connected:
			conn !== null && conn.revokedAt === undefined && easyparcelConfigured(),
		enabled: conn?.enabled === true,
	};
}
