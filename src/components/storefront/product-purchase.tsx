import { useMutation } from "convex/react";
import {
	ArrowRight,
	ImagePlus,
	Link as LinkIcon,
	Loader2,
	Minus,
	Plus,
	ShoppingBag,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UseCart } from "../../hooks/useCart";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import {
	availableValuesPerAxis,
	getCustomLine,
	isSellable,
	minQuantityUnreachable,
	resolveVariant,
	variantLabel,
} from "../../lib/variant";
import { Button } from "../ui/button";
import { ZoomableImage } from "../ui/zoomable-image";
import type { StorefrontProduct } from "./product-card";

export type StorefrontVariant = StorefrontProduct["variants"][number];

export type CustomAddPayload = { note?: string; imageStorageId?: string };

export type OnAddVariant = (
	product: StorefrontProduct,
	variant: StorefrontVariant,
	quantity: number,
	custom?: CustomAddPayload,
) => void;

/**
 * The one shared "buy box" engine for the storefront's two product views —
 * the in-store detail SHEET and the URL-addressable product PAGE
 * (/$slug/p/<productSlug>, 86eybrhrt PR2). Selection, quantity, stock/minimum
 * gating, pricing labels and the custom-line request all live here so the two
 * surfaces cannot drift; each view only arranges the pieces.
 */
