// Kedaipal's own admin surfaces that live OUTSIDE this app (separate Workers on
// admin.kedaipal.com). The app links out to them from navigation; who sees a
// link is decided by `api.adminAccess.mine` (convex/lib/adminAreas.ts).

/** The blog's video upload page (repo Kedaipal/kedaiblog, `media/`). Area "videos". */
export const BLOG_VIDEOS_URL = "https://admin.kedaipal.com/videos";
