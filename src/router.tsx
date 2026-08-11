import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { PageLoader } from "./components/page-loader";
import { RouteErrorCard } from "./components/route-error";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
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

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
