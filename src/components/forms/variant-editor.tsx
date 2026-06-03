import { useMutation } from "convex/react";
import { ImagePlus, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
	convexErrorMessage,
	normalizePriceInput,
	sanitizeIntInput,
} from "../../lib/format";
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
	/** Stored Convex storage ids (0 or 1 for the grid). Submitted to the server. */
	imageStorageIds: string[];
	/** Preview URL only (object URL or existing image URL); not submitted. */
	imageUrl?: string;
};

export type VariantEditorState = {
	options: OptionAxis[];
	rows: VariantRow[];
};

interface VariantEditorProps {
	value: VariantEditorState;
	onChange: (next: VariantEditorState) => void;
	currency: string;
	/** When false, made-to-order — stock columns are de-emphasised. */
	blockWhenOutOfStock: boolean;
}

function emptyRow(optionValues: string[]): VariantRow {
	return {
		optionValues,
		sku: "",
		price: "",
		stock: "",
		active: true,
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
		return seed ? { ...base, price: seed.price, stock: seed.stock } : base;
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

export function VariantEditor({
	value,
	onChange,
	currency,
	blockWhenOutOfStock,
}: VariantEditorProps) {
	const { options, rows } = value;
	const hasOptions = options.length > 0;
	const [valueDrafts, setValueDrafts] = useState<string[]>([]);
	const generateUploadUrl = useMutation(api.products.generateUploadUrl);
	const [uploadingRow, setUploadingRow] = useState<number | null>(null);
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
		onChange({ options: nextOptions, rows: rebuildRows(nextOptions, rows) });
	}

	function setRow(index: number, patch: Partial<VariantRow>) {
		onChange({
			options,
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
		onChange({ options, rows: rows.map((r) => ({ ...r, [field]: v })) });
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

	return (
		<div className="flex flex-col gap-4">
			{/* Single-variant mode: one price/stock/sku trio. */}
			{!hasOptions ? (
				<div className="grid grid-cols-2 gap-3">
					<label className="flex flex-col gap-1 text-sm font-medium">
						Price ({currency})
						<Input
							inputMode="decimal"
							placeholder="120.00"
							value={rows[0]?.price ?? ""}
							onChange={(e) => setRow(0, { price: e.target.value })}
							onBlur={(e) =>
								setRow(0, { price: normalizePriceInput(e.target.value) })
							}
						/>
					</label>
					<label className="flex flex-col gap-1 text-sm font-medium">
						Stock
						<Input
							inputMode="numeric"
							placeholder="10"
							value={rows[0]?.stock ?? ""}
							onChange={(e) =>
								setRow(0, { stock: sanitizeIntInput(e.target.value) })
							}
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
					<div className="overflow-x-auto rounded-xl border border-border">
						<table className="w-full text-sm">
							<thead className="bg-muted/50 text-left text-xs text-muted-foreground">
								<tr>
									<th className="p-2 font-medium">On</th>
									<th className="p-2 font-medium">Variant</th>
									<th className="p-2 font-medium">Img</th>
									<th className="p-2 font-medium">Price ({currency})</th>
									<th
										className={`p-2 font-medium ${blockWhenOutOfStock ? "" : "text-muted-foreground/50"}`}
									>
										Stock
									</th>
									<th className="p-2 font-medium">SKU</th>
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
										<td className="p-2">
											{row.imageUrl ? (
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
															setRow(i, {
																imageStorageIds: [],
																imageUrl: undefined,
															});
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
														onChange={(e) =>
															void uploadRowImage(i, e.target.files)
														}
														className="hidden"
													/>
												</label>
											)}
										</td>
										<td className="p-2">
											<Input
												inputMode="decimal"
												placeholder="0.00"
												value={row.price}
												onChange={(e) => setRow(i, { price: e.target.value })}
												onBlur={(e) =>
													setRow(i, {
														price: normalizePriceInput(e.target.value),
													})
												}
												className="h-9 w-24"
											/>
										</td>
										<td className="p-2">
											<Input
												inputMode="numeric"
												placeholder="0"
												value={row.stock}
												onChange={(e) =>
													setRow(i, { stock: sanitizeIntInput(e.target.value) })
												}
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
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			) : null}
		</div>
	);
}
