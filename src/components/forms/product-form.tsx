import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Info } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { convexErrorMessage } from "../../lib/format";
import { productFormSchema } from "../../lib/schemas";
import { Button } from "../ui/button";
import { useAppForm } from "./form";

const MAX_IMAGES = 5;

export interface ProductFormSubmitValues {
	sku?: string;
	name: string;
	description?: string;
	price: number;
	stock: number;
	imageStorageIds: string[];
}

interface ProductFormProps {
	initialValues?: {
		sku?: string;
		name?: string;
		description?: string;
		price?: number; // minor units
		stock?: number;
		imageStorageIds?: string[];
		imageUrls?: string[];
	};
	currency: string;
	submitLabel: string;
	onSubmit: (values: ProductFormSubmitValues) => Promise<void>;
}

export function ProductForm({
	initialValues,
	currency,
	submitLabel,
	onSubmit,
}: ProductFormProps) {
	const generateUploadUrl = useMutation(api.products.generateUploadUrl);

	const [images, setImages] = useState<{ id: string; url: string }[]>(
		(initialValues?.imageStorageIds ?? []).map((id, i) => ({
			id,
			url: initialValues?.imageUrls?.[i] ?? "",
		})),
	);
	const [uploading, setUploading] = useState(false);
	const [serverError, setServerError] = useState<string | null>(null);

	const form = useAppForm({
		defaultValues: {
			sku: initialValues?.sku ?? "",
			name: initialValues?.name ?? "",
			description: initialValues?.description ?? "",
			price:
				initialValues?.price !== undefined
					? (initialValues.price / 100).toFixed(2)
					: "",
			stock:
				initialValues?.stock !== undefined ? String(initialValues.stock) : "",
		},
		validators: { onChange: productFormSchema },
		onSubmit: async ({ value }) => {
			setServerError(null);
			const parsed = productFormSchema.parse(value);
			try {
				await onSubmit({
					sku: parsed.sku,
					name: parsed.name,
					description: parsed.description,
					price: parsed.price,
					stock: parsed.stock,
					imageStorageIds: images.map((i) => i.id),
				});
			} catch (err) {
				setServerError(convexErrorMessage(err));
			}
		},
	});

	async function handleFiles(files: FileList | null) {
		if (!files || files.length === 0) return;
		if (images.length + files.length > MAX_IMAGES) {
			setServerError(`Maximum ${MAX_IMAGES} images per product`);
			return;
		}
		setServerError(null);
		setUploading(true);
		try {
			for (const file of Array.from(files)) {
				const url = await generateUploadUrl();
				const res = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": file.type },
					body: file,
				});
				if (!res.ok) throw new Error("Upload failed");
				const { storageId } = (await res.json()) as { storageId: string };
				const previewUrl = URL.createObjectURL(file);
				setImages((prev) => [...prev, { id: storageId, url: previewUrl }]);
			}
		} catch (err) {
			setServerError(convexErrorMessage(err));
		} finally {
			setUploading(false);
		}
	}

	function removeImage(id: string) {
		setImages((prev) => prev.filter((i) => i.id !== id));
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		e.stopPropagation();
		form.handleSubmit();
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<form.AppField name="name">
				{(field) => (
					<field.TextField
						label="Name"
						placeholder="e.g. Product name"
						required
					/>
				)}
			</form.AppField>
			<form.AppField name="sku">
				{(field) => (
					<field.TextField
						label="SKU"
						placeholder="e.g. ITEM-001"
						description="Optional. Stable identifier used by bulk export/import to match existing products."
					/>
				)}
			</form.AppField>
			<form.AppField name="description">
				{(field) => (
					<field.TextareaField
						label="Description"
						placeholder="Optional details shoppers should see"
					/>
				)}
			</form.AppField>
			<div className="flex flex-col gap-1">
				<form.AppField name="price">
					{(field) => (
						<field.TextField
							label={`Price (${currency})`}
							placeholder="120.00"
							type="text"
							inputMode="numeric"
							required
							description="Decimal number, e.g. 120 or 120.50."
						/>
					)}
				</form.AppField>
				<Link
					to="/app/settings"
					search={{ tab: "store" }}
					className="inline-flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
				>
					<Info className="size-3.5" aria-hidden />
					Currency is set per store — change it in Settings.
				</Link>
			</div>
			<form.AppField name="stock">
				{(field) => (
					<field.TextField
						label="Stock"
						placeholder="10"
						type="text"
						inputMode="numeric"
						required
					/>
				)}
			</form.AppField>

			<div className="flex flex-col gap-2">
				<span className="text-sm font-medium">
					Images{" "}
					<span className="text-muted-foreground">
						({images.length}/{MAX_IMAGES})
					</span>
				</span>
				<div className="grid grid-cols-3 gap-2">
					{images.map((img) => (
						<div
							key={img.id}
							className="relative aspect-square overflow-hidden rounded-xl bg-muted"
						>
							{img.url ? (
								<img src={img.url} alt="" className="size-full object-cover" />
							) : null}
							<button
								type="button"
								onClick={() => removeImage(img.id)}
								className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-background/90 text-sm shadow"
								aria-label="Remove image"
							>
								×
							</button>
						</div>
					))}
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

			<form.Subscribe
				selector={(s) => ({
					canSubmit: s.canSubmit,
					isSubmitting: s.isSubmitting,
				})}
			>
				{({ canSubmit, isSubmitting }) => (
					<Button
						type="submit"
						disabled={!canSubmit || isSubmitting || uploading}
						className="h-12"
					>
						{isSubmitting ? "Saving…" : submitLabel}
					</Button>
				)}
			</form.Subscribe>

			{serverError ? (
				<p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{serverError}
				</p>
			) : null}
		</form>
	);
}
