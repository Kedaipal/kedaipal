import { useMutation } from "convex/react";
import { ChefHat, ImagePlus, Minus, PackageCheck, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
	convexErrorMessage,
	normalizePriceInput,
	sanitizeIntInput,
} from "../../lib/format";
import { cn } from "../../lib/utils";
import { cartesian, type OptionAxis, variantLabel } from "../../lib/variant";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

// Mirrors the server caps in convex/lib/variant.ts.
const MAX_AXES = 2;
const MAX_VARIANTS = 50;

export type VariantRow = {
	optionValues: string[];
	sku: string;
	/** Major-unit price string as typed (e.g. "120.50"). */
	price: string;
	/** Integer stock string as typed. */
	stock: string;
	/** Per-row deactivate — inactive variants are hidden from the storefront. */
	active: boolean;
	/** Hard-block: stop orders for this variant when it's out of stock. Off =
	 * made-to-order (price/stock are nominal, never runs out). */
	blockWhenOutOfStock: boolean;
	/** Orders containing this variant are gated on buyer mockup approval. */
	requiresProof: boolean;
	/** Stored Convex storage ids (0 or 1 for the grid). Submitted to the server. */
	imageStorageIds: string[];
	/** Preview URL only (object URL or existing image URL); not submitted. */
	imageUrl?: string;
};

/**
 * The optional custom / made-to-order line — one per product, edited outside the
 * variant grid (it's not part of the cartesian). Always made-to-order +
 * mockup-gated on save; see docs/custom-option.md.
 */
export type CustomLineDraft = {
	/** Buyer-facing name; blank falls back to "Custom" on save. */
	label: string;
	/** Major-unit price string. Blank = "Price on quote" (seller quotes on the mockup). */
	price: string;
	/** Optional guidance shown to the buyer ("Tell us your design, flavour & date"). */
	prompt: string;
	imageStorageIds: string[];
	imageUrl?: string;
};

export type VariantEditorState = {
	options: OptionAxis[];
	rows: VariantRow[];
	/** Null when the product offers no custom line. */
	customLine: CustomLineDraft | null;
};

interface VariantEditorProps {
	value: VariantEditorState;
	onChange: (next: VariantEditorState) => void;
	currency: string;
}

function emptyRow(optionValues: string[]): VariantRow {
	return {
		optionValues,
		sku: "",
		price: "",
		stock: "",
		active: true,
		// Default to hard-block (the common case: real stock items). Made-to-order
		// is opt-out per row. Mockup approval is opt-in.
		blockWhenOutOfStock: true,
		requiresProof: false,
		imageStorageIds: [],
	};
}

/**
 * Regenerate the variant grid from the option axes, preserving any price/stock/
 * sku/image/active the seller already typed for a surviving combination (keyed
 * by label). Zero axes → a single default row (optionValues: []).
 */
function rebuildRows(options: OptionAxis[], prev: VariantRow[]): VariantRow[] {
	const byLabel = new Map(prev.map((r) => [variantLabel(r.optionValues), r]));
	// When the seller adds their first axis, carry the price/stock they may have
	// already typed in single-variant mode into every generated row. SKU + image
	// stay per-row blank — those must be unique per variant.
	const seed =
		prev.length === 1 && prev[0].optionValues.length === 0 ? prev[0] : null;
	return cartesian(options).map((optionValues) => {
		const existing = byLabel.get(variantLabel(optionValues));
		if (existing) return existing;
		const base = emptyRow(optionValues);
		return seed
			? {
					...base,
					price: seed.price,
					stock: seed.stock,
					blockWhenOutOfStock: seed.blockWhenOutOfStock,
					requiresProof: seed.requiresProof,
				}
			: base;
	});
}

