import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ImagePlus, Plus, SlidersHorizontal } from "lucide-react";
import { Component, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { popularSince } from "../../../convex/lib/popularProducts";
import type { UseCart } from "../../hooks/useCart";
import { formatPrice } from "../../lib/format";
import { minQuantityUnreachable } from "../../lib/variant";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import type { StorefrontProduct } from "./product-card";
import { quickAddProductToCart } from "./product-purchase";

/**
 * "Popular this week" — the store home's lead story (86eybrhrt PR3): one
 * horizontal feature card for the product real buyers actually ordered most
 * this week, closed by the "All products" divider that hands over to the
 * grid. Data-driven (ranked ids from `products.popularProducts`), zero
 * seller curation — and it hides entirely when nothing qualifies (new or
 * quiet stores), so the claim is never hollow.
 *
 * Candidate ids resolve against the SAME `products.list` the grid subscribes
 * to (Convex dedupes identical subscriptions — no extra read): visibility
 * rules apply once, and a top seller that's since been hidden, archived,
 * sold out or min-quantity-trapped is skipped for the next candidate rather
 * than featured as unbuyable.
 */
export function FeaturedProduct(props: {
	retailerId: Id<"retailers">;
	storeSlug: string;
	cart: UseCart;
}) {
	return (
		<FeaturedErrorBoundary>
			<FeaturedProductInner {...props} />
		</FeaturedErrorBoundary>
	);
}

/**
 * Merchandising is decoration — if its query throws (a deploy window where
 * client and server briefly disagree about `popularProducts`, a transient
 * server error), the row must degrade to NOTHING, never bubble to the route
 * boundary and blank the whole store. Convex's `useQuery` throws render-time,
 * so this needs a real boundary, not a null check.
 */
class FeaturedErrorBoundary extends Component<
	{ children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}

function FeaturedProductInner({
	retailerId,
	storeSlug,
	cart,
}: {
	retailerId: Id<"retailers">;
	storeSlug: string;
	cart: UseCart;
}) {
	const products = useQuery(api.products.list, { retailerId });
	// MYT-midnight-aligned anchor: every buyer on the same date sends the same
	// args, so the query result is cached once per store per day.
	const popular = useQuery(api.products.popularProducts, {
		retailerId,
		since: popularSince(),
	});

	if (!products || !popular || popular.length === 0) return null;
	const byId = new Map(products.map((p) => [p._id as string, p]));
	const product = popular
		.map((id) => byId.get(id))
		.filter((p): p is StorefrontProduct => p !== undefined)
		.find(
			(p) =>
				p.inStock && !minQuantityUnreachable(p.minQuantity ?? 0, p.variants),
		);
	if (!product) return null;

	return (
		<section aria-label="Popular this week" className="flex flex-col">
			<p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
				Popular this week
			</p>
			<FeaturedCard product={product} storeSlug={storeSlug} cart={cart} />
			{/* Hands over to the full grid — same divider the category rail used. */}
			<div className="flex items-center gap-3 pb-1 pt-5" aria-hidden>
				<span className="h-px flex-1 bg-border" />
				<span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
					All products
				</span>
				<span className="h-px flex-1 bg-border" />
			</div>
		</section>
	);
}

function FeaturedCard({
	product,
	storeSlug,
	cart,
}: {
	product: StorefrontProduct;
	storeSlug: string;
	cart: UseCart;
}) {
	// Same affordance rules as ProductCard: multi-variant/custom products go to
	// the page to pick options; single-variant quick-adds in place.
	const hasOptions = (product.options?.length ?? 0) > 0;
	const hasCustom = product.variants.some((v) => v.isCustom);
	const needsDetail = hasOptions || hasCustom;
	const allQuote = product.hasQuotePricing && product.priceTo === 0;
	const showFrom =
		product.priceTo > product.priceFrom || product.hasQuotePricing;
	const firstImage = product.imageUrls[0];
	const cartQuantity = cart.quantityForProduct(product._id);
	const cartSubtotal = cart.subtotalForProduct(product._id);
	// One-line plain-text blurb from the (markdown) description — the feature
	// card teases, the product page tells. Common markdown tokens stripped so
	// they never render raw.
	const blurb = product.description
		?.replace(/[#*_~`>]/g, "")
		.replace(/\s+/g, " ")
		.trim();

	return (
		// ONE compact card at every width, capped at max-w-md. A single lead
		// item must read as a card, not claim the row: full-bleed width was
		// tried twice (mobile card stretched to 1150px, then a banner variant)
		// and both looked wrong — one product doesn't carry that much surface.
		// The cap leaves phones at their natural width and gives desktop a
		// standard card, left-aligned under the section label.
		<div className="mt-2 flex w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card transition-shadow duration-200 hover:shadow-md">
			<Link
				to="/$slug/p/$productSlug"
				params={{ slug: storeSlug, productSlug: product.slug }}
				className="relative w-28 shrink-0 self-stretch overflow-hidden bg-muted"
				aria-label={product.name}
			>
				{firstImage ? (
					<AppImage
						src={firstImage}
						alt={product.name}
						aspect="absolute inset-0"
						priority
					/>
				) : (
					<span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
						<ImagePlus className="size-6" />
					</span>
				)}
				<span className="absolute bottom-2 left-2 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground backdrop-blur-sm">
					Bestseller
				</span>
			</Link>

			<div className="flex min-w-0 flex-1 flex-col gap-1 p-3.5">
				<Link
					to="/$slug/p/$productSlug"
					params={{ slug: storeSlug, productSlug: product.slug }}
					className="line-clamp-1 text-[15px] font-semibold leading-tight"
				>
					{product.name}
				</Link>
				{blurb ? (
					<p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
						{blurb}
					</p>
				) : null}
				{/* Price left, compact action right — a chip-sized button, not a
				    full-width slab (h-11 keeps the 44px tap target). */}
				<div className="mt-auto flex items-end justify-between gap-3 pt-2">
					<div className="flex min-w-0 flex-col gap-0.5">
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
						{cartQuantity > 0 ? (
							<p className="text-xs font-semibold text-accent tabular-nums">
								{cartQuantity} in cart
								{cartSubtotal > 0
									? ` · ${formatPrice(cartSubtotal, product.currency)}`
									: ""}
							</p>
						) : null}
					</div>
					{needsDetail ? (
						<Button
							asChild
							size="sm"
							variant="outline"
							className="h-11 shrink-0 rounded-xl px-4"
						>
							<Link
								to="/$slug/p/$productSlug"
								params={{ slug: storeSlug, productSlug: product.slug }}
							>
								<SlidersHorizontal className="size-4" />
								Choose
							</Link>
						</Button>
					) : (
						<Button
							type="button"
							onClick={() => quickAddProductToCart(cart, product)}
							size="sm"
							className="h-11 shrink-0 rounded-xl px-4"
						>
							<Plus className="size-4" />
							Add
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