export function useProductPurchase({
	product,
	retailerId,
	cartQuantity,
}: {
	product: StorefrontProduct | null;
	retailerId: Id<"retailers">;
	/** Units of this product already in the cart (custom lines excluded) — the
	 * stepper defaults to the REMAINING amount toward the product's minimum
	 * order quantity, so the happy path never trips the checkout block. */
	cartQuantity: number;
}) {
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
	// the view is open.
	const cartQuantityRef = useRef(cartQuantity);
	cartQuantityRef.current = cartQuantity;
	// Same trick for the product doc itself, for a sharper reason: the product
	// PAGE feeds this hook a LIVE query result, so anything that writes the row
	// or its variants — someone else's order decrementing hard-block stock, the
	// seller editing a price — hands us a brand-new object for the SAME product.
	// Depending on that object would re-run the reset below and silently wipe an
	// in-flight buyer's option pills, quantity, custom note and uploaded
	// reference photo. The effect keys on `product._id` instead and reads the
	// current doc through here. (The detail SHEET was immune by accident: it
	// gets a snapshot held in the caller's state.)
	const productRef = useRef(product);
	productRef.current = product;
	const productId = product?._id;

	// Reset selection + quantity whenever a new product opens — identity, not a
	// fresh copy of the same one. Axes with a single value auto-select (one less
	// tap); the implicit default variant resolves immediately when there are no
	// axes. The stepper opens at the REMAINING amount toward the product's
	// minimum order quantity (min 20, 12 in cart → starts at 8) so the buyer
	// lands on a quantity that will actually check out.
	// biome-ignore lint/correctness/useExhaustiveDependencies: productId is the deliberate reset TRIGGER, not a value the body reads — the doc itself comes from productRef so a live re-push can't wipe buyer input.
	useEffect(() => {
		const opened = productRef.current;
		if (!opened) return;
		setQuantity(
			Math.max(1, (opened.minQuantity ?? 1) - cartQuantityRef.current),
		);
		setCustomNote("");
		setImageError(null);
		if (blobRef.current) {
			URL.revokeObjectURL(blobRef.current);
			blobRef.current = null;
		}
		setCustomImage(null);
		setSelection(
			(opened.options ?? []).map((axis) =>
				axis.values.length === 1 ? axis.values[0] : null,
			),
		);
	}, [productId]);

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

	/** After the custom line is added: clear the note and hand ownership of the
	 * blob preview to the cart (don't revoke — the cart may still render it). */
	function resetCustomAfterAdd() {
		setCustomNote("");
		blobRef.current = null;
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

	// The buy box reflects the STANDARD variant (the axis selection). The custom
	// line is an INDEPENDENT add with its own button (see CustomOrderCard) —
	// the two aren't mutually exclusive, so a buyer can add both in one visit.
	const sellable = selectedVariant ? isSellable(selectedVariant) : false;
	// The selected variant's resolved hard-block flag drives stock-bounded qty +
	// the stock hint. Made-to-order variants are unbounded (made on demand).
	const variantBlocks = selectedVariant?.blockWhenOutOfStock === true;
	const hasOptions = options.length > 0;
	// Gallery + price fall back to the product hero when the variant has none.
	const images =
		selectedVariant && selectedVariant.imageUrls.length > 0
			? selectedVariant.imageUrls
			: (product?.imageUrls ?? []);
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
	const minQuantity = product?.minQuantity ?? 0;
	const remainingToMin = Math.max(1, minQuantity - cartQuantity);
	const minFloor = hasOptions ? 1 : Math.min(remainingToMin, maxQty);
	// Stock can no longer reach the minimum → the standard line is unavailable
	// with the reason spelled out, instead of a stepper pinned at a quantity
	// checkout would reject. The custom card stays live (exempt from the
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
		setQuantity(
			Math.max(1, (product?.minQuantity ?? 1) - cartQuantityRef.current),
		);
	}

	const priceVaries = (product?.priceTo ?? 0) > (product?.priceFrom ?? 0);
	// A selected made-to-order variant at RM0 shows "Price on quote" — the seller
	// sets the real price on the mockup after the order is placed.
	const selectedIsQuote =
		selectedVariant?.requiresProof === true && selectedVariant.price === 0;
	const priceLabel = product
		? selectedVariant
			? selectedIsQuote
				? "Price on quote"
				: formatPrice(selectedVariant.price, product.currency)
			: product.hasQuotePricing && product.priceTo === 0
				? "Price on quote"
				: priceVaries || product.hasQuotePricing
					? `from ${formatPrice(product.priceFrom, product.currency)}`
					: formatPrice(product.priceFrom, product.currency)
		: "";

	// Custom line's own price label (independent of the standard selection).
	const customPriceLabel =
		product && customLine && customLine.price > 0
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

	return {
		product,
		options,
		cartQuantity,
		availability,
		selection,
		toggle,
		selectedVariant,
		customLine,
		sellable,
		variantBlocks,
		hasOptions,
		images,
		maxQty,
		minQuantity,
		minFloor,
		minUnreachable,
		displayQuantity,
		setQuantity,
		selectedIsQuote,
		priceLabel,
		customPriceLabel,
		totalPreview,
		customNote,
		setCustomNote,
		customImage,
		uploadingImage,
		imageError,
		handleCustomImage,
		removeCustomImage,
		resetCustomAfterAdd,
	};
}

export type ProductPurchase = ReturnType<typeof useProductPurchase>;

/**
 * Map a chosen variant into the cart (+ confirmation toast). Shared by the
 * grid's quick-add, the detail sheet and the product page so the cart-line
 * snapshot (price, labels, min rules, custom note/image) has one author.
 */
export function addVariantToCart(
	cart: UseCart,
	p: StorefrontProduct,
	variant: StorefrontVariant,
	qty: number,
	custom?: CustomAddPayload,
) {
	// The custom line has no optionValues — label it with its custom name so the
	// cart + order can tell it apart from the default variant.
	const label = variant.isCustom
		? (variant.customLabel ?? "Custom")
		: variantLabel(variant.optionValues);
	// Re-requesting an already-in-cart custom line updates the note, not the qty.
	const updatingCustom =
		variant.isCustom === true &&
		cart.items.some((i) => i.variantId === variant._id);
	cart.addItem(
		{
			variantId: variant._id,
			productId: p._id,
			name: p.name,
			optionLabel: label || undefined,
			price: variant.price,
			currency: p.currency,
			imageUrl: variant.imageUrls[0] ?? p.imageUrls[0],
			quoteOnRequest: variant.requiresProof === true && variant.price === 0,
			minNoticeDays: p.minNoticeDays,
			isCustom: variant.isCustom,
			minQuantity: p.minQuantity,
			note: custom?.note,
			customImageStorageId: custom?.imageStorageId,
		},
		qty,
	);
	toast.success(
		updatingCustom
			? "Custom request updated"
			: `Added ${qty > 1 ? `${qty} × ` : ""}${label ? `${p.name} — ${label}` : p.name} to cart`,
	);
}

