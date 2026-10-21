import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../convex/_generated/api";
import type {
	CreditLockAudience,
	CreditUnlockRoute,
} from "../../convex/lib/credits";
import { counterClosedMessage } from "../../convex/lib/storeAvailability";
import { useDashboardRetailer } from "./useDashboardRetailer";

export type CounterClosed = {
	/** Why, in the seller's words — the same sentence the server refuses with. */
	reason: string;
	/** Set when credits closed it, so the banner can offer the way back
	 * (`CreditLockCta`); null for a hold or Kedaipal's switch, whose sentence
	 * already names theirs. */
	creditLock: {
		unlockRoute: CreditUnlockRoute;
		audience: CreditLockAudience;
	} | null;
};

/**
 * Why the Counter can't take an order right now — or `null` while it can.
 * Two things close it, in this order:
 *
 *  1. an Off-Season Hold or Kedaipal's switch (`z8r3fdudf7`) — never the
 *     seller's own pause, which stops ONLINE orders only;
 *  2. no credit in hand (`z8r3fdwbbb`) — a sale rung up at zero would be born
 *     gated, invisible to the seller who just made it.
 *
 * The availability reason outranks credits because it is the one the server
 * hits first, and topping up a store on hold wouldn't reopen anything.
 *
 * The Counter page greys "New order", the checkout buttons and "Send link"
 * with this BEFORE the tap. The server refuses either way, but a till that
 * looks open and refuses at the last step is the dead end the hands-on test
 * found. `null` while loading: the server still guards the moment in between.
 */
export function useCounterClosed(): CounterClosed | null {
	const retailer = useDashboardRetailer();
	const args = retailer ? { retailerId: retailer._id } : "skip";
	const status = useQuery(
		convexQuery(api.storeAvailability.forSeller, args),
	).data;
	const credit = useQuery(
		convexQuery(api.creditLock.counterCreditState, args),
	).data;
	const availability = status ? counterClosedMessage(status.availability) : "";
	if (availability) return { reason: availability, creditLock: null };
	if (credit?.closedReason)
		return {
			reason: credit.closedReason,
			creditLock: {
				unlockRoute: credit.unlockRoute,
				audience: credit.audience,
			},
		};
	return null;
}

/** `useCounterClosed`, as the sentence alone — what a disabled button needs. */
export function useCounterClosedReason(): string | null {
	return useCounterClosed()?.reason ?? null;
}

/** The "running low" heads-up for the counter — the rule spoken while it can
 * still be avoided. `null` when not low, while closed, or for a teammate who
 * isn't shown the store's balance. `canTopUp` = this reader can take the way
 * back themselves (the owner, or a teammate who may buy packs). */
export function useCounterLowCredit(): {
	line: string;
	canTopUp: boolean;
} | null {
	const retailer = useDashboardRetailer();
	const credit = useQuery(
		convexQuery(
			api.creditLock.counterCreditState,
			retailer ? { retailerId: retailer._id } : "skip",
		),
	).data;
	if (!credit?.lowCreditLine) return null;
	return { line: credit.lowCreditLine, canTopUp: credit.audience !== "member" };
}
