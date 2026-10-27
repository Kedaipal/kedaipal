// What the CALLER may do on Kedaipal's admin surfaces (convex/lib/adminAreas.ts).
//
// Two readers:
//  - the upload Worker at admin.kedaipal.com/videos calls this over Convex's
//    HTTP API (`POST /api/query`, path "adminAccess:mine") with the caller's
//    `convex`-template Clerk token, and refuses anyone without "videos";
//  - the app's navigation shows the "Blog videos" shortcut from the same answer.
//
// Public on purpose and safe to be: it only ever describes the caller, never
// who else holds an area, and a signed-out caller gets an empty list rather
// than an error so the Worker can tell "not allowed" from "Convex is down".

import { v } from "convex/values";
import { query } from "./_generated/server";
import { ADMIN_AREAS, adminAreasFor } from "./lib/adminAreas";

export const mine = query({
	args: {},
	returns: v.object({
		areas: v.array(v.union(...ADMIN_AREAS.map((a) => v.literal(a)))),
	}),
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		return { areas: adminAreasFor(identity?.subject ?? null) };
	},
});
