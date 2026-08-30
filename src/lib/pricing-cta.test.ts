import { describe, expect, it } from "vitest";
import { resolveTierCta } from "./pricing-cta";
import type { SubscriptionView } from "./subscription";

/**
 * Covers the plan-aware pricing CTA branches — the signed-in states can't be
 * exercised in the signed-out marketing preview, so this is where they're proven.
 * The load-bearing case: `plan` is the trialed tier, so ownership is gated on
 * `status`/`comped`, never `plan` alone (PR #125 review).
 */

const sub = (
	plan: SubscriptionView["plan"],
	status: SubscriptionView["status"],
	comped = false,
): SubscriptionView => ({ plan, status, comped });

const signedIn = (subscription: SubscriptionView | null) => ({
	isScale: false,
	isSignedIn: true,
	subscription,
});

describe("resolveTierCta", () => {
	it("Scale is always a Coming soon pill, whatever the auth/plan state", () => {
		const scaleOpts = { isScale: true, isSignedIn: true };
		expect(resolveTierCta("scale", { ...scaleOpts, subscription: null })).toBe(
			"coming_soon",
		);
		expect(
			resolveTierCta("scale", {
				isScale: true,
				isSignedIn: false,
				subscription: null,
			}),
		).toBe("coming_soon");
		expect(
			resolveTierCta("scale", {
				...scaleOpts,
				subscription: sub("pro", "active"),
			}),
		).toBe("coming_soon");
	});

	it("signed-out visitors get the trial CTA on purchasable tiers", () => {
		const opts = { isScale: false, isSignedIn: false, subscription: null };
		expect(resolveTierCta("starter", opts)).toBe("trial");
		expect(resolveTierCta("pro", opts)).toBe("trial");
	});

	it("signed in but plan not resolved → dashboard fallback (no wrong label)", () => {
		expect(resolveTierCta("starter", signedIn(null))).toBe("dashboard");
		expect(resolveTierCta("pro", signedIn(null))).toBe("dashboard");
	});

	// The regression the review caught: a trial stamps plan:"pro", so treating
	// `plan` as ownership showed the whole trial cohort a dead pill on Pro.
	it("a trialing seller (plan pro) gets Subscribe on every tier, never Current", () => {
		const t = signedIn(sub("pro", "trialing"));
		expect(resolveTierCta("pro", t)).toBe("subscribe");
		expect(resolveTierCta("starter", t)).toBe("subscribe");
	});

	it("past_due and cancelled sellers also get Subscribe, not a pill", () => {
		expect(resolveTierCta("pro", signedIn(sub("pro", "past_due")))).toBe(
			"subscribe",
		);
		expect(resolveTierCta("starter", signedIn(sub("pro", "past_due")))).toBe(
			"subscribe",
		);
		expect(resolveTierCta("pro", signedIn(sub("pro", "cancelled")))).toBe(
			"subscribe",
		);
	});

	it("an ACTIVE subscriber's own tier is the disabled Current-plan pill", () => {
		expect(resolveTierCta("starter", signedIn(sub("starter", "active")))).toBe(
			"current",
		);
		expect(resolveTierCta("pro", signedIn(sub("pro", "active")))).toBe(
			"current",
		);
	});

	it("comped accounts own their tier (Current), even if status isn't active", () => {
		// Fail-open missing row resolves to plan:pro/active/comped; a real comp may
		// carry any status. comped === full access → Current, not Subscribe.
		expect(resolveTierCta("pro", signedIn(sub("pro", "trialing", true)))).toBe(
			"current",
		);
		expect(
			resolveTierCta("starter", signedIn(sub("pro", "active", true))),
		).toBe("manage");
	});

	it("an active seller sees Upgrade on a higher tier, Manage on a lower one", () => {
		expect(resolveTierCta("pro", signedIn(sub("starter", "active")))).toBe(
			"upgrade",
		);
		expect(resolveTierCta("starter", signedIn(sub("pro", "active")))).toBe(
			"manage",
		);
	});
});
