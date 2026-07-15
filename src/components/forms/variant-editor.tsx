import { useMutation } from "convex/react";
import {
	ChefHat,
	ChevronDown,
	ChevronUp,
	ImagePlus,
	Minus,
	PackageCheck,
	Plus,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { useRevealOnAdd } from "../../hooks/useRevealOnAdd";
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

/**
 * One submit-time validation problem, addressed to the exact input it belongs
 * to, so the editor can mark that input `aria-invalid` + show the message
 * beneath it (and the shared `focusFirstInvalidField` lands right on it) —
 * instead of a generic banner the seller has to decode. Produced by
 * `buildSubmitVariants` / `collectOptionIssues` in product-form.tsx.
 */
export type VariantIssue = {
	/** Which editor area: a grid/single row, an option axis, or the custom line. */
	where: "row" | "option" | "custom";
	/** Row index (rows), axis index (options); 0 for the custom line. */
	index: number;
	field: "price" | "stock" | "name" | "values";
	message: string;
};

interface VariantEditorProps {
	value: VariantEditorState;
	onChange: (next: VariantEditorState) => void;
	currency: string;
	/** Submit-time issues to render inline (cleared by the parent on any edit). */
	issues?: VariantIssue[];
}

/** Tiny inline error line under the offending input. */
function IssueText({ message }: { message: string | undefined }) {
	if (!message) return null;
	return (
		<span role="alert" className="text-xs font-normal text-destructive">
			{message}
		</span>
	);
}

function emptyRow(optionValues: string[]): VariantRow {
	return {
		optionValues,
		sku: "",
		price: "",
		stock: "",
		active: true,
		// Default to hard-block (the common case: real stock items). Made-to-order
		// is opt-out. Mockup approval is opt-in.
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
	// New combinations added to an existing grid inherit the first row's
	// fulfilment + approval flags — a made-to-order product must not silently
	// grow a stock-tracked row just because a value was added.
	const flagDonor = prev[0] ?? null;
	return cartesian(options).map((optionValues) => {
		const existing = byLabel.get(variantLabel(optionValues));
		if (existing) return existing;
		const base = emptyRow(optionValues);
		if (seed) {
			return {
				...base,
				price: seed.price,
				stock: seed.stock,
				blockWhenOutOfStock: seed.blockWhenOutOfStock,
				requiresProof: seed.requiresProof,
			};
		}
		if (flagDonor) {
			return {
				...base,
				blockWhenOutOfStock: flagDonor.blockWhenOutOfStock,
				requiresProof: flagDonor.requiresProof,
			};
		}
		return base;
	});
}

// Quick-start axis templates for the cohort (F&B + metal prints). Tapping one
// pre-fills a new axis name + common starter values that the seller then edits.
// Exported for the create wizard's "They choose by" chips.
export const AXIS_PRESETS: { name: string; values: string[] }[] = [
	{ name: "Size", values: ["Small", "Medium", "Large"] },
	{ name: "Weight", values: ["500g", "1kg"] },
	{ name: "Flavour", values: [] },
	{ name: "Pack", values: ["Single", "Box of 6", "Box of 12"] },
];

/** Price input with on-blur normalization (e.g. "120,5" → "120.50"). */
export function PriceInput({
	value,
	onChange,
	className,
	invalid = false,
}: {
	value: string;
	onChange: (next: string) => void;
	className?: string;
	invalid?: boolean;
}) {
	return (
		<Input
			inputMode="decimal"
			placeholder="0.00"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			onBlur={(e) => onChange(normalizePriceInput(e.target.value))}
			isError={invalid}
			className={className}
		/>
	);
}

/**
 * Integer stock input — strips non-digits as you type. `stepper` wraps it in
 * ±1 buttons (44px targets): after each sale a seller adjusts by one, not by
 * typing.
 */
export function StockInput({
	value,
	onChange,
	className,
	stepper = false,
	invalid = false,
}: {
	value: string;
	onChange: (next: string) => void;
	className?: string;
	stepper?: boolean;
	invalid?: boolean;
}) {
	if (!stepper) {
		return (
			<Input
				inputMode="numeric"
				placeholder="0"
				value={value}
				onChange={(e) => onChange(sanitizeIntInput(e.target.value))}
				isError={invalid}
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
				invalid &&
					"border-destructive ring-2 ring-destructive/20 focus-within:border-destructive",
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
				aria-invalid={invalid || undefined}
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
 * made-to-order. Compact — used for the per-choice override rows; the
 * product-level question is `PrepareQuestion` below.
 */
function FulfilmentToggle({
	value,
	onChange,
}: {
	value: boolean;
	onChange: (next: boolean) => void;
}) {
	const optionClass = (selected: boolean) =>
		cn(
			"flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
			selected
				? "border-accent bg-accent/10 text-foreground"
				: "border-border text-muted-foreground hover:border-accent/60",
		);
	return (
		<div className="grid grid-cols-2 gap-1.5">
			<button
				type="button"
				aria-pressed={value}
				onClick={() => onChange(true)}
				className={optionClass(value)}
			>
				<PackageCheck className="size-3.5" />
				Track stock
			</button>
			<button
				type="button"
				aria-pressed={!value}
				onClick={() => onChange(false)}
				className={optionClass(!value)}
			>
				<ChefHat className="size-3.5" />
				Made to order
			</button>
		</div>
	);
}

/**
 * The product-level "How do you prepare orders?" question — two answer cards
 * that apply to every choice at once. Mixed per-choice state (legacy or via the
 * override) leaves both unselected with a "varies per choice" note.
 */
function PrepareQuestion({
	allTrack,
	allMto,
	onPick,
}: {
	allTrack: boolean;
	allMto: boolean;
	onPick: (trackStock: boolean) => void;
}) {
	const cardClass = (selected: boolean) =>
		cn(
			"flex flex-1 flex-col gap-0.5 rounded-xl border p-3 text-left transition-colors",
			selected
				? "border-accent bg-accent/10"
				: "border-border hover:border-accent/60",
		);
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-sm font-medium">How do you prepare orders?</span>
			<div className="flex gap-2">
				<button
					type="button"
					aria-pressed={allMto}
					onClick={() => onPick(false)}
					className={cardClass(allMto)}
				>
					<span className="inline-flex items-center gap-1.5 text-sm font-semibold">
						<ChefHat className="size-4 text-accent-emphasis" aria-hidden />
						Made to order
					</span>
					<span className="text-xs text-muted-foreground">
						You make each order fresh. Never runs out — buyers can always order.
					</span>
				</button>
				<button
					type="button"
					aria-pressed={allTrack}
					onClick={() => onPick(true)}
					className={cardClass(allTrack)}
				>
					<span className="inline-flex items-center gap-1.5 text-sm font-semibold">
						<PackageCheck className="size-4 text-accent-emphasis" aria-hidden />
						From stock
					</span>
					<span className="text-xs text-muted-foreground">
						You have ready items. Orders stop automatically when stock hits
						zero.
					</span>
				</button>
			</div>
			{!allTrack && !allMto ? (
				<p className="text-xs text-muted-foreground">
					Currently varies per choice — pick a card to apply one setting to all,
					or adjust each choice below.
				</p>
			) : null}
		</div>
	);
}

/**
 * Mockup-approval opt-in. The field is `requiresProof`; copy is written so a
 * cake decorator recognises it as theirs. Product-level: checking applies to
 * every choice; a mixed per-choice state renders indeterminate.
 */
function MockupApprovalToggle({
	checked,
	indeterminate = false,
	onChange,
}: {
	checked: boolean;
	indeterminate?: boolean;
	onChange: (next: boolean) => void;
}) {
	return (
		<label className="flex items-start gap-2.5 text-sm">
			<input
				type="checkbox"
				checked={checked}
				ref={(el) => {
					if (el) el.indeterminate = indeterminate;
				}}
				onChange={(e) => onChange(e.target.checked)}
				className="mt-0.5 size-4 shrink-0"
			/>
			<span>
				<span className="font-medium">
					Require mockup approval before making it
				</span>
				<span className="block text-xs text-muted-foreground">
					The buyer signs off on a photo or mockup before you start — e.g. a
					cake decorator gets the design approved before baking. The order can't
					move to “packed” until they approve.
					{indeterminate
						? " Currently on for some choices only — set per choice below."
						: null}
				</span>
			</span>
		</label>
	);
}

export function VariantEditor({
	value,
	onChange,
	currency,
	issues = [],
}: VariantEditorProps) {
	const { options, rows, customLine } = value;
	const hasOptions = options.length > 0;
	// Submit-time issue lookup — the offending input renders aria-invalid with its
	// message beneath, so the seller (and focusFirstInvalidField) land on it.
	const issueFor = (
		where: VariantIssue["where"],
		index: number,
		field: VariantIssue["field"],
	): string | undefined =>
		issues.find(
			(x) => x.where === where && x.index === index && x.field === field,
		)?.message;
	const [valueDrafts, setValueDrafts] = useState<string[]>(() =>
		options.map(() => ""),
	);
	const generateUploadUrl = useMutation(api.products.generateUploadUrl);
	const [uploadingRow, setUploadingRow] = useState<number | null>(null);
	const [uploadingCustom, setUploadingCustom] = useState(false);
	// A newly added second axis appends inside Advanced — reveal + focus it.
	const { markAdded, revealRef } = useRevealOnAdd();

	// Product-level derivations for the two promoted questions.
	const allTrack = rows.length > 0 && rows.every((r) => r.blockWhenOutOfStock);
	const allMto = rows.length > 0 && rows.every((r) => !r.blockWhenOutOfStock);
	const allProof = rows.length > 0 && rows.every((r) => r.requiresProof);
	const someProof = rows.some((r) => r.requiresProof);
	// Per-choice fulfilment override — auto-open when the product already varies
	// (a legacy mixed product must never look uniform).
	const [varyFulfilment, setVaryFulfilment] = useState(
		() => hasOptions && !allTrack && !allMto,
	);
	// Advanced disclosure — collapsed by default (zero pixels for the common
	// case), forced open when it holds pre-existing config or a submit issue
	// points inside it.
	const [advOpen, setAdvOpen] = useState(
		() =>
			customLine !== null ||
			options.length > 1 ||
			someProof ||
			rows.some((r) => r.sku.trim().length > 0 || !r.active),
	);
	useEffect(() => {
		if (
			issues.some(
				(i) => i.where === "custom" || (i.where === "option" && i.index > 0),
			)
		) {
			setAdvOpen(true);
		}
	}, [issues]);

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

	// --- Mode switch (the "Does the buyer pick anything?" question) -----------
	function switchToChoices() {
		if (hasOptions) return;
		setOptions([{ name: "", values: [] }]);
		setValueDrafts([""]);
	}

	function switchToSingle() {
		if (!hasOptions) return;
		const hasTypedData = rows.some(
			(r) => r.price.trim().length > 0 || r.stock.trim().length > 0,
		);
		if (
			hasTypedData &&
			!window.confirm(
				"Switch to a single item? Your choices and their prices will be removed.",
			)
		) {
			return;
		}
		// Collapse to one row, carrying the first row's price/stock/flags so the
		// seller doesn't retype; per-choice SKU/image don't apply to a single item.
		const donor = rows[0] ?? emptyRow([]);
		update({
			options: [],
			rows: [
				{
					...donor,
					optionValues: [],
					sku: "",
					imageStorageIds: [],
					imageUrl: undefined,
					active: true,
				},
			],
		});
		setValueDrafts([]);
	}

	function addAxis() {
		if (options.length >= MAX_AXES) return;
		markAdded(String(options.length));
		setOptions([...options, { name: "", values: [] }]);
		setValueDrafts((d) => [...d, ""]);
	}

	function applyPresetToAxis(
		axisIndex: number,
		preset: { name: string; values: string[] },
	) {
		const axis = options[axisIndex];
		if (!axis) return;
		// Rename to the preset; seed its starter values only when the axis is
		// still empty (never clobber values the seller already typed).
		setOptions(
			options.map((a, i) =>
				i === axisIndex
					? {
							name: preset.name,
							values: a.values.length > 0 ? a.values : [...preset.values],
						}
					: a,
			),
		);
	}

	function addPresetAxis(preset: { name: string; values: string[] }) {
		if (options.length >= MAX_AXES) return;
		if (options.some((a) => a.name.toLowerCase() === preset.name.toLowerCase()))
			return;
		markAdded(String(options.length));
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

	function renderRowImage(i: number, row: VariantRow) {
		return row.imageUrl ? (
			<div className="relative size-10 shrink-0">
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
			<label className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:border-ring">
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

	/** Name + value chips for one option axis (used for the main axis inline and
	 * the second axis inside Advanced). */
	function renderAxisEditor(axisIndex: number, removable: boolean) {
		const axis = options[axisIndex];
		if (!axis) return null;
		return (
			<div
				ref={revealRef(String(axisIndex))}
				className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2.5"
			>
				<div className="flex items-center gap-2">
					<Input
						placeholder="Option name (e.g. Size)"
						value={axis.name}
						onChange={(e) => renameAxis(axisIndex, e.target.value)}
						isError={!!issueFor("option", axisIndex, "name")}
						className="h-10"
					/>
					{removable ? (
						<button
							type="button"
							onClick={() => removeAxis(axisIndex)}
							className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
							aria-label="Remove option"
						>
							<X className="size-4" />
						</button>
					) : null}
				</div>
				<IssueText message={issueFor("option", axisIndex, "name")} />
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
							isError={!!issueFor("option", axisIndex, "values")}
							onChange={(e) =>
								setValueDrafts((d) =>
									d.map((val, i) => (i === axisIndex ? e.target.value : val)),
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
				<IssueText message={issueFor("option", axisIndex, "values")} />
			</div>
		);
	}

	const advancedTeaser = hasOptions
		? "Design approval · custom option · a second choice · per-choice SKUs & photos"
		: "Design approval · custom option · SKU";

	return (
		<div className="flex flex-col gap-4">
			{/* Q1 — does the buyer pick anything? Drives the shape of everything
			    below: one price field vs a price per choice. */}
			<div className="flex flex-col gap-1.5">
				<span className="text-sm font-medium">Does the buyer pick anything?</span>
				<div className="flex gap-1 rounded-xl bg-muted p-1">
					<button
						type="button"
						aria-pressed={!hasOptions}
						onClick={switchToSingle}
						className={cn(
							"flex h-10 flex-1 items-center justify-center rounded-lg text-sm font-medium transition-colors",
							!hasOptions
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						Just one item
					</button>
					<button
						type="button"
						aria-pressed={hasOptions}
						onClick={switchToChoices}
						className={cn(
							"flex h-10 flex-1 items-center justify-center rounded-lg text-sm font-medium transition-colors",
							hasOptions
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						Buyer picks a choice
					</button>
				</div>
				<p className="text-xs text-muted-foreground">
					{hasOptions
						? "Each choice gets its own price below."
						: "One name, one price. Pick the other side for sizes, flavours or weights."}
				</p>
			</div>

			{/* Single-item mode: one price (+ stock only when tracking). */}
			{!hasOptions ? (
				<div className="grid grid-cols-2 gap-3">
					<label className="flex flex-col gap-1 text-sm font-medium">
						Price ({currency})
						<PriceInput
							value={rows[0]?.price ?? ""}
							onChange={(v) => setRow(0, { price: v })}
							invalid={!!issueFor("row", 0, "price")}
						/>
						<IssueText message={issueFor("row", 0, "price")} />
					</label>
					{rows[0]?.blockWhenOutOfStock ? (
						<label className="flex flex-col gap-1 text-sm font-medium">
							In stock now
							<StockInput
								value={rows[0]?.stock ?? ""}
								onChange={(v) => setRow(0, { stock: v })}
								stepper
								invalid={!!issueFor("row", 0, "stock")}
							/>
							<IssueText message={issueFor("row", 0, "stock")} />
						</label>
					) : null}
				</div>
			) : (
				<>
					{/* First axis — what the buyer chooses by. */}
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">They choose by</span>
							{variantCount > 0 ? (
								<span className="text-xs text-muted-foreground">
									{variantCount} choice{variantCount === 1 ? "" : "s"}
								</span>
							) : null}
						</div>
						<div className="flex flex-wrap items-center gap-1.5">
							{AXIS_PRESETS.map((preset) => {
								const selected =
									options[0]?.name.toLowerCase() === preset.name.toLowerCase();
								return (
									<button
										key={preset.name}
										type="button"
										onClick={() => applyPresetToAxis(0, preset)}
										className={cn(
											"rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
											selected
												? "border-accent bg-accent/10 text-accent-emphasis"
												: "border-border hover:border-accent",
										)}
									>
										{preset.name}
									</button>
								);
							})}
							<span className="text-xs text-muted-foreground">
								or type your own
							</span>
						</div>
						{renderAxisEditor(0, false)}
						{options[0]?.values.length === 0 ? (
							<p className="text-xs text-muted-foreground">
								Add the choices buyers pick from (e.g. Small, Medium, Large) —
								each gets its own price.
							</p>
						) : null}
					</div>

					{/* The choices & their prices. */}
					{rows.length > 0 ? (
						<div className="flex flex-col gap-2">
							<span className="text-sm font-medium">The choices & prices</span>
							{rows.length > 3 ? (
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
									{allTrack || (!allMto && rows.some((r) => r.blockWhenOutOfStock)) ? (
										<Input
											inputMode="numeric"
											placeholder="Fill all stock"
											className="h-9 text-xs"
											onChange={(e) =>
												bulkFill("stock", sanitizeIntInput(e.target.value))
											}
										/>
									) : null}
								</div>
							) : null}
							<ul className="flex flex-col gap-2">
								{rows.map((row, i) => (
									<li
										key={variantLabel(row.optionValues)}
										className={cn(
											"flex flex-col gap-2 rounded-xl border border-border p-3",
											!row.active && "opacity-60",
										)}
									>
										<div className="flex items-center gap-2">
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{variantLabel(row.optionValues)}
											</span>
											{!row.active ? (
												<span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
													Off — hidden from buyers
												</span>
											) : null}
										</div>
										<div className="grid grid-cols-2 gap-2">
											<label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
												Price ({currency})
												<PriceInput
													value={row.price}
													onChange={(v) => setRow(i, { price: v })}
													className="h-10"
													invalid={!!issueFor("row", i, "price")}
												/>
												<IssueText message={issueFor("row", i, "price")} />
											</label>
											{row.blockWhenOutOfStock ? (
												<label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
													In stock now
													<StockInput
														value={row.stock}
														onChange={(v) => setRow(i, { stock: v })}
														className="h-11"
														stepper
														invalid={!!issueFor("row", i, "stock")}
													/>
													<IssueText message={issueFor("row", i, "stock")} />
												</label>
											) : null}
										</div>
										{varyFulfilment ? (
											<FulfilmentToggle
												value={row.blockWhenOutOfStock}
												onChange={(v) =>
													setRow(i, { blockWhenOutOfStock: v })
												}
											/>
										) : null}
									</li>
								))}
							</ul>
						</div>
					) : null}
					{overCap ? (
						<p className="text-xs text-destructive">
							{variantCount} variants exceeds the max of {MAX_VARIANTS}. Remove
							some values.
						</p>
					) : null}
				</>
			)}

			{/* Q2 — how orders are prepared. Product-level answer applied to every
			    choice; "vary per choice" reveals the per-row override. Hidden until
			    a choices-mode product has its first row (nothing to apply to yet). */}
			{rows.length > 0 ? (
				<div className="flex flex-col gap-1.5 border-t border-border pt-3">
					<PrepareQuestion
						allTrack={allTrack}
						allMto={allMto}
						onPick={(trackStock) =>
							bulkFillFlag("blockWhenOutOfStock", trackStock)
						}
					/>
					{hasOptions && rows.length > 1 ? (
						varyFulfilment ? (
							<button
								type="button"
								onClick={() => {
									// Collapse back to one setting — majority wins.
									const trackCount = rows.filter(
										(r) => r.blockWhenOutOfStock,
									).length;
									bulkFillFlag(
										"blockWhenOutOfStock",
										trackCount >= rows.length - trackCount,
									);
									setVaryFulfilment(false);
								}}
								className="self-start text-xs font-semibold text-accent-emphasis hover:underline"
							>
								Use one setting for all choices
							</button>
						) : (
							<button
								type="button"
								onClick={() => setVaryFulfilment(true)}
								className="self-start text-xs font-semibold text-accent-emphasis hover:underline"
							>
								Vary per choice
							</button>
						)
					) : null}
				</div>
			) : null}

			{/* Advanced — everything the everyday seller never needs, present and
			    labelled (discoverability rule) but zero pixels until opened. */}
			<div className="rounded-xl border border-dashed border-border">
				<button
					type="button"
					onClick={() => setAdvOpen((v) => !v)}
					aria-expanded={advOpen}
					className="flex w-full items-center justify-between gap-3 p-3 text-left"
				>
					<span className="flex min-w-0 flex-col">
						<span className="text-sm font-semibold">Advanced</span>
						<span className="truncate text-xs text-muted-foreground">
							{advancedTeaser}
						</span>
					</span>
					{advOpen ? (
						<ChevronUp className="size-4 shrink-0 text-muted-foreground" />
					) : (
						<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
					)}
				</button>

				{advOpen ? (
					<div className="flex flex-col gap-4 border-t border-border p-3">
						<MockupApprovalToggle
							checked={allProof}
							indeterminate={someProof && !allProof}
							onChange={(v) => bulkFillFlag("requiresProof", v)}
						/>

						{/* Custom / made-to-order line — sits OUTSIDE the grid, so a
						    bespoke option shows up exactly once instead of multiplying
						    across every size/flavour. See docs/custom-option.md. */}
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
										A separate “Custom” line buyers can request — made to order,
										with a mockup they approve (and any quote you set) before
										paying. Kept out of the choices above, so it appears once.
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
													onChange={(e) =>
														void uploadCustomImage(e.target.files)
													}
													className="hidden"
												/>
											</label>
										)}
										<label className="flex flex-1 flex-col gap-1 text-sm font-medium">
											Option name
											<Input
												value={customLine.label}
												onChange={(e) =>
													setCustomLine({ label: e.target.value })
												}
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
											invalid={!!issueFor("custom", 0, "price")}
										/>
										<IssueText message={issueFor("custom", 0, "price")} />
										<span className="text-xs font-normal text-muted-foreground">
											Leave blank to show “Price on quote” — you set the price
											on the mockup after the order comes in.
										</span>
									</label>

									<label className="flex flex-col gap-1 text-sm font-medium">
										What should the buyer tell you?{" "}
										<span className="font-normal text-muted-foreground">
											(optional)
										</span>
										<textarea
											value={customLine.prompt}
											onChange={(e) =>
												setCustomLine({ prompt: e.target.value })
											}
											rows={2}
											maxLength={280}
											placeholder="e.g. Tell us your design, flavour, size & date needed"
											className="rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
										/>
									</label>

									<p className="text-xs text-muted-foreground">
										🧑‍🍳 Made to order · ✅ buyer approves a mockup before you
										start.
									</p>
								</div>
							) : null}
						</div>

						{/* Second axis (choices mode only) — Size × Flavour grids. */}
						{hasOptions ? (
							options.length > 1 ? (
								<div className="flex flex-col gap-2">
									<span className="text-sm font-medium">Second choice</span>
									{renderAxisEditor(1, true)}
								</div>
							) : (
								<div className="flex flex-col gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={addAxis}
										className="self-start"
									>
										<Plus className="size-4" />
										Add a second choice (e.g. Size × Flavour)
									</Button>
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="text-xs text-muted-foreground">
											Quick add:
										</span>
										{AXIS_PRESETS.map((preset) => {
											const used = options.some(
												(a) =>
													a.name.toLowerCase() === preset.name.toLowerCase(),
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
							)
						) : null}

						{/* Per-choice details: SKU, photo, on/off sale, per-choice
						    approval. Single-item mode gets just the SKU. */}
						{hasOptions && rows.length > 0 ? (
							<div className="flex flex-col gap-2">
								<span className="text-sm font-medium">Per-choice details</span>
								<ul className="flex flex-col gap-2">
									{rows.map((row, i) => (
										<li
											key={variantLabel(row.optionValues)}
											className={cn(
												"flex flex-col gap-2 rounded-lg bg-muted/40 p-2.5",
												!row.active && "opacity-60",
											)}
										>
											<div className="flex items-center gap-2.5">
												{renderRowImage(i, row)}
												<span className="min-w-0 flex-1 truncate text-sm font-medium">
													{variantLabel(row.optionValues)}
												</span>
												<Input
													placeholder="SKU"
													value={row.sku}
													onChange={(e) =>
														setRow(i, { sku: e.target.value })
													}
													className="h-9 w-28"
													aria-label={`SKU for ${variantLabel(row.optionValues)}`}
												/>
											</div>
											<div className="flex flex-wrap items-center gap-4 text-xs">
												<label className="flex items-center gap-1.5">
													<input
														type="checkbox"
														checked={row.active}
														onChange={(e) =>
															setRow(i, { active: e.target.checked })
														}
														className="size-4"
														aria-label={`${row.active ? "Deactivate" : "Activate"} ${variantLabel(row.optionValues)}`}
													/>
													On sale
												</label>
												<label className="flex items-center gap-1.5">
													<input
														type="checkbox"
														checked={row.requiresProof}
														onChange={(e) =>
															setRow(i, { requiresProof: e.target.checked })
														}
														className="size-4"
														aria-label={`Require mockup approval for ${variantLabel(row.optionValues)}`}
													/>
													Mockup approval
												</label>
											</div>
										</li>
									))}
								</ul>
							</div>
						) : null}
						{!hasOptions ? (
							<label className="flex flex-col gap-1 text-sm font-medium">
								SKU{" "}
								<span className="font-normal text-muted-foreground">
									(optional — your own item code)
								</span>
								<Input
									placeholder="ITEM-001"
									value={rows[0]?.sku ?? ""}
									onChange={(e) => setRow(0, { sku: e.target.value })}
								/>
							</label>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
