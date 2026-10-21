import { convexQuery } from "@convex-dev/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import { type SsrRead, ssrRead } from "./ssr-read";

/**
 * Storefront loader reads that SEED the query cache (z8r3fdue6f).
 *
 * A storefront loader used to read through a bare HTTP client and keep the
 * answer for `head()` only; the component then re-asked Convex for the same
 * thing over a cold WebSocket while the buyer watched a skeleton. Reading
 * through the render's own `QueryClient` instead puts the answer in the cache
 * under the exact key the component subscribes with, the SSR-query
 * integration ships it in the HTML, and the first client render paints from
 * it. On a client-side navigation the same call answers from the warm cache
 * or the live client — never a second fetch.
 *
 * `ssrEnsure` is the ONE primitive every storefront prefetch goes through:
 * the cache seed, the soft-degrade (`ssrRead`, docs/buyer-page-resilience.md)
 * and the time cap travel together, so adding a prefetch to a loader is one
 * call and can't forget either guard.
 */

/**
 * How long a loader waits on Convex before rendering without the answer. A
 * slow upstream must never hold the buyer's first byte hostage: past this, the
 * shell renders, the read stays out of the HTML (only answered queries are
 * dehydrated — `lib/convex.ts`), and the live subscription paints it.
 */
export const SSR_READ_TIMEOUT_MS = 3_000;

export class SsrReadTimeoutError extends Error {
	constructor(ms: number) {
		super(`Convex read exceeded the ${ms}ms SSR loader budget`);
		this.name = "SsrReadTimeoutError";
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new SsrReadTimeoutError(ms)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Read a public Convex query into the cache under its `convexQuery` key,
 * soft-degrading on failure or after `SSR_READ_TIMEOUT_MS`. A timed-out read
 * keeps running: in the browser its answer still lands in the cache.
 */
export function ssrEnsure<Query extends FunctionReference<"query">>(
	queryClient: QueryClient,
	query: Query,
	args: FunctionArgs<Query>,
): Promise<SsrRead<Query["_returnType"]>> {
	return ssrRead(() =>
		withTimeout(
			queryClient.ensureQueryData(convexQuery(query, args)),
			SSR_READ_TIMEOUT_MS,
		),
	);
}

/**
 * The store every storefront route opens with — same args as the
 * components' `useQuery(convexQuery(api.retailers.getRetailerBySlug, { slug }))`,
 * so the seeded key is the one they read.
 */
export function ssrRetailerBySlug(queryClient: QueryClient, slug: string) {
	return ssrEnsure(queryClient, api.retailers.getRetailerBySlug, { slug });
}
