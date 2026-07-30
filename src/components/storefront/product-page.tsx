import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UseCart } from "../../hooks/useCart";
import { AppImage } from "../ui/app-image";
import { Markdown } from "../ui/markdown";
import { ZoomableImage } from "../ui/zoomable-image";
import type { StorefrontProduct } from "./product-card";
import {
	AddToCartButton,
	addVariantToCart,
	CustomOrderCard,
	EmptyGallery,
	GoToCheckoutBar,
	OptionPills,
	PurchaseHints,
	PurchaseStepper,
	ShareLinkChip,
	TotalPreviewRow,
	useProductPurchase,
} from "./product-purchase";
import {
	StorefrontHeader,
	type StorefrontHeaderRetailer,
} from "./storefront-header";

interface ProductPageViewProps {
	product: StorefrontProduct;
	retailerId: Id<"retailers">;
	/** Drives the SHARED storefront brand header — same component the store
	 * home and category pages render, so a buyer landing here from a WhatsApp
	 * link sees the seller's identity, not a bare product card. */
	retailer: StorefrontHeaderRetailer;
	storeSlug: string;
	cart: UseCart;
	/** Absolute canonical URL of this page — the Copy-link chip's payload. */
	canonicalUrl: string;
}

/**
 * The URL-addressable product view — /$slug/p/<productSlug> (86eybrhrt PR2).
 * This is what a shared WhatsApp link or a search result lands on: a real
 * page carrying the SHARED storefront header (same brand block as the store
 * home and category pages), a back link to the catalog, and a two-column
 * layout on desktop. Mobile is a single column with a sticky purchase bar.
 * This is the ONLY product view on every breakpoint — the buy box lives in
 * product-purchase.tsx.
 */
export function ProductPageView({
	product,
	retailerId,
	retailer,
	storeSlug,
	cart,
	canonicalUrl,
}: ProductPageViewProps) {
	const navigate = useNavigate();
	const pp = useProductPurchase({
		product,
		retailerId,
		cartQuantity: cart.quantityForProduct(product._id),
	});
	const goToCheckout = () =>
		navigate({ to: "/$slug/checkout", params: { slug: storeSlug } });

	return (
		<>
			{/* The same brand header the store home and category pages render —
			    a buyer arriving from a shared WhatsApp link lands in the SELLER's
			    store, not on an anonymous product card. */}
			<StorefrontHeader retailer={retailer} />

			{/* Back to the catalog — mirrors the category page's affordance, so
			    every level of the storefront has the same way out. The cart lives
			    in the sticky purchase bar below (count + total + go to checkout),
			    so there's no second cart chip up here saying the same thing. */}
			<div className="px-5 pt-4 lg:px-8">
				<Link
					to="/$slug"
					params={{ slug: storeSlug }}
					className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					<ArrowLeft className="size-4" aria-hidden />
					All products
				</Link>
			</div>

			<div className="mt-4 px-5 lg:flex lg:items-start lg:gap-10 lg:px-8">
				{/* Gallery — snap carousel on mobile (the sheet's pattern), main
				    image + thumbnail strip on desktop. */}
				<div className="lg:w-[44%] lg:shrink-0">
					<PageGallery images={pp.images} name={product.name} />
				</div>

				<div className="mt-4 min-w-0 flex-1 lg:mt-0">
					<div className="flex flex-col gap-1">
						<h1 className="font-heading text-2xl font-extrabold leading-tight tracking-tight">
							{product.name}
						</h1>
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
							<p className="text-2xl font-bold tabular-nums">{pp.priceLabel}</p>
							<ShareLinkChip url={canonicalUrl} />
						</div>
					</div>

					<OptionPills pp={pp} />
					<PurchaseHints pp={pp} />
					<CustomOrderCard
						pp={pp}
						onAdd={(p, variant, qty, custom) =>
							addVariantToCart(cart, p, variant, qty, custom)
						}
					/>

					{product.description ? (
						<div className="mt-4">
							<Markdown>{product.description}</Markdown>
						</div>
					) : null}

					{/* Purchase controls — fixed bottom bar on mobile (thumb reach),
					    in-flow under the buy box on desktop (`lg:static`). One block,
					    two homes.

					    FIXED on mobile, matching the storefront CartBar: it stays OUT
					    of document flow, so the powered-by footer renders as page
					    content ABOVE it, same as the store home. Sticky would sit in
					    flow and push the footer below the bar. The route reserves
					    matching bottom clearance. */}
					<div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-5 py-4 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur pb-[max(1rem,env(safe-area-inset-bottom))] lg:static lg:z-auto lg:mt-6 lg:border-t-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
						<div className="mx-auto max-w-xl lg:mx-0 lg:max-w-none">
							<TotalPreviewRow pp={pp} />
							<div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
								<PurchaseStepper pp={pp} />
								<AddToCartButton
									pp={pp}
									onAdd={(p, variant, qty, custom) =>
										addVariantToCart(cart, p, variant, qty, custom)
									}
								/>
							</div>
							<GoToCheckoutBar
								cartItemCount={cart.itemCount}
								cartTotal={cart.total}
								currency={product.currency}
								onCheckout={goToCheckout}
							/>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

/** Mobile: the sheet's snap carousel. Desktop: main image + thumb strip. */
function PageGallery({ images, name }: { images: string[]; name: string }) {
	// Track the chosen image by URL, not index: picking a variant can swap the
	// whole set, and a stale index would either point at the wrong photo or out
	// of range. A URL that's no longer in the set simply falls back to the first
	// one — self-correcting, so no reset effect is needed.
	const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

	if (images.length === 0) {
		return <EmptyGallery name={name} className="aspect-[16/10] w-full" />;
	}

	const main =
		selectedUrl && images.includes(selectedUrl) ? selectedUrl : images[0];

	return (
		<>
			{/* Mobile carousel — identical pattern to the detail sheet. */}
			<div className="-mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 lg:hidden">
				{images.map((url) => (
					<ZoomableImage
						key={url}
						src={url}
						alt={name}
						caption={name}
						wrapperClassName="w-64 shrink-0 snap-start"
						className="aspect-square w-full rounded-2xl object-cover"
					/>
				))}
			</div>

			{/* Desktop: hero + thumbnails. */}
			<div className="hidden lg:block">
				<ZoomableImage
					src={main}
					alt={name}
					caption={name}
					wrapperClassName="block w-full"
					className="aspect-square w-full rounded-2xl object-cover"
				/>
				{images.length > 1 ? (
					<div className="mt-3 flex flex-wrap gap-2">
						{images.map((url, i) => (
							<button
								key={url}
								type="button"
								onClick={() => setSelectedUrl(url)}
								aria-label={`Photo ${i + 1} of ${images.length}`}
								aria-current={url === main}
								className={`overflow-hidden rounded-lg border-2 transition-colors ${
									url === main
										? "border-accent"
										: "border-transparent hover:border-accent/40"
								}`}
							>
								<AppImage
									src={url}
									alt=""
									aspect="size-14"
									rounded="rounded-md"
								/>
							</button>
						))}
					</div>
				) : null}
			</div>
		</>
	);
}