/**
 * One-tap add for a SINGLE-variant product (multi-variant products open the
 * product page to pick options first, so the sole variant is unambiguous).
 * Shared by the grid's card button and the landing's featured card so the
 * min-quantity top-up logic has one author.
 *
 * A product with a minimum order quantity tops the cart up to it in one tap
 * (the card shows a "Min N" chip, so the bigger add is expected); once met,
 * +1 as usual. The top-up is clamped to the variant's remaining stock
 * (hard-block only) so a single tap can never put more in the cart than can
 * actually be bought.
 */
export function quickAddProductToCart(cart: UseCart, p: StorefrontProduct) {
	const variant = p.variants[0];
	if (!variant) return;
	const inCart = cart.quantityForProduct(p._id);
	const remainingToMin = (p.minQuantity ?? 1) - inCart;
	const stockLeft =
		variant.blockWhenOutOfStock === true
			? Math.max(1, variant.onHand - inCart)
			: Number.POSITIVE_INFINITY;
	addVariantToCart(
		cart,
		p,
		variant,
		Math.max(1, Math.min(remainingToMin, stockLeft)),
	);
}

/** Share/copy a product link: OS share sheet when available (the WhatsApp
 * path on mobile), clipboard + toast otherwise. `url` may be relative — it's
 * absolutized against the current origin at call time (SSR-safe: only ever
 * called from a click). */
export async function shareProductLink(url: string) {
	const absolute = new URL(url, window.location.origin).toString();
	if (navigator.share) {
		try {
			await navigator.share({ url: absolute });
			return;
		} catch {
			// Cancelled or unsupported payload — fall through to copy.
		}
	}
	try {
		await navigator.clipboard.writeText(absolute);
		toast.success("Link copied — paste it anywhere");
	} catch {
		toast.error("Couldn't copy the link");
	}
}

/** "🔗 Copy link" chip — the product page's share affordance. */
export function ShareLinkChip({ url }: { url: string }) {
	return (
		<button
			type="button"
			onClick={() => void shareProductLink(url)}
			className="tap-target flex w-fit items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent-emphasis transition-colors hover:bg-accent/15"
		>
			<LinkIcon className="size-3.5" aria-hidden />
			Copy link
		</button>
	);
}

// ---------------------------------------------------------------------------
// Shared presentational pieces — each takes the hook result (`pp`)
// ---------------------------------------------------------------------------

