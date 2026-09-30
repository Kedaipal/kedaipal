// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
	cancelCreditLine,
	creditActivityLabel,
	creditTone,
	downgradeCreditLine,
	includedCreditsLabel,
	lockCta,
	ordersBalanceLabel,
	ordersWaitingLabel,
	planPickCreditLine,
} from "./credits-ui";

describe("the balance speaks in orders", () => {
	test("left, owed, and the singular", () => {
		expect(ordersBalanceLabel(42)).toBe("42 orders left");
		expect(ordersBalanceLabel(1)).toBe("1 order left");
		expect(ordersBalanceLabel(0)).toBe("0 orders left");
		expect(ordersBalanceLabel(-1)).toBe("1 order owed");
		expect(ordersBalanceLabel(-15)).toBe("15 orders owed");
	});

	test("amber in the last fifth of the grant, never below the 10-left line; red at zero", () => {
		expect(creditTone(100, 200)).toBe("ok");
		expect(creditTone(40, 200)).toBe("low"); // 20% of 200
		expect(creditTone(41, 200)).toBe("ok");
		// A small grant still warns at 10 left, not at 20% (= 4).
		expect(creditTone(10, 20)).toBe("low");
		expect(creditTone(1, 200)).toBe("low");
		expect(creditTone(0, 200)).toBe("out");
		expect(creditTone(-3, 200)).toBe("out");
	});

	test("the waiting count caps at 99+ and says nothing at zero", () => {
		expect(ordersWaitingLabel(0)).toBeNull();
		expect(ordersWaitingLabel(1)).toBe("1 new order since you ran out");
		expect(ordersWaitingLabel(3)).toBe("3 new orders since you ran out");
		expect(ordersWaitingLabel(99)).toBe("99+ new orders since you ran out");
	});

	test("every unlock route gets the one button that puts credits back", () => {
		expect(lockCta("topup")).toEqual({
			label: "Top up",
			search: { tab: "billing", topup: 1 },
		});
		expect(lockCta("pick_plan").label).toBe("Pick a plan");
		expect(lockCta("pay_invoice").label).toBe("Pay invoice");
		expect(lockCta("resume").label).toBe("Resume plan");
		expect(lockCta("subscribe").label).toBe("Choose a plan");
		// Only a top-up opens the pack picker; the rest land on Billing.
		expect(lockCta("pick_plan").search).toEqual({ tab: "billing" });
	});
});

describe("credit activity reads as a sentence", () => {
	const row = (over: Partial<Parameters<typeof creditActivityLabel>[0]>) =>
		creditActivityLabel({
			type: "debit",
			reason: "order",
			amount: -1,
			periodKey: "2026-10",
			...over,
		});

	test("grants, orders and packs", () => {
		expect(row({ type: "grant", reason: "plan", amount: 200 })).toBe(
			"October credits from your plan",
		);
		expect(row({ type: "grant", reason: "trial", amount: 200 })).toBe(
			"Free trial orders",
		);
		expect(row({ refLabel: "ORD-7K2Q" })).toBe("Order ORD-7K2Q");
		expect(
			row({
				type: "purchase",
				reason: "purchase",
				amount: 50,
				refLabel: "50 credits",
			}),
		).toBe("Bought 50 credits");
	});

	test("every refund says why the credit came back", () => {
		const refund = (cause: "seller" | "system" | "buyer" | "admin") =>
			row({ type: "refund", amount: 1, refLabel: "ORD-7K2Q", cause });
		expect(refund("seller")).toMatch(/cancelled before you accepted it/);
		expect(refund("buyer")).toMatch(/the buyer backed out/);
		expect(refund("system")).toMatch(/expired unanswered or unpaid/);
		expect(refund("admin")).toMatch(/removed by Kedaipal/);
	});

	test("what didn't carry over, and what expired", () => {
		expect(row({ type: "expire", reason: "plan", amount: -12 })).toBe(
			"Unused October plan credits — they don't carry over",
		);
		expect(row({ type: "expire", reason: "expiry", amount: -5 })).toBe(
			"Bought credits expired (12 months)",
		);
		expect(row({ type: "expire", reason: "trial", amount: -60 })).toMatch(
			/Unused trial orders/,
		);
		expect(row({ type: "adjust", reason: "adjust", amount: 10 })).toBe(
			"Added by Kedaipal",
		);
		expect(row({ type: "adjust", reason: "adjust", amount: -10 })).toBe(
			"Removed by Kedaipal",
		);
	});
});

