import type { FunctionReturnType } from "convex/server";
import { ImagePlus, Plus, SlidersHorizontal } from "lucide-react";
import type { api } from "../../../convex/_generated/api";
import { formatPrice } from "../../lib/format";
import { Button } from "../ui/button";

export type StorefrontProduct = FunctionReturnType<
	typeof api.products.list
>[number];

interface ProductCardProps {
	product: StorefrontProduct;
	onOpen: (product: StorefrontProduct) => void;
	onQuickAdd: (product: StorefrontProduct) => void;
}

export function ProductCard({ product, onOpen, onQuickAdd }: ProductCardProps) {
	// Multi-variant products can't be quick-added — the buyer must pick options
	// in the detail sheet first. A custom line also forces the detail sheet so the
	// buyer can see (and choose) the made-to-order option. See docs/custom-option.md.
	const hasOptions = (product.options?.length ?? 0) > 0;
	const hasCustom = product.variants.some((v) => v.isCustom);
	const needsDetail = hasOptions || hasCustom;
	// A product "can run out" if any of its variants hard-blocks (flags are now
	// resolved per-variant server-side). Only then does the low-stock badge apply.
	const canRunOut = product.variants.some(
		(v) => v.blockWhenOutOfStock === true,
	);
	// "In stock" rolls up across variants; only hard-block variants can be out.
	const outOfStock = !product.inStock;
	const lowStock =
		!outOfStock &&
		canRunOut &&
		product.totalOnHand > 0 &&
		product.totalOnHand <= 5;
	const priceVaries = product.priceTo > product.priceFrom;
	// "Price on quote": made-to-order variants at RM0 (seller quotes on the mockup).
	// allQuote = no priced variants at all; showFrom = a cheaper/quote option exists.
	const allQuote = product.hasQuotePricing && product.priceTo === 0;
	const showFrom = priceVaries || product.hasQuotePricing;
	const firstImage = product.imageUrls[0];

	return (
		<div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow duration-200 hover:shadow-md">
			<button
				type="button"
				onClick={() => onOpen(product)}
				className="relative aspect-square w-full overflow-hidden bg-muted text-left"
			>
				{firstImage ? (
					<img
						src={firstImage}
						alt={product.name}
						className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
						loading="lazy"
					/>
				) : (
					<div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/60 text-muted-foreground">
						<span className="flex size-11 items-center justify-center rounded-xl bg-background/80 shadow-sm">
							<ImagePlus className="size-5" />
						</span>
						<span className="max-w-24 text-center text-xs font-medium leading-tight">
							{product.name}
						</span>
					</div>
				)}
				{firstImage && (
					<div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/20 to-transparent" />
				)}
				{outOfStock ? (
					<span className="absolute left-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
						Out of stock
					</span>
				) : lowStock ? (
					<span className="absolute left-2 top-2 rounded-full bg-accent/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground backdrop-blur-sm">
						Low stock
					</span>
				) : null}
				{hasCustom ? (
					// Overlaid on the image (not a text-zone row) so cards with a
					// custom line stay exactly the same height as their neighbours.
					<span className="absolute bottom-2 left-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
						Custom available
					</span>
				) : null}
			</button>

			<div className="flex flex-1 flex-col gap-2 p-3">
				{/* Fixed 2-line name zone: 1-line names reserve the second line so the
				    price row sits at the same height on every card in a grid row. */}
				<button
					type="button"
					onClick={() => onOpen(product)}
					className="line-clamp-2 min-h-[2.05rem] text-left text-[13px] font-medium leading-tight"
				>
					{product.name}
				</button>
				<p className="text-base font-bold leading-tight tabular-nums">
					{allQuote ? (
						<span className="text-sm font-semibold">Price on quote</span>
					) : (
						<>
							{showFrom ? (
								<span className="text-xs font-medium text-muted-foreground">
									from{" "}
								</span>
							) : null}
							{formatPrice(product.priceFrom, product.currency)}
						</>
					)}
				</p>
				{needsDetail ? (
					<Button
						type="button"
						onClick={() => onOpen(product)}
						disabled={outOfStock}
						size="sm"
						variant="outline"
						className="mt-auto h-11 w-full rounded-xl"
					>
						<SlidersHorizontal className="size-4" />
						Choose
					</Button>
				) : (
					<Button
						type="button"
						onClick={() => onQuickAdd(product)}
						disabled={outOfStock}
						size="sm"
						className="mt-auto h-11 w-full rounded-xl"
					>
						<Plus className="size-4" />
						Add
					</Button>
				)}
			</div>
		</div>
	);
}
