import { useQuery } from "convex/react";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UseCart } from "../../hooks/useCart";
import { Input } from "../ui/input";
import { ProductCard, type StorefrontProduct } from "./product-card";
import { ProductDetailSheet } from "./product-detail-sheet";

interface ProductGridProps {
	retailerId: Id<"retailers">;
	cart: UseCart;
}

export function ProductGrid({ retailerId, cart }: ProductGridProps) {
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

	const quickAdd = (p: StorefrontProduct) => {
		cart.addItem(
			{
				productId: p._id,
				name: p.name,
				price: p.price,
				currency: p.currency,
				imageUrl: p.imageUrls[0],
			},
			1,
		);
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
				onClose={() => setOpenProduct(null)}
				onAdd={(p, qty) => {
					cart.addItem(
						{
							productId: p._id,
							name: p.name,
							price: p.price,
							currency: p.currency,
							imageUrl: p.imageUrls[0],
						},
						qty,
					);
					setOpenProduct(null);
				}}
			/>
		</>
	);
}
