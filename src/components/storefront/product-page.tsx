import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UseCart } from "../../hooks/useCart";
import { formatPrice } from "../../lib/format";
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

interface ProductPageViewProps {
	product: StorefrontProduct;
	retailerId: Id<"retailers">;
	storeName: string;
	storeSlug: string;
	cart: UseCart;
	/** Absolute canonical URL of this page — the Copy-link chip's payload. */
	canonicalUrl: string;
}

/**
 * The URL-addressable product view — /$slug/p/<productSlug> (86eybrhrt PR2).
 * This is what a shared WhatsApp link or a search result lands on: a real
 * page with the store's identity, a proper two-column layout on desktop, and
 * the same buy box as the in-store sheet (both compose product-purchase.tsx,
 * so they can't drift). Mobile keeps a single column with a sticky purchase
 * bar; in-store browsing on mobile still uses the sheet — this page is the
 * destination for links, not a detour in the middle of cart-building.
 */
export function ProductPageView({
	product,
	retailerId,
	storeName,
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
			{/* Store identity bar — where am I, how do I get back, what's in my
			    cart. The cart chip doubles as the desktop path to checkout. */}
			<header className="flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<Link
						to="/$slug"
						params={{ slug: storeSlug }}
						aria-label={`Back to ${storeName}`}
						className="tap-target flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
					>
						<ArrowLeft className="size-4" aria-hidden />
					</Link>
					<span className="truncate font-heading text-base font-bold">
						{storeName}
					</span>
				</div>
				{cart.itemCount > 0 ? (
					<button
						type="button"
						onClick={goToCheckout}
						className="tap-target flex shrink-0 items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3.5 py-1.5 text-xs font-semibold transition-colors hover:bg-accent/15"
					>
						<span className="relative flex size-5 items-center justify-center">
							<ShoppingBag className="size-4 text-accent" aria-hidden />
							<span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-primary-foreground">
								{cart.itemCount}
							</span>
						</span>
						<span className="tabular-nums">
							{cart.total > 0
								? formatPrice(cart.total, cart.currency)
								: "Checkout"}
						</span>
					</button>
				) : null}
			</header>

			<div className="mt-4 lg:flex lg:items-start lg:gap-10">
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

					{/* Purchase controls — sticky bottom bar on mobile (thumb reach),
					    in-flow under the buy box on desktop. One block, two homes. */}
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

/** Mobile: the sheet's snap carousel. Desktop: main image + thumb strip. The
 * selected thumb resets when the variant selection swaps the image set. */
function PageGallery({ images, name }: { images: string[]; name: string }) {
	const [index, setIndex] = useState(0);
	// Variant selection can swap the gallery to a shorter set — clamp back.
	useEffect(() => {
		setIndex(0);
	}, [images]);

	if (images.length === 0) {
		return <EmptyGallery name={name} className="aspect-[16/10] w-full" />;
	}

	const main = images[Math.min(index, images.length - 1)];

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
								onClick={() => setIndex(i)}
								aria-label={`Photo ${i + 1} of ${images.length}`}
								aria-current={i === index}
								className={`overflow-hidden rounded-lg border-2 transition-colors ${
									i === index
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
