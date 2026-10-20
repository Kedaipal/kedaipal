/**
 * Kedaipal's own off-app destinations, linked from the landing nav and footer.
 * One constant per place, so a move (a new blog host) is a one-line change
 * rather than a hunt through every surface that links it.
 */

/** The content-marketing blog (Sanity-backed, separate repo + Cloudflare). */
export const BLOG_URL = "https://blog.kedaipal.com";

/**
 * Kedaipal's own social accounts. The handles are not the same across
 * networks (`kedaipal_com` on Instagram, `kedaipal` on TikTok): the footer
 * shipped with `instagram.com/kedaipal_my/`, a handle that was never ours and
 * showed visitors Instagram's "page isn't available". `footer.test.tsx` pins
 * the live handles literally, so a slip here fails the suite, not the visitor.
 */
export const INSTAGRAM_URL = "https://www.instagram.com/kedaipal_com/";
export const TIKTOK_URL = "https://www.tiktok.com/@kedaipal";
