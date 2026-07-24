import { ImageOff } from "lucide-react";
import { useCallback, useRef, useState } from "react";
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
 * or `error` (muted box + icon + the alt text, terminal until `src` changes).
 * An unset `src` renders the same fallback with zero network request.
 *
 * Deliberately NOT used by `store-poster.tsx` (a print/PDF-export surface —
 * a lazy or opacity-0 image can print blank) or landing's `responsive-image.tsx`
 * (a build-time `<picture>`/srcset wrapper for static optimized assets, a
 * different concern from this component's runtime Convex-hosted URLs).
 */

type ImageStatus = "loading" | "loaded" | "error";

export interface AppImageProps {
	/** Image URL. `undefined`/`null`/empty string renders the fallback — no `<img>` mounts, no request fires. */
	src?: string | null;
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
}: AppImageProps) {
	const hasSrc = typeof src === "string" && src.length > 0;
	const isLocalPreview = hasSrc && isLocalPreviewUrl(src);
	const initialStatus: ImageStatus = isLocalPreview ? "loaded" : "loading";

	const [status, setStatus] = useState<ImageStatus>(initialStatus);

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
	}

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

	const eager = priority || isLocalPreview;

	return (
		<span className={wrapperClassName}>
			{status === "loading" ? (
				<Skeleton className="absolute inset-0 rounded-[inherit]" />
			) : null}
			<img
				key={src}
				ref={setImgRef}
				src={src}
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
				onError={() => setStatus("error")}
			/>
		</span>
	);
}
