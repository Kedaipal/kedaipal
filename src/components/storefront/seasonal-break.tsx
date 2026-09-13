import { PauseCircle } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { orderingPausedMessage } from "../../../convex/lib/seasonalHold";

/**
 * Off-Season Hold on the buyer side (z8r3fday24). The store is still here —
 * catalog, photos, prices — it just isn't taking orders this season. The
 * public payload's `orderingPaused` is provided once per storefront route and
 * read by every ordering CTA (cart bar, add-to-cart, quick add, checkout), so
 * the whole surface flips together and no button can quietly still work.
 * The server refuses on every order-create path with the same message, so a
 * stale tab can't place an order either.
 */
const OrderingPausedContext = createContext(false);

export function OrderingPausedProvider({
	paused,
	children,
}: {
	paused: boolean;
	children: ReactNode;
}) {
	return (
		<OrderingPausedContext.Provider value={paused}>
			{children}
		</OrderingPausedContext.Provider>
	);
}

export function useOrderingPaused(): boolean {
	return useContext(OrderingPausedContext);
}

/** Label every disabled ordering CTA shares while the store is paused. */
export const ORDERING_PAUSED_CTA = "Ordering paused";

/**
 * The seasonal-break note under the storefront header. Calm and warm — a
 * "back soon" sign on the shutter, not a closed-down store. Renders nothing
 * when the store is open, so it can sit unconditionally in every route.
 */
export function SeasonalBreakNotice({ storeName }: { storeName: string }) {
	const paused = useOrderingPaused();
	if (!paused) return null;
	return (
		<div className="mx-5 mt-4 flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 lg:mx-8">
			<PauseCircle className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
			<div className="flex flex-col gap-0.5">
				<p className="text-sm font-semibold">On a seasonal break</p>
				<p className="text-sm text-muted-foreground">
					{orderingPausedMessage(storeName)}
				</p>
			</div>
		</div>
	);
}
