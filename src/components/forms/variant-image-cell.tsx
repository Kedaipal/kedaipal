import { useMutation } from "convex/react";
import { ImagePlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { convexErrorMessage } from "../../lib/format";
import { cn } from "../../lib/utils";
import { AppImage } from "../ui/app-image";

/**
 * Small square image cell for one variant / custom line — upload on tap,
 * ✕ to remove. Owns the upload round-trip (storage URL + POST + validation);
 * the parent owns the value and any blob-URL revocation on replace/remove.
 * Used by the wizard's per-choice details + custom option. (The variant
 * editor still carries its own inline copy — consolidation follow-up.)
 */
export function VariantImageCell({
	imageUrl,
	onUploaded,
	onRemove,
	size = "size-10",
	label = "image",
}: {
	imageUrl?: string;
	/** Called with the stored id + a local object-URL preview. */
	onUploaded: (storageId: string, previewUrl: string) => void;
	onRemove: () => void;
	size?: "size-10" | "size-14";
	/** Accessible naming: "photo for Small", "custom option photo"… */
	label?: string;
}) {
	const generateUploadUrl = useMutation(api.products.generateUploadUrl);
	const [uploading, setUploading] = useState(false);

	async function handleFile(files: FileList | null) {
		const file = files?.[0];
		if (!file) return;
		setUploading(true);
		try {
			const url = await generateUploadUrl();
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!res.ok) throw new Error("Upload failed");
			// Validate the response shape before trusting it — an error body would
			// otherwise store `undefined` as a storage id and surface server-side.
			const body = (await res.json()) as { storageId?: unknown };
			if (typeof body.storageId !== "string")
				throw new Error("Upload failed: unexpected response");
			onUploaded(body.storageId, URL.createObjectURL(file));
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setUploading(false);
		}
	}

	return imageUrl ? (
		<div className={cn("relative shrink-0", size)}>
			<AppImage src={imageUrl} alt="" aspect={size} rounded="rounded-lg" />
			<button
				type="button"
				onClick={onRemove}
				className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-background text-xs shadow ring-1 ring-border"
				aria-label={`Remove ${label}`}
			>
				<X className="size-3" />
			</button>
		</div>
	) : (
		<label
			className={cn(
				"flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:border-ring",
				size,
			)}
		>
			{uploading ? (
				<span className="text-[10px]">…</span>
			) : (
				<ImagePlus className="size-4" />
			)}
			<input
				type="file"
				accept="image/*"
				disabled={uploading}
				onChange={(e) => void handleFile(e.target.files)}
				className="hidden"
				aria-label={`Add ${label}`}
			/>
		</label>
	);
}
