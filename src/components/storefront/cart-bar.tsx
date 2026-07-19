import { ShoppingBag } from "lucide-react";
import { useState } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { UseCart } from "../../hooks/useCart";
import { formatPrice } from "../../lib/format";
import { Button } from "../ui/button";
import { CheckoutSheet, type PublicPickupLocation } from "./checkout-sheet";

interface CartBarProps {
	cart: UseCart;
	retailerId: Id<"retailers">;
	storeName: string;
	checkoutPhone: string | undefined;
	offerSelfCollect: boolean;
	offerDelivery: boolean;
	minFulfilmentNoticeDays: number | undefined;
	/** Store-wide minimum order value (minor units) — passed through to the
	 * checkout sheet's min-order-rule gate. */
	minOrderValue: number | undefined;
	pickupLocations: ReadonlyArray<PublicPickupLocation>;
}

export function CartBar({
	cart,
	retailerId,
	storeName,
	checkoutPhone,
	offerSelfCollect,
	offerDelivery,
	minFulfilmentNoticeDays,
	minOrderValue,
	pickupLocations,
}: CartBarProps) {
	const [checkoutOpen, setCheckoutOpen] = useState(false);
	const empty = cart.itemCount === 0;

	return (
		<>
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
						onClick={() => setCheckoutOpen(true)}
						className="h-12 px-5 text-sm"
					>
						Checkout on WhatsApp
					</Button>
				</div>
			</div>

			<CheckoutSheet
				open={checkoutOpen}
				onClose={() => setCheckoutOpen(false)}
				cart={cart}
				retailerId={retailerId}
				storeName={storeName}
				checkoutPhone={checkoutPhone}
				offerSelfCollect={offerSelfCollect}
				offerDelivery={offerDelivery}
				minFulfilmentNoticeDays={minFulfilmentNoticeDays}
				minOrderValue={minOrderValue}
				pickupLocations={pickupLocations}
			/>
		</>
	);
}