// Quick-start axis templates for the cohort (F&B + metal prints). Tapping one
// pre-fills a new axis name + common starter values that the seller then edits.
const AXIS_PRESETS: { name: string; values: string[] }[] = [
	{ name: "Size", values: ["Small", "Medium", "Large"] },
	{ name: "Weight", values: ["500g", "1kg"] },
	{ name: "Flavour", values: [] },
	{ name: "Pack", values: ["Single", "Box of 6", "Box of 12"] },
];

/** Price input with on-blur normalization (e.g. "120,5" → "120.50"). */
function PriceInput({
	value,
	onChange,
	className,
}: {
	value: string;
	onChange: (next: string) => void;
	className?: string;
}) {
	return (
		<Input
			inputMode="decimal"
			placeholder="0.00"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			onBlur={(e) => onChange(normalizePriceInput(e.target.value))}
			className={className}
		/>
	);
}

/**
 * Integer stock input — strips non-digits as you type. `stepper` wraps it in
 * ±1 buttons (44px targets): after each sale a seller adjusts by one, not by
 * typing. The compact desktop grid keeps the plain input (mouse + narrow cell).
 */
function StockInput({
	value,
	onChange,
	className,
	stepper = false,
}: {
	value: string;
	onChange: (next: string) => void;
	className?: string;
	stepper?: boolean;
}) {
	if (!stepper) {
		return (
			<Input
				inputMode="numeric"
				placeholder="0"
				value={value}
				onChange={(e) => onChange(sanitizeIntInput(e.target.value))}
				className={className}
			/>
		);
	}
	const num = /^\d+$/.test(value.trim())
		? Number.parseInt(value.trim(), 10)
		: 0;
	const step = (delta: number) => onChange(String(Math.max(0, num + delta)));
	return (
		<div
			className={cn(
				"flex h-11 items-center overflow-hidden rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50",
				className,
			)}
		>
			<button
				type="button"
				onClick={() => step(-1)}
				disabled={num <= 0}
				aria-label="Decrease stock"
				className="flex h-full w-11 shrink-0 items-center justify-center border-r border-border/60 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
			>
				<Minus className="size-4" aria-hidden="true" />
			</button>
			<input
				inputMode="numeric"
				placeholder="0"
				value={value}
				onChange={(e) => onChange(sanitizeIntInput(e.target.value))}
				className="h-full w-full min-w-0 flex-1 bg-transparent text-center text-[15px] font-semibold tabular-nums outline-none"
				aria-label="Stock on hand"
			/>
			<button
				type="button"
				onClick={() => step(1)}
				aria-label="Increase stock"
				className="flex h-full w-11 shrink-0 items-center justify-center border-l border-border/60 text-muted-foreground transition-colors hover:text-foreground"
			>
				<Plus className="size-4" aria-hidden="true" />
			</button>
		</div>
	);
}

/**
 * Fulfilment mode as a positive two-way choice instead of a "stop orders when
 * out of stock" checkbox (which read as a confusing double-negative). The
 * underlying field is still `blockWhenOutOfStock`: true = track stock, false =
 * made-to-order. `compact` drops the label + helper for the per-variant grid.
 */
function FulfilmentToggle({
	value,
	onChange,
	compact = false,
}: {
	value: boolean;
	onChange: (next: boolean) => void;
	compact?: boolean;
}) {
	const optionClass = (selected: boolean) =>
		cn(
			"flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors",
			compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm",
			selected
				? "border-accent bg-accent/10 text-foreground"
				: "border-border text-muted-foreground hover:border-accent/60",
		);
	return (
		<div className="flex flex-col gap-1.5">
			{compact ? null : <span className="text-sm font-medium">Fulfilment</span>}
			<div className="grid grid-cols-2 gap-1.5">
				<button
					type="button"
					aria-pressed={value}
					onClick={() => onChange(true)}
					className={optionClass(value)}
				>
					<PackageCheck className={compact ? "size-3.5" : "size-4"} />
					Track stock
				</button>
				<button
					type="button"
					aria-pressed={!value}
					onClick={() => onChange(false)}
					className={optionClass(!value)}
				>
					<ChefHat className={compact ? "size-3.5" : "size-4"} />
					Made to order
				</button>
			</div>
			{compact ? null : (
				<p className="text-xs text-muted-foreground">
					{value
						? "Orders stop automatically when stock reaches zero."
						: "Never runs out — stock is just a guide for you. Buyers can always order."}
				</p>
			)}
		</div>
	);
}

