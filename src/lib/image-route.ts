import { clampImageWidth, IMAGE_ROUTE_PREFIX } from "./image-proxy";

/**
 * The `/img/<uuid>` handler — Cloudflare Image Transformations in front of
 * Convex storage (ClickUp 86eypxght). Mounted pre-router in `src/server-entry.ts`.
 *
 * Why a Worker route rather than Cloudflare's `/cdn-cgi/image/<origin>` URL
 * form: that form only transforms sources on the same zone unless the zone is
 * opened up to arbitrary origins, and doing that turns the endpoint into an open
 * image proxy anyone can bill to our account. Here the origin is CONSTRUCTED
 * server-side from a uuid, so a caller can never point it at a host we didn't
 * choose, and the Convex deployment host stays out of public HTML.
 *
 * Why not the Cloudflare Images *product* (its own blob store): that means
 * migrating every blob out of Convex — a server-side re-upload of the whole
 * catalog — and then living with two sources of truth, since every cascade
 * delete, blob GC and upload path in the app assumes Convex storage.
 * Transformations give the same optimization against blobs that never move.
 */

/** Same-origin-only cache lifetime. See `immutable` note below. */
const ONE_YEAR_SECONDS = 31_536_000;

export interface ImageRouteDeps {
	/** Convex deployment origin, e.g. `https://peaceful-falcon-152.convex.cloud`. */
	convexUrl: string | undefined;
	/** Injected for tests; defaults to global fetch. */
	fetchImpl?: typeof fetch;
}

/**
 * Handle a request if it targets the image route; return null so the caller
 * falls through to the app router otherwise.
 */
export async function handleImageRequest(
	request: Request,
	deps: ImageRouteDeps,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(IMAGE_ROUTE_PREFIX)) return null;

	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method not allowed", {
			status: 405,
			headers: { allow: "GET, HEAD" },
		});
	}

	const uuid = url.pathname.slice(IMAGE_ROUTE_PREFIX.length);
	// The uuid is the entire remaining path — a nested path would mean someone is
	// probing, and it must never be pasted into an origin URL.
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			uuid,
		)
	) {
		return new Response("Not found", { status: 404 });
	}

	if (!deps.convexUrl) {
		// Misconfiguration, not a client error. Loud status so it shows up in
		// monitoring rather than silently serving broken images forever.
		return new Response("Image origin not configured", { status: 500 });
	}

	const width = clampImageWidth(url.searchParams.get("w"));
	const origin = `${deps.convexUrl.replace(/\/+$/, "")}/api/storage/${uuid}`;
	const doFetch = deps.fetchImpl ?? fetch;

	const upstream = await doFetch(origin, {
		method: request.method,
		cf: {
			image: {
				width,
				quality: 82,
				// Explicitly WebP rather than `auto`: universal since Safari 14,
				// and pinning ONE output format per width keeps a single cache
				// entry (and a single billed unique) per file per width instead of
				// splitting it by the caller's Accept header.
				format: "webp",
				// Never upscale a small original — that spends bytes inventing
				// pixels. A source narrower than `width` is served at its own size.
				fit: "scale-down",
			},
			cacheEverything: true,
			cacheTtlByStatus: {
				"200-299": ONE_YEAR_SECONDS,
				"404": 60,
				"500-599": 0,
			},
		},
		// `cf` is a Cloudflare extension to RequestInit; it's a no-op elsewhere.
	} as RequestInit);

	// A transform that can't run (transformations disabled on the zone, an SVG,
	// an unsupported source) yields the ORIGINAL bytes plus a `Cf-Resized: err=`
	// header. That degrades to exactly today's behaviour rather than to a broken
	// image, which is what makes this safe to ship before the zone toggle is on.
	const headers = new Headers(upstream.headers);
	if (upstream.ok) {
		// `immutable` is true by construction: Convex blobs are never rewritten in
		// place — every replace path mints a new storage id (and a new uuid) and
		// GCs the old blob. So a given uuid's bytes can never change; they can only
		// stop existing, and a deleted file's cached copies are no worse than the
		// 30-day private cache the originals already carry.
		headers.set(
			"cache-control",
			`public, max-age=${ONE_YEAR_SECONDS}, immutable`,
		);
	}
	// Convex sets `private`, which would forbid shared caching of our response.
	headers.delete("pragma");

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers,
	});
}
