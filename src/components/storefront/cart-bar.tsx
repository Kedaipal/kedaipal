import { useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { UseCart } from "../../hooks/useCart";
import { formatPrice } from "../../lib/format";
import { ORDERING_PAUSED_CTA, useOrderingPaused } from "./seasonal-break";

interface CartBarProps {
	cart: UseCart;
	/** Store slug — checkout lives at /$slug/checkout (86eybrhrt PR1). */
	storeSlug: string;
}

/**
 * The floating cart pill on the browse pages (z8r3fdegb5) — a navy capsule
 * inset from the screen edges with the running count, the money total and the
 * checkout action, instead of the old full-width bottom strip. It appears the
 * moment the first item lands and disappears with the last one: an empty cart
 * has nothing to check out, and permanent chrome saying "Empty" taught
 * nothing. Mobile floats it across the bottom; desktop parks the same pill
 * bottom-right. Pages that render it keep ≥96px of bottom padding (`pb-28`)
 * so the pill never sits on the footer.
 *
 * Off-Season Hold: the pill stays (the cart persists — nothing is lost when
 * the store reopens) but checkout is disabled with the reason on it; the
 * banner at the top of the page carries the full story.
 */
export function CartBar({ cart, storeSlug }: CartBarProps) {
	const navigate = useNavigate();
	const paused = useOrderingPaused();

	if (cart.itemCount === 0) return null;

	// Count badge caps at 99+ (design-system badge rule); the "N items" line
	// beside it carries the exact number until it, too, gets silly.
	const badge = cart.itemCount > 99 ? "99+" : String(cart.itemCount);

	return (
		<div className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 lg:inset-x-auto lg:right-6 lg:bottom-6">
			<div className="pointer-events-auto mx-auto flex h-14 max-w-md items-center gap-3 rounded-full bg-primary p-1.5 pl-2 text-primary-foreground shadow-lg shadow-primary/30 lg:mx-0 lg:w-auto lg:max-w-none">
				<span
					aria-hidden
					className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground tabular-nums dark:bg-background dark:text-foreground"
				>
					{badge}
				</span>
				<div className="flex min-w-0 flex-1 flex-col lg:flex-initial">
					<span className="text-[11px] leading-tight text-primary-foreground/70">
						{cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}
					</span>
					<span className="truncate text-sm font-bold leading-tight tabular-nums">
						{formatPrice(cart.total, cart.currency)}
					</span>
				</div>
				<button
					type="button"
					disabled={paused}
					onClick={() =>
						navigate({ to: "/$slug/checkout", params: { slug: storeSlug } })
					}
					className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-70 dark:bg-background dark:text-foreground dark:hover:bg-background/90"
				>
					{paused ? (
						ORDERING_PAUSED_CTA
					) : (
						<>
							Checkout
							<ArrowRight className="size-4" aria-hidden />
						</>
					)}
				</button>
			</div>
		</div>
	);
}
