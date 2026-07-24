import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { useImageLoad } from "#/components/ui/image";
import { cn } from "#/lib/utils";

/**
 * Shared tap-to-zoom image lightbox. Built once and reused for storefront
 * product images (info baked into images is unreadable at thumbnail size) and
 * the payment QR images on the tracking page (must be openable full-screen to
 * scan). Mobile-first: full-screen overlay, ≥44px close target, safe-area
 * insets, tap-to-zoom with scroll-to-pan. Accessibility (focus trap, Escape,
 * portal) comes from radix Dialog.
 *
 * Two pieces:
 *  - `ZoomableImage` — drop-in `<img>` replacement; renders the thumbnail as a
 *    button that opens the lightbox. Use this at call sites.
 *  - `ImageLightbox` — the controlled full-screen viewer (exported for the rare
 *    case a caller already manages its own open state).
 */

const MAX_ZOOM = 3;

export function ImageLightbox({
	src,
	alt,
	open,
	onOpenChange,
	caption,
}: {
	src: string;
	alt: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Optional label shown over the image (e.g. the QR method name). */
	caption?: string;
}) {
	// 1 = fit-to-screen; 2/3 = zoomed (image overflows, scroll/drag to pan).
	const [zoom, setZoom] = useState(1);
	// Every open starts fit-to-screen.
	useEffect(() => {
		if (!open) setZoom(1);
	}, [open]);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-[60] bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in" />
				<Dialog.Content
					aria-describedby={undefined}
					className="fixed inset-0 z-[70] outline-none data-[state=open]:animate-in data-[state=open]:fade-in"
				>
					{/* radix requires a title for a11y; not visually shown. */}
					<Dialog.Title className="sr-only">{alt || "Image"}</Dialog.Title>

					<div className="absolute inset-0 overflow-auto">
						{/* Full-area close target, sits behind the image. Tapping empty
						    space closes; the image (above) catches its own taps to zoom. */}
						<button
							type="button"
							aria-label="Close image viewer"
							onClick={() => onOpenChange(false)}
							className="absolute inset-0 cursor-zoom-out"
						/>
						{/* Centered image. The wrapper is pointer-events-none so taps on the
						    empty margins fall through to the close target beneath. */}
						<div className="pointer-events-none relative flex min-h-full min-w-full items-center justify-center p-4">
							<button
								type="button"
								aria-label={zoom > 1 ? "Zoom out" : "Zoom in"}
								onClick={() => setZoom((z) => (z >= MAX_ZOOM ? 1 : z + 1))}
								className="pointer-events-auto block"
							>
								<img
									src={src}
									alt={alt}
									draggable={false}
									style={zoom > 1 ? { width: `${zoom * 100}%` } : undefined}
									className={cn(
										"select-none rounded-lg",
										zoom > 1
											? "max-w-none cursor-zoom-out"
											: "max-h-[86dvh] max-w-[92vw] object-contain cursor-zoom-in",
									)}
								/>
							</button>
						</div>
					</div>

					<Dialog.Close asChild>
						<button
							type="button"
							aria-label="Close"
							className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex size-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
						>
							<X className="size-5" />
						</button>
					</Dialog.Close>

					<div className="pointer-events-none fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-1 px-4 text-center">
						{caption ? (
							<p className="rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white">
								{caption}
							</p>
						) : null}
						<p className="text-[11px] text-white/60">
							Tap image to zoom · tap outside to close
						</p>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

export function ZoomableImage({
	src,
	alt,
	className,
	wrapperClassName,
	caption,
}: {
	src: string;
	alt: string;
	/** Classes for the `<img>` thumbnail (same as you'd put on a plain img). */
	className?: string;
	/** Classes for the wrapping button — use for layout (flex item, snap, etc.). */
	wrapperClassName?: string;
	/** Optional caption shown in the lightbox. */
	caption?: string;
}) {
	const [open, setOpen] = useState(false);
	const { ref, loaded, errored, onLoad, onError } = useImageLoad(src);
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label={alt ? `View ${alt} full screen` : "View image full screen"}
				className={cn("relative block cursor-zoom-in", wrapperClassName)}
			>
				{!loaded && !errored ? (
					<span
						aria-hidden
						className="absolute inset-0 animate-pulse rounded-[inherit] bg-muted"
					/>
				) : null}
				<img
					ref={ref}
					src={src}
					alt={alt}
					draggable={false}
					onLoad={onLoad}
					onError={onError}
					className={cn(
						"transition-opacity duration-300",
						loaded || errored ? "opacity-100" : "opacity-0",
						className,
					)}
				/>
			</button>
			<ImageLightbox
				src={src}
				alt={alt}
				caption={caption}
				open={open}
				onOpenChange={setOpen}
			/>
		</>
	);
}
