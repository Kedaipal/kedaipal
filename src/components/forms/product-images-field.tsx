import { useMutation } from "convex/react";
import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { PhotoAutosaveStatus } from "../../hooks/usePhotoAutosave";
import { takePickedFiles } from "../../lib/file-input";
import { IMAGE_ACCEPT } from "../../lib/image-upload";
import { reorderByIds } from "../../lib/reorder";
import { uploadImage } from "../../lib/storage-upload";
import { AppImage } from "../ui/app-image";
import { SortableList } from "../ui/sortable-list";

export const MAX_IMAGES = 5;

export type ProductImage = { id: string; url: string };

/**
 * Where the grid's uploads stand, for the parent: `uploading` while any photo
 * is still going up (the parent holds its submit), `failed` while a photo that
 * didn't make it is still on screen waiting for Retry or Remove (unsaved work —
 * leaving would lose it), otherwise `idle`.
 */
export type PhotoUploadState = "idle" | "uploading" | "failed";

/** A picked photo that isn't in `images` yet — on its way up, or stopped. */
type PendingTile = {
	key: string;
	file: File;
	/** The picked file, for the tile — the stored bytes replace it on success. */
	previewUrl: string;
} & ({ status: "uploading" } | { status: "failed"; message: string });

let tileSeq = 0;

/**
 * Product photo grid — upload, drag-to-reorder (first image = storefront
 * cover), remove. Shared by the full product form and the create wizard so the
 * upload + reorder behaviour stays single-sourced.
 *
 * Every picked photo gets its OWN tile the moment it's picked (z8r3fdtk85):
 * "Uploading…" over its preview, then either it joins the grid or the tile
 * turns into "Didn't upload" with a Retry and a Remove. Each step of an upload
 * is deadline-bounded (`uploadImage`), so a tile can't spin forever, and a
 * batch no longer lands all-or-nothing — the seller sees exactly which photo
 * made it and which needs another tap, instead of guessing.
 */