/** Option pickers — one pill row per axis, in options order. */
export function OptionPills({ pp }: { pp: ProductPurchase }) {
	if (!pp.hasOptions) return null;
	return (
		<div className="mt-4 flex flex-col gap-3">
			{pp.options.map((axis, axisIndex) => (
				<div key={axis.name}>
					<p className="mb-1.5 text-xs font-medium text-muted-foreground">
						{axis.name}
					</p>
					<div className="flex flex-wrap gap-2">
						{axis.values.map((value) => {
							const selected = pp.selection[axisIndex] === value;
							const available = pp.availability[axisIndex]?.has(value) ?? false;
							// Greyed when no sellable variant matches (reason 1
							// or, under hard-block, reason 2). Always allow the
							// currently-selected value so it can be toggled off.
							const disabled = !available && !selected;
							return (
								<button
									key={value}
									type="button"
									disabled={disabled}
									onClick={() => pp.toggle(axisIndex, value)}
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
	);
}

/** Stock hint + minimum-order hint/unreachable alert — surfaced on the product
 * (not only at checkout) so neither rule is ever a surprise. */
export function PurchaseHints({ pp }: { pp: ProductPurchase }) {
	const product = pp.product;
	if (!product) return null;
	return (
		<>
			{/* Stock hint — only meaningful for hard-block variants. */}
			{pp.selectedVariant && pp.variantBlocks ? (
				<p className="mt-3 text-xs text-muted-foreground">
					{pp.selectedVariant.onHand <= 0
						? "Out of stock"
						: pp.selectedVariant.onHand <= 5
							? `Only ${pp.selectedVariant.onHand} left`
							: `${pp.selectedVariant.onHand} in stock`}
				</p>
			) : null}

			{pp.minQuantity >= 2 ? (
				pp.minUnreachable ? (
					<p
						role="alert"
						className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
					>
						<span className="font-semibold">
							Only {product.totalOnHand} left
						</span>{" "}
						— not enough to meet this product&apos;s minimum of {pp.minQuantity}{" "}
						per order. Check back once it&apos;s restocked.
					</p>
				) : (
					<p className="mt-3 rounded-lg bg-accent/5 px-3 py-2 text-xs text-foreground">
						<span className="font-semibold">
							Minimum {pp.minQuantity} per order
						</span>
						{pp.hasOptions ? " — mix options to reach it." : "."}
						{pp.cartQuantity > 0
							? ` You have ${pp.cartQuantity} in your cart.`
							: ""}
					</p>
				)
			) : null}
		</>
	);
}

/** Custom / made-to-order line — a self-contained, INDEPENDENT add (its own
 * button), not mutually exclusive with the variant pills. Shows once
 * regardless of how many sizes/flavours exist. */
export function CustomOrderCard({
	pp,
	onAdd,
}: {
	pp: ProductPurchase;
	onAdd: OnAddVariant;
}) {
	const product = pp.product;
	const customLine = pp.customLine;
	if (!product || !customLine) return null;
	return (
		<div className="mt-5 rounded-2xl border border-border bg-muted/30 p-3">
			{pp.hasOptions ? (
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
						{pp.customPriceLabel}
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
					value={pp.customNote}
					onChange={(e) => pp.setCustomNote(e.target.value)}
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
				{pp.customImage ? (
					<div className="flex items-center gap-3">
						<ZoomableImage
							src={pp.customImage.preview}
							alt="Your reference"
							caption="Your reference photo"
							wrapperClassName="size-14 shrink-0"
							className="size-14 rounded-lg object-cover"
						/>
						<button
							type="button"
							onClick={pp.removeCustomImage}
							className="text-xs font-medium text-destructive underline-offset-2 hover:underline"
						>
							Remove photo
						</button>
					</div>
				) : (
					<label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-background text-sm text-muted-foreground hover:border-ring">
						{pp.uploadingImage ? (
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
							disabled={pp.uploadingImage}
							onChange={(e) =>
								void pp.handleCustomImage(e.target.files?.[0] ?? null)
							}
							className="hidden"
						/>
					</label>
				)}
				{pp.imageError ? (
					<p className="text-xs text-destructive">{pp.imageError}</p>
				) : null}
			</div>

			<Button
				type="button"
				variant="outline"
				disabled={pp.uploadingImage}
				onClick={() => {
					onAdd(product, customLine, 1, {
						note: pp.customNote.trim() || undefined,
						imageStorageId: pp.customImage?.storageId,
					});
					pp.resetCustomAfterAdd();
				}}
				className="mt-3 h-11 w-full"
			>
				Request custom order
			</Button>
		</div>
	);
}

/** Live "Total · N × unit" preview row above the stepper. */
export function TotalPreviewRow({ pp }: { pp: ProductPurchase }) {
	const product = pp.product;
	if (!product || !pp.totalPreview) return null;
	return (
		<div className="mb-3 flex items-baseline justify-between gap-2">
			<span className="text-sm font-medium text-muted-foreground">
				Total
				{pp.displayQuantity > 1 ? (
					<span className="ml-1 tabular-nums">
						· {pp.displayQuantity} ×{" "}
						{formatPrice(pp.totalPreview.unit, product.currency)}
					</span>
				) : null}
			</span>
			<span className="text-lg font-bold tabular-nums">
				{formatPrice(pp.totalPreview.total, product.currency)}
			</span>
		</div>
	);
}

/** The − qty + trio. */
export function PurchaseStepper({ pp }: { pp: ProductPurchase }) {
	return (
		<div className="flex items-center justify-center gap-3 sm:justify-start">
			<button
				type="button"
				onClick={() =>
					pp.setQuantity(Math.max(pp.minFloor, pp.displayQuantity - 1))
				}
				disabled={
					pp.displayQuantity <= pp.minFloor || !pp.sellable || pp.minUnreachable
				}
				className="flex size-11 items-center justify-center rounded-full border border-border disabled:opacity-40"
				aria-label="Decrease quantity"
			>
				<Minus className="size-4" />
			</button>
			<span className="min-w-10 text-center text-lg font-semibold">
				{pp.displayQuantity}
			</span>
			<button
				type="button"
				onClick={() =>
					pp.setQuantity(Math.min(pp.maxQty, pp.displayQuantity + 1))
				}
				disabled={
					pp.displayQuantity >= pp.maxQty || !pp.sellable || pp.minUnreachable
				}
				className="flex size-11 items-center justify-center rounded-full border border-border disabled:opacity-40"
				aria-label="Increase quantity"
			>
				<Plus className="size-4" />
			</button>
		</div>
	);
}

/** The primary CTA, with the full label ladder (min-unreachable → select
 * options → out of stock → add). */
export function AddToCartButton({
	pp,
	onAdd,
}: {
	pp: ProductPurchase;
	onAdd: OnAddVariant;
}) {
	return (
		<Button
			type="button"
			disabled={!pp.sellable || pp.minUnreachable}
			onClick={() =>
				pp.product &&
				pp.selectedVariant &&
				onAdd(pp.product, pp.selectedVariant, pp.displayQuantity)
			}
			className="h-12 w-full text-base"
		>
			{pp.minUnreachable
				? "Not enough stock"
				: !pp.selectedVariant
					? pp.hasOptions
						? "Select options"
						: "Unavailable"
					: !pp.sellable
						? "Out of stock"
						: "Add to cart"}
		</Button>
	);
}

/** Direct-to-checkout CTA — jump to the checkout page from the product view.
 * Appears once the cart holds ≥1 item; styled as a tinted-accent secondary so
 * it never competes with the filled "Add to cart" primary. Mirrors the cart
 * bar's bag + count + total. See docs/storefront-direct-checkout.md. */
export function GoToCheckoutBar({
	cartItemCount,
	cartTotal,
	currency,
	onCheckout,
}: {
	cartItemCount: number;
	cartTotal: number;
	currency: string;
	onCheckout?: () => void;
}) {
	if (!onCheckout || cartItemCount <= 0) return null;
	return (
		<button
			type="button"
			onClick={onCheckout}
			className="mt-3 flex h-12 w-full items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 outline-none transition-colors hover:bg-accent/15 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
		>
			<span className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
				<span className="relative flex size-6 items-center justify-center">
					<ShoppingBag className="size-5 text-accent" />
					<span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
						{cartItemCount}
					</span>
				</span>
				Go to checkout
			</span>
			<span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-foreground">
				{cartTotal > 0 ? formatPrice(cartTotal, currency) : null}
				<ArrowRight className="size-4 text-muted-foreground" aria-hidden />
			</span>
		</button>
	);
}

/** Placeholder when a product has no photos yet. */
export function EmptyGallery({
	name,
	className,
}: {
	name: string;
	className?: string;
}) {
	return (
		<div
			className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-muted/50 px-6 text-center text-muted-foreground ${className ?? ""}`}
		>
			<span className="flex size-14 items-center justify-center rounded-2xl bg-background shadow-sm">
				<ImagePlus className="size-6" />
			</span>
			<span className="text-sm font-medium">{name}</span>
		</div>
	);
}
