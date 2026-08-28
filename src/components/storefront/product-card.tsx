import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import {
	CalendarRange,
	ImagePlus,
	Plus,
	SlidersHorizontal,
} from "lucide-react";
import type { api } from "../../../convex/_generated/api";
import { bookingPriceSuffix } from "../../lib/booking-dates";
import { formatPrice } from "../../lib/format";
import { hasStartingPrice, minQuantityUnreachable } from "../../lib/variant";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";

export type StorefrontProduct = FunctionReturnType<
	typeof api.products.list
>[number];

interface ProductCardProps {
	product: StorefrontProduct;
	/**
	 * Store slug — the card's photo, name and "Choose" all resolve to the
	 * product's own page, `/{storeSlug}/p/{productSlug}`. Real `<Link>`s, not
	 * click handlers: an `<a href>` is the only thing a crawler can follow (the
	 * page ships canonical + Product JSON-LD, which is inert without one), and
	 * it's what gives buyers ⌘-click, open-in-new-tab, "copy link address" and
	 * the router's hover prefetch on the surface whose entire job is producing
	 * a pasteable link. See docs/storefront-product-pages.md.
	 */
	storeSlug: string;
	onQuickAdd: (product: StorefrontProduct) => void;
	/** Units of this product already in the cart (custom lines excluded). */
	cartQuantity: number;
	/**
	 * Running money total (minor units) of those in-cart units. 0 when every
	 * in-cart line is quote-priced, in which case only the count is shown.
	 */
	cartSubtotal: number;
	/** Above-the-fold hint for early grid rows — the first product photo a
	 * buyer sees is a common LCP element. See `product-grid.tsx`. */
	priority?: boolean;
}

