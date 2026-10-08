import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import {
	Bell,
	CalendarClock,
	CalendarRange,
	ImagePlus,
	Minus,
	Plus,
	SlidersHorizontal,
	Zap,
} from "lucide-react";
import type { api } from "../../../convex/_generated/api";
import { formatEventBadge } from "../../../convex/lib/productEvent";
import { usePromoClock } from "../../hooks/usePromoClock";
import { bookingPriceSuffix, weekendRateSuffix } from "../../lib/booking-dates";
import { formatClaimCountdown } from "../../lib/countdown";
import { formatPrice } from "../../lib/format";
import {
	effectivePriceFrom,
	promoLive,
	promoPercentOff,
} from "../../lib/promo";
import { cn } from "../../lib/utils";
import { hasStartingPrice, minQuantityUnreachable } from "../../lib/variant";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { ORDERING_PAUSED_CTA, useOrderingPaused } from "./seasonal-break";

export type StorefrontProduct = FunctionReturnType<
	typeof api.products.list
>[number];

interface ProductCardProps {
	product: StorefrontProduct;
	/**
	 * Store slug — the card's photo, name and "Options" all resolve to the
	 * product's own page, `/{storeSlug}/p/{productSlug}`. Real `<Link>`s, not
	 * click handlers: an `<a href>` is the only thing a crawler can follow (the
	 * page ships canonical + Product JSON-LD, which is inert without one), and
	 * it's what gives buyers ⌘-click, open-in-new-tab, "copy link address" and
	 * the router's hover prefetch on the surface whose entire job is producing
	 * a pasteable link. See docs/storefront-product-pages.md.
	 */
	storeSlug: string;
	onQuickAdd: (product: StorefrontProduct) => void;
	/** The stepper's "−" — one unit off this product's single cart line
	 * (`useCart.quickRemoveProduct`). */
	onQuickRemove: (product: StorefrontProduct) => void;
	/** Units of this product already in the cart (custom lines excluded) —
	 * `> 0` swaps the Add pill for the −/n/+ stepper. */
	cartQuantity: number;
	/** Above-the-fold hint for early grid rows — the first product photo a
	 * buyer sees is a common LCP element. See `product-grid.tsx`. */
	priority?: boolean;
}

/** One full-width pill CTA per card, every state (z8r3fdegb5 — Arif's 12 Sep
 * spec supersedes the price+round-button row: price sits on its own line so
 * 4–5-digit prices never clip, and the CTA keeps one size in every state). */
const CTA_CLASS = "h-9 w-full rounded-full text-[13px] font-semibold lg:h-10";

