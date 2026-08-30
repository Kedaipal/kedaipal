import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CalendarRange } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UseCart } from "../../hooks/useCart";
import { usePublishedHeight } from "../../hooks/usePublishedHeight";
import { bookingPriceSuffix } from "../../lib/booking-dates";
import { formatPrice } from "../../lib/format";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { Markdown } from "../ui/markdown";
import { ZoomableImage } from "../ui/zoomable-image";
import type { StorefrontProduct } from "./product-card";
import {
	addVariantToCart,
	CustomOrderCard,
	EmptyGallery,
	GoToCheckoutBar,
	OptionPills,
	PriceLabel,
	PurchaseActions,
	PurchaseHints,
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
	// Booking listing (S2 `86eyn4kbw`): the stay is picked on the calendar at
	// the next step, so the whole cart machinery below (options, stepper,
	// quick-add, go-to-checkout) is replaced by ONE door — "Request to book".
	const isBooking = product.kind === "booking";
	// The route reserves exactly this bar's height as bottom padding — see the
	// bar's own comment below.
	const barRef = usePublishedHeight<HTMLDivElement>("--storefront-bar-h");

	return (
		<>
			{/* The same brand header the store home and category pages render —
			    a buyer arriving from a shared WhatsApp link lands in the SELLER's
			    store, not on an anonymous product card. */}
			<StorefrontHeader retailer={retailer} asPageHeading={false} />

			{/* Back to the catalog — mirrors the category page's affordance, so
			    every level of the storefront has the same way out. The cart lives
			    in the sticky purchase bar below (count + total + go to checkout),
			    so there's no second cart chip up here saying the same thing. */}
			<div className="px-5 pt-4 lg:px-8">
				<Link
					to="/$slug"
					params={{ slug: storeSlug }}
					activeOptions={{ exact: true }}
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
							<span className="flex items-baseline gap-1">
								<PriceLabel value={pp.priceLabel} className="text-2xl" />
								{isBooking ? (
									<span className="text-sm font-medium text-muted-foreground">
										{bookingPriceSuffix(product.booking?.packageLength)}
									</span>
								) : null}
							</span>
							<ShareLinkChip url={canonicalUrl} />
						</div>
					</div>

					{/* Description sits directly under the title, ahead of the option
					    pickers: "what is this" is the question a buyer answers before
					    "which size", and it used to sit below the custom-order card
					    where it read as a footnote. Renders nothing at all when the
					    seller hasn't written one — no empty block, no stray gap. */}
					{product.description ? (
						<ProductDescription text={product.description} />
					) : null}

					{isBooking ? (
						<div className="mt-4 flex flex-col gap-2">
							{(product.booking?.securityDeposit ?? 0) > 0 ? (
								// Stated BEFORE requesting — the deposit must never be a
								// surprise at payment time (86eyn4kee).
								<p className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm leading-relaxed">
									<span className="font-semibold">
										+{" "}
										{formatPrice(
											product.booking?.securityDeposit ?? 0,
											product.currency,
										)}{" "}
										refundable security deposit
									</span>
									<span className="text-muted-foreground">
										{" "}
										— collected with your payment, returned after check-out.
									</span>
								</p>
							) : null}
							<p className="rounded-xl bg-accent/5 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
								Pick your dates on the next step — you&apos;ll see live
								availability on a calendar, and nothing is paid until the seller
								approves your request.
							</p>
						</div>
					) : (
						<>
							<OptionPills pp={pp} />
							<PurchaseHints pp={pp} />
							<CustomOrderCard
								pp={pp}
								onAdd={(p, variant, qty, custom) =>
									addVariantToCart(cart, p, variant, qty, custom)
								}
							/>
						</>
					)}

					{/* Purchase controls — fixed bottom bar on mobile (thumb reach),
					    in-flow under the buy box on desktop (`lg:static`). One block,
					    two homes. `PurchaseActions` guarantees it always has a CTA,
					    whatever the product's type, so this chrome is never empty.

					    FIXED on mobile, matching the storefront CartBar: it stays OUT
					    of document flow, so the powered-by footer renders as page
					    content ABOVE it, same as the store home. Sticky would sit in
					    flow and push the footer below the bar. The route reserves
					    clearance equal to `--storefront-bar-h`, which this bar
					    publishes as it's measured — so the gap under the footer badge
					    is the footer's own padding and nothing else, whatever height
					    the bar happens to be. */}
					<div
						ref={barRef}
						className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-5 py-4 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur pb-[max(1rem,env(safe-area-inset-bottom))] lg:static lg:z-auto lg:mt-6 lg:border-t-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none"
					>
						<div className="mx-auto max-w-xl lg:mx-0 lg:max-w-none">
							{isBooking ? (
								<div className="flex flex-col gap-1.5">
									<Button asChild className="tap-target h-12 w-full">
										<Link
											to="/$slug/checkout"
											params={{ slug: storeSlug }}
											search={{ booking: product.slug }}
										>
											<CalendarRange className="size-4" aria-hidden />
											Request to book
										</Link>
									</Button>
									<p className="text-center text-xs text-muted-foreground">
										Seller confirms within 24 hours — nothing is paid yet.
									</p>
								</div>
							) : (
								<>
									<TotalPreviewRow pp={pp} />
									<PurchaseActions
										pp={pp}
										onAdd={(p, variant, qty, custom) =>
											addVariantToCart(cart, p, variant, qty, custom)
										}
									/>
									<GoToCheckoutBar
										cartItemCount={cart.itemCount}
										cartTotal={cart.total}
										currency={product.currency}
										onCheckout={goToCheckout}
									/>
								</>
							)}
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

/**
 * The seller's own copy, directly under the title. Markdown, so it keeps the
 * line breaks and lists sellers write ingredients and lead times in.
 *
 * Clamped to three lines with a Read-more toggle, because moving it above the
 * option pickers means its length now decides how far down the pickers sit.
 * Measured on the dev catalog: a 240-character description already runs four
 * lines at 430px and pushes the Size pills under the fixed purchase bar — and
 * a seller listing ingredients, allergens and lead time writes far more than
 * 240 characters. The clamp bounds that at three lines no matter what's typed,
 * while the full text stays one tap away (and is always in the DOM, so it's
 * still indexable and selectable).
 */
export function ProductDescription({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	const [clamped, setClamped] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	// Only measure while collapsed: expanded, scrollHeight === clientHeight by
	// definition, so re-checking there would decide the text no longer overflows
	// and yank the "Show less" button out from under the reader.
	useEffect(() => {
		if (expanded) return;
		const el = ref.current;
		if (!el) return;
		const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
		check();
		const observer = new ResizeObserver(check);
		observer.observe(el);
		return () => observer.disconnect();
	}, [expanded]);

	return (
		<div className="mt-3">
			<div ref={ref} className={expanded ? undefined : "line-clamp-3"}>
				<Markdown>{text}</Markdown>
			</div>
			{clamped ? (
				<button
					type="button"
					onClick={() => setExpanded((open) => !open)}
					aria-expanded={expanded}
					className="mt-1 py-1 text-sm font-medium text-accent underline-offset-2 hover:underline"
				>
					{expanded ? "Show less" : "Read more"}
				</button>
			) : null}
		</div>
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
						sizes="256px"
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
					// Desktop hero fills the left column of the two-column layout.
					sizes="(min-width: 1024px) 45vw, 100vw"
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
									sizes="56px"
								/>
							</button>
						))}
					</div>
				) : null}
			</div>
		</>
	);
}
