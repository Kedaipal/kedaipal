import { Link } from "@tanstack/react-router";
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
import type { Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage, parsePriceInput } from "../../lib/format";
import { describeProduct } from "../../lib/product-summary";
import { productDetailsSchema } from "../../lib/schemas";
import { Button } from "../ui/button";
import { Markdown } from "../ui/markdown";
import { CategoryPicker } from "./category-picker";
import { submitThenFocusError } from "./focus-error";
import { useAppForm } from "./form";
import { type ProductImage, ProductImagesField } from "./product-images-field";
import {
	type CustomLineDraft,
	VariantEditor,
	type VariantEditorState,
	type VariantIssue,
	type VariantRow,
} from "./variant-editor";

export interface ProductFormSubmitValues {
	name: string;
	description?: string;
	// Storefront visibility. true = hidden from the public store (still sellable
	// at the counter). See docs/hidden-products.md.
	hidden: boolean;
	// FULL category membership (the picker's staged selection) — the caller
	// diffs it via categories.setProductCategories. See docs/product-categories.md.
	categoryIds: Id<"categories">[];
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

/** Seed shape for the form — also produced by the wizard's open-in-full-editor
 * handoff (`wizardToFormInitialValues`). */
export type ProductFormInitialValues = NonNullable<
	ProductFormProps["initialValues"]
>;

interface ProductFormProps {
	/** Owning retailer — feeds the category picker's list query. */
	retailerId: Id<"retailers">;
	/** Client mirror of the `categories` plan gate: when true, the picker only
	 * allows deselection (server enforces the same add-gated rule). */
	categoriesLocked: boolean;
	initialValues?: {
		name?: string;
		description?: string;
		hidden?: boolean;
		categoryIds?: Id<"categories">[];
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

type SubmitVariant = ProductFormSubmitValues["variants"][number];

/**
 * Validate the option axes: every axis needs a name and at least one value.
 * Pure + exported for tests; issues are addressed to the exact axis input so
 * the editor marks it inline (no generic banner).
 */
export function collectOptionIssues(
	options: { name: string; values: string[] }[],
): VariantIssue[] {
	const issues: VariantIssue[] = [];
	options.forEach((axis, index) => {
		if (axis.name.trim().length === 0) {
			issues.push({
				where: "option",
				index,
				field: "name",
				message: "Give this option a name (e.g. Size).",
			});
		}
		if (axis.values.length === 0) {
			issues.push({
				where: "option",
				index,
				field: "values",
				message: "Add at least one value (e.g. Small).",
			});
		}
	});
	return issues;
}

/**
 * Turn the editor's grid rows + optional custom line into the submit payload,
 * validating active variants. Pure (no React/state) so the validation is unit
 * testable. Returns ALL validation issues — each addressed to the exact
 * row/field so the editor can mark that input inline and the shared
 * focus-first-error helper lands on it — or the built variant list.
 *
 * Stock rule: it only gates the save when the variant is tracking stock
 * (`blockWhenOutOfStock`). Made-to-order variants never run out — stock is just
 * a guide — so a blank/omitted value is fine and falls back to 0. Inactive
 * (deactivated) variants are hidden from buyers, so their price/stock never
 * block the save either (blank falls back to 0).
 */
export function buildSubmitVariants(
	rows: VariantRow[],
	customLine: CustomLineDraft | null,
): { issues: VariantIssue[] } | { variants: SubmitVariant[] } {
	const issues: VariantIssue[] = [];
	const variants: SubmitVariant[] = [];
	rows.forEach((row, index) => {
		// Price: any non-negative number; rounded to integer sen (2 dp).
		// parsePriceInput handles comma separators and rejects (rather than
		// silently truncating) anything non-numeric — see src/lib/format.ts.
		const priceNum = parsePriceInput(row.price.trim());
		const priceOk = priceNum !== null;
		const stockOk = INT_RE.test(row.stock.trim());
		if (row.active) {
			if (!priceOk) {
				issues.push({
					where: "row",
					index,
					field: "price",
					message:
						row.price.trim().length === 0
							? "Enter a price (e.g. 120 or 120.50)."
							: "Not a valid price — numbers only (e.g. 120 or 120.50).",
				});
			}
			if (row.blockWhenOutOfStock && !stockOk) {
				issues.push({
					where: "row",
					index,
					field: "stock",
					message: "Enter a whole-number stock (0 is fine).",
				});
			}
		}
		variants.push({
			optionValues: row.optionValues,
			sku: row.sku.trim() || undefined,
			price: priceOk ? Math.round(priceNum * 100) : 0,
			onHand: stockOk ? Number.parseInt(row.stock, 10) : 0,
			active: row.active,
			blockWhenOutOfStock: row.blockWhenOutOfStock,
			requiresProof: row.requiresProof,
			imageStorageIds: row.imageStorageIds,
		});
	});

	// Custom line (if enabled) — a flagged entry in the same array. Price is
	// optional: blank = "Price on quote" (0). The server coerces the made-to-
	// order + mockup flags and the default label.
	if (customLine) {
		const priceStr = customLine.price.trim();
		let customPrice = 0;
		if (priceStr.length > 0) {
			const n = parsePriceInput(priceStr);
			if (n === null) {
				issues.push({
					where: "custom",
					index: 0,
					field: "price",
					message:
						"Not a valid price — enter a number, or leave blank for price on quote.",
				});
			} else {
				customPrice = Math.round(n * 100);
			}
		}
		variants.push({
			optionValues: [],
			price: customPrice,
			onHand: 0,
			active: true,
			blockWhenOutOfStock: false,
			requiresProof: true,
			imageStorageIds: customLine.imageStorageIds,
			isCustom: true,
			customLabel: customLine.label.trim() || undefined,
			customPrompt: customLine.prompt.trim() || undefined,
		});
	}

	if (issues.length > 0) return { issues };
	return { variants };
}

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
 * Edit-mode summary strip — the product's selling setup in plain words
 * ("3 choices by Size · Made to order · RM 12–28"), live-derived from the
 * draft state so the seller confirms what they have before touching anything.
 */
function ProductSummaryStrip({
	name,
	editor,
	currency,
}: {
	name: string;
	editor: VariantEditorState;
	currency: string;
}) {
	const summary = describeProduct(
		{
			options: editor.options,
			rows: editor.rows,
			hasCustomLine: editor.customLine !== null,
		},
		currency,
	);
	return (
		<div className="rounded-2xl border border-accent/20 bg-accent/5 px-4 py-3 text-sm leading-relaxed">
			<span className="font-semibold text-accent-emphasis">
				{name.trim() || "This product"}
			</span>{" "}
			— {summary}
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
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<h4 className="text-sm font-semibold leading-tight">Visibility</h4>
				<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
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
		</div>
	);
}

export function ProductForm({
	retailerId,
	categoriesLocked,
	initialValues,
	currency,
	submitLabel,
	onSubmit,
	stickyAction,
}: ProductFormProps) {
	// Editing an existing product vs creating a new one — the edit page leads
	// with the summary strip; create keeps the readiness checklist.
	const isEdit = initialValues !== undefined;

	const [images, setImages] = useState<ProductImage[]>(
		(initialValues?.imageStorageIds ?? []).map((id, i) => ({
			id,
			url: initialValues?.imageUrls?.[i] ?? "",
		})),
	);
	const [uploading, setUploading] = useState(false);
	const [serverError, setServerError] = useState<string | null>(null);
	const [showPreview, setShowPreview] = useState(false);
	const [hidden, setHidden] = useState(initialValues?.hidden ?? false);
	const [categoryIds, setCategoryIds] = useState<Id<"categories">[]>(
		initialValues?.categoryIds ?? [],
	);
	const [editor, setEditorState] = useState<VariantEditorState>(() =>
		initialEditorState(initialValues),
	);
	// Submit-time validation issues, addressed to the exact editor input (see
	// VariantIssue). Any edit clears them — they re-validate on the next save.
	const [editorIssues, setEditorIssues] = useState<VariantIssue[]>([]);
	function setEditor(next: VariantEditorState) {
		setEditorState(next);
		setEditorIssues([]);
	}

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
			// Issues are addressed to the exact input (marked aria-invalid, message
			// beneath), so the shared focus helper lands on the offending field —
			// never a generic banner the seller has to decode.
			const hasOptions = editor.options.length > 0;
			const built = buildSubmitVariants(editor.rows, editor.customLine);
			const issues = [
				...collectOptionIssues(editor.options),
				...("issues" in built ? built.issues : []),
			];
			if (issues.length > 0) {
				setEditorIssues(issues);
				return;
			}
			// `issues` empty ⇒ built carries the variants.
			const variants = "variants" in built ? built.variants : [];

			try {
				await onSubmit({
					name: parsed.name,
					description: parsed.description,
					hidden,
					categoryIds,
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

	function handleSubmit(e: FormEvent) {
		submitThenFocusError(form, e);
	}

	const hasAnyPrice = editor.rows.some((row) => row.price.trim().length > 0);

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-5">
			{/* Lead-in: the edit page confirms what the product IS in words; the
			    create path shows what's still needed. */}
			<form.Subscribe selector={(s) => s.values.name}>
				{(name) =>
					isEdit ? (
						<ProductSummaryStrip
							name={name}
							editor={editor}
							currency={currency}
						/>
					) : (
						<ProductReadiness
							hasName={name.trim().length > 0}
							hasPrice={hasAnyPrice}
							imageCount={images.length}
						/>
					)
				}
			</form.Subscribe>

			<ProductStepCard
				icon={<PackageCheck className="size-5" />}
				kicker="The product"
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
				kicker="The product"
				title="Photos"
				description="Use the first image as the storefront cover. Extra images help shoppers compare angles, flavours, sizes, or packaging."
			>
				<ProductImagesField
					images={images}
					onChange={(next) => {
						setServerError(null);
						setImages(next);
					}}
					onUploadingChange={setUploading}
					onError={setServerError}
				/>
			</ProductStepCard>

			<ProductStepCard
				icon={<Layers3 className="size-5" />}
				kicker="Selling"
				title="Pricing & choices"
				description="One price for one item — or let buyers pick a size, flavour or weight, each with its own price."
			>
				<VariantEditor
					value={editor}
					onChange={setEditor}
					currency={currency}
					issues={editorIssues}
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

			{/* Publishing concerns — where the product appears — come after what
			    the product IS. See docs/product-setup-wizard.md. */}
			<ProductStepCard
				icon={<Store className="size-5" />}
				kicker="Publishing"
				title="Where it appears"
				description="Control storefront visibility and which categories the product shows under."
			>
				<VisibilityControl hidden={hidden} onChange={setHidden} />
				<div className="border-t border-border pt-4">
					<CategoryPicker
						retailerId={retailerId}
						selectedIds={categoryIds}
						onChange={setCategoryIds}
						locked={categoriesLocked}
						embedded
					/>
				</div>
			</ProductStepCard>

			{serverError ? (
				<p
					data-form-error
					role="alert"
					className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
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
