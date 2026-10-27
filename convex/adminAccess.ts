// What the CALLER may do on Kedaipal's admin surfaces (convex/lib/adminAreas.ts),
// and whether they have a store to go back to.
//
// Two readers:
//  - the upload Worker at admin.kedaipal.com/videos calls this over Convex's
//    HTTP API (`POST /api/query`, path "adminAccess:mine") with the caller's
//    `convex`-template Clerk token, and refuses anyone without "videos";
//  - the app's navigation shows the "Blog videos" shortcut from the same answer.
//
// `hasStore` is the app shell's own rule — `resolveMyRetailer`, the resolver
// behind `getMyRetailer`: an owned store or an active team membership. A caller
// without one is sent to onboarding by the app, so the admin page must not link
// a storeless blog editor "back to the app"; it links them to kedaipal.com.
//
// Public on purpose and safe to be: it only ever describes the caller, never
// who else holds an area, and a signed-out caller gets `{areas: [], hasStore:
// false}` rather than an error so the Worker can tell "not allowed" from
// "Convex is down".

import { v } from "convex/values";
import { query } from "./_generated/server";
import { ADMIN_AREAS, adminAreasFor } from "./lib/adminAreas";
import { resolveMyRetailer } from "./lib/auth";

export const mine = query({
	args: {},
	returns: v.object({
		areas: v.array(v.union(...ADMIN_AREAS.map((a) => v.literal(a)))),
		hasStore: v.boolean(),
	}),
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return { areas: [], hasStore: false };
		return {
			areas: adminAreasFor(identity.subject),
			hasStore: (await resolveMyRetailer(ctx)) !== null,
		};
	},
});
