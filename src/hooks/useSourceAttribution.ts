import { useEffect } from "react";
import {
	ATTRIBUTION_PARAMS,
	sanitizeAttributionSource,
} from "../../convex/lib/attribution";

/**
 * Storefront source attribution capture (86eyq0eq9). Every buyer-facing
 * storefront route calls `useCaptureAttribution(slug)` on mount: if the hit
 * arrived with `?src=` (fallback `utm_source`), the sanitized tag is persisted
 * to sessionStorage — keyed per store so two shops in one browser can't
 * cross-attribute — and checkout reads it back via `readAttributionSource`
 * into `orders.create`.
 *
 * Last-touch within the session: a later hit WITH a tag overwrites, a hit
 * without one leaves the stored tag alone (in-store navigation never carries
 * the param). sessionStorage scopes it to the tab and dies with it — no
 * cookies, no PII, nothing crosses the /track/* analytics carve-out (ticket
 * AC). Everything is best-effort: storage being unavailable (some private
 * modes) must never break browsing or checkout.
 */

const storageKey = (slug: string) => `kedaipal:src:${slug}`;

/** Capture the visit's `?src=`/`utm_source` tag for this store, if present. */
export function useCaptureAttribution(slug: string | undefined): void {
	useEffect(() => {
		if (!slug) return;
		try {
			const params = new URLSearchParams(window.location.search);
			// First param that yields a USABLE tag wins — not merely the first
			// one PRESENT. `?src=&utm_source=tiktok` must read as TikTok: an
			// empty `?src=` is an authoring accident, and an accident must not
			// out-rank a real signal. A garbage `src` still wins, because it
			// sanitizes to "other" — unusable, but genuinely a signal.
			let tag: string | undefined;
			for (const key of ATTRIBUTION_PARAMS) {
				tag = sanitizeAttributionSource(params.get(key));
				if (tag) break;
			}
			if (tag) sessionStorage.setItem(storageKey(slug), tag);
		} catch {
			// Storage/URL access denied — attribution is best-effort, never fatal.
		}
	}, [slug]);
}

/** The tag this session arrived with for `slug`, or undefined (= direct). */
export function readAttributionSource(slug: string): string | undefined {
	try {
		return sessionStorage.getItem(storageKey(slug)) ?? undefined;
	} catch {
		return undefined;
	}
}
