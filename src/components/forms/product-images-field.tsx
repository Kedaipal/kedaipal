import { useMutation } from "convex/react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { PhotoAutosaveStatus } from "../../hooks/usePhotoAutosave";
import { takePickedFiles } from "../../lib/file-input";
import { convexErrorMessage } from "../../lib/format";
import { IMAGE_ACCEPT, prepareImageUpload } from "../../lib/image-upload";
import { reorderByIds } from "../../lib/reorder";
import { AppImage } from "../ui/app-image";
import { SortableList } from "../ui/sortable-list";

export const MAX_IMAGES = 5;

export type ProductImage = { id: string; url: string };

/**
 * Product photo grid — upload, drag-to-reorder (first image = storefront
 * cover), remove. Shared by the full product form and the create wizard so the
 * upload + reorder behaviour stays single-sourced.
 */
export function ProductImagesField({
	images,
	onChange,
	onUploadingChange,
	onError,
	autosaveStatus,
}: {
	images: ProductImage[];
	onChange: (next: ProductImage[]) => void;
	/** Lets the parent disable its submit while an upload is in flight. */
	onUploadingChange?: (uploading: boolean) => void;
	onError: (message: string) => void;
	/** Set when the photos save themselves (an existing product, z8r3fdtk82):
	 * the grid then says, beside the count, whether they've landed. */
	autosaveStatus?: PhotoAutosaveStatus;
}) {
	const generateUploadUrl = useMutation(api.products.generateUploadUrl);
	const [uploading, setUploadingState] = useState(false);

	function setUploading(next: boolean) {
		setUploadingState(next);
		onUploadingChange?.(next);
	}

	async function handleFiles(files: readonly File[]) {
		if (files.length === 0) return;
		if (images.length + files.length > MAX_IMAGES) {
			onError(`Maximum ${MAX_IMAGES} images per product`);
			return;
		}
		setUploading(true);
		try {
			// Prepare EVERY file before uploading any of them, so a batch either
			// lands whole or not at all — a partial upload leaves the seller
			// guessing which photos actually made it.
			const prepared: { blob: Blob; contentType: string }[] = [];
			for (const file of Array.from(files)) {
				const result = await prepareImageUpload(file);
				if (!result.ok) {
					onError(result.message);
					return;
				}
				prepared.push(result);
			}

			const added: ProductImage[] = [];
			for (const item of prepared) {
				const url = await generateUploadUrl();
				const res = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": item.contentType },
					body: item.blob,
				});
				if (!res.ok) throw new Error("Upload failed");
				// Validate the response shape before trusting it — an error body
				// would otherwise store `undefined` as a storage id and only
				// surface server-side (same guard as VariantImageCell).
				const body = (await res.json()) as { storageId?: unknown };
				if (typeof body.storageId !== "string")
					throw new Error("Upload failed: unexpected response");
				// Preview the bytes we actually stored — for a converted file the
				// original and the upload differ.
				added.push({
					id: body.storageId,
					url: URL.createObjectURL(item.blob),
				});
			}
			onChange([...images, ...added]);
		} catch (err) {
			onError(convexErrorMessage(err));
		} finally {
			setUploading(false);
		}
	}

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
				{images.length < MAX_IMAGES ? (
					<label className="flex aspect-square cursor-pointer items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:border-ring">
						{uploading ? "Uploading…" : "+ Add"}
						<input
							type="file"
							accept={IMAGE_ACCEPT}
							multiple
							disabled={uploading}
							onChange={(e) => handleFiles(takePickedFiles(e.target))}
							className="hidden"
						/>
					</label>
				) : null}
			</div>
			{autosaveStatus?.kind === "error" ? (
				<p role="alert" className="text-xs text-destructive">
					Couldn't save your photos ({autosaveStatus.message}). Tap Save changes
					to try again.
				</p>
			) : null}
		</div>
	);
}
