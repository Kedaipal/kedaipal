import { describe, expect, test } from "vitest";
import {
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
});
