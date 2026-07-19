import { useMutation } from "convex/react";
import { ImagePlus, Loader2, Minus, Plus, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import {
	availableValuesPerAxis,
	getCustomLine,
	isSellable,
	minQuantityUnreachable,
	resolveVariant,
} from "../../lib/variant";
import { Button } from "../ui/button";
import { Markdown } from "../ui/markdown";
import { ZoomableImage } from "../ui/zoomable-image";
import type { StorefrontProduct } from "./product-card";

export type StorefrontVariant = StorefrontProduct["variants"][number];

interface ProductDetailSheetProps {
	product: StorefrontProduct | null;
	retailerId: Id<"retailers">;
	/** Units of this product already in the cart (custom lines excluded) — the
	 * stepper defaults to the REMAINING amount toward the product's minimum
	 * order quantity, so the happy path never trips the checkout block. */
	cartQuantity: number;
	onClose: () => void;
	onAdd: (
		product: StorefrontProduct,
		variant: StorefrontVariant,
		quantity: number,
		// Buyer's request + optional reference image for the custom line.
		custom?: { note?: string; imageStorageId?: string },
	) => void;
}

export function ProductDetailSheet({
	product,
	retailerId,
	cartQuantity,
	onClose,
	onAdd,
}: ProductDetailSheetProps) {
	const generateCustomImageUploadUrl = useMutation(
		api.orders.generateCustomImageUploadUrl,
	);
	const [quantity, setQuantity] = useState(1);
	// Per-axis selection, aligned to product.options; null = not yet chosen.
	const [selection, setSelection] = useState<(string | null)[]>([]);
	// Buyer's free-text request for the custom line (their spec).
	const [customNote, setCustomNote] = useState("");
	// Optional buyer reference image: uploaded on attach (storageId) + a local
	// preview (blob URL, not persisted). See docs/custom-option.md.
	const [customImage, setCustomImage] = useState<{
		storageId: string;
		preview: string;
	} | null>(null);
	const [uploadingImage, setUploadingImage] = useState(false);
	const [imageError, setImageError] = useState<string | null>(null);
	// Revoke any blob preview on unmount / replacement.
	const blobRef = useRef<string | null>(null);

	const options = product?.options ?? [];
	const variants = product?.variants ?? [];

	// Latest cart count via a ref so the reset effect below can read it without
	// re-running (and clobbering the stepper) every time the cart changes while
	// the sheet is open.
	const cartQuantityRef = useRef(cartQuantity);
	cartQuantityRef.current = cartQuantity;

	// Reset selection + quantity whenever a new product opens. Axes with a single
	// value auto-select (one less tap); the implicit default variant resolves
	// immediately when there are no axes. The stepper opens at the REMAINING
	// amount toward the product's minimum order quantity (min 20, 12 in cart →
	// starts at 8) so the buyer lands on a quantity that will actually check out.
	useEffect(() => {
		if (!product) return;
		setQuantity(
			Math.max(1, (product.minQuantity ?? 1) - cartQuantityRef.current),
		);
		setCustomNote("");
		setImageError(null);
		if (blobRef.current) {
			URL.revokeObjectURL(blobRef.current);
			blobRef.current = null;
		}
		setCustomImage(null);
		setSelection(
			(product.options ?? []).map((axis) =>
				axis.values.length === 1 ? axis.values[0] : null,
			),
		);
	}, [product]);

	// Revoke the last preview on unmount.
	useEffect(
		() => () => {
			if (blobRef.current) URL.revokeObjectURL(blobRef.current);
		},
		[],
	);

	async function handleCustomImage(file: File | null) {
		if (!file) return;
		setImageError(null);
		setUploadingImage(true);
		try {
			const url = await generateCustomImageUploadUrl({ retailerId });
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!res.ok) throw new Error("Upload failed");
			const body = (await res.json()) as { storageId?: unknown };
			if (typeof body.storageId !== "string")
				throw new Error("Upload failed: unexpected response");
			if (blobRef.current) URL.revokeObjectURL(blobRef.current);
			const preview = URL.createObjectURL(file);
			blobRef.current = preview;
			setCustomImage({ storageId: body.storageId, preview });
		} catch (err) {
			setImageError(convexErrorMessage(err));
		} finally {
			setUploadingImage(false);
		}
	}

	function removeCustomImage() {
		if (blobRef.current) {
			URL.revokeObjectURL(blobRef.current);
			blobRef.current = null;
		}
		setCustomImage(null);
	}

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
	// Minimum-order-quantity easement (86ey9unyx): the amount still needed to
	// reach the product's minimum, given what's already in the cart. On a
	// no-options product the minus button floors here (the only way to comply is
	// this one variant); with options the floor stays 1 — the buyer may mix
	// variants to reach the minimum, and checkout judges the SUM.
	const minQuantity = product.minQuantity ?? 0;
	const remainingToMin = Math.max(1, minQuantity - cartQuantity);
	const minFloor = hasOptions ? 1 : Math.min(remainingToMin, maxQty);
	// Stock can no longer reach the minimum → the standard line is unavailable
	// with the reason spelled out, instead of a stepper pinned at a quantity
	// checkout would reject. The custom card below stays live (exempt from the
	// minimum). `totalOnHand` equals the purchasable stock here: this state only
	// fires when every standard variant hard-blocks, and the custom line's
	// onHand is always 0.
	const minUnreachable = minQuantityUnreachable(minQuantity, variants);
	// Never render/add more than the stock ceiling, even if the min default
	// exceeds it (the buyer sees the stock hint explain the tension).
	const displayQuantity = Math.min(quantity, maxQty);

	function toggle(axisIndex: number, value: string) {
		setSelection((prev) => {
			const next = [...prev];
			next[axisIndex] = prev[axisIndex] === value ? null : value;
			return next;
		});
		// Re-open the stepper at the remaining amount toward the minimum (10 of
		// 20 already in the cart → the next flavour starts at 10); 1 when no rule.
		// `product?.` because hoisting puts this function above the null guard.
		setQuantity(
			Math.max(1, (product?.minQuantity ?? 1) - cartQuantityRef.current),
		);
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

	// Live money total for the standard selection — shown by the stepper so the
	// buyer sees what they're committing to before adding, and it updates on every
	// tap. Only when a concrete, priced, sellable variant is resolved: quote lines
	// have no price yet, and an unresolved multi-axis selection has no variant.
	// Uses `displayQuantity` (the stock-capped, min-floored value the stepper shows
	// and the cart receives), never the raw `quantity`, so the total can't disagree
	// with the number above the "Add to cart" button.
	const totalPreview =
		selectedVariant && sellable && !selectedIsQuote
			? {
					unit: selectedVariant.price,
					total: selectedVariant.price * displayQuantity,
				}
			: null;

	return (
		<Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
				<Dialog.Content
					className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-3xl border-t border-border bg-background shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-[min(92vw,760px)] sm:max-h-[86dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
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

					<div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
						{images.length > 0 ? (
							<div className="-mx-5 mb-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:px-0">
								{images.map((url) => (
									<ZoomableImage
										key={url}
										src={url}
										alt={product.name}
										caption={product.name}
										wrapperClassName="w-64 shrink-0 snap-start sm:w-full"
										className="aspect-square w-full rounded-2xl object-cover"
									/>
								))}
							</div>
						) : (
							<div className="mb-4 flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-muted/50 px-6 text-center text-muted-foreground sm:aspect-[2.4/1]">
								<span className="flex size-14 items-center justify-center rounded-2xl bg-background shadow-sm">
									<ImagePlus className="size-6" />
								</span>
								<span className="text-sm font-medium">{product.name}</span>
							</div>
						)}

						<div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
							<h2 className="text-xl font-bold leading-tight">
								{product.name}
							</h2>
							<p className="shrink-0 text-2xl font-bold tabular-nums">
								{priceLabel}
							</p>
						</div>

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

						{/* Minimum-order hint — surfaced here (not only at checkout) so the
						    rule is never a surprise. When stock can't reach the minimum
						    the hint becomes the unavailability reason instead of a rule
						    the buyer can't comply with. See convex/lib/minOrderRules.ts. */}
						{minQuantity >= 2 ? (
							minUnreachable ? (
								<p
									role="alert"
									className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
								>
									<span className="font-semibold">
										Only {product.totalOnHand} left
									</span>{" "}
									— not enough to meet this product&apos;s minimum of{" "}
									{minQuantity} per order. Check back once it&apos;s restocked.
								</p>
							) : (
								<p className="mt-3 rounded-lg bg-accent/5 px-3 py-2 text-xs text-foreground">
									<span className="font-semibold">
										Minimum {minQuantity} per order
									</span>
									{hasOptions ? " — mix options to reach it." : "."}
									{cartQuantity > 0
										? ` You have ${cartQuantity} in your cart.`
										: ""}
								</p>
							)
						) : null}

						{/* Custom / made-to-order line — a self-contained, INDEPENDENT add
						    (its own button), not mutually exclusive with the variant pills.
						    Shows once regardless of how many sizes/flavours exist. */}
						{customLine ? (
							<div className="mt-5 rounded-2xl border border-border bg-muted/30 p-3">
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
										<span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
											<ImagePlus className="size-5" />
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

								{/* Optional reference photo — a picture says more than a note. */}
								<div className="mt-2 flex flex-col gap-1">
									<span className="text-xs font-medium text-muted-foreground">
										Reference photo (optional)
									</span>
									{customImage ? (
										<div className="flex items-center gap-3">
											<ZoomableImage
												src={customImage.preview}
												alt="Your reference"
												caption="Your reference photo"
												wrapperClassName="size-14 shrink-0"
												className="size-14 rounded-lg object-cover"
											/>
											<button
												type="button"
												onClick={removeCustomImage}
												className="text-xs font-medium text-destructive underline-offset-2 hover:underline"
											>
												Remove photo
											</button>
										</div>
									) : (
										<label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-background text-sm text-muted-foreground hover:border-ring">
											{uploadingImage ? (
												<>
													<Loader2 className="size-4 animate-spin" />
													Uploading…
												</>
											) : (
												<>
													<ImagePlus className="size-4" />
													Add a photo
												</>
											)}
											<input
												type="file"
												accept="image/*"
												disabled={uploadingImage}
												onChange={(e) =>
													void handleCustomImage(e.target.files?.[0] ?? null)
												}
												className="hidden"
											/>
										</label>
									)}
									{imageError ? (
										<p className="text-xs text-destructive">{imageError}</p>
									) : null}
								</div>

								<Button
									type="button"
									variant="outline"
									disabled={uploadingImage}
									onClick={() => {
										onAdd(product, customLine, 1, {
											note: customNote.trim() || undefined,
											imageStorageId: customImage?.storageId,
										});
										setCustomNote("");
										// Hand off ownership of the preview to the cart; don't revoke.
										blobRef.current = null;
										setCustomImage(null);
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

					<div className="border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
						{totalPreview ? (
							<div className="mb-3 flex items-baseline justify-between gap-2">
								<span className="text-sm font-medium text-muted-foreground">
									Total
									{displayQuantity > 1 ? (
										<span className="ml-1 tabular-nums">
											· {displayQuantity} ×{" "}
											{formatPrice(totalPreview.unit, product.currency)}
										</span>
									) : null}
								</span>
								<span className="text-lg font-bold tabular-nums">
									{formatPrice(totalPreview.total, product.currency)}
								</span>
							</div>
						) : null}
						<div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
							<div className="flex items-center justify-center gap-3 sm:justify-start">
								<button
									type="button"
									onClick={() =>
										setQuantity(Math.max(minFloor, displayQuantity - 1))
									}
									disabled={
										displayQuantity <= minFloor || !sellable || minUnreachable
									}
									className="flex size-11 items-center justify-center rounded-full border border-border disabled:opacity-40"
									aria-label="Decrease quantity"
								>
									<Minus className="size-4" />
								</button>
								<span className="min-w-10 text-center text-lg font-semibold">
									{displayQuantity}
								</span>
								<button
									type="button"
									onClick={() =>
										setQuantity(Math.min(maxQty, displayQuantity + 1))
									}
									disabled={
										displayQuantity >= maxQty || !sellable || minUnreachable
									}
									className="flex size-11 items-center justify-center rounded-full border border-border disabled:opacity-40"
									aria-label="Increase quantity"
								>
									<Plus className="size-4" />
								</button>
							</div>
							<Button
								type="button"
								disabled={!sellable || minUnreachable}
								onClick={() =>
									selectedVariant &&
									onAdd(product, selectedVariant, displayQuantity)
								}
								className="h-12 w-full text-base"
							>
								{minUnreachable
									? "Not enough stock"
									: !selectedVariant
										? hasOptions
											? "Select options"
											: "Unavailable"
										: !sellable
											? "Out of stock"
											: "Add to cart"}
							</Button>
						</div>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
