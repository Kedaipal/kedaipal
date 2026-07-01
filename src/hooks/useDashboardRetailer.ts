import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useActAsRetailerId } from "./useActAs";

/**
 * The store the dashboard is currently operating on.
 *
 * Normally that's the signed-in seller's own store (`getMyRetailer`). But when a
 * Kedaipal admin is running white-glove onboarding, an act-as session is active
 * (see `useActAs`) and every `/app/*` screen instead operates on THAT store
 * (`getRetailerForAdmin`, which returns `actingAsAdmin: true` so the banner shows).
 *
 * Centralising the resolution here means each route calls one hook instead of
 * hard-wiring `getMyRetailer`, and the act-as context is read from a persistent
 * session — so it holds across every navigation, refresh, and CRUD action until
 * the admin Exits. See docs/admin-console.md.
 */

// Re-exported for callers that only need the raw id (mutation wrappers that must
// pass an explicit `retailerId`, e.g. settings + counter checkout).
export { useActAsRetailerId } from "./useActAs";

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
