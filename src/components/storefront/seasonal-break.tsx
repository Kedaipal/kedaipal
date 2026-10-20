import { PauseCircle } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { unavailableMessage } from "../../../convex/lib/storeAvailability";

/**
 * A store that isn't taking orders, on the buyer side. Three reasons share
 * this one surface (`z8r3fdudf7`): the seller's own pause ("not taking orders
 * right now", with their note), Off-Season Hold (z8r3fday24, "on a seasonal
 * break"), and Kedaipal's pause (the same calm "not right now", nothing about
 * why). The store is still here — catalog, photos, prices — it just isn't
 * taking orders. The public payload's `orderingPaused` is provided once per
 * storefront route and read by every ordering CTA (cart bar, add-to-cart,
 * quick add, checkout), so the whole surface flips together and no button can
 * quietly still work. The server refuses on every order door with the same
 * sentence (`unavailableMessage`), so a stale tab can't place an order either.
 */
export type PausedBy = { by: "seller" | "hold" | "admin"; note?: string };

const OrderingPausedContext = createContext<{
	paused: boolean;
	pausedBy?: PausedBy;
}>({ paused: false });

export function OrderingPausedProvider({
	paused,
	pausedBy,
	children,
}: {
	paused: boolean;
	pausedBy?: PausedBy;
	children: ReactNode;
}) {
	return (
		<OrderingPausedContext.Provider value={{ paused, pausedBy }}>
			{children}
		</OrderingPausedContext.Provider>
	);
}

export function useOrderingPaused(): boolean {
	return useContext(OrderingPausedContext).paused;
}

/** Label every disabled ordering CTA shares while the store is paused. */
export const ORDERING_PAUSED_CTA = "Ordering paused";

/** The banner's title and line, per reason — the line is the server's own
 * refusal sentence, so the banner and a stale tab's error always match. */
export function pausedCopy(
	storeName: string,
	pausedBy: PausedBy | undefined,
): { title: string; body: string } {
	const by = pausedBy?.by ?? "hold";
	return {
		title:
			by === "hold" ? "On a seasonal break" : "Not taking orders right now",
		body: unavailableMessage(
			{ state: "paused", by, note: pausedBy?.note },
			storeName,
		),
	};
}

/**
 * The "not taking orders" note under the storefront header. Calm and warm —
 * a "back soon" sign on the shutter, not a closed-down store. Renders nothing
 * when the store is open, so it can sit unconditionally in every route.
 */
export function SeasonalBreakNotice({ storeName }: { storeName: string }) {
	const { paused, pausedBy } = useContext(OrderingPausedContext);
	if (!paused) return null;
	const copy = pausedCopy(storeName, pausedBy);
	return (
		<div className="mx-5 mt-4 flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 lg:mx-8">
			<PauseCircle className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
			<div className="flex flex-col gap-0.5">
				<p className="text-sm font-semibold">{copy.title}</p>
				<p className="text-sm text-muted-foreground">{copy.body}</p>
			</div>
		</div>
	);
}
