import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import { clientEnv } from "./env";

/**
 * The Convex + TanStack Query clients one RENDER owns, handed to every route
 * as router context (`src/router.tsx`) and read by the root providers.
 *
 * On the SERVER this is built fresh for every request. That is not a
 * preference: SSR loaders now write Convex results into the query cache and
 * the SSR-query integration dehydrates that cache into the HTML, so a cache
 * shared across requests would serve one buyer's store (or one seller's data)
 * into another visitor's response. In the BROWSER it is built once — one
 * WebSocket, one cache, Clerk's token attached to the one `ConvexReactClient`.
 * See docs/frontend-caching.md#ssr-per-request-clients.
 *
 * `convexQueryClient` is null only when `VITE_CONVEX_URL` is unset (a fresh
 * checkout before `convex dev`): the root renders its setup notice instead of
 * the app, and `pnpm build` keeps working without a deployment. The bare
 * `queryClient` that rides along has no Convex `queryFn`, so a loader's read
 * throws and its `ssrRead` soft-degrades.
 */
export interface QueryClients {
	queryClient: QueryClient;
	convexQueryClient: ConvexQueryClient | null;
}

// How long a query's data + live subscription survive after the last component
// using it unmounts. 10 min comfortably covers tab-hopping within a work session
// (so back-nav stays instant) while still reclaiming idle subscriptions; not
// Infinity, which would pin every one-off detail page's subscription for the
// whole session. This is the single-seller dashboard sweet spot.
const QUERY_GC_TIME_MS = 1000 * 60 * 10;

/**
 * TanStack Query <-> Convex bridge.
 *
 * Reads across the app go through `useQuery(convexQuery(api.x, args))` so their
 * results live in the TanStack Query cache instead of being dropped the moment a
 * page unmounts. `gcTime` keeps each result — and its live Convex subscription —
 * warm after unmount, so navigating back to an already-visited page paints
 * instantly from cache and revalidates in the background (Convex still pushes
 * updates, so cached data is never stale). See docs/frontend-caching.md.
 *
 * The bridge wraps the SAME `ConvexReactClient` the React providers mount
 * (`convexQueryClient.convexClient`), so Clerk's auth token flows to adapter
 * queries with no extra wiring. Construction opens no connection — the
 * client's sync layer is lazy — so a server render never dials a WebSocket;
 * on the server the bridge answers loader reads over its own HTTP client.
 */
function createQueryClients(url: string, onServer: boolean): QueryClients {
	const convexQueryClient = new ConvexQueryClient(new ConvexReactClient(url));
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				// convexQuery's key is `["convexQuery", "<module>:<fn>", args]` — the
				// function's NAME, never the FunctionReference — so it is plain JSON
				// and survives the SSR dehydrate → HTML → hydrate round trip. The
				// bridge still owns both: its hash encodes args through
				// `convexToJson` (Ids, bigints), and the key carries no fetcher.
				queryKeyHashFn: convexQueryClient.hashFn(),
				queryFn: convexQueryClient.queryFn(),
				// A server cache lives exactly one request, so it never collects:
				// any finite gcTime would schedule a timer per seeded query that
				// outlives the response (Cloudflare drops it; node dev would hold
				// each request's cache for 10 min). TanStack's own server default
				// is Infinity for the same reason — no timer is scheduled at all.
				gcTime: onServer ? Number.POSITIVE_INFINITY : QUERY_GC_TIME_MS,
			},
			// What the SSR-query integration ships into the HTML. Only answers:
			// a loader read that failed or timed out stays OUT of the payload, so
			// the browser fetches it fresh instead of hydrating an error or an
			// empty pending entry (the integration's own default is "everything",
			// which would also ship every pending `useQuery` the server render
			// touched). This is what makes `ssrRead`'s soft-degrade hold across
			// the hydration boundary.
			dehydrate: {
				shouldDehydrateQuery: (query) => query.state.status === "success",
			},
		},
	});
	convexQueryClient.connect(queryClient);
	return { queryClient, convexQueryClient };
}

let _browserClients: QueryClients | null = null;

/**
 * The clients for this render: fresh per call on the server (one call per
 * request, from `getRouter()`), one shared instance in the browser.
 */
export function getQueryClients(): QueryClients {
	const url = clientEnv.VITE_CONVEX_URL;
	if (!url) return { queryClient: new QueryClient(), convexQueryClient: null };
	// Same test the Convex bridge itself uses to pick its server path.
	if (typeof window === "undefined") return createQueryClients(url, true);
	_browserClients ??= createQueryClients(url, false);
	return _browserClients;
}
