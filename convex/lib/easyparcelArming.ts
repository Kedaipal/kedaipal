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

/** Why EasyParcel can't price a checkout for this store right now — the
 * reason a live overseas lane is held, said to the seller with its fix.
 * `null` = it can quote. Ordered by what to fix first. */
export type EasyparcelQuoteBlock =
	| "not_connected"
	| "reconnect_needed"
	| "disabled"
	| "no_pickup_address"
	| "no_sender_phone"
	/** The account prices in another currency than the store charges in
	 * (EasyParcel's one sandbox per login is MYR): a quote the buyer can't be
	 * charged in is dropped, so the lane would never price — held instead. */
	| "wrong_currency";

/**
 * Can EasyParcel price a checkout for this store right now? Pure over the
 * stored connection, so `storeLanes` (every storefront read) costs one
 * indexed read and no network. The live quote itself still decides the
 * price — this only says whether asking is worth offering the lane.
 */
export function easyparcelQuoteBlock(args: {
	conn:
		| {
				revokedAt?: number;
				enabled: boolean;
				pickupAddress?: unknown;
				balanceCurrency?: string;
		  }
		| null;
	configured: boolean;
	senderPhone: string | undefined;
	storeCurrency: string;
}): EasyparcelQuoteBlock | null {
	const { conn } = args;
	if (!conn || !args.configured) return "not_connected";
	if (conn.revokedAt !== undefined) return "reconnect_needed";
	if (!conn.enabled) return "disabled";
	if (!conn.pickupAddress) return "no_pickup_address";
	if (!(args.senderPhone ?? "").replace(/\D/g, "")) return "no_sender_phone";
	if (
		conn.balanceCurrency &&
		conn.balanceCurrency.toUpperCase() !== args.storeCurrency.toUpperCase()
	)
		return "wrong_currency";
	return null;
}

export async function loadEasyparcelQuoteBlock(
	ctx: QueryCtx,
	retailer: {
		_id: Id<"retailers">;
		waPhone?: string;
		currency?: string;
	},
	storeCurrency: string,
): Promise<EasyparcelQuoteBlock | null> {
	const conn = await ctx.db
		.query("easyparcelConnections")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
		.unique();
	return easyparcelQuoteBlock({
		conn,
		configured: easyparcelConfigured(),
		senderPhone: retailer.waPhone,
		storeCurrency,
	});
}
