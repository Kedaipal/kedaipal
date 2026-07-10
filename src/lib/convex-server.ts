import { ConvexHttpClient } from "convex/browser";
import { serverEnv } from "./env";

/**
 * Convex HTTP client for TanStack Router loaders. On the server (SSR) it reads
 * CONVEX_URL so crawlers and link unfurlers see real meta tags before any JS
 * executes. Loaders ALSO run in the browser on client-side navigations (e.g.
 * storefront home → a category page), where only the Vite-inlined
 * VITE_CONVEX_URL exists — without that fallback the loader throws and the
 * navigation silently no-ops. Loaders only — don't import from components.
 */

let _client: ConvexHttpClient | null = null;

export function getConvexHttpClient(): ConvexHttpClient {
	if (_client) return _client;
	const url =
		serverEnv.CONVEX_URL ??
		process.env.VITE_CONVEX_URL ??
		import.meta.env.VITE_CONVEX_URL;
	if (!url) {
		throw new Error(
			"CONVEX_URL is not set. Required for Convex queries in route loaders.",
		);
	}
	_client = new ConvexHttpClient(url);
	return _client;
}

export const SITE_URL = serverEnv.SITE_URL ?? "https://kedaipal.com";
