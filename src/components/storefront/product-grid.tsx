import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ChevronRight, Search, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UseCart } from "../../hooks/useCart";
import { Input } from "../ui/input";
import { ProductCard, type StorefrontProduct } from "./product-card";
import { quickAddProductToCart } from "./product-purchase";

/** Product-card grid — 4 columns on desktop (86eybrhrt PR3). The old 5/6-col
 * density existed so cards never outweighed the category hero tiles; those
 * tiles are now a compact carousel (category-rail.tsx), so the products ARE
 * the page and get tiles ~50% larger. */
const GRID_CLASS = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4";

/**
 * The "All products" rule that hands merchandising over to the full catalog.
 *
 * It lives beside the grid it labels, NOT inside whichever section happens to
 * sit above it — it was briefly owned by the popular shelf, which meant it
 * disappeared along with the shelf on any store under the qualifying-orders
 * threshold, leaving category tiles 4px from the first product row. That's not
 * an edge case: it's every newly-onboarded seller and every quiet week.
 *
 * Render it as the last child of `beforeGrid`, after a `peer`-marked wrapper
 * holding the merchandising sections. `peer-[:not(:empty)]` then shows it only
 * when at least one of those sections actually rendered — the wrapper is
 * genuinely `:empty` when they all return null (React renders no nodes, and
 * JSX drops the whitespace between them), so all four combinations are right
 * with no extra queries or prop-drilling.
 */
export function AllProductsDivider() {
	return (
		<div
			aria-hidden
			className="hidden items-center gap-3 pb-4 pt-5 peer-[:not(:empty)]:flex"
		>
			<span className="h-px flex-1 bg-border" />
			<span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
				All products
			</span>
			<span className="h-px flex-1 bg-border" />
		</div>
	);
}

interface ProductGridProps {
	retailerId: Id<"retailers">;
	cart: UseCart;
	/**
	 * Pre-filtered product set (the nested category page passes the category's
	 * own products in within-category order). When set, the grid skips its own
	 * `products.list` query and renders these — same cards, search, product
	 * links and cart-add, no forked component.
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
	 * Store slug — every card links to `/{storeSlug}/p/{productSlug}`, and the
	 * search also matches CATEGORY names, rendering matches as tappable tiles
	 * above the product results. (Shares the rail's `listActivePublic`
	 * subscription, so no extra read cost.)
	 *
	 * Required: a card with nowhere to link is a dead tile, so there's no
	 * meaningful grid without it. Both mount points (store home, category page)
	 * have the slug in hand.
	 */
	storeSlug: string;
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
	const categories = useQuery(api.categories.listActivePublic, { retailerId });
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
		searchQuery && categories
			? categories.filter((c) =>
					c.name.toLowerCase().includes(searchQuery.toLowerCase()),
				)
			: [];

	// One-tap add — quick-add only fires for single-variant products
	// (multi-variant cards link to the product page instead). The shared helper
	// (cart-line snapshot, toast, min-quantity top-up, stock clamp) also serves
	// the landing's featured card, so the two buttons can't drift. See
	// product-purchase.tsx.
	const quickAdd = (p: StorefrontProduct) => quickAddProductToCart(cart, p);

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
							categories && categories.length > 0
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
								params={{ slug: storeSlug, categorySlug: category.slug }}
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
					{/* Opening a product goes to its PAGE on EVERY breakpoint, and the
					    card owns that link itself — a real `<Link>`, so it's crawlable,
					    ⌘-clickable and prefetched on hover. A modal on mobile hid the one
					    thing PR2 exists to give buyers: the product's URL in the address
					    bar, which is how sharing actually happens on a phone. `slug` is
					    always present — every write path assigns one and the server
					    derives a fallback for un-backfilled rows (effectiveSlug).
					    See docs/storefront-product-pages.md. */}
					{filtered.map((product, index) => (
						<ProductCard
							key={product._id}
							product={product}
							storeSlug={storeSlug}
							onQuickAdd={quickAdd}
							cartQuantity={cart.quantityForProduct(product._id)}
							cartSubtotal={cart.subtotalForProduct(product._id)}
							// Early cards are likely above-the-fold — eager-load their
							// photo instead of lazy so the first paint isn't blank.
							priority={index < 4}
						/>
					))}
				</div>
			)}
		</>
	);
}
