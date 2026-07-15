import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { convexErrorMessage } from "../../lib/format";
import { reorderByIds } from "../../lib/reorder";
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
}: {
	images: ProductImage[];
	onChange: (next: ProductImage[]) => void;
	/** Lets the parent disable its submit while an upload is in flight. */
	onUploadingChange?: (uploading: boolean) => void;
	onError: (message: string) => void;
}) {
	const generateUploadUrl = useMutation(api.products.generateUploadUrl);
	const [uploading, setUploadingState] = useState(false);

	function setUploading(next: boolean) {
		setUploadingState(next);
		onUploadingChange?.(next);
	}

	async function handleFiles(files: FileList | null) {
		if (!files || files.length === 0) return;
		if (images.length + files.length > MAX_IMAGES) {
			onError(`Maximum ${MAX_IMAGES} images per product`);
			return;
		}
		setUploading(true);
		try {
			const added: ProductImage[] = [];
			for (const file of Array.from(files)) {
				const url = await generateUploadUrl();
				const res = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": file.type },
					body: file,
				});
				if (!res.ok) throw new Error("Upload failed");
				const { storageId } = (await res.json()) as { storageId: string };
				added.push({ id: storageId, url: URL.createObjectURL(file) });
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
			<div className="flex items-center justify-between gap-3">
				<span className="text-sm font-medium">
					Product images{" "}
					<span className="text-muted-foreground">
						({images.length}/{MAX_IMAGES})
					</span>
				</span>
				{images.length > 1 ? (
					<p className="text-xs text-muted-foreground">Drag to reorder</p>
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
								{img.url ? (
									<img src={img.url} alt="" className="size-full object-cover" />
								) : null}
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
							accept="image/*"
							multiple
							disabled={uploading}
							onChange={(e) => handleFiles(e.target.files)}
							className="hidden"
						/>
					</label>
				) : null}
			</div>
		</div>
	);
}
