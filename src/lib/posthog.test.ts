// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__resetPostHogClientForTests,
	POSTHOG_DEFAULT_HOST,
	posthogBeforeSend,
	posthogInitOptions,
	readAnalyticsDistinctId,
	setPostHogClient,
	stripTrackingReferrer,
} from "./posthog";

afterEach(() => {
	__resetPostHogClientForTests();
});

/** Minimal stand-in for the bits of the PostHog client we actually call. */
function fakeClient(distinctId: unknown) {
	return {
		get_distinct_id: () =>
			typeof distinctId === "function"
				? (distinctId as () => string)()
				: distinctId,
	} as never;
}

describe("posthogInitOptions", () => {
	// Each of these is a cost or privacy decision, not a preference — see the
	// rationale on posthogInitOptions. Flipping one silently changes what a third
	// party records about buyers, or what we pay, so they are pinned.
	it("disables autocapture — it would bypass every MASK_PII surface", () => {
		expect(posthogInitOptions(POSTHOG_DEFAULT_HOST).autocapture).toBe(false);
	});

	it("disables session replay — that is Clarity's job, and free there", () => {
		expect(
			posthogInitOptions(POSTHOG_DEFAULT_HOST).disable_session_recording,
		).toBe(true);
	});

	it("leaves pageview capture to the router hook, so SPA navs count once", () => {
		const options = posthogInitOptions(POSTHOG_DEFAULT_HOST);
		expect(options.capture_pageview).toBe(false);
		expect(options.capture_pageleave).toBe(false);
	});

	it("keeps anonymous shoppers out of the person table", () => {
		expect(posthogInitOptions(POSTHOG_DEFAULT_HOST).person_profiles).toBe(
			"identified_only",
		);
	});

	// A fresh PostHog project shipped heatmaps, web vitals, dead clicks and
	// surveys switched ON from the dashboard (/test-code, 2 Nov 2026). A client
	// that never says "no" inherits whatever remote config tells it, so every
	// one is refused here.
	it.each([
		["capture_dead_clicks", false],
		["capture_heatmaps", false],
		["rageclick", false],
		["capture_performance", false],
		["capture_exceptions", false],
		["disable_surveys", true],
		["disable_product_tours", true],
		["disable_web_experiments", true],
	] as const)("pins %s to %s regardless of the project's remote config", (key, value) => {
		expect(posthogInitOptions(POSTHOG_DEFAULT_HOST)[key]).toBe(value);
	});

	it("routes every event through the before_send gate", () => {
		expect(posthogInitOptions(POSTHOG_DEFAULT_HOST).before_send).toBe(
			posthogBeforeSend,
		);
	});

	it("routes to the host it is given", () => {
		expect(posthogInitOptions("https://eu.i.posthog.com").api_host).toBe(
			"https://eu.i.posthog.com",
		);
	});
});

describe("stripTrackingReferrer", () => {
	// /track/<token> IS the buyer's capability secret. document.referrer is the
	// one channel that can carry it onto a page PostHog is allowed to observe.
	it("blanks a referrer pointing at the tracking page", () => {
		const out = stripTrackingReferrer({
			$referrer: "https://kedaipal.com/track/8f3c09b1a7e24d5c9b0e",
			$initial_referrer: "https://kedaipal.com/track/8f3c09b1a7e24d5c9b0e",
		});

		expect(out.$referrer).toBe("$direct");
		expect(out.$initial_referrer).toBe("$direct");
	});

	it("blanks a referrer pointing at the claim page", () => {
		const out = stripTrackingReferrer({
			$referrer: "https://kedaipal.com/claim/8f3c09b1a7e24d5c9b0e",
		});

		expect(out.$referrer).toBe("$direct");
	});

	it("leaves ordinary referrers alone", () => {
		const out = stripTrackingReferrer({
			$referrer: "https://www.google.com/search?q=kedai",
		});

		expect(out.$referrer).toBe("https://www.google.com/search?q=kedai");
	});

	it("leaves a route that merely shares the tracking prefix alone", () => {
		const out = stripTrackingReferrer({
			$referrer: "https://kedaipal.com/tracking-guide",
		});

		expect(out.$referrer).toBe("https://kedaipal.com/tracking-guide");
	});

	it("passes through non-URL and non-string values untouched", () => {
		const out = stripTrackingReferrer({
			$referrer: "$direct",
			$referring_domain: "google.com",
			$session_id: 42,
		});

		expect(out.$referrer).toBe("$direct");
		expect(out.$referring_domain).toBe("google.com");
		expect(out.$session_id).toBe(42);
	});

	// PostHog reuses the properties object across handlers, so mutating it in
	// place would corrupt state we do not own.
	it("does not mutate the object it was given", () => {
		const input = {
			$referrer: "https://kedaipal.com/track/8f3c09b1a7e24d5c9b0e",
		};

		const out = stripTrackingReferrer(input);

		expect(input.$referrer).toBe(
			"https://kedaipal.com/track/8f3c09b1a7e24d5c9b0e",
		);
		expect(out).not.toBe(input);
	});

	it("returns the same object when there is nothing to strip", () => {
		const input = { $referrer: "$direct" };
		expect(stripTrackingReferrer(input)).toBe(input);
	});
});

