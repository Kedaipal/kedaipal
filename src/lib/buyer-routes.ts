/**
 * Route ids of the buyer-facing surfaces: the storefront family + the order
 * tracking page. These render WITHOUT Clerk (86eyheqzv) — shoppers can never
 * sign in there, and booting Clerk cost every buyer page view 8 requests to
 * `clerk.kedaipal.com` including two per-IP rate-limited FAPI calls: pure
 * bundle weight on the highest-stakes pages, and a plausible source of the
 * intermittent buyer-side "too many requests" (MY mobile carriers CGNAT many
 * subscribers behind few IPs, so one hot IP can exhaust a per-IP limit).
 *
 * `__root.tsx` checks the matched route ids against this set to pick the
 * provider tree: plain `ConvexProvider` here, Clerk + Convex everywhere else.
 *
 * ADDING A BUYER SURFACE? Add its route id here or it will boot Clerk. The
 * ids are the generated ones from `routeTree.gen.ts`; `buyer-routes.test.ts`
 * fails if an id listed here stops existing, so a route rename can't silently
 * turn a buyer page back into a Clerk page.
 */
export const BUYER_ROUTE_IDS: ReadonlySet<string> = new Set([
	"/$slug",
	"/$slug_/checkout",
	"/$slug_/c/$categorySlug",
	"/$slug_/p/$productSlug",
	"/track/$token",
	// Claim-link checkout (86eyq0epn) — a buyer surface like /track.
	"/claim/$token",
]);

export function isBuyerRouteId(routeId: string): boolean {
	return BUYER_ROUTE_IDS.has(routeId);
}
