import { convexQuery } from "@convex-dev/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { popularSince } from "../../convex/lib/popularProducts";
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
 * call and can't forget either guard. The per-page sets below are the only
 * place a storefront loader names what it seeds, and each mirrors — key for
 * key, args in the same order — what that page's components subscribe to
 * (`storefront-ssr.keys.test.tsx` renders the real components to hold it).
 */

/**
 * The whole loader's budget for Convex. A slow upstream must never hold the
 * buyer's first byte hostage: past this, the shell renders, the reads still
 * outstanding stay out of the HTML (only answered queries are dehydrated —
 * `lib/convex.ts`), and the live subscription paints them. ONE deadline per
 * loader, shared by its sequential stages (the store, then what needs the
 * store's id), so the cap is the loader's and not each read's.
 */
export const SSR_READ_TIMEOUT_MS = 3_000;

/** The deadline a loader takes at its first line and hands every read. */
export function ssrDeadline(now: number = Date.now()): number {
	return now + SSR_READ_TIMEOUT_MS;
}

export class SsrReadTimeoutError extends Error {
	constructor() {
		super(`Convex read missed the ${SSR_READ_TIMEOUT_MS}ms SSR loader budget`);
		this.name = "SsrReadTimeoutError";
	}
}

function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new SsrReadTimeoutError()),
			Math.max(0, deadline - Date.now()),
		);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Read a public Convex query into the cache under its `convexQuery` key,
 * soft-degrading on failure or once the loader's deadline passes. A read that
 * misses the deadline keeps running: in the browser its answer still lands in
 * the cache. A warm-cache hit resolves before even a spent deadline fires, so
 * client-side navigation between pages already visited is never cut short.
 */
export function ssrEnsure<Query extends FunctionReference<"query">>(
	queryClient: QueryClient,
	query: Query,
	args: FunctionArgs<Query>,
	deadline: number = ssrDeadline(),
): Promise<SsrRead<Query["_returnType"]>> {
	return ssrRead(() =>
		beforeDeadline(
			queryClient.ensureQueryData(convexQuery(query, args)),
			deadline,
		),
	);
}

/**
 * A read only `head()` needs — nothing on the page subscribes to it, so it
 * isn't seeded (it would be HTML weight no render uses) — held to the same
 * loader deadline as everything else.
 */
export function ssrHeadRead<T>(
	run: () => Promise<T>,
	deadline: number,
): Promise<SsrRead<T>> {
	return ssrRead(() => beforeDeadline(run(), deadline));
}

/**
 * The store every storefront route opens with — same args as the
 * components' `useQuery(convexQuery(api.retailers.getRetailerBySlug, { slug }))`,
 * so the seeded key is the one they read.
 */
export function ssrRetailerBySlug(
	queryClient: QueryClient,
	slug: string,
	deadline: number,
) {
	return ssrEnsure(
		queryClient,
		api.retailers.getRetailerBySlug,
		{ slug },
		deadline,
	);
}

/**
 * The store home's catalog: the grid (`ProductGrid`), the category rail
 * (`CategoryRail`, and the grid's own category filter) and the "Popular this
 * week" shelf (`FeaturedProduct`). Resolves with the product list's read —
 * the loader's share-image fallback reuses it rather than asking again.
 */
export async function ssrStorefrontHome(
	queryClient: QueryClient,
	retailerId: Id<"retailers">,
	deadline: number,
) {
	const [products] = await Promise.all([
		ssrEnsure(queryClient, api.products.list, { retailerId }, deadline),
		ssrEnsure(
			queryClient,
			api.categories.listActivePublic,
			{ retailerId },
			deadline,
		),
		// MYT midnight, the same `since` the shelf computes at render — a
		// request straddling midnight MYT costs one refetch, never a wrong shelf.
		ssrEnsure(
			queryClient,
			api.products.popularProducts,
			{ retailerId, since: popularSince() },
			deadline,
		),
	]);
	return products;
}

/**
 * A category page: its own product set, plus the store's categories the
 * grid's filter reads. Resolves with the page read (the loader's 404 and
 * `head()` need it).
 */
export async function ssrCategoryPage(
	queryClient: QueryClient,
	retailerId: Id<"retailers">,
	categorySlug: string,
	deadline: number,
) {
	const [page] = await Promise.all([
		ssrEnsure(
			queryClient,
			api.categories.getPublicPage,
			{ retailerId, categorySlug },
			deadline,
		),
		ssrEnsure(
			queryClient,
			api.categories.listActivePublic,
			{ retailerId },
			deadline,
		),
	]);
	return page;
}

/** A product page: the product itself is the page's only catalog read. */
export function ssrProductPage(
	queryClient: QueryClient,
	retailerId: Id<"retailers">,
	slug: string,
	deadline: number,
) {
	return ssrEnsure(
		queryClient,
		api.products.getPublicBySlug,
		{ retailerId, slug },
		deadline,
	);
}
