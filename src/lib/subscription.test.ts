import { describe, expect, test } from "vitest";
import {
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
