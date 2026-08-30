/**
 * Loader-side Convex read that distinguishes "the query answered" from "the
 * query couldn't be reached" (86eyheqzv).
 *
 * Buyer routes (storefront + /track) render their real data from client-side
 * reactive `useQuery` subscriptions — the loader's result only feeds `head()`
 * meta. Before this helper, ANY transient upstream failure during SSR (a
 * Convex hiccup, an edge 429, a Worker→Convex fetch timeout) threw out of the
 * loader and served the buyer a raw framework error page instead of their
 * order — the WhatsApp-link dead-end. A transient failure must soft-degrade
 * (render the shell, let the live query take over), while a *definitive*
 * answer ("no such token/slug") must still 404.
 *
 * The two cases MUST stay distinct: mapping a thrown error onto the same
 * `null` a query returns for a bad token would 404 a valid order on a blip,
 * which is a worse confusion than the error page it replaces.
 */
export type SsrRead<T> = { ok: true; value: T } | { ok: false };

export async function ssrRead<T>(run: () => Promise<T>): Promise<SsrRead<T>> {
	try {
		return { ok: true, value: await run() };
	} catch (err) {
		// Loaders run on the Worker during SSR and in the browser on SPA navs;
		// console.error reaches wrangler tail / devtools respectively, which is
		// exactly where each side's operator looks.
		console.error("SSR read failed (soft-degrading to client render)", err);
		return { ok: false };
	}
}
