import { hasPermission } from "../../convex/lib/permissions";
import type { PermissionArea } from "../lib/team-permissions";
import { useDashboardRetailer } from "./useDashboardRetailer";

/**
 * WHO the signed-in person is to the store on screen (86exr91r4).
 *
 * `role` is on the `getMyRetailer`/act-as payload; a payload without one
 * predates team members, and the only person who could be looking at it is
 * the owner — so absent reads as "owner", never as "locked out".
 */
export function useStoreRole(): "owner" | "member" | "admin" | undefined {
	const retailer = useDashboardRetailer();
	if (!retailer) return undefined;
	return retailer.role ?? "owner";
}

/** True for the owner AND an admin acting-as — the people owner-only
 * surfaces (Team, WhatsApp tab, slug, billing writes) are for. */
export function useIsStoreOwner(): boolean {
	const role = useStoreRole();
	return role === "owner" || role === "admin";
}

/**
 * The caller's standing on one permission AREA — the client mirror of the
 * server gate, for disabled-with-reason states (the server remains the rule).
 * Owner/admin hold everything; a member reads their grants off the payload.
 * While the payload is loading everything reads `false`, so gated chrome
 * appears rather than flashes away.
 */
export function usePermission(area: PermissionArea): {
	canRead: boolean;
	canWrite: boolean;
	role: "owner" | "member" | "admin" | undefined;
} {
	const retailer = useDashboardRetailer();
	const role = retailer ? (retailer.role ?? "owner") : undefined;
	if (!retailer || role === undefined) {
		return { canRead: false, canWrite: false, role };
	}
	if (role === "owner" || role === "admin") {
		return { canRead: true, canWrite: true, role };
	}
	const grants = retailer.permissions ?? {};
	return {
		canRead: hasPermission(grants, area, "read"),
		canWrite: hasPermission(grants, area, "write"),
		role,
	};
}
