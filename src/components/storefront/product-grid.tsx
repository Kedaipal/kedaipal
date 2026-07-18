import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ChevronRight, Search, X } from "lucide-react";
import { type ReactNode, useState } from "react";
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

/** Product-card grid — denser on desktop so a product card never outweighs a
 * category hero card (categories are the highlight, products the inventory). */
const GRID_CLASS =
	"grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6";

interface ProductGridProps {
	retailerId: Id<"retailers">;
	cart: UseCart;
	/**
	 * Pre-filtered product set (the nested category page passes the category's
	 * own products in within-category order). When set, the grid skips its own
	 * `products.list` query and renders these — same cards, search, detail
	 * sheet and cart-add, no forked component.
	 */
	products?: StorefrontProduct[];
	/**
	 * Rendered between the sticky search bar and the grid — the home page slots
	 * the category hero carousel here so search stays the first control while
	 * categories stay the first CONTENT. Hidden while a search query is active
	 * (results take the whole surface, categories would be noise).
	 */
	beforeGrid?: ReactNode;
	/**
	 * Store slug for category deep links. When set, the search also matches
	 * CATEGORY names — matching categories render as tappable tiles above the
	 * product results. (Shares the rail's `listActivePublic` subscription, so
	 * no extra read cost.)
	 */
	storeSlug?: string;
}

export function ProductGrid({
	retailerId,
	cart,
	products: productsOverride,
	beforeGrid,
	storeSlug,
}: ProductGridProps) {
	// `products.list` returns active products already sorted by the retailer's
	// `sortOrder` (set via the dashboard reorder). We render in that order — the
	// search filter below preserves it — so the storefront reflects the seller's
	// chosen sequence.
	const listed = useQuery(
		api.products.list,
		productsOverride ? "skip" : { retailerId },
	);
	const products = productsOverride ?? listed;
	// Same query the CategoryRail subscribes to — Convex dedupes identical
	// (query, args) subscriptions, so this costs nothing extra.
	const categories = useQuery(
		api.categories.listActivePublic,
		storeSlug ? { retailerId } : "skip",
	);
	const [openProduct, setOpenProduct] = useState<StorefrontProduct | null>(
		null,
	);
	const [searchQuery, setSearchQuery] = useState("");

	if (products === undefined) {
		return (
			<div className={GRID_CLASS}>
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
	// Category-name matches surface as tappable tiles above product results.
	const matchedCategories =
		searchQuery && storeSlug && categories
			? categories.filter((c) =>
					c.name.toLowerCase().includes(searchQuery.toLowerCase()),
				)
			: [];

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
	};

	// Quick-add only fires for single-variant products (multi-variant cards open
	// the sheet instead), so the sole variant is unambiguous. A product with a
	// minimum order quantity tops the cart up to it in one tap (the card shows a
	// "Min N" chip, so the bigger add is expected); once met, +1 as usual.
	const quickAdd = (p: StorefrontProduct) => {
		const variant = p.variants[0];
		if (!variant) return;
		const remainingToMin =
			(p.minQuantity ?? 1) - cart.quantityForProduct(p._id);
		addVariant(p, variant, Math.max(1, remainingToMin));
	};

	return (
		<>
			{/* Search bar — the first control, sticky so it's always within reach
			    mid-scroll. Full-bleed on mobile via negative margins (the parent
			    section pads px-5 / lg:px-8). */}
			<div className="sticky top-0 z-30 -mx-5 mb-4 bg-background/92 px-5 py-2 backdrop-blur-md lg:-mx-8 lg:px-8">
				<div className="relative">
					<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						type="search"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder={
							storeSlug && categories && categories.length > 0
								? "Search products & categories…"
								: "Search products…"
						}
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
			</div>

			{/* Home page slots the category hero here; hidden while searching so
			    results take the whole surface. */}
			{searchQuery ? null : beforeGrid}

			{/* Matching categories — tappable doors above the product results. */}
			{matchedCategories.length > 0 ? (
				<div className="mb-4 flex flex-col gap-2">
					<p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
						Categories
					</p>
					<div className="flex flex-wrap gap-2">
						{matchedCategories.map((category) => (
							<Link
								key={category._id}
								to="/$slug/c/$categorySlug"
								// biome-ignore lint/style/noNonNullAssertion: matchedCategories is only non-empty when storeSlug is set
								params={{ slug: storeSlug!, categorySlug: category.slug }}
								className="flex h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 transition-colors hover:border-accent/50"
							>
								<span className="text-[13.5px] font-semibold">
									{category.name}
								</span>
								<span className="text-[11.5px] text-muted-foreground">
									{category.productCount} item
									{category.productCount === 1 ? "" : "s"}
								</span>
								<ChevronRight
									className="size-3.5 text-muted-foreground/70"
									aria-hidden
								/>
							</Link>
						))}
					</div>
				</div>
			) : null}

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
						{matchedCategories.length > 0
							? " — but the categories above do."
							: ""}
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
				<div className={GRID_CLASS}>
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
				// Units of this product already in the cart — the sheet's stepper
				// defaults to the REMAINING amount toward the product's minimum.
				cartQuantity={
					openProduct ? cart.quantityForProduct(openProduct._id) : 0
				}
				onClose={() => setOpenProduct(null)}
				// Stay open after adding so a buyer can add a standard variant AND
				// request the custom line from the same product without reopening. The
				// toast + cart bar confirm the add; they close via the X when done.
				onAdd={(p, variant, qty, custom) => addVariant(p, variant, qty, custom)}
			/>
		</>
	);
}