/**
 * Mockup-approval opt-in. The field is `requiresProof`; copy is written so a
 * cake decorator recognises it as theirs. `compact` drops the explainer for the
 * per-variant grid card.
 */
function MockupApprovalToggle({
	checked,
	onChange,
	compact = false,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	compact?: boolean;
}) {
	return (
		<label className="flex items-start gap-2.5 text-sm">
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				className="mt-0.5 size-4 shrink-0"
			/>
			<span>
				<span className="font-medium">
					Require mockup approval before making it
				</span>
				{compact ? null : (
					<span className="block text-xs text-muted-foreground">
						The buyer signs off on a photo or mockup before you start — e.g. a
						cake decorator gets the design approved before baking. The order
						can't move to “packed” until they approve.
					</span>
				)}
			</span>
		</label>
	);
}

export function VariantEditor({
	value,
	onChange,
	currency,
}: VariantEditorProps) {
	const { options, rows, customLine } = value;
	const hasOptions = options.length > 0;
	const [valueDrafts, setValueDrafts] = useState<string[]>([]);
	const generateUploadUrl = useMutation(api.products.generateUploadUrl);
	const [uploadingRow, setUploadingRow] = useState<number | null>(null);
	const [uploadingCustom, setUploadingCustom] = useState(false);

	// Merge a partial into the full editor state — preserves sibling fields
	// (notably `customLine`) that a given setter doesn't touch.
	function update(partial: Partial<VariantEditorState>) {
		onChange({ ...value, ...partial });
	}
	// Track blob: preview URLs so they're revoked on overwrite/remove/unmount
	// (createObjectURL pins the file in memory until revoked).
	const blobUrls = useRef<Set<string>>(new Set());
	useEffect(
		() => () => {
			for (const u of blobUrls.current) URL.revokeObjectURL(u);
		},
		[],
	);

	function revokeRowBlob(index: number) {
		const prev = rows[index]?.imageUrl;
		if (prev?.startsWith("blob:")) {
			URL.revokeObjectURL(prev);
			blobUrls.current.delete(prev);
		}
	}

	const variantCount = useMemo(() => cartesian(options).length, [options]);
	const overCap = variantCount > MAX_VARIANTS;

	function setOptions(nextOptions: OptionAxis[]) {
		update({ options: nextOptions, rows: rebuildRows(nextOptions, rows) });
	}

	function setRow(index: number, patch: Partial<VariantRow>) {
		update({
			rows: rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
		});
	}

	function addAxis() {
		if (options.length >= MAX_AXES) return;
		setOptions([...options, { name: "", values: [] }]);
		setValueDrafts((d) => [...d, ""]);
	}

	function addPresetAxis(preset: { name: string; values: string[] }) {
		if (options.length >= MAX_AXES) return;
		if (options.some((a) => a.name.toLowerCase() === preset.name.toLowerCase()))
			return;
		setOptions([...options, { name: preset.name, values: [...preset.values] }]);
		setValueDrafts((d) => [...d, ""]);
	}

	function removeAxis(axisIndex: number) {
		setOptions(options.filter((_, i) => i !== axisIndex));
		setValueDrafts((d) => d.filter((_, i) => i !== axisIndex));
	}

	function renameAxis(axisIndex: number, name: string) {
		setOptions(options.map((a, i) => (i === axisIndex ? { ...a, name } : a)));
	}

	function addValue(axisIndex: number) {
		const draft = (valueDrafts[axisIndex] ?? "").trim();
		if (!draft) return;
		const axis = options[axisIndex];
		if (axis.values.some((v) => v.toLowerCase() === draft.toLowerCase())) {
			setValueDrafts((d) => d.map((v, i) => (i === axisIndex ? "" : v)));
			return;
		}
		setOptions(
			options.map((a, i) =>
				i === axisIndex ? { ...a, values: [...a.values, draft] } : a,
			),
		);
		setValueDrafts((d) => d.map((v, i) => (i === axisIndex ? "" : v)));
	}

	function removeValue(axisIndex: number, value: string) {
		setOptions(
			options.map((a, i) =>
				i === axisIndex
					? { ...a, values: a.values.filter((v) => v !== value) }
					: a,
			),
		);
	}

	function bulkFill(field: "price" | "stock", v: string) {
		update({ rows: rows.map((r) => ({ ...r, [field]: v })) });
	}

	function bulkFillFlag(
		field: "blockWhenOutOfStock" | "requiresProof",
		v: boolean,
	) {
		update({ rows: rows.map((r) => ({ ...r, [field]: v })) });
	}

	// --- Custom line ---------------------------------------------------------
	function setCustomLine(patch: Partial<CustomLineDraft>) {
		if (!customLine) return;
		update({ customLine: { ...customLine, ...patch } });
	}

	function toggleCustomLine(enabled: boolean) {
		if (enabled) {
			update({
				customLine: { label: "", price: "", prompt: "", imageStorageIds: [] },
			});
		} else {
			if (customLine?.imageUrl?.startsWith("blob:")) {
				URL.revokeObjectURL(customLine.imageUrl);
				blobUrls.current.delete(customLine.imageUrl);
			}
			update({ customLine: null });
		}
	}

	async function uploadCustomImage(files: FileList | null) {
		if (!files || files.length === 0 || !customLine) return;
		const file = files[0];
		setUploadingCustom(true);
		try {
			const url = await generateUploadUrl();
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!res.ok) throw new Error("Upload failed");
			const body = (await res.json()) as { storageId?: unknown };
			if (typeof body.storageId !== "string")
				throw new Error("Upload failed: unexpected response");
			if (customLine.imageUrl?.startsWith("blob:")) {
				URL.revokeObjectURL(customLine.imageUrl);
				blobUrls.current.delete(customLine.imageUrl);
			}
			const previewUrl = URL.createObjectURL(file);
			blobUrls.current.add(previewUrl);
			setCustomLine({
				imageStorageIds: [body.storageId],
				imageUrl: previewUrl,
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setUploadingCustom(false);
		}
	}

	async function uploadRowImage(index: number, files: FileList | null) {
		if (!files || files.length === 0) return;
		const file = files[0];
		setUploadingRow(index);
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
			revokeRowBlob(index); // drop the previous preview before replacing
			const previewUrl = URL.createObjectURL(file);
			blobUrls.current.add(previewUrl);
			setRow(index, {
				imageStorageIds: [body.storageId],
				imageUrl: previewUrl,
			});
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setUploadingRow(null);
		}
	}

	// Shared image cell — used by both the mobile cards and the desktop table so
	// upload/remove behaviour stays single-sourced.
	function renderRowImage(i: number, row: VariantRow) {
		return row.imageUrl ? (
			<div className="relative size-10">
				<img
					src={row.imageUrl}
					alt=""
					className="size-10 rounded-lg object-cover"
				/>
				<button
					type="button"
					onClick={() => {
						revokeRowBlob(i);
						setRow(i, { imageStorageIds: [], imageUrl: undefined });
					}}
					className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-background text-xs shadow ring-1 ring-border"
					aria-label="Remove image"
				>
					<X className="size-3" />
				</button>
			</div>
		) : (
			<label className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:border-ring">
				{uploadingRow === i ? (
					<span className="text-[10px]">…</span>
				) : (
					<ImagePlus className="size-4" />
				)}
				<input
					type="file"
					accept="image/*"
					disabled={uploadingRow !== null}
					onChange={(e) => void uploadRowImage(i, e.target.files)}
					className="hidden"
				/>
			</label>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Single-variant mode: one price/stock/sku trio. */}
			{!hasOptions ? (
				<div className="grid grid-cols-2 gap-3">
					<label className="flex flex-col gap-1 text-sm font-medium">
						Price ({currency})
						<PriceInput
							value={rows[0]?.price ?? ""}
							onChange={(v) => setRow(0, { price: v })}
						/>
					</label>
					<label className="flex flex-col gap-1 text-sm font-medium">
						Stock
						<StockInput
							value={rows[0]?.stock ?? ""}
							onChange={(v) => setRow(0, { stock: v })}
							stepper
						/>
					</label>
					<label className="col-span-2 flex flex-col gap-1 text-sm font-medium">
						SKU{" "}
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
						<Input
							placeholder="ITEM-001"
							value={rows[0]?.sku ?? ""}
							onChange={(e) => setRow(0, { sku: e.target.value })}
						/>
					</label>
					<div className="col-span-2 flex flex-col gap-3 border-t border-border pt-3">
						<FulfilmentToggle
							value={rows[0]?.blockWhenOutOfStock ?? true}
							onChange={(v) => setRow(0, { blockWhenOutOfStock: v })}
						/>
						<MockupApprovalToggle
							checked={rows[0]?.requiresProof ?? false}
							onChange={(v) => setRow(0, { requiresProof: v })}
						/>
					</div>
				</div>
			) : null}

			{/* Axis builder */}
			<div className="flex flex-col gap-3 rounded-xl border border-border p-3">
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">Options</span>
					<span className="text-xs text-muted-foreground">
						{hasOptions
							? `${variantCount} variant${variantCount === 1 ? "" : "s"}`
							: "Add sizes, flavours, weights…"}
					</span>
				</div>

				{options.map((axis, axisIndex) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: axis identity is positional (no id; renaming must not remount)
						key={axisIndex}
						className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2.5"
					>
						<div className="flex items-center gap-2">
							<Input
								placeholder="Option name (e.g. Size)"
								value={axis.name}
								onChange={(e) => renameAxis(axisIndex, e.target.value)}
								className="h-10"
							/>
							<button
								type="button"
								onClick={() => removeAxis(axisIndex)}
								className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
								aria-label="Remove option"
							>
								<X className="size-4" />
							</button>
						</div>
						<div className="flex flex-wrap items-center gap-1.5">
							{axis.values.map((v) => (
								<span
									key={v}
									className="inline-flex items-center gap-1 rounded-full bg-background px-2.5 py-1 text-xs font-medium"
								>
									{v}
									<button
										type="button"
										onClick={() => removeValue(axisIndex, v)}
										aria-label={`Remove ${v}`}
									>
										<X className="size-3" />
									</button>
								</span>
							))}
							<div className="flex items-center gap-1">
								<Input
									placeholder="Add value"
									value={valueDrafts[axisIndex] ?? ""}
									onChange={(e) =>
										setValueDrafts((d) =>
											d.map((val, i) =>
												i === axisIndex ? e.target.value : val,
											),
										)
									}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === ",") {
											e.preventDefault();
											addValue(axisIndex);
										}
									}}
									// Commit on blur too: Android soft keyboards don't fire a
									// reliable Enter keydown (the key moves focus instead), so
									// losing focus is our cross-platform "lock it in" signal.
									// No-op on iOS/desktop where the draft is already cleared by
									// the keydown/button path.
									onBlur={() => addValue(axisIndex)}
									className="h-8 w-28 text-xs"
								/>
								<button
									type="button"
									onClick={() => addValue(axisIndex)}
									className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-accent"
									aria-label="Add value"
								>
									<Plus className="size-3.5" />
								</button>
							</div>
						</div>
					</div>
				))}

				{options.length < MAX_AXES ? (
					<div className="flex flex-col gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={addAxis}
							className="self-start"
						>
							<Plus className="size-4" />
							{hasOptions ? "Add another option" : "Add an option"}
						</Button>
						<div className="flex flex-wrap items-center gap-1.5">
							<span className="text-xs text-muted-foreground">Quick add:</span>
							{AXIS_PRESETS.map((preset) => {
								const used = options.some(
									(a) => a.name.toLowerCase() === preset.name.toLowerCase(),
								);
								return (
									<button
										key={preset.name}
										type="button"
										disabled={used}
										onClick={() => addPresetAxis(preset)}
										className="rounded-full border border-border px-2.5 py-1 text-xs font-medium hover:border-accent disabled:opacity-40"
									>
										+ {preset.name}
									</button>
								);
							})}
						</div>
					</div>
				) : null}
				{overCap ? (
					<p className="text-xs text-destructive">
						{variantCount} variants exceeds the max of {MAX_VARIANTS}. Remove
						some values.
					</p>
				) : null}
			</div>

			{/* Variant grid */}
			{hasOptions ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<Input
							inputMode="decimal"
							placeholder="Fill all prices"
							className="h-9 text-xs"
							onChange={(e) => bulkFill("price", e.target.value)}
							onBlur={(e) =>
								bulkFill("price", normalizePriceInput(e.target.value))
							}
						/>
						<Input
							inputMode="numeric"
							placeholder="Fill all stock"
							className="h-9 text-xs"
							onChange={(e) =>
								bulkFill("stock", sanitizeIntInput(e.target.value))
							}
						/>
					</div>
					{/* Apply a flag to every row at once — toggles set ALL rows. Labels
					    describe the action the tap performs (not the current state). */}
					<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						<span>Apply to all:</span>
						<button
							type="button"
							onClick={() =>
								bulkFillFlag(
									"blockWhenOutOfStock",
									!rows.every((r) => r.blockWhenOutOfStock),
								)
							}
							className="rounded-full border border-border px-2.5 py-1 font-medium hover:border-accent"
						>
							{rows.every((r) => r.blockWhenOutOfStock)
								? "Make all made-to-order"
								: "Track stock for all"}
						</button>
						<button
							type="button"
							onClick={() =>
								bulkFillFlag(
									"requiresProof",
									!rows.every((r) => r.requiresProof),
								)
							}
							className="rounded-full border border-border px-2.5 py-1 font-medium hover:border-accent"
						>
							{rows.every((r) => r.requiresProof)
								? "Remove approval from all"
								: "Require approval on all"}
						</button>
					</div>

					{/* One-time legend for the per-variant flags. The grid toggles are
					    compact (no inline helper) so the meaning lives here once, rather
					    than repeated under every card. Inline text (not a hover tooltip)
					    so it works on touch. */}
					<dl className="flex flex-col gap-1 rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
						<div className="flex gap-1.5">
							<dt className="inline-flex items-center gap-1 font-medium text-foreground">
								<PackageCheck className="size-3.5" />
								Track stock
							</dt>
							<dd>— orders stop automatically when that variant sells out.</dd>
						</div>
						<div className="flex gap-1.5">
							<dt className="inline-flex items-center gap-1 font-medium text-foreground">
								<ChefHat className="size-3.5" />
								Made to order
							</dt>
							<dd>— never runs out; you make each one on demand.</dd>
						</div>
						<div className="flex gap-1.5">
							<dt className="font-medium text-foreground">Approval</dt>
							<dd>
								— buyer signs off on a mockup before you start (e.g. a cake
								design); blocks the order until they approve.
							</dd>
						</div>
					</dl>

					{/* Mobile: stacked cards. An 8-column table is unreadable on a phone,
					    and sellers manage their catalog on mobile (mobile-first rule). */}
					<ul className="flex flex-col gap-2 sm:hidden">
						{rows.map((row, i) => (
							<li
								key={variantLabel(row.optionValues)}
								className={cn(
									"flex flex-col gap-3 rounded-xl border border-border p-3",
									!row.active && "opacity-60",
								)}
							>
								<div className="flex items-center gap-2.5">
									<input
										type="checkbox"
										checked={row.active}
										onChange={(e) => setRow(i, { active: e.target.checked })}
										className="size-4 shrink-0"
										aria-label={`${row.active ? "Deactivate" : "Activate"} ${variantLabel(row.optionValues)}`}
									/>
									<span className="min-w-0 flex-1 truncate text-sm font-medium">
										{variantLabel(row.optionValues)}
									</span>
									{renderRowImage(i, row)}
								</div>
								<div className="grid grid-cols-2 gap-2">
									<label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
										Price ({currency})
										<PriceInput
											value={row.price}
											onChange={(v) => setRow(i, { price: v })}
											className="h-10"
										/>
									</label>
									<label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
										Stock
										<StockInput
											value={row.stock}
											onChange={(v) => setRow(i, { stock: v })}
											className="h-11"
											stepper
										/>
									</label>
									<label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted-foreground">
										SKU (optional)
										<Input
											placeholder="ITEM-001"
											value={row.sku}
											onChange={(e) => setRow(i, { sku: e.target.value })}
											className="h-10"
										/>
									</label>
								</div>
								<div className="flex flex-col gap-2.5 border-t border-border pt-2.5">
									<FulfilmentToggle
										value={row.blockWhenOutOfStock}
										onChange={(v) => setRow(i, { blockWhenOutOfStock: v })}
										compact
									/>
									<MockupApprovalToggle
										checked={row.requiresProof}
										onChange={(v) => setRow(i, { requiresProof: v })}
										compact
									/>
								</div>
							</li>
						))}
					</ul>

					{/* Desktop: dense table for power-users editing up to 50 variants. */}
					<div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
						<table className="w-full text-sm">
							<thead className="bg-muted/50 text-left text-xs text-muted-foreground">
								<tr>
									<th className="p-2 font-medium">On</th>
									<th className="p-2 font-medium">Variant</th>
									<th className="p-2 font-medium">Img</th>
									<th className="p-2 font-medium">Price ({currency})</th>
									<th className="p-2 font-medium">Stock</th>
									<th className="p-2 font-medium">SKU</th>
									<th
										className="whitespace-nowrap p-2 font-medium"
										title="Checked = track stock and stop orders when sold out. Unchecked = made to order."
									>
										Track stock
									</th>
									<th
										className="p-2 font-medium"
										title="Require buyer mockup approval before production"
									>
										Approval
									</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row, i) => (
									<tr
										key={variantLabel(row.optionValues)}
										className={`border-t border-border ${row.active ? "" : "opacity-50"}`}
									>
										<td className="p-2">
											<input
												type="checkbox"
												checked={row.active}
												onChange={(e) =>
													setRow(i, { active: e.target.checked })
												}
												className="size-4"
												aria-label={`${row.active ? "Deactivate" : "Activate"} ${variantLabel(row.optionValues)}`}
											/>
										</td>
										<td className="whitespace-nowrap p-2 font-medium">
											{variantLabel(row.optionValues)}
										</td>
										<td className="p-2">{renderRowImage(i, row)}</td>
										<td className="p-2">
											<PriceInput
												value={row.price}
												onChange={(v) => setRow(i, { price: v })}
												className="h-9 w-24"
											/>
										</td>
										<td className="p-2">
											<StockInput
												value={row.stock}
												onChange={(v) => setRow(i, { stock: v })}
												className="h-9 w-20"
											/>
										</td>
										<td className="p-2">
											<Input
												placeholder="optional"
												value={row.sku}
												onChange={(e) => setRow(i, { sku: e.target.value })}
												className="h-9 w-28"
											/>
										</td>
										<td className="p-2 text-center">
											<input
												type="checkbox"
												checked={row.blockWhenOutOfStock}
												onChange={(e) =>
													setRow(i, { blockWhenOutOfStock: e.target.checked })
												}
												className="size-4"
												aria-label={`Track stock for ${variantLabel(row.optionValues)} (uncheck for made to order)`}
											/>
										</td>
										<td className="p-2 text-center">
											<input
												type="checkbox"
												checked={row.requiresProof}
												onChange={(e) =>
													setRow(i, { requiresProof: e.target.checked })
												}
												className="size-4"
												aria-label={`Require mockup approval for ${variantLabel(row.optionValues)}`}
											/>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			) : null}

			{/* Custom / made-to-order line — sits OUTSIDE the grid, so a bespoke
			    option shows up exactly once instead of multiplying across every
			    size/flavour. See docs/custom-option.md. */}
			<div className="flex flex-col gap-3 rounded-xl border border-border p-3">
				<label className="flex items-start gap-2.5 text-sm">
					<input
						type="checkbox"
						checked={customLine !== null}
						onChange={(e) => toggleCustomLine(e.target.checked)}
						className="mt-0.5 size-4 shrink-0"
					/>
					<span>
						<span className="font-medium">
							Also offer a custom / made-to-order option
						</span>
						<span className="block text-xs text-muted-foreground">
							A separate “Custom” line buyers can request — made to order, with
							a mockup they approve (and any quote you set) before paying. Kept
							out of the grid above, so it appears once.
						</span>
					</span>
				</label>

				{customLine ? (
					<div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
						<div className="flex items-start gap-3">
							{customLine.imageUrl ? (
								<div className="relative size-14 shrink-0">
									<img
										src={customLine.imageUrl}
										alt=""
										className="size-14 rounded-lg object-cover"
									/>
									<button
										type="button"
										onClick={() => {
											if (customLine.imageUrl?.startsWith("blob:")) {
												URL.revokeObjectURL(customLine.imageUrl);
												blobUrls.current.delete(customLine.imageUrl);
											}
											setCustomLine({
												imageStorageIds: [],
												imageUrl: undefined,
											});
										}}
										className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-background text-xs shadow ring-1 ring-border"
										aria-label="Remove custom image"
									>
										<X className="size-3" />
									</button>
								</div>
							) : (
								<label className="flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:border-ring">
									{uploadingCustom ? (
										<span className="text-[10px]">…</span>
									) : (
										<ImagePlus className="size-4" />
									)}
									<input
										type="file"
										accept="image/*"
										disabled={uploadingCustom}
										onChange={(e) => void uploadCustomImage(e.target.files)}
										className="hidden"
									/>
								</label>
							)}
							<label className="flex flex-1 flex-col gap-1 text-sm font-medium">
								Option name
								<Input
									value={customLine.label}
									onChange={(e) => setCustomLine({ label: e.target.value })}
									placeholder="Custom"
									maxLength={40}
								/>
							</label>
						</div>

						<label className="flex flex-col gap-1 text-sm font-medium">
							Starting price ({currency}){" "}
							<span className="font-normal text-muted-foreground">
								(optional)
							</span>
							<PriceInput
								value={customLine.price}
								onChange={(v) => setCustomLine({ price: v })}
							/>
							<span className="text-xs font-normal text-muted-foreground">
								Leave blank to show “Price on quote” — you set the price on the
								mockup after the order comes in.
							</span>
						</label>

						<label className="flex flex-col gap-1 text-sm font-medium">
							What should the buyer tell you?{" "}
							<span className="font-normal text-muted-foreground">
								(optional)
							</span>
							<textarea
								value={customLine.prompt}
								onChange={(e) => setCustomLine({ prompt: e.target.value })}
								rows={2}
								maxLength={280}
								placeholder="e.g. Tell us your design, flavour, size & date needed"
								className="rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
							/>
						</label>

						<p className="text-xs text-muted-foreground">
							🧑‍🍳 Made to order · ✅ buyer approves a mockup before you start.
						</p>
					</div>
				) : null}
			</div>
		</div>
	);
}
