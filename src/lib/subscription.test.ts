import { describe, expect, test } from "vitest";
import { UNLIMITED } from "../../convex/lib/plans";
import {
	hasFeature,
	hasSubscribed,
	orderCapState,
	resolveBannerState,
	type SubscriptionView,
	shouldNudgePayment,
	tierPill,
	trialDaysLeft,
} from "./subscription";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000;

function sub(p: Partial<SubscriptionView>): SubscriptionView {
	return { plan: "pro", status: "active", ...p };
}

describe("trialDaysLeft", () => {
	test("rounds up, never negative", () => {
		expect(trialDaysLeft(NOW + 5 * DAY, NOW)).toBe(5);
		expect(trialDaysLeft(NOW + 4.2 * DAY, NOW)).toBe(5);
		expect(trialDaysLeft(NOW - DAY, NOW)).toBe(0);
		expect(trialDaysLeft(undefined, NOW)).toBe(0);
	});
});

describe("hasSubscribed (onboarding-complete gate)", () => {
	test("trialing is NOT subscribed", () => {
		expect(hasSubscribed(sub({ status: "trialing" }))).toBe(false);
	});

	test("a paid/active or lapsed plan counts as subscribed", () => {
		expect(hasSubscribed(sub({ status: "active" }))).toBe(true);
		expect(hasSubscribed(sub({ status: "past_due" }))).toBe(true);
		expect(hasSubscribed(sub({ status: "cancelled" }))).toBe(true);
	});

	test("comped pilots are subscribed even while trialing (never nagged)", () => {
		expect(hasSubscribed(sub({ status: "trialing", comped: true }))).toBe(true);
	});

	test("missing subscription fails open to subscribed", () => {
		expect(hasSubscribed(undefined)).toBe(true);
	});
});

describe("tierPill", () => {
	test("active → plan label, neutral", () => {
		expect(tierPill(sub({ status: "active", plan: "pro" }), NOW)).toEqual({
			label: "Pro",
			tone: "neutral",
		});
		expect(
			tierPill(sub({ status: "active", plan: "starter" }), NOW).label,
		).toBe("Starter");
	});

	test("trialing → countdown (warn when ended)", () => {
		expect(
			tierPill(sub({ status: "trialing", trialEndsAt: NOW + 5 * DAY }), NOW),
		).toEqual({ label: "Trial · 5 days left", tone: "trial" });
		expect(
			tierPill(sub({ status: "trialing", trialEndsAt: NOW + DAY }), NOW).label,
		).toBe("Trial · 1 day left");
		expect(
			tierPill(sub({ status: "trialing", trialEndsAt: NOW - DAY }), NOW),
		).toEqual({ label: "Trial ended", tone: "warn" });
	});

	test("past_due / cancelled → warn", () => {
		expect(tierPill(sub({ status: "past_due" }), NOW).tone).toBe("warn");
		expect(tierPill(sub({ status: "cancelled" }), NOW).label).toBe("Cancelled");
	});

	test("admin → 'Admin', overrides every subscription state", () => {
		// A Kedaipal admin runs the app for free, so no trial/past-due countdown is
		// ever shown — even a past_due or founding store reads "Admin".
		expect(tierPill(sub({ status: "past_due" }), NOW, undefined, true)).toEqual(
			{ label: "Admin", tone: "admin" },
		);
		expect(
			tierPill(
				sub({ status: "trialing", trialEndsAt: NOW - DAY }),
				NOW,
				3,
				true,
			),
		).toEqual({ label: "Admin", tone: "admin" });
	});
});

describe("shouldNudgePayment", () => {
	test("past_due always; trialing only in the last stretch; active never", () => {
		expect(shouldNudgePayment(sub({ status: "past_due" }), NOW)).toBe(true);
		expect(
			shouldNudgePayment(
				sub({ status: "trialing", trialEndsAt: NOW + 2 * DAY }),
				NOW,
			),
		).toBe(true);
		expect(
			shouldNudgePayment(
				sub({ status: "trialing", trialEndsAt: NOW + 9 * DAY }),
				NOW,
			),
		).toBe(false);
		expect(shouldNudgePayment(sub({ status: "active" }), NOW)).toBe(false);
	});
});

