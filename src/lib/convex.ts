import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import { clientEnv } from "./env";

/**
 * Convex client singleton. Instantiated at module load so the provider tree
 * can inject it once. If `VITE_CONVEX_URL` is missing we throw at first use
 * rather than at import time — that keeps `pnpm build` working before a
 * deployment has been provisioned.
 */
let _client: ConvexReactClient | null = null;

export function getConvexClient(): ConvexReactClient {
	if (_client) return _client;
	const url = clientEnv.VITE_CONVEX_URL;
	if (!url) {
		throw new Error(
			"VITE_CONVEX_URL is not set. Run `pnpm dlx convex dev` to provision a deployment, then fill in .env.local.",
		);
	}
	_client = new ConvexReactClient(url);
	return _client;
}

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
 * The bridge wraps the SAME `getConvexClient()` singleton the React providers
 * use, so Clerk's auth token (attached to that one client) flows to adapter
 * queries with no extra wiring. Both are lazy singletons so `.connect()` runs
 * exactly once and never at import time (preserves the missing-env build path).
 */
let _convexQueryClient: ConvexQueryClient | null = null;

export function getConvexQueryClient(): ConvexQueryClient {
	if (_convexQueryClient) return _convexQueryClient;
	_convexQueryClient = new ConvexQueryClient(getConvexClient());
	return _convexQueryClient;
}

// How long a query's data + live subscription survive after the last component
// using it unmounts. 10 min comfortably covers tab-hopping within a work session
// (so back-nav stays instant) while still reclaiming idle subscriptions; not
// Infinity, which would pin every one-off detail page's subscription for the
// whole session. This is the single-seller dashboard sweet spot.
const QUERY_GC_TIME_MS = 1000 * 60 * 10;

let _queryClient: QueryClient | null = null;

export function getQueryClient(): QueryClient {
	if (_queryClient) return _queryClient;
	const convexQueryClient = getConvexQueryClient();
	_queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				// convexQuery's queryKey carries a non-serializable FunctionReference,
				// so the hash + fetch both must come from the Convex bridge.
				queryKeyHashFn: convexQueryClient.hashFn(),
				queryFn: convexQueryClient.queryFn(),
				gcTime: QUERY_GC_TIME_MS,
			},
		},
	});
	convexQueryClient.connect(_queryClient);
	return _queryClient;
}
