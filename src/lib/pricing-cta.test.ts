import { describe, expect, it } from "vitest";
import { isPlanSelectable, LISTED_PLANS, PLANS } from "../../convex/lib/plans";
import { resolveTierCta } from "./pricing-cta";
import type { SubscriptionView } from "./subscription";

/**
 * Covers the plan-aware pricing CTA branches — the signed-in states can't be
 * exercised in the signed-out marketing preview, so this is where they're proven.
 * The load-bearing case: `plan` is the trialed tier, so ownership is gated on
 * `status`, never `plan` alone (PR #125 review); a comp is its own answer.
 */

const sub = (
	plan: SubscriptionView["plan"],
	status: SubscriptionView["status"],
	comped = false,
): SubscriptionView => ({ plan, status, comped });

const signedIn = (subscription: SubscriptionView | null) => ({
	selectable: true,
	isSignedIn: true,
	subscription,
});

describe("resolveTierCta", () => {
	it("a LISTED tier that isn't for sale is a Coming soon pill, whatever the auth/plan state", () => {
		const closed = { selectable: false, isSignedIn: true };
		expect(resolveTierCta("pro", { ...closed, subscription: null })).toBe(
			"coming_soon",
		);
		expect(
			resolveTierCta("starter", {
				selectable: false,
				isSignedIn: false,
				subscription: null,
			}),
		).toBe("coming_soon");
	});

	/**
	 * Enterprise (Credits T6) has no price and no self-serve door: its card is
	 * a conversation for everyone — visitors, trials, paying stores — except
	 * the store already on a contract (its Current plan) and a comp (included).
	 * A store on a contract changes it by talking to us, so every OTHER tier
	 * is "talk" for it too — never a billing-tab door that would refuse it.
	 */
	it("Enterprise is Talk to Arif — Current for a contract store, included for a comp", () => {
		for (const plan of LISTED_PLANS)
			expect(isPlanSelectable(plan), plan).toBe(true);
		expect(isPlanSelectable("enterprise")).toBe(false);
		const opts = (
			subscription: SubscriptionView | null,
			isSignedIn = true,
		) => ({
			selectable: isPlanSelectable("enterprise"),
			isSignedIn,
			subscription,
		});
		expect(resolveTierCta("enterprise", opts(null, false))).toBe("talk");
		expect(resolveTierCta("enterprise", opts(null))).toBe("talk");
		expect(resolveTierCta("enterprise", opts(sub("pro", "trialing")))).toBe(
			"talk",
		);
		expect(resolveTierCta("enterprise", opts(sub("pro", "active")))).toBe(
			"talk",
		);
		expect(
			resolveTierCta("enterprise", opts(sub("enterprise", "active"))),
		).toBe("current");
		expect(resolveTierCta("enterprise", opts(sub("pro", "active", true)))).toBe(
			"sponsored",
		);
		// A contract store's other tiers are a conversation too.
		for (const tier of LISTED_PLANS)
			expect(resolveTierCta(tier, signedIn(sub("enterprise", "active")))).toBe(
				"talk",
			);
	});

	it("signed-out visitors get the trial CTA on purchasable tiers", () => {
		const opts = { selectable: true, isSignedIn: false, subscription: null };
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

	it("comped accounts see every live tier as included — never a door into billing (z8r3fdeub2)", () => {
		// A comp resolves to the highest tier with unlimited orders and refuses
		// subscribe/change/cancel server-side, so no tier may be a link. Covers the
		// fail-open missing row (plan:pro/active/comped) and any stored plan/status.
		for (const tier of PLANS) {
			expect(resolveTierCta(tier, signedIn(sub("pro", "active", true)))).toBe(
				"sponsored",
			);
			expect(
				resolveTierCta(tier, signedIn(sub("starter", "trialing", true))),
			).toBe("sponsored");
		}
		// A closed listed tier stays Coming soon even for a comp — a product
		// fact, not a seller one.
		expect(
			resolveTierCta("pro", {
				selectable: false,
				isSignedIn: true,
				subscription: sub("pro", "active", true),
			}),
		).toBe("coming_soon");
	});

	it("a store whose comp ENDED is back to subscribing like any expired seller", () => {
		const expired: SubscriptionView = {
			plan: "pro",
			status: "past_due",
			comped: false,
			compEnded: { at: 1 },
		};
		expect(resolveTierCta("pro", signedIn(expired))).toBe("subscribe");
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
