import type { FunctionReturnType } from "convex/server";
import { Plus, SlidersHorizontal } from "lucide-react";
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
	// in the detail sheet first.
	const hasOptions = (product.options?.length ?? 0) > 0;
	const blockOOS = product.blockWhenOutOfStock === true;
	// "In stock" rolls up across variants; only hard-block products can be out.
	const outOfStock = !product.inStock;
	const lowStock =
		!outOfStock &&
		blockOOS &&
		product.totalOnHand > 0 &&
		product.totalOnHand <= 5;
	const priceVaries = product.priceTo > product.priceFrom;
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
					<div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
						No image
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
			</button>

			<div className="flex flex-1 flex-col gap-2 p-3">
				<button
					type="button"
					onClick={() => onOpen(product)}
					className="line-clamp-2 text-left text-[13px] font-medium leading-tight"
				>
					{product.name}
				</button>
				<p className="text-base font-bold tabular-nums">
					{priceVaries ? (
						<span className="text-xs font-medium text-muted-foreground">
							from{" "}
						</span>
					) : null}
					{formatPrice(product.priceFrom, product.currency)}
				</p>
				{hasOptions ? (
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