export function ProductImagesField({
	images,
	onChange,
	onUploadStateChange,
	onError,
	autosaveStatus,
}: {
	images: ProductImage[];
	onChange: (next: ProductImage[]) => void;
	/** Lets the parent hold its submit while a photo is uploading, and count a
	 * failed one as unsaved work. */
	onUploadStateChange?: (state: PhotoUploadState) => void;
	onError: (message: string) => void;
	/** Set when the photos save themselves (an existing product, z8r3fdtk82):
	 * the grid then says, beside the count, whether they've landed. */
	autosaveStatus?: PhotoAutosaveStatus;
}) {
	const generateUploadUrl = useMutation(api.products.generateUploadUrl);
	const [pending, setPending] = useState<PendingTile[]>([]);

	// The list a finishing upload appends to. Synced from the prop every render
	// AND advanced the moment we append, so two uploads finishing between
	// renders can't each append to the same stale list and drop one.
	const imagesRef = useRef(images);
	imagesRef.current = images;
	// Uploads run one at a time: it keeps a five-photo pick inside the
	// per-minute write limit, and appends land in pick order.
	const queueRef = useRef<Promise<void>>(Promise.resolve());

	const uploadState: PhotoUploadState = pending.some(
		(t) => t.status === "uploading",
	)
		? "uploading"
		: pending.length > 0
			? "failed"
			: "idle";
	useEffect(() => {
		onUploadStateChange?.(uploadState);
	}, [uploadState, onUploadStateChange]);

	function patchTile(key: string, next: PendingTile | null) {
		setPending((now) =>
			next === null
				? now.filter((t) => t.key !== key)
				: now.map((t) => (t.key === key ? next : t)),
		);
	}

	function enqueue(tile: PendingTile) {
		queueRef.current = queueRef.current.then(async () => {
			const result = await uploadImage(tile.file, () => generateUploadUrl());
			if (result.ok) {
				const next = [
					...imagesRef.current,
					{ id: result.storageId, url: URL.createObjectURL(result.blob) },
				];
				imagesRef.current = next;
				onChange(next);
				URL.revokeObjectURL(tile.previewUrl);
				patchTile(tile.key, null);
			} else if (result.retryable) {
				patchTile(tile.key, {
					...tile,
					status: "failed",
					message: result.message,
				});
			} else {
				// The file itself (a HEIC, too large) or a refusal naming its own
				// fix — a Retry would be a button that can't work, so the tile
				// goes and the reason is said once, where the seller is looking.
				URL.revokeObjectURL(tile.previewUrl);
				patchTile(tile.key, null);
				onError(result.message);
			}
		});
	}

	function handleFiles(files: readonly File[]) {
		if (files.length === 0) return;
		if (images.length + pending.length + files.length > MAX_IMAGES) {
			onError(`Maximum ${MAX_IMAGES} images per product`);
			return;
		}
		const tiles: PendingTile[] = files.map((file) => ({
			key: `pending-${++tileSeq}`,
			file,
			previewUrl: URL.createObjectURL(file),
			status: "uploading",
		}));
		setPending((now) => [...now, ...tiles]);
		for (const tile of tiles) enqueue(tile);
	}

	function retry(tile: PendingTile) {
		const again: PendingTile = { ...tile, status: "uploading" };
		patchTile(tile.key, again);
		enqueue(again);
	}

	function discard(tile: PendingTile) {
		URL.revokeObjectURL(tile.previewUrl);
		patchTile(tile.key, null);
	}

	const failed = pending.filter(
		(t): t is PendingTile & { status: "failed"; message: string } =>
			t.status === "failed",
	);
	const failedMessages = [...new Set(failed.map((t) => t.message))];

	return (
		<div className="flex flex-col gap-3">
			{/* Wraps instead of squeezing: on a phone the count, the save status
			    and the drag hint don't fit one line, and squeezed they broke
			    mid-phrase ("Drag to / reorder"). */}
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<span className="whitespace-nowrap text-sm font-medium">
					Product images{" "}
					<span className="text-muted-foreground">
						({images.length}/{MAX_IMAGES})
					</span>
				</span>
				{autosaveStatus?.kind === "saving" ? (
					<output className="mr-auto inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
						Saving…
					</output>
				) : autosaveStatus?.kind === "saved" ? (
					<output className="mr-auto inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-accent-emphasis">
						<CheckCircle2 className="size-3.5" aria-hidden="true" />
						Saved
					</output>
				) : autosaveStatus?.kind === "waiting" ? (
					// Throttled: it saves by itself, so no "tap Save" here (Save
					// would hit the same limit).
					<output className="mr-auto inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
						<Clock className="size-3.5" aria-hidden="true" />
						Lots of changes — saving in {autosaveStatus.wait}
					</output>
				) : null}
				{images.length > 1 ? (
					<p className="whitespace-nowrap text-xs text-muted-foreground">
						Drag to reorder
					</p>
				) : null}
			</div>
			<div className="grid grid-cols-3 gap-2">
				{/* `className="contents"` lets the sortable <li>s join this grid
				    directly, so the "+ Add" tile flows in the next free cell. */}
				{images.length > 0 ? (
					<SortableList
						items={images}
						getId={(img) => img.id}
						onReorder={(orderedIds) =>
							onChange(reorderByIds(images, orderedIds, (img) => img.id))
						}
						strategy="grid"
						className="contents"
						renderItem={(img, handle) => (
							<div className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted">
								<AppImage src={img.url} alt="" aspect="size-full" />
								{/* Cover badge on the first image — reordering changes
								    which image leads on the storefront. */}
								{img.id === images[0]?.id ? (
									<span className="absolute bottom-1 left-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] font-medium shadow">
										Cover
									</span>
								) : null}
								{/* Grip handle only matters with 2+ images. */}
								{images.length > 1 ? (
									<span className="absolute left-1 top-1 rounded-lg bg-background/90 shadow">
										{handle}
									</span>
								) : null}
								{/* 44px tap target (mobile rule) with a lighter visible
								    chip, so two corner controls don't crowd the cell. */}
								<button
									type="button"
									onClick={() =>
										onChange(images.filter((i) => i.id !== img.id))
									}
									className="absolute right-0 top-0 flex size-11 items-center justify-center"
									aria-label="Remove image"
								>
									<span className="flex size-8 items-center justify-center rounded-full bg-background/90 text-lg leading-none shadow">
										×
									</span>
								</button>
							</div>
						)}
					/>
				) : null}
				{/* Not sortable: a photo can't be ordered until it exists. They
				    sit after the stored ones, which is where they'll land. */}
				{pending.map((tile) => (
					<div
						key={tile.key}
						className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted"
					>
						<div className="size-full opacity-40">
							<AppImage src={tile.previewUrl} alt="" aspect="size-full" />
						</div>
						{tile.status === "uploading" ? (
							<output className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs font-medium text-foreground">
								<Loader2 className="size-5 animate-spin" aria-hidden="true" />
								Uploading…
							</output>
						) : (
							<>
								{/* The words sit in the band between the remove chip's row
								    and the Retry strip, so neither control crowds them on
								    a ~110px phone tile. */}
								<div className="absolute inset-0 bg-background/60" />
								<p className="absolute inset-x-0 top-9 bottom-11 flex items-center justify-center gap-1 px-1 text-xs font-medium text-destructive">
									<AlertCircle
										className="size-3.5 shrink-0"
										aria-hidden="true"
									/>
									Didn't upload
								</p>
								<button
									type="button"
									onClick={() => retry(tile)}
									className="absolute inset-x-0 bottom-0 flex h-11 items-center justify-center bg-background/90 text-sm font-semibold text-foreground hover:bg-background"
								>
									Retry
								</button>
								<button
									type="button"
									onClick={() => discard(tile)}
									className="absolute right-0 top-0 flex size-11 items-center justify-center"
									aria-label="Remove photo that didn't upload"
								>
									<span className="flex size-8 items-center justify-center rounded-full bg-background/90 text-lg leading-none shadow">
										×
									</span>
								</button>
							</>
						)}
					</div>
				))}
				{images.length + pending.length < MAX_IMAGES ? (
					<label className="flex aspect-square cursor-pointer items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:border-ring">
						+ Add
						<input
							type="file"
							accept={IMAGE_ACCEPT}
							multiple
							onChange={(e) => handleFiles(takePickedFiles(e.target))}
							className="hidden"
						/>
					</label>
				) : null}
			</div>
			{/* The tile says THAT it failed; this says why and what to do. One
			    line per distinct reason, so five timeouts read as one sentence. */}
			{failedMessages.map((message) => {
				const count = failed.filter((t) => t.message === message).length;
				return (
					<p key={message} role="alert" className="text-xs text-destructive">
						{count === 1
							? "1 photo didn't upload"
							: `${count} photos didn't upload`}
						: {message.replace(/\.$/, "")}. Tap Retry on the photo, or remove
						it.
					</p>
				);
			})}
			{autosaveStatus?.kind === "error" ? (
				<p role="alert" className="text-xs text-destructive">
					Couldn't save your photos: {autosaveStatus.message.replace(/\.$/, "")}
					. Tap Save changes to try again.
				</p>
			) : null}
		</div>
	);
}
