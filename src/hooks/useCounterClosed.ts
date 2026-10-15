import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../convex/_generated/api";
import { counterClosedMessage } from "../../convex/lib/storeAvailability";
import { useDashboardRetailer } from "./useDashboardRetailer";

/**
 * Why the Counter can't take an order right now, in the seller's words — or
 * `null` while it can (`z8r3fdudf7`). Closed by an Off-Season Hold or
 * Kedaipal's switch; never by the seller's own pause, which stops ONLINE
 * orders only.
 *
 * The Counter page greys its "New order" and checkout buttons with this
 * BEFORE the tap. The server refuses either way (`assertTakesCounterOrders`,
 * same sentence), but a till that looks open and refuses at the last step is
 * the dead end the hands-on test found. `null` while loading: the server
 * still guards the moment in between.
 */
export function useCounterClosedReason(): string | null {
	const retailer = useDashboardRetailer();
	const status = useQuery(
		convexQuery(
			api.storeAvailability.forSeller,
			retailer ? { retailerId: retailer._id } : "skip",
		),
	).data;
	if (!status) return null;
	return counterClosedMessage(status.availability) || null;
}
