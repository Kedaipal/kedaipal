// Dashboard alert feed (browser notifications, docs/order-notifications.md).
//
// One tiny reactive query the app shell subscribes to while the seller has
// notifications enabled: the newest order stamp + the newest FAILED delivery
// booking. The client compares stamps against what it last saw and raises a
// browser notification + chime on increase — Convex reactivity is the push
// channel, so there's no polling and nothing new to operate. (True Web Push
// with the browser closed is the separate roadmap item "PWA + Push".)

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRetailerAccess } from "./lib/auth";

/** Terminal-failure job states — the ones worth interrupting a seller for. */
const FAILED_JOB_STATUSES = new Set(["canceled", "expired", "rejected"]);

export const latestActivity = query({
	args: { retailerId: v.id("retailers") },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		newestOrder: { createdAt: number; shortId: string } | null;
		newestFailedBooking: {
			failedAt: number;
			shortId: string;
			reason?: string;
		} | null;
	}> => {
		await requireRetailerAccess(ctx, retailerId);

		// Newest order — one indexed row.
		const newest = await ctx.db
			.query("orders")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.first();

		// Newest failed rider booking — bookings are rare relative to orders, so
		// a small recency window is plenty (a failure older than the last 10
		// bookings isn't a fresh interruption-worthy event anyway).
		const recentJobs = await ctx.db
			.query("deliveryJobs")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.take(10);
		const failed = recentJobs.find((j) => FAILED_JOB_STATUSES.has(j.status));
		let failedBooking: {
			failedAt: number;
			shortId: string;
			reason?: string;
		} | null = null;
		if (failed) {
			const order = await ctx.db.get(failed.orderId);
			if (order) {
				failedBooking = {
					failedAt: failed.updatedAt,
					shortId: order.shortId,
					reason: failed.failureReason,
				};
			}
		}

		return {
			newestOrder: newest
				? { createdAt: newest.createdAt, shortId: newest.shortId }
				: null,
			newestFailedBooking: failedBooking,
		};
	},
});
