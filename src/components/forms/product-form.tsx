import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	Camera,
	CheckCircle2,
	Eye,
	EyeOff,
	Info,
	Layers3,
	PackageCheck,
	Save,
	Store,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { convexErrorMessage, parsePriceInput } from "../../lib/format";
import { reorderByIds } from "../../lib/reorder";
import { productDetailsSchema } from "../../lib/schemas";
import { variantLabel } from "../../lib/variant";
import { Button } from "../ui/button";
import { Markdown } from "../ui/markdown";
import { SortableList } from "../ui/sortable-list";
import { useAppForm } from "./form";
import {
	type CustomLineDraft,
	VariantEditor,
	type VariantEditorState,
	type VariantRow,
} from "./variant-editor";

const MAX_IMAGES = 5;

export interface ProductFormSubmitValues {
	name: string;
	description?: string;
	// Storefront visibility. true = hidden from the public store (still sellable
	// at the counter). See docs/hidden-products.md.
	hidden: boolean;
	imageStorageIds: string[];
	options: { name: string; values: string[] }[];
	variants: {
		optionValues: string[];
		sku?: string;
		price: number;
		onHand: number;
		active: boolean;
		blockWhenOutOfStock: boolean;
		requiresProof: boolean;
		imageStorageIds: string[];
		// The custom / made-to-order line is submitted as a flagged entry in this
		// same array (server splits matrix vs custom). See docs/custom-option.md.
		isCustom?: boolean;
		customLabel?: string;
		customPrompt?: string;
	}[];
}

interface ProductFormProps {
	initialValues?: {
		name?: string;
		description?: string;
		hidden?: boolean;
		// Deprecated product-level defaults — used only to seed per-variant flags
		// for legacy products whose variants predate the per-variant columns.
		blockWhenOutOfStock?: boolean;
		requiresProof?: boolean;
		imageStorageIds?: string[];
		imageUrls?: string[];
		options?: { name: string; values: string[] }[];
		variants?: {
			optionValues: string[];
			sku?: string;
			price: number;
			onHand: number;
			active?: boolean;
			blockWhenOutOfStock?: boolean;
			requiresProof?: boolean;
			imageStorageIds?: string[];
			imageUrls?: string[];
			isCustom?: boolean;
			customLabel?: string;
			customPrompt?: string;
		}[];
	};
	currency: string;
	submitLabel: string;
	onSubmit: (values: ProductFormSubmitValues) => Promise<void>;
	/**
	 * Optional secondary control rendered beside Save in the sticky action bar
	 * (e.g. the edit page's archive icon) — rare actions ride along without
	 * competing with the primary save.
	 */
	stickyAction?: ReactNode;
}

/** Seed the editor state from existing variants, or a single empty default row. */
function initialEditorState(
	initial: ProductFormProps["initialValues"],
): VariantEditorState {
	const options = initial?.options ?? [];
	const variants = initial?.variants;
	if (variants && variants.length > 0) {
		// Editing: preserve each variant's resolved flag exactly. The `?? product
		// ?? false` chain mirrors the old runtime (an unset flag meant made-to-order),
		// so opening a legacy product never silently flips it to hard-block.
		const blockFallback = initial?.blockWhenOutOfStock ?? false;
		const proofFallback = initial?.requiresProof ?? false;
		// The custom line lives outside the grid — pull it out so it doesn't become
		// a grid row, and seed the dedicated custom editor from it.
		const customVariant = variants.find((vr) => vr.isCustom);
		const rows: VariantRow[] = variants
			.filter((vr) => !vr.isCustom)
			.map((vr) => ({
				optionValues: vr.optionValues,
				sku: vr.sku ?? "",
				price: (vr.price / 100).toFixed(2),
				stock: String(vr.onHand),
				active: vr.active ?? true,
				blockWhenOutOfStock: vr.blockWhenOutOfStock ?? blockFallback,
				requiresProof: vr.requiresProof ?? proofFallback,
				imageStorageIds: vr.imageStorageIds ?? [],
				imageUrl: vr.imageUrls?.[0],
			}));
		const customLine: CustomLineDraft | null = customVariant
			? {
					label: customVariant.customLabel ?? "",
					// price 0 = "Price on quote" → show as blank in the editor.
					price:
						customVariant.price === 0
							? ""
							: (customVariant.price / 100).toFixed(2),
					prompt: customVariant.customPrompt ?? "",
					imageStorageIds: customVariant.imageStorageIds ?? [],
					imageUrl: customVariant.imageUrls?.[0],
				}
			: null;
		return { options, rows, customLine };
	}
	// Brand-new product: default the starting row to hard-block (the common case —
	// a real stock item). Made-to-order is an explicit per-row opt-out. No custom
	// line until the seller opts in.
	return {
		options: [],
		rows: [
			{
				optionValues: [],
				sku: "",
				price: "",
				stock: "",
				active: true,
				blockWhenOutOfStock: true,
				requiresProof: false,
				imageStorageIds: [],
			},
		],
		customLine: null,
	};
}

