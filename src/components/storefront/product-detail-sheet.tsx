import { Minus, Plus, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { formatPrice } from "../../lib/format";
import {
	availableValuesPerAxis,
	getCustomLine,
	isSellable,
	resolveVariant,
} from "../../lib/variant";
import { Button } from "../ui/button";
import { Markdown } from "../ui/markdown";
import { ZoomableImage } from "../ui/zoomable-image";
import type { StorefrontProduct } from "./product-card";

export type StorefrontVariant = StorefrontProduct["variants"][number];

interface ProductDetailSheetProps {
	product: StorefrontProduct | null;
	onClose: () => void;
	onAdd: (
		product: StorefrontProduct,
		variant: StorefrontVariant,
		quantity: number,
		// Buyer's request, for the custom line (their size/colour/design spec).
		note?: string,
	) => void;
}

export function ProductDetailSheet({
	product,
	onClose,
	onAdd,
}: ProductDetailSheetProps) {
	const [quantity, setQuantity] = useState(1);
	// Per-axis selection, aligned to product.options; null = not yet chosen.
	const [selection, setSelection] = useState<(string | null)[]>([]);
	// Buyer's free-text request for the custom line (their spec).
	const [customNote, setCustomNote] = useState("");

	const options = product?.options ?? [];
	const variants = product?.variants ?? [];

	// Reset selection + quantity whenever a new product opens. Axes with a single
	// value auto-select (one less tap); the implicit default variant resolves
	// immediately when there are no axes.
	useEffect(() => {
		if (!product) return;
		setQuantity(1);
		setCustomNote("");
		setSelection(
			(product.options ?? []).map((axis) =>
				axis.values.length === 1 ? axis.values[0] : null,
			),
		);
	}, [product]);

	const availability = useMemo(
		() => availableValuesPerAxis(options, variants, selection),
		[options, variants, selection],
	);

	const selectedVariant = useMemo(
		() => resolveVariant(variants, selection),
		[variants, selection],
	);
	const customLine = useMemo(() => getCustomLine(variants), [variants]);

	const open = product !== null;
	if (!product) {
		// Keep the dialog mounted (radix needs a stable root) but render nothing.
		return <Dialog.Root open={false} onOpenChange={(o) => !o && onClose()} />;
	}

	// The bottom bar reflects the STANDARD variant (the axis selection). The custom
	// line is an INDEPENDENT add with its own button (see the custom card below) —
	// the two aren't mutually exclusive, so a buyer can add both in one visit.
	const sellable = selectedVariant ? isSellable(selectedVariant) : false;
	// The selected variant's resolved hard-block flag drives stock-bounded qty + the
	// stock hint. Made-to-order variants are unbounded (made on demand).
	const variantBlocks = selectedVariant?.blockWhenOutOfStock === true;
	const hasOptions = options.length > 0;
	// Gallery + price fall back to the product hero when the variant has none.
	const images =
		selectedVariant && selectedVariant.imageUrls.length > 0
			? selectedVariant.imageUrls
			: product.imageUrls;
	const maxQty = selectedVariant
		? variantBlocks
			? Math.max(1, selectedVariant.onHand)
			: 99
		: 1;

	function toggle(axisIndex: number, value: string) {
		setSelection((prev) => {
			const next = [...prev];
			next[axisIndex] = prev[axisIndex] === value ? null : value;
			return next;
		});
		setQuantity(1);
	}

	const priceVaries = product.priceTo > product.priceFrom;
	// A selected made-to-order variant at RM0 shows "Price on quote" — the seller
	// sets the real price on the mockup after the order is placed.
	const selectedIsQuote =
		selectedVariant?.requiresProof === true && selectedVariant.price === 0;
	const priceLabel = selectedVariant
		? selectedIsQuote
			? "Price on quote"
			: formatPrice(selectedVariant.price, product.currency)
		: product.hasQuotePricing && product.priceTo === 0
			? "Price on quote"
			: priceVaries || product.hasQuotePricing
				? `from ${formatPrice(product.priceFrom, product.currency)}`
				: formatPrice(product.priceFrom, product.currency);

	// Custom line's own price label (independent of the standard selection).
	const customPriceLabel =
		customLine && customLine.price > 0
			? `from ${formatPrice(customLine.price, product.currency)}`
			: "Price on quote";

	return (
		<Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
				<Dialog.Content
					className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-3xl border-t border-border bg-background shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom"
					aria-describedby={undefined}
				>
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<Dialog.Title className="text-base font-semibold">
							Product details
						</Dialog.Title>
						<Dialog.Close asChild>
							<button
								type="button"
								className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
								aria-label="Close"
							>
								<X className="size-5" />
							</button>
						</Dialog.Close>
					</div>

					<div className="flex-1 overflow-y-auto px-5 py-4">
						{images.length > 0 ? (
							<div className="-mx-5 mb-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5">
								{images.map((url) => (
									<ZoomableImage
										key={url}
										src={url}
										alt={product.name}
										caption={product.name}
										wrapperClassName="w-64 shrink-0 snap-start"
										className="aspect-square w-full rounded-2xl object-cover"
									/>
								))}
							</div>
						) : (
							<div className="mb-4 flex aspect-square w-full items-center justify-center rounded-2xl bg-muted text-sm text-muted-foreground">
								No image
							</div>
						)}

						<h2 className="text-xl font-bold leading-tight">{product.name}</h2>
						<p className="mt-1 text-2xl font-bold">{priceLabel}</p>

						{/* Option pickers — one pill row per axis, in options order. */}
						{hasOptions ? (
							<div className="mt-4 flex flex-col gap-3">
								{options.map((axis, axisIndex) => (
									<div key={axis.name}>
										<p className="mb-1.5 text-xs font-medium text-muted-foreground">
											{axis.name}
										</p>
										<div className="flex flex-wrap gap-2">
											{axis.values.map((value) => {
												const selected = selection[axisIndex] === value;
												const available =
													availability[axisIndex]?.has(value) ?? false;
												// Greyed when no sellable variant matches (reason 1
												// or, under hard-block, reason 2). Always allow the
												// currently-selected value so it can be toggled off.
												const disabled = !available && !selected;
												return (
													<button
														key={value}
														type="button"
														disabled={disabled}
														onClick={() => toggle(axisIndex, value)}
														className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
															selected
																? "border-accent bg-accent text-accent-foreground"
																: disabled
																	? "border-border bg-muted/40 text-muted-foreground/40 line-through"
																	: "border-border bg-background hover:border-accent"
														}`}
													>
														{value}
													</button>
												);
											})}
										</div>
									</div>
								))}
							</div>
						) : null}

						{/* Stock hint — only meaningful for hard-block variants. */}
						{selectedVariant && variantBlocks ? (
							<p className="mt-3 text-xs text-muted-foreground">
								{selectedVariant.onHand <= 0
									? "Out of stock"
									: selectedVariant.onHand <= 5
										? `Only ${selectedVariant.onHand} left`
										: `${selectedVariant.onHand} in stock`}
							</p>
						) : null}

						{/* Custom / made-to-order line — a self-contained, INDEPENDENT add
						    (its own button), not mutually exclusive with the variant pills.
						    Shows once regardless of how many sizes/flavours exist. */}
						{customLine ? (
							<div className="mt-5 rounded-xl border border-border p-3">
								{hasOptions ? (
									<p className="mb-2 text-xs font-medium text-muted-foreground">
										Or order a custom one
									</p>
								) : null}
								<div className="flex items-center gap-3">
									{customLine.imageUrls[0] ? (
										<ZoomableImage
											src={customLine.imageUrls[0]}
											alt={customLine.customLabel ?? "Custom"}
											caption={customLine.customLabel ?? "Custom"}
											wrapperClassName="size-12 shrink-0"
											className="size-12 rounded-lg object-cover"
										/>
									) : (
										<span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">
											🧑‍🍳
										</span>
									)}
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="flex items-center gap-2">
											<span className="text-sm font-semibold">
												{customLine.customLabel ?? "Custom"}
											</span>
											<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
												Made to order
											</span>
										</span>
										<span className="text-xs text-muted-foreground">
											{customPriceLabel}
										</span>
									</span>
								</div>
								{/* The seller's prompt becomes the placeholder so the buyer can
								    actually type their spec — the whole point of a custom line. */}
								<label className="mt-3 flex flex-col gap-1">
									<span className="text-xs font-medium text-muted-foreground">
										Your request
									</span>
									<textarea
										value={customNote}
										onChange={(e) => setCustomNote(e.target.value)}
										rows={2}
										maxLength={280}
										placeholder={
											customLine.customPrompt ||
											"Tell the seller what you'd like — size, colour, design, date…"
										}
										className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
									/>
								</label>
								<Button
									type="button"
									variant="outline"
									onClick={() => {
										onAdd(
											product,
											customLine,
											1,
											customNote.trim() || undefined,
										);
										setCustomNote("");
									}}
									className="mt-3 h-11 w-full"
								>
									Request custom order
								</Button>
							</div>
						) : null}

						{product.description ? (
							<div className="mt-4">
								<Markdown>{product.description}</Markdown>
							</div>
						) : null}
					</div>

					<div className="border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
						<div className="mb-3 flex items-center justify-center gap-3">
							<button
								type="button"
								onClick={() => setQuantity((q) => Math.max(1, q - 1))}
								disabled={quantity <= 1 || !sellable}
								className="flex size-11 items-center justify-center rounded-full border border-border disabled:opacity-40"
								aria-label="Decrease quantity"
							>
								<Minus className="size-4" />
							</button>
							<span className="min-w-10 text-center text-lg font-semibold">
								{quantity}
							</span>
							<button
								type="button"
								onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
								disabled={quantity >= maxQty || !sellable}
								className="flex size-11 items-center justify-center rounded-full border border-border disabled:opacity-40"
								aria-label="Increase quantity"
							>
								<Plus className="size-4" />
							</button>
						</div>
						<Button
							type="button"
							disabled={!sellable}
							onClick={() =>
								selectedVariant && onAdd(product, selectedVariant, quantity)
							}
							className="h-12 w-full text-base"
						>
							{!selectedVariant
								? hasOptions
									? "Select options"
									: "Unavailable"
								: !sellable
									? "Out of stock"
									: "Add to cart"}
						</Button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
