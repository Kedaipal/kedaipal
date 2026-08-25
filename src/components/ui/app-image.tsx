import { ImageOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	DEFAULT_IMAGE_WIDTH,
	imageSrcSet,
	proxiedImageUrl,
} from "#/lib/image-proxy";
import { cn } from "#/lib/utils";
import { Skeleton } from "./skeleton";

/**
 * Shared image primitive — every raw `<img>` that renders a Convex-hosted or
 * user-uploaded photo (product photos, logos, payment proofs, mockups, QR
 * codes, POD photos…) should render through here instead. Before this
 * component, zero call sites in the app had any `onLoad`/`onError` handling —
 * a dead storage URL or a slow connection just showed a blank box.
 *
 * States: `loading` (skeleton overlay, image invisible) → `loaded` (fades in)
 * or `error` (muted box + icon + the alt text). A failed load is retried a
 * bounded number of times before `error` becomes terminal — see
 * `MAX_LOAD_RETRIES`. An unset `src` renders the same fallback with zero
 * network request.
 *
 * Deliberately NOT used by `store-poster.tsx` (a print/PDF-export surface —
 * a lazy or opacity-0 image can print blank).
 */

type ImageStatus = "loading" | "loaded" | "error";

/**
 * How many times a failed load is retried before the error state becomes
 * terminal. Bounded on purpose: the original no-retry rule existed so a dead
 * storage URL could never turn into a request loop hammering storage, and that
 * still holds — three total attempts, then we stop for good.
 */
export const MAX_LOAD_RETRIES = 2;
const RETRY_BASE_MS = 700;

/**
 * Backoff for retry `n` (0-based), with heavy jitter.
 *
 * The jitter is the load-bearing part, not a nicety. The failures worth
 * retrying here are congestion-driven — a storefront can queue 30+ photos
 * against a single host, and requests die because the pile-up starves them,
 * not because the bytes are gone. Retrying every failed image on the same
 * timer would rebuild the exact pile-up that broke them. Spreading the herd
 * across a wide window is what makes the retry actually land.
 */
function retryDelayMs(attempt: number): number {
	const base = RETRY_BASE_MS * 3 ** attempt;
	return Math.round(base * (0.5 + Math.random()));
}

export interface AppImageProps {
	/** Image URL. `undefined`/`null`/empty string renders the fallback — no `<img>` mounts, no request fires. */
	src?: string | null;
	/**
	 * CSS `sizes` describing how wide this image actually paints, e.g.
	 * `"(min-width: 768px) 25vw, 45vw"`.
	 *
	 * Supplying it turns on a full `srcset` so the browser downloads a file
	 * matched to the real box instead of the default width. Set it on anything
	 * that paints large or varies by breakpoint (covers, product galleries,
	 * grid tiles); leave it off and the image is still proxied, just at one
	 * fixed width.
	 *
	 * A `srcset` WITHOUT `sizes` is deliberately impossible here: the browser
	 * would assume 100vw and pull the largest candidate, which on a grid of
	 * 180 px tiles is worse than not proxying at all.
	 */
	sizes?: string;
	/**
	 * Accessible name. Also shown (truncated) as the error/empty-state caption.
	 * Pass `""` for purely decorative images — the fallback then renders
	 * icon-only and `aria-hidden`.
	 */
	alt: string;
	/** Extra classes for the wrapper (rarely needed beyond `aspect`/`rounded`). */
	className?: string;
	/** Sizing/position classes for the wrapper, e.g. `"aspect-square w-full"`, `"size-14 shrink-0"`, `"absolute inset-0"`. */
	aspect?: string;
	/** Above-the-fold hint: skips the lazy-loading attribute and requests high fetch priority (LCP candidates — hero/cover images, first grid row). */
	priority?: boolean;
	/** Custom empty/error-state node. Defaults to a muted box + `ImageOff` icon + the alt text. */
	fallback?: React.ReactNode;
	/** Rounded-corner utility class for the wrapper, e.g. `"rounded-2xl"`. */
	rounded?: string;
	objectFit?: "cover" | "contain";
	/**
	 * `true` (default) — the image fills the `aspect` box exactly (`h-full
	 * w-full` + `objectFit`), cropping as needed. Use for photo thumbnails,
	 * avatars, banners — anything with a fixed or absolute-positioned box.
	 *
	 * `false` — the image keeps its own intrinsic aspect ratio instead of
	 * being stretched to fill a box; `aspect` becomes the image's own sizing
	 * classes (e.g. `"h-8 w-auto"`) rather than a box it's cropped into, and
	 * `objectFit` is ignored (nothing to fit — there's no size mismatch to
	 * resolve). Use for brand-mark/logo SVGs sized by a fixed height with
	 * `w-auto` — forcing those through `w-full` inside an auto-width wrapper
	 * is the classic "percentage width in an indefinite container" CSS trap.
	 */
	fill?: boolean;
}

/** Local upload previews (`URL.createObjectURL`) and inline data URIs resolve
 * instantly with no network round-trip — showing a skeleton for these would
 * just be a flash of placeholder before content that was already ready. */
function isLocalPreviewUrl(src: string): boolean {
	return src.startsWith("blob:") || src.startsWith("data:");
}

function DefaultFallback({ alt }: { alt: string }) {
	const decorative = alt === "";
	return (
		<span
			className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted p-2 text-muted-foreground"
			aria-hidden={decorative || undefined}
		>
			<ImageOff className="size-5 shrink-0" aria-hidden="true" />
			{decorative ? null : (
				<span className="w-full truncate px-1 text-center text-[10px] leading-tight">
					{alt}
				</span>
			)}
		</span>
	);
}

