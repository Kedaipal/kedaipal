import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Info } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { convexErrorMessage } from "../../lib/format";
import { productDetailsSchema } from "../../lib/schemas";
import { variantLabel } from "../../lib/variant";
import { Button } from "../ui/button";
import { useAppForm } from "./form";
import {
	VariantEditor,
	type VariantEditorState,
	type VariantRow,
} from "./variant-editor";

const MAX_IMAGES = 5;

export interface ProductFormSubmitValues {
	name: string;
	description?: string;
	blockWhenOutOfStock: boolean;
	imageStorageIds: string[];
	options: { name: string; values: string[] }[];
	variants: {
		optionValues: string[];
		sku?: string;
		price: number;
		onHand: number;
		active: boolean;
		imageStorageIds: string[];
	}[];
}

interface ProductFormProps {
	initialValues?: {
		name?: string;
		description?: string;
		blockWhenOutOfStock?: boolean;
		imageStorageIds?: string[];
		imageUrls?: string[];
		options?: { name: string; values: string[] }[];
		variants?: {
			optionValues: string[];
			sku?: string;
			price: number;
			onHand: number;
			active?: boolean;
			imageStorageIds?: string[];
			imageUrls?: string[];
		}[];
	};
	currency: string;
	submitLabel: string;
	onSubmit: (values: ProductFormSubmitValues) => Promise<void>;
}

/** Seed the editor state from existing variants, or a single empty default row. */
function initialEditorState(
	initial: ProductFormProps["initialValues"],
): VariantEditorState {
	const options = initial?.options ?? [];
	const variants = initial?.variants;
	if (variants && variants.length > 0) {
		const rows: VariantRow[] = variants.map((vr) => ({
			optionValues: vr.optionValues,
			sku: vr.sku ?? "",
			price: (vr.price / 100).toFixed(2),
			stock: String(vr.onHand),
			active: vr.active ?? true,
			imageStorageIds: vr.imageStorageIds ?? [],
			imageUrl: vr.imageUrls?.[0],
		}));
		return { options, rows };
	}
	return {
		options: [],
		rows: [
			{
				optionValues: [],
				sku: "",
				price: "",
				stock: "",
				active: true,
				imageStorageIds: [],
			},
		],
	};
}

const PRICE_RE = /^\d+(\.\d{1,2})?$/;
const INT_RE = /^\d+$/;

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
	const [blockOOS, setBlockOOS] = useState(
		initialValues?.blockWhenOutOfStock ?? false,
	);
	const [editor, setEditor] = useState<VariantEditorState>(() =>
		initialEditorState(initialValues),
	);

	const form = useAppForm({
		defaultValues: {
			name: initialValues?.name ?? "",
			description: initialValues?.description ?? "",
		},
		validators: { onChange: productDetailsSchema },
		onSubmit: async ({ value }) => {
			setServerError(null);
			const parsed = productDetailsSchema.parse(value);

			// --- Client-side validation of options + the variant grid ----------
			const hasOptions = editor.options.length > 0;
			if (hasOptions) {
				for (const axis of editor.options) {
					if (axis.name.trim().length === 0) {
						setServerError("Every option needs a name.");
						return;
					}
					if (axis.values.length === 0) {
						setServerError(`Option "${axis.name}" needs at least one value.`);
						return;
					}
				}
			}

			const variants: ProductFormSubmitValues["variants"] = [];
			for (const row of editor.rows) {
				const label = variantLabel(row.optionValues) || "this product";
				if (!PRICE_RE.test(row.price.trim())) {
					setServerError(
						`Enter a valid price for ${label} (e.g. 120 or 120.50).`,
					);
					return;
				}
				if (!INT_RE.test(row.stock.trim())) {
					setServerError(`Enter a whole-number stock for ${label}.`);
					return;
				}
				variants.push({
					optionValues: row.optionValues,
					sku: row.sku.trim() || undefined,
					price: Math.round(Number.parseFloat(row.price) * 100),
					onHand: Number.parseInt(row.stock, 10),
					active: row.active,
					imageStorageIds: row.imageStorageIds,
				});
			}

			try {
				await onSubmit({
					name: parsed.name,
					description: parsed.description,
					blockWhenOutOfStock: blockOOS,
					imageStorageIds: images.map((i) => i.id),
					options: hasOptions
						? editor.options.map((a) => ({
								name: a.name.trim(),
								values: a.values,
							}))
						: [],
					variants,
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
			<form.AppField name="description">
				{(field) => (
					<field.TextareaField
						label="Description"
						placeholder="Optional. Supports markdown — use **bold**, lists, and headings for specs & what's included."
					/>
				)}
			</form.AppField>

			<div className="flex flex-col gap-1">
				<VariantEditor
					value={editor}
					onChange={setEditor}
					currency={currency}
					blockWhenOutOfStock={blockOOS}
				/>
				<Link
					to="/app/settings"
					search={{ tab: "store" }}
					className="inline-flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
				>
					<Info className="size-3.5" aria-hidden />
					Currency is set per store — change it in Settings.
				</Link>
			</div>

			<label className="flex items-start gap-2.5 rounded-xl border border-border p-3 text-sm">
				<input
					type="checkbox"
					checked={blockOOS}
					onChange={(e) => setBlockOOS(e.target.checked)}
					className="mt-0.5 size-4"
				/>
				<span>
					<span className="font-medium">Stop orders when out of stock</span>
					<span className="block text-xs text-muted-foreground">
						Leave off for made-to-order items (cakes, frozen packs) — buyers can
						still order at zero stock.
					</span>
				</span>
			</label>

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
