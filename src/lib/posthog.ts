import type { PostHog, PostHogConfig } from "posthog-js";
import { sanitizeDistinctId } from "../../convex/lib/posthog";
import { isCapabilityTokenPath } from "./analytics-privacy";

/**
 * PostHog client configuration + the checkout hand-off read (86eyrayux).
 *
 * PostHog is the THIRD analytics provider, and the three have deliberately
 * non-overlapping jobs — see docs/analytics.md:
 *
 *   - GA4      → acquisition + ad attribution
 *   - Clarity  → session replay (free and uncapped; PostHog's replay free tier
 *                is 5k recordings/mo, which ~100 retailers would blow through)
 *   - PostHog  → events, funnels, cohorts
 *
 * That division is what makes a third provider defensible rather than
 * redundant, and it is why {@link posthogInitOptions} turns off everything
 * PostHog does that another tool already does better or cheaper.
 */

/** PostHog US cloud. Overridden by `VITE_POSTHOG_HOST` for EU/self-hosted. */
export const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

/**
 * Blank any referrer property that points at a `/track/*` URL.
 *
 * The tracking URL is the buyer's capability token (see `isCapabilityTokenPath`)
 * and `document.referrer` is the one channel that can smuggle it onto a page
 * PostHog *is* allowed to observe: a full-document navigation from /track to
 * any other route would carry it.
 *
 * Every anchor on the tracking page currently sets `rel="noreferrer"`, so this
 * is defence in depth rather than a live hole — but it is the kind of hole a
 * single future `<a href>` reopens silently, and the fix belongs next to the
 * analytics config rather than in a reviewer's memory.
 */
export function stripTrackingReferrer(
	properties: Record<string, unknown>,
): Record<string, unknown> {
	const REFERRER_KEYS = [
		"$referrer",
		"$initial_referrer",
		"$referring_domain",
		"$initial_referring_domain",
	];
	let sanitized = properties;
	for (const key of REFERRER_KEYS) {
		const value = sanitized[key];
		if (typeof value !== "string") continue;
		let pathname: string;
		try {
			pathname = new URL(value).pathname;
		} catch {
			// Not a URL ("$direct", a bare domain) — nothing to leak.
			continue;
		}
		if (!isCapabilityTokenPath(pathname)) continue;
		// Copy-on-write: PostHog reuses the properties object across handlers.
		if (sanitized === properties) sanitized = { ...properties };
		sanitized[key] = "$direct";
	}
	return sanitized;
}

/**
 * The init options. Every disabled default is a deliberate cost or privacy
 * decision, not a preference:
 *
 * - **`autocapture: false`** — autocapture records the text and attributes of
 *   clicked elements. On Kedaipal that means buyer names, delivery addresses
 *   and `wa.me` hrefs containing phone numbers. The existing `MASK_PII` spread
 *   is a *Clarity* attribute that PostHog does not honour, so leaving
 *   autocapture on would quietly bypass all fifteen masked surfaces. Turning it
 *   off also protects the 1M events/mo free tier, which autocapture is the
 *   fastest way to exhaust.
 * - **`capture_pageview: false`** — `usePostHog` fires `$pageview` per resolved
 *   route instead, so client-side navigations count. Leaving PostHog's own
 *   listener on would double-count every SPA nav.
 * - **`capture_pageleave: false`** — roughly doubles event volume to measure
 *   bounce/duration, which Clarity already shows us.
 * - **`disable_session_recording: true`** — replay is Clarity's job.
 * - **`person_profiles: "identified_only"`** — an anonymous shopper never mints
 *   a person record. The server mirrors this with `$process_person_profile`
 *   (see `convex/posthog.ts`).
 */
export function posthogInitOptions(host: string): Partial<PostHogConfig> {
	return {
		api_host: host,
		autocapture: false,
		capture_pageview: false,
		capture_pageleave: false,
		disable_session_recording: true,
		person_profiles: "identified_only",
		sanitize_properties: stripTrackingReferrer,
	};
}

/**
 * The booted client, parked at module scope so `readAnalyticsDistinctId` can
 * reach it from checkout without threading a context through the storefront.
 * Set by `usePostHog`; stays undefined when PostHog is unconfigured or when the
 * visitor never left `/track/*`.
 */
let client: PostHog | undefined;

export function setPostHogClient(instance: PostHog | undefined): void {
	client = instance;
}

/**
 * The booted client, or `undefined` when PostHog is unconfigured, still
 * loading, or was blocked. Every caller must treat absence as normal.
 */
export function getPostHogClient(): PostHog | undefined {
	return client;
}

/** Test seam — the module-level client outlives `vi.resetModules()` otherwise. */
export function __resetPostHogClientForTests(): void {
	client = undefined;
}

/**
 * The browser's PostHog `distinct_id`, for stamping onto an order at create.
 *
 * This is the join that makes the funnel computable: the storefront pageviews
 * are anonymous and client-fired, while `order_created` (and later `order_paid`)
 * are server-fired long after the buyer left for WhatsApp. Carrying the id into
 * the order is what puts both halves on the same PostHog person.
 *
 * Best-effort by construction, exactly like `readAttributionSource`: PostHog
 * being absent, blocked, or mid-boot must never interfere with checkout.
 */
export function readAnalyticsDistinctId(): string | undefined {
	try {
		return sanitizeDistinctId(client?.get_distinct_id());
	} catch {
		return undefined;
	}
}
