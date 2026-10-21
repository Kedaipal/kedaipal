import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { PageLoader } from "./components/page-loader";
import { RouteErrorCard } from "./components/route-error";
import { getQueryClients, type QueryClients } from "./lib/convex";
import { routeTree } from "./routeTree.gen";

/** What every route's `context` carries — see `QueryClients`. */
export type RouterContext = QueryClients;

// Called once per request on the server and once in the browser, so the
// clients it builds are scoped exactly like the router itself.
export function getRouter() {
	const context: RouterContext = getQueryClients();
	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPreload: "intent",
		// 30s (the TanStack default this previously overrode to 0). At 0 every
		// hover re-ran the hovered route's loader with zero dedupe — on a product
		// grid that's 2 Convex queries per <Link> per hover, so sweeping a cursor
		// across the grid fired an unbounded query storm for data that was thrown
		// away (86eyheqzv). 30s means a hover's preload is reused by the click
		// that follows it, which is the entire point of intent preloading.
		defaultPreloadStaleTime: 30_000,
		defaultPendingComponent: PageLoader,
		// Buyers must never see a raw framework error page (86eyheqzv) — every
		// route without its own errorComponent falls back to the branded card.
		defaultErrorComponent: RouteErrorCard,
	});

	// Dehydrates what loaders put in the query cache into the HTML and hydrates
	// it before the first client render, so a component's `useQuery` for the
	// same key paints with data instead of a skeleton. It also mounts the
	// QueryClientProvider (around the whole router, outside the root's
	// buyer/Clerk provider switch, so the cache survives that remount).
	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