const INT_RE = /^\d+$/;

function ProductStepCard({
	icon,
	kicker,
	title,
	description,
	children,
}: {
	icon: ReactNode;
	kicker: string;
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
			<div className="flex gap-3 border-b border-border bg-muted/25 px-4 py-4 lg:px-5">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background text-accent ring-1 ring-border">
					{icon}
				</div>
				<div className="min-w-0">
					<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						{kicker}
					</p>
					<h3 className="text-base font-semibold leading-tight">{title}</h3>
					<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
						{description}
					</p>
				</div>
			</div>
			<div className="flex flex-col gap-4 p-4 lg:p-5">{children}</div>
		</section>
	);
}

function ProductReadiness({
	hasName,
	hasPrice,
	imageCount,
}: {
	hasName: boolean;
	hasPrice: boolean;
	imageCount: number;
}) {
	const checks = [
		{ label: "Product name", done: hasName },
		{ label: "Price ready", done: hasPrice },
		{
			label: imageCount > 0 ? `${imageCount} photo added` : "Photo optional",
			done: true,
		},
	];
	return (
		<div className="grid gap-2 rounded-2xl border border-accent/20 bg-accent/5 p-3 sm:grid-cols-3">
			{checks.map((check) => (
				<div
					key={check.label}
					className="flex items-center gap-2 rounded-xl bg-background/80 px-3 py-2 text-sm"
				>
					<CheckCircle2
						className={`size-4 shrink-0 ${
							check.done ? "text-accent" : "text-muted-foreground"
						}`}
					/>
					<span
						className={
							check.done
								? "font-medium text-foreground"
								: "text-muted-foreground"
						}
					>
						{check.label}
					</span>
				</div>
			))}
		</div>
	);
}

/**
 * Product-level storefront visibility. A first-class status (not a buried
 * toggle) because it changes where the product appears. Hidden products stay
 * fully sellable in counter checkout — surfaced in the helper so the behaviour
 * is never a surprise. See docs/hidden-products.md.
 */
function VisibilityControl({
	hidden,
	onChange,
}: {
	hidden: boolean;
	onChange: (hidden: boolean) => void;
}) {
	const options = [
		{
			value: false,
			label: "Visible",
			icon: <Store className="size-4" aria-hidden />,
		},
		{
			value: true,
			label: "Hidden",
			icon: <EyeOff className="size-4" aria-hidden />,
		},
	];
	return (
		<section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between lg:p-5">
			<div className="min-w-0">
				<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
					Storefront
				</p>
				<h3 className="text-base font-semibold leading-tight">Visibility</h3>
				<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
					{hidden
						? "Hidden from your public store. Still sellable in counter checkout."
						: "Shown on your public store and sellable everywhere."}
				</p>
			</div>
			<div className="flex shrink-0 gap-1 rounded-xl bg-muted p-1">
				{options.map((opt) => {
					const selected = opt.value === hidden;
					return (
						<button
							key={opt.label}
							type="button"
							aria-pressed={selected}
							onClick={() => onChange(opt.value)}
							className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
								selected
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							{opt.icon}
							{opt.label}
						</button>
					);
				})}
			</div>
		</section>
	);
}