describe("readAnalyticsDistinctId", () => {
	it("is undefined before PostHog boots", () => {
		expect(readAnalyticsDistinctId()).toBeUndefined();
	});

	it("returns the booted client's id", () => {
		setPostHogClient(fakeClient("0198f3a1-4b2c-7d3e-8f90-a1b2c3d4e5f6"));

		expect(readAnalyticsDistinctId()).toBe(
			"0198f3a1-4b2c-7d3e-8f90-a1b2c3d4e5f6",
		);
	});

	it("applies the shared sanitizer, so junk never reaches an order", () => {
		setPostHogClient(fakeClient("undefined"));

		expect(readAnalyticsDistinctId()).toBeUndefined();
	});

	// Checkout must survive a broken or blocked SDK — this read sits directly in
	// the order-submit path.
	it("swallows a client that throws", () => {
		setPostHogClient(
			fakeClient(() => {
				throw new Error("posthog is not initialized");
			}),
		);

		expect(() => readAnalyticsDistinctId()).not.toThrow();
		expect(readAnalyticsDistinctId()).toBeUndefined();
	});
});

describe("env host fallback", () => {
	// .env.local.example ships VITE_POSTHOG_HOST blank so local traffic stays out
	// of the production project. Vite inlines that as "", which z.string().url()
	// rejects — and a throwing env module takes the WHOLE app down, not just
	// analytics. Blank must read as unset.
	it("treats a blank VITE_POSTHOG_HOST as unset rather than throwing", async () => {
		vi.resetModules();
		vi.stubEnv("VITE_POSTHOG_HOST", "");
		vi.stubEnv("VITE_POSTHOG_KEY", "");

		const { clientEnv } = await import("./env");

		expect(clientEnv.VITE_POSTHOG_HOST).toBeUndefined();
		expect(clientEnv.VITE_POSTHOG_KEY).toBeUndefined();
		vi.unstubAllEnvs();
	});
});

describe("posthogBeforeSend", () => {
	const ev = (properties: Record<string, unknown>) =>
		({ event: "$web_vitals", properties }) as never;

	afterEach(() => {
		window.history.replaceState(null, "", "/");
	});

	// Checkout reaches /track/<token> as an IN-APP navigation, so an SDK booted
	// on the storefront is still alive on the token page. Whatever it records
	// there — heatmap, web vitals, anything a future setting turns on — would
	// carry the buyer's capability token in its URL.
	it.each([
		"http://localhost:3130/track/8f3c09b1a7e24d5c9b0e",
		"https://kedaipal.com/claim/8f3c09b1a7e24d5c9b0e",
	])("drops an event whose URL is a capability-token page: %s", (url) => {
		expect(posthogBeforeSend(ev({ $current_url: url }))).toBeNull();
	});

	it("drops an event recorded while the browser sits on a token page", () => {
		window.history.replaceState(null, "", "/track/8f3c09b1a7e24d5c9b0e");
		expect(posthogBeforeSend(ev({}))).toBeNull();
	});

	// Heatmap / web-vitals batches can flush AFTER the route changed: the
	// event's own URL decides, not the page the browser happens to be on now.
	it("judges by the event's own URL, not the current page", () => {
		window.history.replaceState(null, "", "/track/8f3c09b1a7e24d5c9b0e");
		const kept = posthogBeforeSend(
			ev({ $current_url: "http://localhost:3130/herb/p/kuih" }),
		);
		expect(kept).not.toBeNull();
	});

	it("keeps an ordinary storefront event", () => {
		const kept = posthogBeforeSend(
			ev({ $current_url: "http://localhost:3130/tracking-guide" }),
		);
		expect(kept).not.toBeNull();
	});

	// The fix for the sign-out bug: stamped per event, so posthog.reset() —
	// which wipes registered super properties — can no longer untag anything.
	it("stamps the environment on every event it keeps", () => {
		const kept = posthogBeforeSend(
			ev({ $current_url: "http://localhost:3130/" }),
		);
		expect(kept?.properties.environment).toBe("development");
	});

	it("blanks a referrer that points at a token page", () => {
		const kept = posthogBeforeSend(
			ev({
				$current_url: "http://localhost:3130/herb",
				$referrer: "https://kedaipal.com/track/8f3c09b1a7e24d5c9b0e",
			}),
		);
		expect(kept?.properties.$referrer).toBe("$direct");
	});

	it("passes a null event straight through", () => {
		expect(posthogBeforeSend(null)).toBeNull();
	});
});
