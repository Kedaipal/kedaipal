import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "#/lib/utils";

/**
 * Shared image load-state so every image card fades in smoothly instead of
 * painting top-to-bottom as the bytes stream in.
 *
 * Two pieces:
 *  - `useImageLoad` — headless hook returning the `<img>` ref + load flags, for
 *    call sites that already own their markup (e.g. ZoomableImage's button).
 *  - `Img` — a drop-in `<img>` wrapper that renders a pulsing skeleton until the
 *    image decodes, then cross-fades it in. Size/round/aspect go on
 *    `wrapperClassName`; object-fit and the like go on `className`.
 */

export function useImageLoad(src: string | null | undefined) {
	const ref = useRef<HTMLImageElement>(null);
	const [loaded, setLoaded] = useState(false);
	const [errored, setErrored] = useState(false);

	// Reset when the source changes, and immediately settle for images the
	// browser already has cached — a cached `<img>` can be `complete` before React
	// attaches the handlers, so `onLoad` would never fire and it'd stay hidden.
	useEffect(() => {
		setLoaded(false);
		setErrored(false);
		if (!src) return;
		const img = ref.current;
		if (img?.complete) {
			if (img.naturalWidth > 0) setLoaded(true);
			else setErrored(true);
		}
	}, [src]);

	return {
		ref,
		loaded,
		errored,
		onLoad: () => setLoaded(true),
		onError: () => setErrored(true),
	};
}

export function Img({
	src,
	alt,
	className,
	wrapperClassName,
	fallback,
	loading = "lazy",
}: {
	src: string | null | undefined;
	alt: string;
	/** Classes for the `<img>` — object-fit, positioning, etc. */
	className?: string;
	/** Classes for the wrapper — size, aspect ratio, rounding, background. */
	wrapperClassName?: string;
	/** Shown centered when there's no src or the image fails to load. */
	fallback?: ReactNode;
	loading?: "lazy" | "eager";
}) {
	const { ref, loaded, errored, onLoad, onError } = useImageLoad(src);
	const showFallback = !src || errored;

	return (
		<span
			className={cn(
				"relative block overflow-hidden bg-muted",
				wrapperClassName,
			)}
		>
			{showFallback ? (
				<span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
					{fallback}
				</span>
			) : (
				<>
					{!loaded ? (
						<span
							aria-hidden
							className="absolute inset-0 animate-pulse bg-muted"
						/>
					) : null}
					<img
						ref={ref}
						src={src ?? undefined}
						alt={alt}
						loading={loading}
						decoding="async"
						onLoad={onLoad}
						onError={onError}
						className={cn(
							"size-full object-cover transition-opacity duration-300",
							loaded ? "opacity-100" : "opacity-0",
							className,
						)}
					/>
				</>
			)}
		</span>
	);
}