export function AppImage({
	src,
	alt,
	className,
	aspect,
	priority = false,
	fallback,
	rounded,
	objectFit = "cover",
	fill = true,
	sizes,
}: AppImageProps) {
	const hasSrc = typeof src === "string" && src.length > 0;
	const isLocalPreview = hasSrc && isLocalPreviewUrl(src);

	// Convex storage URLs are rewritten onto our own `/img/` route so Cloudflare
	// resizes and re-encodes them and the result is cached at the edge
	// (86eypxght). Anything else — upload previews, bundled assets — passes
	// through untouched. Doing this HERE, rather than at the ~45 server-side
	// `storage.getUrl()` call sites, is what fixes the entire existing catalog
	// with no backfill and no seller re-upload.
	// `src` doubles as the srcset fallback, so the default width serves both the
	// no-`sizes` case and browsers that ignore srcset.
	const displaySrc = hasSrc ? proxiedImageUrl(src, DEFAULT_IMAGE_WIDTH) : src;
	const srcSet = hasSrc && sizes ? imageSrcSet(src) : null;
	const initialStatus: ImageStatus = isLocalPreview ? "loaded" : "loading";

	const [status, setStatus] = useState<ImageStatus>(initialStatus);
	// Bumped on each retry and folded into the <img> `key`, which remounts the
	// element and issues a genuinely fresh request. Same URL on purpose: a
	// failed load leaves no cache entry to bust, and a cache-busting param would
	// miss the edge cache every time AND mint a brand-new unique transformation
	// per retry — Cloudflare bills those (see lib/image-route.ts), so a retry
	// storm would be a bill as well as a re-download.
	const [reloadKey, setReloadKey] = useState(0);
	const retriesUsedRef = useRef(0);
	const retryTimerRef = useRef<number | null>(null);

	// Tracks the src this render's `status` reflects. When `src` changes
	// identity (a different product image, a fresh upload replacing a
	// preview…) we reset synchronously during render — React discards this
	// render pass and re-renders immediately with the fresh value, so a stale
	// "error" or "loaded" state never survives a src swap and there's no
	// flash of wrong state. See the "adjusting state" pattern in the React
	// docs: https://react.dev/reference/react/useState#storing-information-from-previous-renders
	const trackedSrcRef = useRef(src);
	if (trackedSrcRef.current !== src) {
		trackedSrcRef.current = src;
		setStatus(initialStatus);
		// A fresh src gets a fresh retry budget, and any retry still queued for
		// the OLD src is dropped — letting it fire would remount the <img> a
		// beat after the new URL had already started loading.
		retriesUsedRef.current = 0;
		setReloadKey(0);
		if (retryTimerRef.current !== null) {
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}
	}

	// Never leave a retry pending on an unmounted image — a storefront grid can
	// hold dozens of these, and scrolling away mid-retry shouldn't queue work
	// for elements that are gone.
	useEffect(
		() => () => {
			if (retryTimerRef.current !== null)
				clearTimeout(retryTimerRef.current);
		},
		[],
	);

	// Covers the classic "already cached" trap: an image that's already
	// `complete` the moment it mounts (browser cache, SPA back-navigation)
	// must never show a skeleton flash. A callback ref runs during the commit
	// phase — before the browser paints — so the correction lands in the same
	// frame as the initial (skeleton) render would have, and is invisible.
	const setImgRef = useCallback((node: HTMLImageElement | null) => {
		if (node?.complete && node.naturalWidth > 0) {
			setStatus("loaded");
		}
	}, []);

	const wrapperClassName = cn(
		"relative block overflow-hidden",
		aspect,
		rounded,
		className,
	);

	if (!hasSrc || status === "error") {
		return (
			<span className={wrapperClassName}>
				{fallback ?? <DefaultFallback alt={alt} />}
			</span>
		);
	}

	/**
	 * A failed load is retried (bounded, jittered) before the fallback is shown.
	 * The status deliberately stays `loading` across retries so the buyer keeps
	 * seeing the skeleton — flipping to the broken box and back would read as a
	 * glitch on a photo that is simply still arriving.
	 *
	 * Local previews are exempt: a `blob:` URL fails because it was revoked, and
	 * no number of retries brings a revoked object URL back.
	 */
	const handleError = () => {
		// A retry is already armed — never stack a second timer on top of it, or
		// the extra one leaks past the element it was scheduled for.
		if (retryTimerRef.current !== null) return;
		if (isLocalPreview || retriesUsedRef.current >= MAX_LOAD_RETRIES) {
			setStatus("error");
			return;
		}
		const attempt = retriesUsedRef.current;
		retriesUsedRef.current = attempt + 1;
		retryTimerRef.current = window.setTimeout(() => {
			retryTimerRef.current = null;
			setReloadKey(attempt + 1);
		}, retryDelayMs(attempt));
	};

	const eager = priority || isLocalPreview;

	return (
		<span className={wrapperClassName}>
			{status === "loading" ? (
				<Skeleton className="absolute inset-0 rounded-[inherit]" />
			) : null}
			<img
				key={`${src}#${reloadKey}`}
				ref={setImgRef}
				src={displaySrc ?? undefined}
				srcSet={srcSet ?? undefined}
				sizes={srcSet ? sizes : undefined}
				alt={alt}
				aria-hidden={alt === "" || undefined}
				draggable={false}
				className={cn(
					fill ? "h-full w-full" : aspect,
					fill && (objectFit === "contain" ? "object-contain" : "object-cover"),
					"transition-opacity duration-200 motion-reduce:transition-none",
					status === "loaded" ? "opacity-100" : "opacity-0",
				)}
				loading={eager ? "eager" : "lazy"}
				decoding="async"
				fetchPriority={eager ? "high" : undefined}
				onLoad={() => setStatus("loaded")}
				onError={handleError}
			/>
		</span>
	);
}
