import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../convex/_generated/api";
import { isStoreReadOnly, storeReadOnlyReason } from "../lib/subscription";
import { AREA_COPY, type PermissionArea } from "../lib/team-permissions";
import { useDashboardRetailer } from "./useDashboardRetailer";
import { usePermission, useStoreRole } from "./usePermission";

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

/**
 * Is THIS AREA view-only for the person on screen, and why (86exr91r4)?
 *
 * `useStoreLock` answers the store-wide question: a lapsed subscription
 * freezes every seller write, owner included. A TEAMMATE can be frozen for a
 * second, independent reason — the owner granted them view on this area and
 * not edit — and the matrix offers exactly that, so it is a state the product
 * sells, not an edge case. Both end in the same place (a control that must say
 * why before it is tapped), so they share one shape: a surface that already
 * reads `{ readOnly, reason }` gains permission gating by changing which hook
 * it calls, and every disabled state it already designed keeps working.
 *
 * The SUBSCRIPTION wins when both apply. It is the store-wide fact, it blocks
 * the owner too, and "ask the owner for edit access" would send a teammate
 * chasing a grant that still wouldn't let them save.
 *
 * Reads nothing new: `usePermission` resolves off the same cached retailer
 * payload the shell already holds.
 */
export function useAreaLock(area: PermissionArea): {
	readOnly: boolean;
	reason: string;
} {
	const store = useStoreLock();
	const { canWrite, role } = usePermission(area);
	if (store.readOnly) return store;
	// `role` is undefined until the payload lands — no lock, so nothing flashes
	// disabled for an owner on first paint.
	if (role === "member" && !canWrite)
		return { readOnly: true, reason: writeBlockReason(area) };
	return store;
}

/** The ONE sentence a teammate reads when they hold view on an area and reach
 * for a control that changes it. Mirrors the server's `refusalMessage`. */
export function writeBlockReason(area: PermissionArea): string {
	return `Ask the store owner for edit access to change ${AREA_COPY[area].label}.`;
}
