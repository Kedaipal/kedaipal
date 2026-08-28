/**
 * Storefront image delivery — rewrites Convex storage URLs onto our own
 * `/img/<uuid>` Worker route so Cloudflare can resize + re-encode them and
 * cache the result at the edge (ClickUp 86eypxght).
 *
 * The problem this exists for: product photos are raw phone-camera originals
 * served straight from Convex storage. Measured on prod (21 Aug 2026) one
 * store home carried 38.3 MB of images, individual files up to 4.4 MB, 1200x1600
 * sources painted into ~180 px tiles, and Convex sends them
 * `Cache-Control: private` — which forbids shared caches, so there is no CDN in
 * front of storage at all. Under that weight the browser queues dozens of
 * multi-MB requests against one host and some die outright.
 *
 * Deliberately a URL rewrite on the CLIENT, not a change to the 45-odd
 * `ctx.storage.getUrl()` call sites in `convex/`. Every image in the app already
 * flows through one component (`AppImage`), so rewriting there fixes the whole
 * catalog — every store, every existing photo — with no backfill, no re-upload
 * and no seller action. Convex stays the single source of truth for the bytes.
 */

/**
 * The widths we are willing to transform to.
 *
 * This list IS the billing cap: Cloudflare charges per *unique* transformation
 * (one source image x one option set), so bounding the option space bounds the
 * bill no matter what widths a caller asks for. Values are spaced roughly 2x —
 * finer steps buy pixels nobody can see while multiplying uniques.
 */
export const IMAGE_WIDTHS = [160, 320, 640, 960, 1280] as const;

export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

/**
 * Width used when a caller doesn't say. Covers the common case (a product card
 * or thumbnail on a phone) without being so small that an unannotated call site
 * renders visibly soft. Full-bleed surfaces pass an explicit `sizes` instead.
 */
export const DEFAULT_IMAGE_WIDTH: ImageWidth = 640;

/** Our own route. Kept short — it lands in every `srcset` entry. */
export const IMAGE_ROUTE_PREFIX = "/img/";

/**
 * Convex serves stored files at `/api/storage/<uuid>`, where the uuid is NOT
 * the `Id<"_storage">` — it's a separate, stable, unsigned identifier minted per
 * file (verified: three `getUrl` calls on one id return byte-identical URLs with
 * no query string). Stable matters twice over: it keeps the edge cache key
 * stable, and it keeps the unique-transformation count bounded to one per file
 * per width. Unsigned matters because it means this route grants no access that
 * wasn't already public — anyone holding the URL could always fetch the bytes.
 */
const CONVEX_STORAGE_PATH =
	/^\/api\/storage\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Host check kept loose across deployments (dev + prod are different subdomains). */
const CONVEX_HOST = /(^|\.)convex\.cloud$/i;

/**
 * The file id if `src` is a Convex storage URL, else null.
 *
 * Anything that isn't one — `blob:`/`data:` upload previews, bundled static
 * assets, a third-party URL — returns null and is left completely alone.
 */
export function convexStorageUuid(src: string): string | null {
	let url: URL;
	try {
		url = new URL(src);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	if (!CONVEX_HOST.test(url.hostname)) return null;
	return CONVEX_STORAGE_PATH.exec(url.pathname)?.[1] ?? null;
}

/**
 * Snap any requested width onto the whitelist.
 *
 * Clamping rather than rejecting is deliberate: a width we don't recognise
 * should still render a picture. A 400 here would turn a typo — or a stale URL
 * frozen in a WhatsApp link preview — into a broken image, while clamping keeps
 * the billing surface exactly as bounded either way.
 */
export function clampImageWidth(
	raw: string | number | null | undefined,
): ImageWidth {
	const n = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
	if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_IMAGE_WIDTH;
	// Smallest whitelisted width that still covers the request; largest if none do.
	return (
		IMAGE_WIDTHS.find((w) => w >= n) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]
	);
}

/**
 * `src` rewritten onto our image route at `width`, or returned untouched when
 * it isn't a Convex storage URL.
 */
export function proxiedImageUrl(
	src: string,
	width: number = DEFAULT_IMAGE_WIDTH,
): string {
	const uuid = convexStorageUuid(src);
	if (!uuid) return src;
	return `${IMAGE_ROUTE_PREFIX}${uuid}?w=${clampImageWidth(width)}`;
}

/**
 * A full `srcset` across every whitelisted width, or null when `src` isn't
 * proxyable.
 *
 * Only ever paired with an explicit `sizes` — a `srcset` without one makes the
 * browser assume the image is 100vw and pull the LARGEST candidate, which on a
 * grid of 180 px tiles is worse than not doing this at all.
 */
export function imageSrcSet(src: string): string | null {
	const uuid = convexStorageUuid(src);
	if (!uuid) return null;
	return IMAGE_WIDTHS.map(
		(w) => `${IMAGE_ROUTE_PREFIX}${uuid}?w=${w} ${w}w`,
	).join(", ");
}

/**
 * Absolute proxied URL for `<head>` metadata (og:image, JSON-LD).
 *
 * Link unfurlers and crawlers can't resolve a root-relative path, so these must
 * carry the site origin. Sized large — a social card is rendered big — but still
 * ~50x lighter than shipping a 4 MB original, which link unfurlers are known to
 * skip outright.
 */
export function absoluteProxiedImageUrl(
	src: string,
	siteUrl: string,
	width: number = 1280,
): string {
	const proxied = proxiedImageUrl(src, width);
	if (proxied === src) return src;
	return `${siteUrl.replace(/\/+$/, "")}${proxied}`;
}
