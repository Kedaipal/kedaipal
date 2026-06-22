import { useQuery } from "convex/react";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UseCart } from "../../hooks/useCart";
import { variantLabel } from "../../lib/variant";
import { Input } from "../ui/input";
import { ProductCard, type StorefrontProduct } from "./product-card";
import {
	ProductDetailSheet,
	type StorefrontVariant,
} from "./product-detail-sheet";

interface ProductGridProps {
	retailerId: Id<"retailers">;
	cart: UseCart;
}

export function ProductGrid({ retailerId, cart }: ProductGridProps) {
	// `products.list` returns active products already sorted by the retailer's
	// `sortOrder` (set via the dashboard reorder). We render in that order — the
	// search filter below preserves it — so the storefront reflects the seller's
	// chosen sequence.
	const products = useQuery(api.products.list, { retailerId });
	const [openProduct, setOpenProduct] = useState<StorefrontProduct | null>(
		null,
	);
	const [searchQuery, setSearchQuery] = useState("");

	if (products === undefined) {
		return (
			<div className="grid grid-cols-2 gap-3">
				{Array.from({ length: 4 }).map((_, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders are stable
						key={i}
						className="aspect-square animate-pulse rounded-2xl bg-muted"
					/>
				))}
			</div>
		);
	}

	if (products.length === 0) {
		return (
			<div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
				No products yet — check back soon.
			</div>
		);
	}

	const filtered = searchQuery
		? products.filter((p) =>
				p.name.toLowerCase().includes(searchQuery.toLowerCase()),
			)
		: products;

	const addVariant = (
		p: StorefrontProduct,
		variant: StorefrontVariant,
		qty: number,
		custom?: { note?: string; imageStorageId?: string },
	) => {
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
				isCustom: variant.isCustom,
				note: custom?.note,
				customImageStorageId: custom?.imageStorageId,
			},
			qty,
		);
		toast.success(
			updatingCustom
				? "Custom request updated"
				: `Added ${label ? `${p.name} — ${label}` : p.name} to cart`,
		);
	};

	// Quick-add only fires for single-variant products (multi-variant cards open
	// the sheet instead), so the sole variant is unambiguous.
	const quickAdd = (p: StorefrontProduct) => {
		const variant = p.variants[0];
		if (variant) addVariant(p, variant, 1);
	};

	return (
		<>
			{/* Search bar */}
			<div className="relative mb-4">
				<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					placeholder="Search products…"
					className="h-11 w-full rounded-xl border-border bg-muted/50 pl-10 pr-10 text-sm focus:bg-background"
				/>
				{searchQuery && (
					<button
						type="button"
						onClick={() => setSearchQuery("")}
						className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						aria-label="Clear search"
					>
						<X className="size-4" />
					</button>
				)}
			</div>

			{/* Result count */}
			{searchQuery && (
				<p className="mb-3 text-xs text-muted-foreground">
					{filtered.length === 0
						? `No products match "${searchQuery}"`
						: `${filtered.length} product${filtered.length === 1 ? "" : "s"} found`}
				</p>
			)}

			{filtered.length === 0 && searchQuery ? (
				<div className="rounded-2xl border border-dashed border-border p-8 text-center">
					<p className="text-sm text-muted-foreground">
						No products match &ldquo;{searchQuery}&rdquo;
					</p>
					<button
						type="button"
						onClick={() => setSearchQuery("")}
						className="mt-2 text-xs font-medium text-accent underline-offset-2 hover:underline"
					>
						Clear search
					</button>
				</div>
			) : (
				<div className="grid grid-cols-2 gap-3">
					{filtered.map((product) => (
						<ProductCard
							key={product._id}
							product={product}
							onOpen={setOpenProduct}
							onQuickAdd={quickAdd}
						/>
					))}
				</div>
			)}

			<ProductDetailSheet
				product={openProduct}
				retailerId={retailerId}
				onClose={() => setOpenProduct(null)}
				// Stay open after adding so a buyer can add a standard variant AND
				// request the custom line from the same product without reopening. The
				// toast + cart bar confirm the add; they close via the X when done.
				onAdd={(p, variant, qty, custom) => addVariant(p, variant, qty, custom)}
			/>
		</>
	);
}