describe("resolveBannerState", () => {
	test("no banner for comped, missing, or healthy active with nothing due", () => {
		expect(resolveBannerState(undefined, undefined, NOW).kind).toBe("none");
		expect(resolveBannerState(sub({ comped: true }), NOW + DAY, NOW).kind).toBe(
			"none",
		);
		expect(
			resolveBannerState(sub({ status: "active" }), undefined, NOW).kind,
		).toBe("none");
	});

	test("past_due wins over everything", () => {
		expect(
			resolveBannerState(sub({ status: "past_due" }), NOW + DAY, NOW).kind,
		).toBe("pastDue");
	});

	test("active with a pending invoice due within 5 days → invoiceWarn", () => {
		expect(
			resolveBannerState(sub({ status: "active" }), NOW + 3 * DAY, NOW),
		).toEqual({ kind: "invoiceWarn", daysLeft: 3 });
		// Still >5 days out → no banner.
		expect(
			resolveBannerState(sub({ status: "active" }), NOW + 8 * DAY, NOW).kind,
		).toBe("none");
	});

	test("pending invoice takes precedence over the trial countdown", () => {
		const s = sub({ status: "trialing", trialEndsAt: NOW + 4 * DAY });
		expect(resolveBannerState(s, NOW + 2 * DAY, NOW)).toEqual({
			kind: "invoiceWarn",
			daysLeft: 2,
		});
	});

	test("trialing within 5 days (no invoice) → trialWarn; ended flag at/below 0", () => {
		expect(
			resolveBannerState(
				sub({ status: "trialing", trialEndsAt: NOW + 2 * DAY }),
				undefined,
				NOW,
			),
		).toEqual({ kind: "trialWarn", daysLeft: 2, ended: false });
		expect(
			resolveBannerState(
				sub({ status: "trialing", trialEndsAt: NOW - DAY }),
				undefined,
				NOW,
			),
		).toEqual({ kind: "trialWarn", daysLeft: 0, ended: true });
	});

	test("soft order-cap nudge: over/near, ranked below payment deadlines", () => {
		const caps = { orderCap: 100, userCap: 1, broadcastQuota: 0 };
		const s = sub({ plan: "starter", status: "active", caps });
		expect(resolveBannerState(s, undefined, NOW, undefined, 100)).toEqual({
			kind: "orderCapOver",
			used: 100,
			cap: 100,
		});
		expect(resolveBannerState(s, undefined, NOW, undefined, 85)).toEqual({
			kind: "orderCapNear",
			used: 85,
			cap: 100,
		});
		expect(resolveBannerState(s, undefined, NOW, undefined, 42).kind).toBe(
			"none",
		);
		// A payment deadline outranks the upsell.
		expect(resolveBannerState(s, NOW + 2 * DAY, NOW, undefined, 200).kind).toBe(
			"invoiceWarn",
		);
	});
});

describe("orderCapState (soft cap meter)", () => {
	const caps = { orderCap: 100, userCap: 1, broadcastQuota: 0 };

	test("thresholds: near at 80%, over at 100%", () => {
		const s = sub({ caps });
		expect(orderCapState(s, 79).kind).toBe("none");
		expect(orderCapState(s, 80).kind).toBe("near");
		expect(orderCapState(s, 99).kind).toBe("near");
		expect(orderCapState(s, 100).kind).toBe("over");
	});

	test("comped, unlimited-cap, or unknown usage never nudge", () => {
		expect(orderCapState(sub({ caps, comped: true }), 500).kind).toBe("none");
		expect(
			orderCapState(sub({ caps: { ...caps, orderCap: UNLIMITED } }), 5000).kind,
		).toBe("none");
		expect(orderCapState(sub({ caps }), undefined).kind).toBe("none");
		expect(orderCapState(undefined, 500).kind).toBe("none");
	});
});

describe("hasFeature (client plan gate)", () => {
	test("reads the resolved features off the subscription", () => {
		const starter = sub({
			plan: "starter",
			features: {
				crm: false,
				orderInbox: false,
				chargeablePickup: false,
				insights: false,
			},
		});
		expect(hasFeature(starter, "crm")).toBe(false);
		expect(hasFeature(starter, "orderInbox")).toBe(false);
		expect(hasFeature(starter, "chargeablePickup")).toBe(false);
		expect(hasFeature(starter, "insights")).toBe(false);
		const pro = sub({
			features: {
				crm: true,
				orderInbox: true,
				chargeablePickup: true,
				insights: true,
			},
		});
		expect(hasFeature(pro, "crm")).toBe(true);
		expect(hasFeature(pro, "chargeablePickup")).toBe(true);
		expect(hasFeature(pro, "insights")).toBe(true);
	});

	test("fails open when the subscription/features are missing (loading, comped)", () => {
		expect(hasFeature(undefined, "crm")).toBe(true);
		expect(hasFeature(sub({}), "crm")).toBe(true);
	});
});
