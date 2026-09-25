import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../convex/_generated/api";
import { isStoreReadOnly, storeReadOnlyReason } from "../lib/subscription";
import { useDashboardRetailer } from "./useDashboardRetailer";
import { useStoreRole } from "./usePermission";

/**
 * Is the dashboard view-only right now, and why (z8r3fdeub2)?
 *
 * A store whose subscription lapsed can read everything and change nothing —
 * the server refuses every seller write, orders included. Controls that would
 * refuse must SAY so before the tap, so this is the one hook they all read.
 *
 * Costs nothing extra: both reads are the same cached queries the app shell
 * already subscribes to, so a component calling this is a cache hit.
 */
export function useStoreLock(): { readOnly: boolean; reason: string } {
	const retailer = useDashboardRetailer();
	const isMember = useStoreRole() === "member";
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data === true;
	return {
		readOnly: isStoreReadOnly(retailer, isAdmin),
		reason: storeReadOnlyReason(retailer?.subscription, isMember),
	};
}