describe("the cancel dialog says what happens to the order's credit", () => {
	test("never accepted: it comes back, with what's left this month", () => {
		expect(cancelCreditLine({ kind: "refund", refundsLeftAfter: 9 })).toBe(
			"The credit it used comes back to you (9 more this month).",
		);
		expect(cancelCreditLine({ kind: "refund", refundsLeftAfter: 0 })).toMatch(
			/the last one this month/,
		);
	});

	test("accepted, or the allowance is spent: it stays used, and says why", () => {
		expect(cancelCreditLine({ kind: "kept", reason: "accepted" })).toMatch(
			/you'd already accepted this order/,
		);
		expect(
			cancelCreditLine({ kind: "kept", reason: "allowance_used" }),
		).toMatch(/this month's 10 credits back from cancelling are used up/);
	});

	test("an order that never used a credit says nothing", () => {
		expect(cancelCreditLine({ kind: "not_charged" })).toBeNull();
	});
});

describe("plan choices state the allowance and what they do to the balance", () => {
	const trial = (plan: number) => ({
		regime: "trial" as const,
		plan,
		periodGrant: 200,
		periodKey: "2026-10",
	});

	test("each plan names its allowance", () => {
		expect(includedCreditsLabel(100)).toBe("100 credits a month");
	});

	test("a trial converting: what it used, and what it starts with", () => {
		expect(
			planPickCreditLine({
				balance: trial(60),
				grant: 100,
				planName: "Starter",
			}),
		).toBe(
			"Your trial has used 140 of its 200 orders. Starter includes 100 a month — you'd start with 100 for the rest of October; unused trial orders don't carry over.",
		);
		expect(
			planPickCreditLine({
				balance: trial(-30),
				grant: 100,
				planName: "Starter",
			}),
		).toMatch(
			/used 230 orders, 30 more .* start with 70 .* the 30 extra come off first/,
		);
		// Over by more than the allowance: still short after subscribing.
		expect(
			planPickCreditLine({
				balance: trial(-150),
				grant: 100,
				planName: "Starter",
			}),
		).toMatch(/you'd still be 50 short for October/);
	});

	test("a lapsed store: the month's credits land on payment, less anything owed", () => {
		const none = (plan: number) => ({
			regime: "none" as const,
			plan,
			periodGrant: 0,
			periodKey: "2026-10",
		});
		expect(
			planPickCreditLine({ balance: none(0), grant: 200, planName: "Pro" }),
		).toBe(
			"Pro includes 200 orders a month — October's land the moment you pay.",
		);
		expect(
			planPickCreditLine({ balance: none(-8), grant: 200, planName: "Pro" }),
		).toMatch(/less the 8 owed/);
	});

	test("a running monthly allowance adds nothing to the picker", () => {
		expect(
			planPickCreditLine({
				balance: {
					regime: "monthly",
					plan: 50,
					periodGrant: 200,
					periodKey: "2026-10",
				},
				grant: 100,
				planName: "Starter",
			}),
		).toBeNull();
	});

	test("downgrade: the smaller allowance beside this month's orders", () => {
		expect(
			downgradeCreditLine({
				fromLabel: "1 Nov",
				currentGrant: 200,
				targetGrant: 100,
				ordersThisPeriod: 140,
				customGrant: false,
			}),
		).toBe(
			"From 1 Nov you'll have 100 credits a month instead of 200 — you've had 140 orders so far this month.",
		);
		expect(
			downgradeCreditLine({
				fromLabel: "1 Nov",
				currentGrant: 200,
				targetGrant: 100,
				ordersThisPeriod: 1,
				customGrant: false,
			}),
		).toMatch(/you've had 1 order so far/);
		// A store owing orders is told the first month lands smaller — as
		// TODAY's figure, since a top-up before then clears it.
		expect(
			downgradeCreditLine({
				fromLabel: "1 Nov",
				currentGrant: 200,
				targetGrant: 100,
				ordersThisPeriod: 215,
				owedNow: 15,
				customGrant: false,
			}),
		).toBe(
			"From 1 Nov you'll have 100 credits a month instead of 200 — you've had 215 orders so far this month. Anything still owed then comes off that month's credits (15 orders owed today).",
		);
		// A viewer who can't see credits still gets the allowance change.
		expect(
			downgradeCreditLine({
				fromLabel: "1 Nov",
				currentGrant: 200,
				targetGrant: 100,
				customGrant: false,
			}),
		).toBe("From 1 Nov you'll have 100 credits a month instead of 200.");
		// A custom allowance doesn't change with the plan — nothing to say.
		expect(
			downgradeCreditLine({
				fromLabel: "1 Nov",
				currentGrant: 150,
				targetGrant: 100,
				ordersThisPeriod: 140,
				customGrant: true,
			}),
		).toBeNull();
	});
});
