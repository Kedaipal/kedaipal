import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { compareCalendarVersions, isCalendarVersion } from "./lib/appVersion";

/**
 * "What's new" seen-state (ClickUp 86eyqgxv9).
 *
 * The release-note CONTENT lives in the frontend bundle (`src/content/releases.ts`)
 * because it describes the code in that build. The server only stores how far a
 * seller has read.
 *
 * ## Why both sides resolve the retailer from the caller's own identity
 *
 * Never from an explicit `retailerId`, and never from the act-as target. This
 * is the `markLinkShared` posture, and it makes admin act-as safe **by
 * construction** rather than by a guard someone can forget: an admin operating
 * a seller's store reads and stamps their OWN release state, and the seller's
 * announcement is never silently consumed on their behalf.
 *
 * It is also the coherent semantic — "have I read the release notes?" is a
 * question about the person using the app, not about the store they happen to
 * be looking at.
 */

async function retailerForCaller(ctx: QueryCtx): Promise<Doc<"retailers"> | null> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return null;
	return await ctx.db
		.query("retailers")
		.withIndex("by_user", (q) => q.eq("userId", identity.subject))
		.first();
}

/**
 * How far this seller has read.
 *
 * - `null`            — no retailer for this identity (signed out, or a
 *                       storeless admin). The client renders nothing: seller
 *                       release notes have no audience there.
 * - `{ seenVersion: null }`   — a retailer that has never been stamped. The
 *                       client silently catches them up to the running version
 *                       and shows nothing.
 * - `{ seenVersion: "..." }`  — the stored version.
 *
 * The two nulls are deliberately different shapes. Collapsing them would make
 * "no store" indistinguishable from "never stamped", and a storeless admin
 * would get a stamp attempt on every page load that can never succeed.
 */
export const getSeenVersion = query({
	args: {},
	handler: async (ctx): Promise<{ seenVersion: string | null } | null> => {
		const retailer = await retailerForCaller(ctx);
		if (!retailer) return null;
		return { seenVersion: retailer.lastSeenReleaseVersion ?? null };
	},
});

/**
 * Record that this seller has read up to `version`.
 *
 * Monotonic: a version older than or equal to the stored one is a no-op. Two
 * tabs open at different points in a deploy would otherwise let a stale one
 * roll the marker backwards and re-show notes the seller already dismissed.
 */
export const markSeen = mutation({
	args: { version: v.string() },
	handler: async (ctx, args): Promise<{ updated: boolean }> => {
		// Validated rather than trusted: this value decides what the seller is
		// shown forever after. A malformed one sorts below every real version
		// (see compareCalendarVersions), which would re-show every release on
		// every visit.
		if (!isCalendarVersion(args.version)) {
			throw new ConvexError("Invalid release version");
		}
		const retailer = await retailerForCaller(ctx);
		if (!retailer) return { updated: false };

		const current = retailer.lastSeenReleaseVersion;
		if (
			current !== undefined &&
			compareCalendarVersions(args.version, current) <= 0
		) {
			return { updated: false };
		}
		await ctx.db.patch(retailer._id, { lastSeenReleaseVersion: args.version });
		return { updated: true };
	},
});
