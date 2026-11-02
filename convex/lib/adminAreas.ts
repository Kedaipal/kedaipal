// Admin AREAS — what a person may do on Kedaipal's own admin surfaces, as
// opposed to a store's team grants (convex/lib/permissions.ts).
//
// The first area is "videos": the blog's upload page at
// https://admin.kedaipal.com/videos (repo Kedaipal/kedaiblog, `media/`). That
// Worker asks `adminAccess.mine` with the caller's own Clerk token and lets
// them in only when "videos" is in the answer — so this file is the ONE list
// of who can upload blog videos, kept next to the admin list it extends.
//
// Who holds an area:
//  - a Kedaipal ADMIN (`ADMIN_USER_IDS`) holds every area;
//  - a BLOG EDITOR (`BLOG_EDITOR_USER_IDS`) holds "videos" and nothing else.
//    Deliberately NOT an admin: `ADMIN_USER_IDS` lets someone act as any
//    seller, and writing for the blog must never need that.
//
// Both lists are comma-separated Clerk user ids in the Convex env and fail
// closed — unset means nobody. Pure: no ctx, no db, so the client may import
// the TYPES (`import type`), never this module's values.

import { adminUserIds } from "./auth";

export const ADMIN_AREAS = ["videos"] as const;
export type AdminArea = (typeof ADMIN_AREAS)[number];

/** Parsed `BLOG_EDITOR_USER_IDS` (trimmed, non-empty). Empty when unset. */
export function blogEditorUserIds(): string[] {
	return (process.env.BLOG_EDITOR_USER_IDS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * The areas a Clerk subject holds, in `ADMIN_AREAS` order. `null` (signed
 * out) holds none.
 */
export function adminAreasFor(subject: string | null): AdminArea[] {
	if (!subject) return [];
	if (adminUserIds().includes(subject)) return [...ADMIN_AREAS];
	const areas: AdminArea[] = [];
	if (blogEditorUserIds().includes(subject)) areas.push("videos");
	return areas;
}