export function ProductForm({
	initialValues,
	currency,
	submitLabel,
	onSubmit,
	stickyAction,
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
	const [showPreview, setShowPreview] = useState(false);
	const [hidden, setHidden] = useState(initialValues?.hidden ?? false);
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
				// Price: any non-negative number; rounded to integer sen (2 dp).
				// parsePriceInput handles comma separators and rejects (rather than
				// silently truncating) anything non-numeric — see src/lib/format.ts.
				const priceStr = row.price.trim();
				const priceNum = parsePriceInput(priceStr);
				const priceOk = priceNum !== null;
				const stockOk = INT_RE.test(row.stock.trim());
				// Inactive (deactivated) variants are hidden from buyers, so don't
				// block the whole save on their price/stock — just fall back to 0 for
				// any blank/invalid field. Active variants must be fully valid.
				if (row.active) {
					if (!priceOk) {
						setServerError(
							`Enter a valid price for ${label} (e.g. 120 or 120.50).`,
						);
						return;
					}
					if (!stockOk) {
						setServerError(`Enter a whole-number stock for ${label}.`);
						return;
					}
				}
				variants.push({
					optionValues: row.optionValues,
					sku: row.sku.trim() || undefined,
					price: priceNum !== null ? Math.round(priceNum * 100) : 0,
					onHand: stockOk ? Number.parseInt(row.stock, 10) : 0,
					active: row.active,
					blockWhenOutOfStock: row.blockWhenOutOfStock,
					requiresProof: row.requiresProof,
					imageStorageIds: row.imageStorageIds,
				});
			}

			// Custom line (if enabled) — a flagged entry in the same array. Price is
			// optional: blank = "Price on quote" (0). The server coerces the made-to-
			// order + mockup flags and the default label.
			if (editor.customLine) {
				const cl = editor.customLine;
				const priceStr = cl.price.trim();
				let customPrice = 0;
				if (priceStr.length > 0) {
					const n = parsePriceInput(priceStr);
					if (n === null) {
						setServerError(
							"Enter a valid starting price for the custom option, or leave it blank for price on quote.",
						);
						return;
					}
					customPrice = Math.round(n * 100);
				}
				variants.push({
					optionValues: [],
					price: customPrice,
					onHand: 0,
					active: true,
					blockWhenOutOfStock: false,
					requiresProof: true,
					imageStorageIds: cl.imageStorageIds,
					isCustom: true,
					customLabel: cl.label.trim() || undefined,
					customPrompt: cl.prompt.trim() || undefined,
				});
			}

			try {
				await onSubmit({
					name: parsed.name,
					description: parsed.description,
					hidden,
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

	function reorderImages(orderedIds: string[]) {
		setImages((prev) => reorderByIds(prev, orderedIds, (img) => img.id));
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		e.stopPropagation();
		form.handleSubmit();
	}

	const hasAnyPrice = editor.rows.some((row) => row.price.trim().length > 0);

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-5">
			<form.Subscribe selector={(s) => s.values.name.trim().length > 0}>
				{(hasName) => (
					<ProductReadiness
						hasName={hasName}
						hasPrice={hasAnyPrice}
						imageCount={images.length}
					/>
				)}
			</form.Subscribe>

			<VisibilityControl hidden={hidden} onChange={setHidden} />

			<ProductStepCard
				icon={<PackageCheck className="size-5" />}
				kicker="Step 1"
				title="Product basics"
				description="Start with the name shoppers will recognise, then add a short description only if it helps them decide."
			>
				<form.AppField name="name">
					{(field) => (
						<field.TextField
							label="Name"
							placeholder="e.g. Chocolate fudge brownies"
							required
						/>
					)}
				</form.AppField>
				<div className="flex flex-col gap-1.5">
					<form.AppField name="description">
						{(field) => (
							<field.TextareaField
								label="Description"
								placeholder="Optional. Use **bold**, - bullet lists, and ## headings for specs & what's included."
								description="Formatting supported — buyers see it rendered on your storefront."
								maxLength={1000}
							/>
						)}
					</form.AppField>
					<form.Subscribe selector={(s) => s.values.description ?? ""}>
						{(desc) => {
							const trimmed = desc.trim();
							return (
								<div className="flex flex-col gap-1.5">
									<button
										type="button"
										onClick={() => setShowPreview((v) => !v)}
										disabled={trimmed.length === 0}
										className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
									>
										<Eye className="size-3.5" aria-hidden />
										{showPreview ? "Hide preview" : "Preview formatting"}
									</button>
									{showPreview && trimmed.length > 0 ? (
										<div className="rounded-xl border border-border bg-muted/30 p-3">
											<Markdown>{desc}</Markdown>
										</div>
									) : null}
								</div>
							);
						}}
					</form.Subscribe>
				</div>
			</ProductStepCard>

			<ProductStepCard
				icon={<Camera className="size-5" />}
				kicker="Step 2"
				title="Photos"
				description="Use the first image as the storefront cover. Extra images help shoppers compare angles, flavours, sizes, or packaging."
			>
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
							onReorder={reorderImages}
							strategy="grid"
							className="contents"
							renderItem={(img, handle) => (
								<div className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted">
									{img.url ? (
										<img
											src={img.url}
											alt=""
											className="size-full object-cover"
										/>
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
										onClick={() => removeImage(img.id)}
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
			</ProductStepCard>

			<ProductStepCard
				icon={<Layers3 className="size-5" />}
				kicker="Step 3"
				title="Price, stock and options"
				description="Keep it simple for one product, or add sizes, flavours, weights, and made-to-order choices when buyers need to choose."
			>
				<VariantEditor
					value={editor}
					onChange={setEditor}
					currency={currency}
				/>
				<Link
					to="/app/settings"
					search={{ tab: "store" }}
					className="inline-flex items-center gap-1.5 self-start rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
				>
					<Info className="size-3.5" aria-hidden />
					Currency is set in Settings
				</Link>
			</ProductStepCard>

			{serverError ? (
				<p className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{serverError}
				</p>
			) : null}

			{/* Sticky action bar — on a long form, save must never scroll away.
			    Rare actions (archive) sit beside it as a quiet icon. */}
			<form.Subscribe
				selector={(s) => ({
					canSubmit: s.canSubmit,
					isSubmitting: s.isSubmitting,
				})}
			>
				{({ canSubmit, isSubmitting }) => (
					<div className="sticky bottom-20 z-10 flex gap-2 lg:static">
						{stickyAction}
						<Button
							type="submit"
							disabled={!canSubmit || isSubmitting || uploading}
							className="h-12 flex-1 shadow-lg shadow-accent/20 lg:shadow-none"
						>
							<Save className="size-4" />
							{isSubmitting ? "Saving…" : submitLabel}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}