export function ProductCard({
	product,
	storeSlug,
	onQuickAdd,
	onQuickRemove,
	cartQuantity,
	priority = false,
}: ProductCardProps) {
	// Off-Season Hold (z8r3fday24): every quick-add flips together.
	const paused = useOrderingPaused();
	// Multi-variant products can't be quick-added — the buyer must pick options
	// on the product page first. A custom line also forces the product page so the
	// buyer can see (and choose) the made-to-order option. See docs/custom-option.md.
	// A BOOKING listing always routes to its page too (S2): the stay is picked on
	// a calendar, so a cart quick-add has nothing to add.
	const isBooking = product.kind === "booking";
	// Second per-night rate on the nights the seller named (S13) — shown
	// under the base price so a guest knows both before opening the listing.
	const weekendSuffix = isBooking ? weekendRateSuffix(product.booking) : null;
	const hasOptions = (product.options?.length ?? 0) > 0;
	const hasCustom = product.variants.some((v) => v.isCustom);
	// An EVENT always routes to its page too (`z8r3fdhh45`): an RSVP is checked
	// out standalone, so there is no cart line for a quick-add to make — and
	// the page carries the terms (fixed date, venue, seats left) a guest has to
	// read before committing.
	const isEvent = product.event !== undefined;
	const needsDetail = hasOptions || hasCustom || isBooking || isEvent;
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
	// product page) is unaffected, so cards with one keep their Options button live.
	const minUnreachable = minQuantityUnreachable(minQuantity, product.variants);
	// Event RSVP (`z8r3fdff9u`). The date IS the product's identity here — a
	// guest scanning the grid decides on "Thu 25 Sep" before anything else — so
	// it leads the chip row rather than sitting among the micro-rules.
	const event = product.event;
	const seatsLeft = product.eventSeatsLeft;
	const eventFull =
		event !== undefined && seatsLeft !== undefined && seatsLeft <= 0;
	// A live custom line keeps Options usable (its own CTA on the page is exempt
	// from the minimum) even when the standard variants can't reach it.
	const chooseDisabled = eventFull || (minUnreachable && !hasCustom);
	// The stepper's "+" stops at what's actually addable: remaining hard-block
	// stock, and remaining event seats net of what's already in the cart —
	// the quick-add helper clamps the same way, so an enabled "+" always adds.
	const stockCap =
		canRunOut && !isBooking ? product.totalOnHand : Number.POSITIVE_INFINITY;
	const seatCap =
		event !== undefined && seatsLeft !== undefined
			? seatsLeft
			: Number.POSITIVE_INFINITY;
	const atCap = cartQuantity >= Math.min(stockCap, seatCap);
	// The stepper's "−" drops the WHOLE line when one unit off would fall below
	// the product's minimum (`useCart.quickRemoveProduct`). On a min-order
	// product that is the DEFAULT state, not an edge case — quick-add opens the
	// line AT the minimum — so the control has to say what it does. A minus
	// glyph labelled "Remove one" that silently clears four units is the button
	// lying about its own consequence, and the card's own "Min N" chip only
	// states the rule, not what this tap will do about it.
	const stepDownClearsLine =
		minQuantity >= 2 && cartQuantity <= Math.max(1, minQuantity);
	const stepDownLabel = stepDownClearsLine
		? `Remove ${product.name} from cart — minimum order is ${minQuantity}`
		: `Remove one ${product.name}`;
	// Does the bottom-left overlay row render at all? Drives the no-photo
	// placeholder's clearance — see the tile below.
	// Promotion (z8r3fdcw72). The card carries the whole sale story ON THE
	// IMAGE — badge, countdown, units left — so a card on sale is exactly as
	// tall as the one beside it and the grid never staggers. Deliberately NOT
	// the scissors strip: at ~180px the blades and ghost text turn to mush.
	const promoClock = usePromoClock(product.promoState);
	const onPromo = promoLive(product.promoState, promoClock);
	const salePriceFrom = effectivePriceFrom(product, promoClock);
	const saleOn = onPromo && salePriceFrom < product.priceFrom;
	const percentOff = saleOn
		? promoPercentOff(product.priceFrom, salePriceFrom)
		: null;
	const teasing = product.promoState?.phase === "scheduled";
	const promoEndsAt = product.promoState?.endsAt;
	const promoStartsAt = product.promoState?.startsAt;
	const countdownAt = teasing
		? promoStartsAt
		: saleOn
			? promoEndsAt
			: undefined;
	const unitsLeft = saleOn ? product.promoState?.unitsLeft : undefined;
	// A sale strip sits where the chips do, so it has to claim the same
	// clearance on a photo-less tile or it paints over the product's name.
	const hasSaleStrip = countdownAt !== undefined || unitsLeft !== undefined;
	const hasBottomChips =
		event !== undefined || hasCustom || minQuantity >= 2 || hasSaleStrip;
	// A LIVE flash sale breathes (Zaki, 9 Oct) — a slow mint heartbeat that
	// pulls the eye across a grid. Only a TIMED sale, never a plain discount:
	// urgency you can't run out of isn't urgency, and a storefront where every
	// card pulsed would read as decoration. The ring is separate from the
	// animation so reduced motion still shows which card is on sale.
	const flashGlow = saleOn && promoEndsAt !== undefined;
	const pageLink = {
		to: "/$slug/p/$productSlug",
		params: { slug: storeSlug, productSlug: product.slug },
	} as const;

	return (
		// `h-full` so the card FILLS its track. Grid cells and the popular
		// shelf's flex row both stretch, but without this the card was only as
		// tall as its own content — so a two-line name left a row of ragged tiles
		// with their CTAs at different heights. The body is already `flex-1`
		// and the CTAs `mt-auto`, so filling is all that was missing.
		// The photo is inset (`p-1.5` + its own radius) per the polish pass —
		// the card reads as a tile holding a photo, not a photo with a caption.
		<div
			className={cn(
				"group flex h-full flex-col overflow-hidden rounded-[18px] border bg-card p-1.5 transition-shadow duration-200 hover:shadow-md",
				flashGlow
					? "border-accent/50 ring-2 ring-accent/35 animate-kp-flash-glow motion-reduce:animate-none"
					: "border-border",
			)}
		>
			<Link
				{...pageLink}
				// The photo is decorative here — the name link right below is the
				// card's accessible door, so screen readers don't announce the same
				// destination twice.
				tabIndex={-1}
				aria-hidden
				className="relative block aspect-square w-full overflow-hidden rounded-[13px] bg-muted text-left"
			>
				{/* The bottom-left chip row sits ON the image tile. With no photo the
				    tile is the name placeholder instead, and the chips were painting
				    over it — already true of a lone "Min N", and unmissable once an
				    event adds a date chip and a seat count. The placeholder gets the
				    row's height back as padding when chips are present. */}
				{firstImage ? (
					<AppImage
						src={firstImage}
						alt={product.name}
						aspect="absolute inset-0"
						className={`transition-transform duration-300 group-hover:scale-105 ${
							outOfStock ? "grayscale opacity-60" : ""
						}`}
						priority={priority}
						// Tracks GRID_CLASS in product-grid.tsx (2 / sm:3 / lg:4).
						// These tiles are the bulk of a store home's payload — a
						// phone pulls ~320px files here instead of 1200px originals.
						sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
						// Hairline, not raised: the card around this tile already
						// carries `hover:shadow-md`, and a shadow per tile turns a
						// 16-tile grid into mush.
						frame="hairline"
					/>
				) : (
					<div
						className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/60 text-muted-foreground ${
							hasBottomChips ? "pb-9" : ""
						}`}
					>
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
				{eventFull ? (
					// Outranks "Out of stock": the seats are the binding constraint on
					// an event, and a guest reading "out of stock" would go looking for
					// a restock that isn't what's happening.
					<span className="absolute left-2 top-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						Fully booked
					</span>
				) : outOfStock ? (
					<span className="absolute left-2 top-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						Out of stock
					</span>
				) : minUnreachable ? (
					// Reads with the "Min N" chip below: stock exists but can't reach
					// the minimum, so the standard line can't be ordered right now.
					<span className="absolute left-2 top-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						Not enough stock
					</span>
				) : lowStock ? (
					<span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground shadow-sm">
						Low stock
					</span>
				) : saleOn ? (
					// Last in the chain on purpose: every badge above it is a reason
					// the buyer may NOT be able to order, which outranks a reason to
					// want to. Navy + bolt when the sale is timed, mint when it is a
					// plain discount — two states of one idea, told apart at a glance.
					<span
						className={cn(
							"absolute left-2 top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm",
							promoEndsAt !== undefined
								? "bg-primary text-primary-foreground"
								: "bg-accent text-accent-foreground",
						)}
					>
						{promoEndsAt !== undefined ? (
							<Zap className="size-3" aria-hidden />
						) : null}
						{percentOff !== null
							? `−${percentOff}%`
							: (product.promoState?.label ?? "Sale")}
					</span>
				) : null}
				{/* The sale strip — a full-width band across the foot of the image.
				    Carries the countdown (to the drop when teasing, to the end when
				    live) and the units left, so the card sells the urgency without
				    adding a row to the text zone. */}
				{hasSaleStrip ? (
					<span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-primary/90 px-2 py-1 text-[11px] text-primary-foreground backdrop-blur-sm">
						{countdownAt !== undefined ? (
							<span className="flex items-center gap-1 font-semibold tabular-nums">
								<Zap className="size-3 shrink-0" aria-hidden />
								{teasing
									? // Name the price it drops TO, not just when: "in 1h
										// 11m" alone asks the buyer to come back for a number
										// they were never told.
										`${
											product.promoPriceFrom !== undefined
												? `${formatPrice(product.promoPriceFrom, product.currency)} `
												: ""
										}in ${formatClaimCountdown(countdownAt - promoClock)}`
									: formatClaimCountdown(countdownAt - promoClock)}
							</span>
						) : (
							<span className="font-medium">
								{product.promoState?.label ?? "Sale"}
							</span>
						)}
						{unitsLeft !== undefined ? (
							<span className="font-medium">
								{unitsLeft} of {product.promoState?.unitCap} left
							</span>
						) : null}
					</span>
				) : null}
				{/* Overlaid on the image (not a text-zone row) so cards with chips
				    stay exactly the same height as their neighbours. */}
				{hasBottomChips ? (
					<span
						className={cn(
							"absolute left-2 flex flex-wrap items-center gap-1",
							hasSaleStrip ? "bottom-8" : "bottom-2",
						)}
					>
						{event !== undefined ? (
							// Accent, normal case, a size up: this is the headline fact,
							// not a micro-rule. Overlaid on the image like its neighbours
							// so an event card stays exactly as tall as the rest of its row.
							<span className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground shadow-sm">
								<CalendarClock className="size-3" aria-hidden />
								{formatEventBadge(event)}
							</span>
						) : null}
						{event !== undefined && seatsLeft !== undefined && seatsLeft > 0 ? (
							<span className="rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
								{seatsLeft} {seatsLeft === 1 ? "seat" : "seats"} left
							</span>
						) : null}
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

			<div className="flex flex-1 flex-col gap-1 p-2">
				{/* Fixed 2-line name zone: 1-line names reserve the second line so the
				    price row sits at the same height on every card in a grid row. */}
				<Link
					{...pageLink}
					className="line-clamp-2 min-h-[2.05rem] text-left text-[13px] font-medium leading-tight"
				>
					{product.name}
				</Link>
				{/* Price on its own line, never wrapping mid-figure — RM 9,999.99
				    stays whole (Arif, 12 Sep). */}
				<p className="overflow-hidden whitespace-nowrap text-[15px] font-bold leading-tight tabular-nums">
					{allQuote ? (
						<span className="text-sm font-semibold">Price on quote</span>
					) : (
						<>
							{showFrom ? (
								<span className="text-xs font-medium text-muted-foreground">
									From{" "}
								</span>
							) : null}
							{formatPrice(
								saleOn ? salePriceFrom : product.priceFrom,
								product.currency,
							)}
							{saleOn ? (
								<span className="ml-1.5 text-xs font-medium text-muted-foreground line-through">
									{formatPrice(product.priceFrom, product.currency)}
								</span>
							) : null}
							{isBooking ? (
								<span className="text-xs font-medium text-muted-foreground">
									{bookingPriceSuffix(
										product.booking?.packageLength,
										product.booking?.packageUnit,
									)}
								</span>
							) : null}
						</>
					)}
				</p>
				{weekendSuffix && product.booking?.weekendPrice !== undefined ? (
					<p className="overflow-hidden whitespace-nowrap text-xs font-medium text-muted-foreground tabular-nums">
						{formatPrice(product.booking.weekendPrice, product.currency)}
						{weekendSuffix}
					</p>
				) : null}
				<div className="mt-auto pt-1.5">
					{paused ? (
						<Button type="button" disabled size="sm" className={CTA_CLASS}>
							{ORDERING_PAUSED_CTA}
						</Button>
					) : outOfStock ? (
						// The design's "Notify" — a no-op for now (deliberate: ClickUp
						// z8r3fdegb5 ships the affordance ahead of the feature), so it
						// stays disabled with the promise attached. `title` only reaches
						// a mouse, so the accessible name carries it too — otherwise a
						// screen-reader user hears "Notify, dimmed" and is told nothing.
						<span title="Coming soon" className="block">
							<Button
								type="button"
								disabled
								size="sm"
								variant="outline"
								aria-label={`Notify me when ${product.name} is back in stock — coming soon`}
								className={CTA_CLASS}
							>
								<Bell className="size-4" aria-hidden />
								Notify
							</Button>
						</span>
					) : needsDetail ? (
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
								className={CTA_CLASS}
							>
								{isBooking ? (
									<CalendarRange className="size-4" aria-hidden />
								) : isEvent ? (
									<CalendarClock className="size-4" aria-hidden />
								) : (
									<SlidersHorizontal className="size-4" aria-hidden />
								)}
								{isBooking ? "Book" : isEvent ? "RSVP" : "Options"}
							</Button>
						) : (
							<Button asChild size="sm" variant="outline" className={CTA_CLASS}>
								<Link {...pageLink}>
									{isBooking ? (
										<CalendarRange className="size-4" aria-hidden />
									) : isEvent ? (
										<CalendarClock className="size-4" aria-hidden />
									) : (
										<SlidersHorizontal className="size-4" aria-hidden />
									)}
									{isBooking ? "Book" : isEvent ? "RSVP" : "Options"}
								</Link>
							</Button>
						)
					) : cartQuantity > 0 ? (
						// In the cart → the CTA becomes the quantity itself (replaces
						// the old "N in cart · RM" line). Full-width mint stepper,
						// count tabular so 100 sits as steady as 1.
						<div
							className={`flex items-center justify-between bg-accent text-accent-foreground ${CTA_CLASS}`}
						>
							<button
								type="button"
								onClick={() => onQuickRemove(product)}
								aria-label={stepDownLabel}
								title={stepDownClearsLine ? stepDownLabel : undefined}
								className="flex h-full w-11 items-center justify-center rounded-full transition-colors hover:bg-accent-foreground/10"
							>
								<Minus className="size-4" aria-hidden />
							</button>
							<span
								aria-live="polite"
								className="min-w-6 text-center text-sm font-bold tabular-nums"
							>
								{cartQuantity}
							</span>
							<button
								type="button"
								onClick={() => onQuickAdd(product)}
								disabled={atCap}
								aria-label={`Add one more ${product.name}`}
								title={atCap ? "No more stock" : undefined}
								className="flex h-full w-11 items-center justify-center rounded-full transition-colors hover:bg-accent-foreground/10 disabled:opacity-40"
							>
								<Plus className="size-4" aria-hidden />
							</button>
						</div>
					) : (
						// An event never reaches this branch (`z8r3fdhh45`) — it is
						// `needsDetail`, so it routes to its page and from there to the
						// standalone RSVP checkout. No seat gate is needed here.
						<Button
							type="button"
							onClick={() => onQuickAdd(product)}
							disabled={minUnreachable}
							size="sm"
							className={CTA_CLASS}
						>
							<Plus className="size-4" aria-hidden />
							Add
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
