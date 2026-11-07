import { useRouterState } from "@tanstack/react-router";
import type { PostHog } from "posthog-js";
import { useEffect } from "react";
import { isCapabilityTokenPath } from "../lib/analytics-privacy";
import { clientEnv } from "../lib/env";
import {
	POSTHOG_DEFAULT_HOST,
	posthogInitOptions,
	setPostHogClient,
} from "../lib/posthog";

/**
 * Boots PostHog once on the client and fires a `$pageview` per SPA navigation.
 *
 * Mirrors `useGoogleAnalytics` / `useClarity` deliberately — same env gate, same
 * `/track/*` carve-out, same module-level once-guard — so the three providers
 * stay one readable pattern rather than three. Two things differ, both on
 * purpose:
 *
 * 1. **The SDK is imported dynamically, inside the effect.** Buyer routes SSR on
 *    the Worker, and a top-level `import "posthog-js"` would drag the SDK into
 *    the server bundle and the client's critical path. Loading it from the
 *    effect means it never executes during SSR at all, and it stays out of the
 *    initial bundle on a storefront whose payload budget is already a live
 *    concern (86eypxght).
 * 2. **The once-guard caches the in-flight promise, not a boolean.** Every
 *    caller then awaits the SAME boot and resolves to the SAME client, so a
 *    navigation that lands mid-boot still gets a live instance to fire its
 *    pageview on. A boolean would make that caller resolve to `undefined` and
 *    silently drop the pageview.
 */
let bootPromise: Promise<PostHog | undefined> | undefined;

/** Test seam — the cached promise outlives `vi.resetModules()` otherwise. */
export function __resetPostHogBootForTests(): void {
	bootPromise = undefined;
}

/**
 * Load + initialise PostHog exactly once. Exported because the `typeof window`
 * guard below is FOR callers outside React — anything that might reach this
 * from a loader or a server route — and that contract deserves a direct test
 * rather than one mediated by a render.
 */
export function bootPostHog(
	key: string,
	host: string,
): Promise<PostHog | undefined> {
	// Defensive: the effect already guarantees a browser, but this seam is the
	// one place a future caller (a loader, a server route) could get it wrong,
	// and the failure would be a hard SSR crash on a buyer page.
	if (typeof window === "undefined") return Promise.resolve(undefined);
	bootPromise ??= import("posthog-js")
		.then(({ default: posthog }) => {
			posthog.init(key, posthogInitOptions(host));
			setPostHogClient(posthog);
			return posthog;
		})
		.catch((error: unknown) => {
			// A blocked or failed SDK load is not an error the buyer should ever
			// experience — checkout must keep working with no analytics at all.
			console.warn("posthog failed to load", error);
			return undefined;
		});
	return bootPromise;
}

export function usePostHog(): void {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	useEffect(() => {
		const key = clientEnv.VITE_POSTHOG_KEY;
		if (!key) return;
		// The tracking URL is the buyer's capability secret, so PostHog must not
		// merely avoid *sending* the path — it must not load, because the SDK
		// reads `window.location` itself. Same rule and same predicate as GA and
		// Clarity; see `isCapabilityTokenPath`.
		if (isCapabilityTokenPath(pathname)) return;

		const host = clientEnv.VITE_POSTHOG_HOST ?? POSTHOG_DEFAULT_HOST;
		void bootPostHog(key, host).then((posthog) => {
			posthog?.capture("$pageview");
		});
	}, [pathname]);
}
