import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__resetPostHogClientForTests,
	POSTHOG_DEFAULT_HOST,
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
