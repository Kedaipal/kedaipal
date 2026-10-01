import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../convex/_generated/api";
import { useActAs } from "./useActAs";

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
 * The dashboard's current retailer, and whether reading it FAILED.
 *
 * `retailer` is `undefined` while loading — including while a stored act-as
 * session waits to be confirmed as the viewer's, since guessing between the
 * admin's own store and the acted-as one would let a write land on the wrong
 * one — `null` when there's no store (own path: not onboarded; act-as: bad id),
 * or the payload. When acting-as, the payload's `actingAsAdmin` is `true`.
 *
 * `error` is set only when the read failed with NOTHING to show. An adapter read
 * never throws: a failed one settles as `data === undefined`, which looks
 * exactly like a slow one, so the shell must check this or render its skeleton
 * forever (ClickUp z8r3fdkqn6). Data that was loaded and then errors keeps
 * showing (Convex keeps it); each action on it reports its own failure.
 */
export function useDashboardRetailerRead() {
	const { actAsRetailerId, pending } = useActAs();
	const own = useQuery(
		convexQuery(
			api.retailers.getMyRetailer,
			actAsRetailerId || pending ? "skip" : {},
		),
	);
	const asAdmin = useQuery(
		convexQuery(
			api.retailers.getRetailerForAdmin,
			actAsRetailerId ? { retailerId: actAsRetailerId } : "skip",
		),
	);
	// While pending both reads are skipped, so this is `undefined` — loading.
	const read = actAsRetailerId ? asAdmin : own;
	return {
		retailer: read.data,
		error: read.data === undefined ? read.error : null,
	};
}

/**
 * Resolve the dashboard's current retailer: `undefined` while loading, `null`
 * when there's no store, or the payload. Every `/app/*` screen reads this; the
 * shell reads `useDashboardRetailerRead` instead, because it is the one place
 * that decides between the page, the skeleton and the error.
 */
export function useDashboardRetailer() {
	return useDashboardRetailerRead().retailer;
}
