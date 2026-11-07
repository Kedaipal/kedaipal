import type { CaptureResult, PostHog, PostHogConfig } from "posthog-js";
import {
	posthogEnvironment,
	sanitizeDistinctId,
} from "../../convex/lib/posthog";
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
 * The pathname an event belongs to: the event's own `$current_url` when it
 * carries one (heatmap and web-vitals events are often flushed AFTER the route
 * changed, keyed to the page they measured), else the live location.
 */
function eventPathname(event: CaptureResult): string {
	const url = event.properties?.$current_url;
	if (typeof url === "string") {
		try {
			return new URL(url).pathname;
		} catch {
			// Fall through to the live location.
		}
	}
	return typeof window === "undefined" ? "" : window.location.pathname;
}

/**
 * The single gate every PostHog event passes through before it leaves the
 * browser. Two jobs, both structural rather than per-feature:
 *
 * 1. **Drop anything recorded on a capability-token page.** `usePostHog`
 *    refuses to BOOT on `/track` and `/claim`, but checkout reaches
 *    `/track/<token>` as an in-app navigation — the SDK booted on the
 *    storefront is still alive on the token page. Any event recorded there
 *    (a heatmap click, a web-vitals sample, anything a future SDK release or a
 *    project-side setting switches on) would carry the token in its URL. This
 *    drops it whatever it is, which is why it lives here and not as a list of
 *    features to remember to turn off.
 * 2. **Stamp `environment` on every event.** It used to be registered once as
 *    a super property, and `posthog.reset()` on sign-out wiped it — every
 *    event after a seller signed out went out untagged, and the free plan's
 *    single project has no other way to tell dev from production. Stamping it
 *    here means no reset, re-init or future code path can lose it.
 *
 * Referrers pointing at a token page are blanked too (`stripTrackingReferrer`).
 */
export function posthogBeforeSend(
	event: CaptureResult | null,
): CaptureResult | null {
	if (event === null) return null;
	if (isCapabilityTokenPath(eventPathname(event))) return null;
	const hostname =
		typeof window === "undefined" ? "" : window.location.hostname;
	return {
		...event,
		properties: {
			...stripTrackingReferrer(event.properties ?? {}),
			environment: posthogEnvironment(hostname),
		},
	};
}

/**
 * The init options. Every disabled feature is a deliberate cost or privacy
 * decision, and each is switched off HERE rather than trusted to the project's
 * dashboard: PostHog's remote config can turn features on for a project
 * without a deploy, and a client that never says "no" inherits whatever it is
 * told. (Observed in /test-code, 2 Nov 2026: a fresh project shipped heatmaps,
 * web vitals, dead clicks and surveys switched on.)
 *
 * - **`autocapture`, `capture_dead_clicks`, `capture_heatmaps`, `rageclick`**
 *   — all record what a buyer clicked, element text included. On Kedaipal that
 *   is buyer names, the phone-echo line at checkout and `wa.me` hrefs.
 *   `MASK_PII` is a *Clarity* attribute PostHog does not honour.
 * - **`capture_pageview`** — `usePostHog` fires `$pageview` per resolved route
 *   so client-side navigations count once, not twice.
 * - **`capture_pageleave`, `capture_performance`** — pure event volume
 *   against the 1M/mo free tier, measuring things Clarity already shows.
 * - **`disable_session_recording`** — replay is Clarity's job, uncapped there.
 * - **`capture_exceptions`** — not our error tool, and exception messages can
 *   carry PII.
 * - **`disable_surveys`, `disable_product_tours`, `disable_web_experiments`**
 *   — each would render or rewrite UI on a buyer's storefront. Nothing should
 *   appear there that the seller didn't put there.
 * - **`person_profiles: "identified_only"`** — an anonymous shopper never mints
 *   a person record. The server mirrors this with `$process_person_profile`.
 * - **`before_send`** — see {@link posthogBeforeSend}.
 */
export function posthogInitOptions(host: string): Partial<PostHogConfig> {
	return {
		api_host: host,
		autocapture: false,
		capture_dead_clicks: false,
		capture_heatmaps: false,
		rageclick: false,
		capture_pageview: false,
		capture_pageleave: false,
		capture_performance: false,
		capture_exceptions: false,
		disable_session_recording: true,
		disable_surveys: true,
		disable_product_tours: true,
		disable_web_experiments: true,
		person_profiles: "identified_only",
		before_send: posthogBeforeSend,
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
