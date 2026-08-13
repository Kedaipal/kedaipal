import { describe, expect, it } from "vitest";
import { resolveTierCta } from "./pricing-cta";

/**
 * Covers the plan-aware pricing CTA branches — the signed-in states can't be
 * exercised in the signed-out marketing preview, so this is where they're proven.
 */
describe("resolveTierCta", () => {
	const scale = { isScale: true, isSignedIn: true, currentPlan: null };

	it("Scale is always a Coming soon pill, whatever the auth/plan state", () => {
		expect(resolveTierCta("scale", scale)).toBe("coming_soon");
		expect(
			resolveTierCta("scale", {
				isScale: true,
				isSignedIn: false,
				currentPlan: null,
			}),
		).toBe("coming_soon");
		expect(
			resolveTierCta("scale", {
				isScale: true,
				isSignedIn: true,
				currentPlan: "pro",
			}),
		).toBe("coming_soon");
	});

	it("signed-out visitors get the trial CTA on purchasable tiers", () => {
		const opts = { isScale: false, isSignedIn: false, currentPlan: null };
		expect(resolveTierCta("starter", opts)).toBe("trial");
		expect(resolveTierCta("pro", opts)).toBe("trial");
	});

	it("signed in but plan not resolved → dashboard fallback (no wrong label)", () => {
		const opts = { isScale: false, isSignedIn: true, currentPlan: null };
		expect(resolveTierCta("starter", opts)).toBe("dashboard");
		expect(resolveTierCta("pro", opts)).toBe("dashboard");
	});

	it("the seller's own tier is a disabled Current-plan pill", () => {
		expect(
			resolveTierCta("starter", {
				isScale: false,
				isSignedIn: true,
				currentPlan: "starter",
			}),
		).toBe("current");
		expect(
			resolveTierCta("pro", {
				isScale: false,
				isSignedIn: true,
				currentPlan: "pro",
			}),
		).toBe("current");
	});

	it("a higher tier is Upgrade, a lower tier is Manage (both → billing)", () => {
		// Starter seller
		expect(
			resolveTierCta("pro", {
				isScale: false,
				isSignedIn: true,
				currentPlan: "starter",
			}),
		).toBe("upgrade");
		// Pro seller looking at Starter
		expect(
			resolveTierCta("starter", {
				isScale: false,
				isSignedIn: true,
				currentPlan: "pro",
			}),
		).toBe("manage");
	});
});
