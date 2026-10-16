import { describe, expect, test } from "vitest";
import { ATTRIBUTION_MAX_LENGTH } from "./attribution";
import { PLAN_CREDIT_GRANT } from "./plans";
import {
	isReferralSource,
	referralHref,
	referralPath,
	referralRefereeOffer,
	referralRewardCredits,
	referralShareMessage,
	referralSourceTag,
	referrerStanding,
} from "./referral";

describe("referral link", () => {
	test("is the store slug under /referral on the marketing site", () => {
		expect(referralHref("siti-kitchen")).toBe(
			"https://kedaipal.com/referral/siti-kitchen",
		);
		expect(referralPath("siti-kitchen")).toBe("/referral/siti-kitchen");
	});
});

describe("referral analytics tag", () => {
	test("is referral-<slug>", () => {
		expect(referralSourceTag("siti-kitchen")).toBe("referral-siti-kitchen");
		expect(isReferralSource("referral-siti-kitchen")).toBe(true);
	});

	test("truncates a long slug — which is why identity never comes from it", () => {
		const slug = "a-very-long-store-name-for-tests"; // 32 chars, the slug max
		const tag = referralSourceTag(slug);
		expect(tag.length).toBeLessThanOrEqual(ATTRIBUTION_MAX_LENGTH);
		expect(tag).not.toBe(`referral-${slug}`);
		// Still recognisably a referral visit for analytics.
		expect(isReferralSource(tag)).toBe(true);
	});

	test("badge and other tags are not referrals", () => {
		expect(isReferralSource("powered-by")).toBe(false);
		expect(isReferralSource("spotlight-thg")).toBe(false);
		expect(isReferralSource(undefined)).toBe(false);
	});
});

describe("referral reward size", () => {
	test("is 30% of a month of the tier's list grant", () => {
		expect(referralRewardCredits("starter")).toBe(30);
		expect(referralRewardCredits("pro")).toBe(60);
	});

	test("derives from PLAN_CREDIT_GRANT, never a literal", () => {
		expect(referralRewardCredits("starter")).toBe(
			(PLAN_CREDIT_GRANT.starter * 30) / 100,
		);
		expect(referralRewardCredits("pro")).toBe(
			(PLAN_CREDIT_GRANT.pro * 30) / 100,
		);
	});

	test("Enterprise counts as Pro, so a contract can't inflate a reward", () => {
		expect(referralRewardCredits("enterprise")).toBe(
			referralRewardCredits("pro"),
		);
	});

	test("the referee offer quotes both listed tiers", () => {
		expect(referralRefereeOffer()).toEqual({ starter: 30, pro: 60 });
	});
});

describe("referrerStanding", () => {
	const base = {
		status: "active" as const,
		comped: false,
		ownerIsAdmin: false,
		unclaimed: false,
	};

	test("an active paid plan refers and earns", () => {
		expect(referrerStanding(base)).toEqual({
			canRefer: true,
			earnsReward: true,
		});
	});

	test("a comped partner refers but earns nothing", () => {
		expect(referrerStanding({ ...base, comped: true })).toEqual({
			canRefer: true,
			earnsReward: false,
		});
		// Comped wins over whatever status the row carries.
		expect(
			referrerStanding({ ...base, comped: true, status: "trialing" }),
		).toEqual({ canRefer: true, earnsReward: false });
	});

	test("an admin-owned store refers but earns nothing", () => {
		expect(
			referrerStanding({ ...base, ownerIsAdmin: true, status: "trialing" }),
		).toEqual({ canRefer: true, earnsReward: false });
	});

	test("trial, hold, lapsed and no-plan stores cannot refer", () => {
		expect(referrerStanding({ ...base, status: "trialing" })).toEqual({
			canRefer: false,
			reason: "trial",
		});
		expect(referrerStanding({ ...base, status: "on_hold" })).toEqual({
			canRefer: false,
			reason: "paused",
		});
		expect(referrerStanding({ ...base, status: "past_due" })).toEqual({
			canRefer: false,
			reason: "lapsed",
		});
		expect(referrerStanding({ ...base, status: "cancelled" })).toEqual({
			canRefer: false,
			reason: "lapsed",
		});
		expect(referrerStanding({ ...base, status: null })).toEqual({
			canRefer: false,
			reason: "no_plan",
		});
	});

	test("an unclaimed pre-built store cannot refer, even comped", () => {
		expect(
			referrerStanding({ ...base, unclaimed: true, comped: true }),
		).toEqual({ canRefer: false, reason: "unclaimed" });
	});
});

describe("referral share message", () => {
	test("carries the link and the referee's offer, never money or commission", () => {
		const msg = referralShareMessage("https://kedaipal.com/referral/siti");
		expect(msg).toContain("https://kedaipal.com/referral/siti");
		expect(msg).toContain("60 bonus credits");
		expect(msg).toContain("30 on Starter");
		expect(msg).not.toMatch(/RM|commission|affiliate|earn/i);
	});
});
