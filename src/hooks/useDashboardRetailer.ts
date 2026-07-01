import { useSearch } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * The store the dashboard is currently operating on.
 *
 * Normally that's the signed-in seller's own store (`getMyRetailer`). But when a
 * Kedaipal admin is running white-glove onboarding, the URL carries `?actAs=<id>`
 * and every `/app/*` screen instead operates on THAT store (`getRetailerForAdmin`,
 * which returns `actingAsAdmin: true` so the banner shows). Centralising the
 * resolution here means each route calls one hook instead of hard-wiring
 * `getMyRetailer`, and the act-as context is threaded from the URL — so it
 * survives refresh and is never confused with the admin's own store.
 *
 * See docs/admin-console.md.
 */

/** The acting-as retailer id from `?actAs=`, or undefined for the normal path. */
export function useActAsRetailerId(): Id<"retailers"> | undefined {
	const search = useSearch({ strict: false }) as { actAs?: string };
	return search.actAs ? (search.actAs as Id<"retailers">) : undefined;
}

/**
 * Resolve the dashboard's current retailer. Returns `undefined` while loading,
 * `null` when there's no store (own path: not onboarded; act-as: bad id), or the
 * retailer payload. When acting-as, the payload's `actingAsAdmin` is `true`.
 */
export function useDashboardRetailer() {
	const actAsRetailerId = useActAsRetailerId();
	const own = useQuery(
		api.retailers.getMyRetailer,
		actAsRetailerId ? "skip" : {},
	);
	const asAdmin = useQuery(
		api.retailers.getRetailerForAdmin,
		actAsRetailerId ? { retailerId: actAsRetailerId } : "skip",
	);
	return actAsRetailerId ? asAdmin : own;
}