export function ProductCard({
	product,
	storeSlug,
	onQuickAdd,
	cartQuantity,
	cartSubtotal,
	priority = false,
}: ProductCardProps) {
	// Multi-variant products can't be quick-added — the buyer must pick options
	// on the product page first. A custom line also forces the product page so the
	// buyer can see (and choose) the made-to-order option. See docs/custom-option.md.
	// A BOOKING listing always routes to its page too (S2): the stay is picked on
	// a calendar, so a cart quick-add has nothing to add.
	const isBooking = product.kind === "booking";
	const hasOptions = (product.options?.length ?? 0) > 0;
	const hasCustom = product.variants.some((v) => v.isCustom);
	const needsDetail = hasOptions || hasCustom || isBooking;
	// A product "can run out" if any of its variants hard-blocks (flags are now
	// resolved per-variant server-side). Only then does the low-stock badge apply.
	const canRunOut = product.variants.some(
		(v) => v.blockWhenOutOfStock === true,
	);
	// "In stock" rolls up across variants; only hard-block variants can be out.
	const outOfStock = !product.inStock;
	const lowStock =
		!outOfStock &&
		canRunOut &&
		product.totalOnHand > 0 &&
		product.totalOnHand <= 5;
	const priceVaries = product.priceTo > product.priceFrom;
	// "Price on quote": made-to-order variants at RM0 (seller quotes on the mockup).
	// allQuote = no priced variants at all; showFrom = the printed price is only a
	// floor — a cheaper/quote option exists, or a custom line's STARTING price the
	// seller tops up on the mockup (86eyhn4mr).
	const allQuote = product.hasQuotePricing && product.priceTo === 0;
	const showFrom =
		priceVaries ||
		product.hasQuotePricing ||
		hasStartingPrice(product.variants);
	const firstImage = product.imageUrls[0];
	// Minimum order quantity (≥2 when set — sanitizer normalizes 0/1 away).
	const minQuantity = product.minQuantity ?? 0;
	// Stock can no longer reach the minimum (all-hard-block, combined on-hand
	// below it) → the standard line is unavailable-with-reason, never a stepper
	// trap the buyer discovers at checkout. The custom line (its own CTA on the
	// product page) is unaffected, so cards with one keep their Choose button live.
	const minUnreachable = minQuantityUnreachable(minQuantity, product.variants);
	// A live custom line keeps Choose usable (its own CTA on the page is exempt
	// from the minimum) even when the standard variants can't reach it.
	const chooseDisabled = outOfStock || (minUnreachable && !hasCustom);
	const pageLink = {
		to: "/$slug/p/$productSlug",
		params: { slug: storeSlug, productSlug: product.slug },
	} as const;

	return (
		// `h-full` so the card FILLS its track. Grid cells and the popular
		// shelf's flex row both stretch, but without this the card was only as
		// tall as its own content — so a two-line name, or the "N in cart" line
		// appearing on some cards and not others, left a row of ragged tiles with
		// their Add buttons at different heights. The body is already `flex-1`
		// and the CTAs `mt-auto`, so filling is all that was missing.
		<div className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow duration-200 hover:shadow-md">
			<Link
				{...pageLink}
				// The photo is decorative here — the name link right below is the
				// card's accessible door, so screen readers don't announce the same
				// destination twice.
				tabIndex={-1}
				aria-hidden
				className="relative block aspect-square w-full overflow-hidden bg-muted text-left"
			>
				{firstImage ? (
					<AppImage
						src={firstImage}
						alt={product.name}
						aspect="absolute inset-0"
						className="transition-transform duration-300 group-hover:scale-105"
						priority={priority}
						// Tracks GRID_CLASS in product-grid.tsx (2 / sm:3 / lg:4).
						// These tiles are the bulk of a store home's payload — a
						// phone pulls ~320px files here instead of 1200px originals.
						sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
					/>
				) : (
					<div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/60 text-muted-foreground">
						<span className="flex size-11 items-center justify-center rounded-xl bg-background/80 shadow-sm">
							<ImagePlus className="size-5" />
						</span>
						<span className="max-w-24 text-center text-xs font-medium leading-tight">
							{product.name}
						</span>
					</div>
				)}
				{firstImage && (
					<div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/20 to-transparent" />
				)}
				{outOfStock ? (
					<span className="absolute left-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
						Out of stock
					</span>
				) : minUnreachable ? (
					// Reads with the "Min N" chip below: stock exists but can't reach
					// the minimum, so the standard line can't be ordered right now.
					<span className="absolute left-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
						Not enough stock
					</span>
				) : lowStock ? (
					<span className="absolute left-2 top-2 rounded-full bg-accent/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground backdrop-blur-sm">
						Low stock
					</span>
				) : null}
				{/* Overlaid on the image (not a text-zone row) so cards with chips
				    stay exactly the same height as their neighbours. */}
				{hasCustom || minQuantity >= 2 ? (
					<span className="absolute bottom-2 left-2 flex flex-wrap gap-1">
						{minQuantity >= 2 ? (
							// The order rule must be visible BEFORE the buyer adds — a
							// checkout-only surprise is a silent failure. See minOrderRules.
							<span className="rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
								Min {minQuantity}
							</span>
						) : null}
						{hasCustom ? (
							<span className="rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
								Custom available
							</span>
						) : null}
					</span>
				) : null}
			</Link>

			<div className="flex flex-1 flex-col gap-2 p-3">
				{/* Fixed 2-line name zone: 1-line names reserve the second line so the
				    price row sits at the same height on every card in a grid row. */}
				<Link
					{...pageLink}
					className="line-clamp-2 min-h-[2.05rem] text-left text-[13px] font-medium leading-tight"
				>
					{product.name}
				</Link>
				<p className="text-base font-bold leading-tight tabular-nums">
					{allQuote ? (
						<span className="text-sm font-semibold">Price on quote</span>
					) : (
						<>
							{showFrom ? (
								<span className="text-xs font-medium text-muted-foreground">
									From{" "}
								</span>
							) : null}
							{formatPrice(product.priceFrom, product.currency)}
							{isBooking ? (
								<span className="text-xs font-medium text-muted-foreground">
									{bookingPriceSuffix(product.booking?.packageDays)}
								</span>
							) : null}
						</>
					)}
				</p>
				{/* Running cart line — shows what the buyer has already committed for
				    this product (updates as they add more). Only rendered once it's in
				    the cart, so un-added tiles stay clean. The money total is dropped
				    when everything in cart is quote-priced (subtotal 0). */}
				{cartQuantity > 0 ? (
					<p className="text-xs font-semibold text-accent tabular-nums">
						{cartQuantity} in cart
						{cartSubtotal > 0
							? ` · ${formatPrice(cartSubtotal, product.currency)}`
							: ""}
					</p>
				) : null}
				{needsDetail ? (
					// Disabled-with-reason wins over a link that goes nowhere useful:
					// an unorderable product renders the inert button (an `<a>` can't
					// be disabled), an orderable one renders the real link so the CTA
					// is as copyable as the photo and the name. Booking listings say
					// what the page does — dates, not options.
					chooseDisabled ? (
						<Button
							type="button"
							disabled
							size="sm"
							variant="outline"
							className="mt-auto h-11 w-full rounded-xl"
						>
							{isBooking ? (
								<CalendarRange className="size-4" />
							) : (
								<SlidersHorizontal className="size-4" />
							)}
							{isBooking ? "Book" : "Choose"}
						</Button>
					) : (
						<Button
							asChild
							size="sm"
							variant="outline"
							className="mt-auto h-11 w-full rounded-xl"
						>
							<Link {...pageLink}>
								{isBooking ? (
									<CalendarRange className="size-4" />
								) : (
									<SlidersHorizontal className="size-4" />
								)}
								{isBooking ? "Book" : "Choose"}
							</Link>
						</Button>
					)
				) : (
					<Button
						type="button"
						onClick={() => onQuickAdd(product)}
						disabled={outOfStock || minUnreachable}
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
