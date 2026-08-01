import { useQuery } from "convex/react";
import { Component, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { popularSince } from "../../../convex/lib/popularProducts";
import type { UseCart } from "../../hooks/useCart";
import { minQuantityUnreachable } from "../../lib/variant";
import { ProductCard, type StorefrontProduct } from "./product-card";
import { quickAddProductToCart } from "./product-purchase";

/**
 * "Popular this week" — the store home's merchandising shelf (86eybrhrt PR3):
 * a horizontally scrollable row of the products real buyers actually ordered
 * most over the last 7 days, closed by the "All products" divider that hands
 * over to the grid. The scroller is the Grab/Pandamart pattern and behaves
 * identically on mobile and desktop — a shelf, not a hero.
 *
 * Data-driven (ranked ids from `products.popularProducts`), zero seller
 * curation, and it hides entirely when nothing qualifies (new or quiet
 * stores), so the claim is never hollow.
 *
 * Cards are the SAME `ProductCard` the grid renders. That's deliberate: the
 * shelf gets every state the grid already handles (out-of-stock, low stock,
 * "Min N", custom-available, quick-add vs Choose, real <Link>s for crawlers)
 * for free, and the two surfaces can never drift. There is no "Bestseller"
 * ribbon — the section heading already says what the row is, and stamping it
 * on all ten would be noise.
 *
 * Candidate ids resolve against the SAME `products.list` the grid subscribes
 * to (Convex dedupes identical subscriptions — no extra read): visibility
 * rules apply once, and any candidate that has since been hidden, archived,
 * sold out or min-quantity-trapped drops out of the row rather than being
 * merchandised as unbuyable.
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
	// Rank order preserved; anything no longer buyable simply isn't shelved.
	const featured = popular
		.map((id) => byId.get(id))
		.filter((p): p is StorefrontProduct => p !== undefined)
		.filter(
			(p) =>
				p.inStock && !minQuantityUnreachable(p.minQuantity ?? 0, p.variants),
		);
	if (featured.length === 0) return null;

	return (
		<section aria-label="Popular this week" className="flex flex-col">
			<p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
				Popular this week
			</p>
			{/* Full-bleed scroller: the negative margins let cards run to the
			    screen edge (the parent section pads px-5 / lg:px-8) so a
			    part-visible card at the right edge advertises that the row
			    scrolls. Same treatment the category rail used before it became
			    chips. Fixed card widths — a shelf item shouldn't stretch. */}
			<div className="-mx-5 mt-2 flex snap-x gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] lg:-mx-8 lg:px-8 [&::-webkit-scrollbar]:hidden">
				{featured.map((product, index) => (
					<div
						key={product._id}
						className="w-40 shrink-0 snap-start sm:w-44 lg:w-52"
					>
						<ProductCard
							product={product}
							storeSlug={storeSlug}
							onQuickAdd={(p) => quickAddProductToCart(cart, p)}
							cartQuantity={cart.quantityForProduct(product._id)}
							cartSubtotal={cart.subtotalForProduct(product._id)}
							// The shelf sits above the grid, so its leading cards are
							// the storefront's real above-the-fold images.
							priority={index < 3}
						/>
					</div>
				))}
			</div>
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
