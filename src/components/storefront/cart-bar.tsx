import { useNavigate } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import type { UseCart } from "../../hooks/useCart";
import { formatPrice } from "../../lib/format";
import { Button } from "../ui/button";

interface CartBarProps {
	cart: UseCart;
	/** Store slug — checkout lives at /$slug/checkout (86eybrhrt PR1). */
	storeSlug: string;
}

/**
 * The fixed bottom cart bar on the browse pages. Checkout is a real route now
 * (not a sheet this bar owns), so all the checkout plumbing that used to pass
 * through here — pickup locations, fulfilment settings, min-order rules —
 * lives with the checkout page instead.
 */
export function CartBar({ cart, storeSlug }: CartBarProps) {
	const navigate = useNavigate();
	const empty = cart.itemCount === 0;

	return (
		<div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-5 py-3 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]">
			<div className="mx-auto flex max-w-6xl items-center gap-3">
				<div className="flex flex-1 items-center gap-3">
					<div className="relative flex size-11 items-center justify-center rounded-full bg-muted">
						<ShoppingBag className="size-5" />
						{!empty ? (
							<span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
								{cart.itemCount}
							</span>
						) : null}
					</div>
					<div className="flex flex-col">
						<span className="text-[11px] uppercase tracking-wide text-muted-foreground">
							Cart
						</span>
						<span className="text-sm font-semibold">
							{empty ? "Empty" : formatPrice(cart.total, cart.currency)}
						</span>
					</div>
				</div>
				<Button
					type="button"
					disabled={empty}
					onClick={() =>
						navigate({ to: "/$slug/checkout", params: { slug: storeSlug } })
					}
					className="h-12 px-6 text-sm"
				>
					Checkout
				</Button>
			</div>
		</div>
	);
}
