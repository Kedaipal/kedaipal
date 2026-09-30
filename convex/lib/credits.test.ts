// Kedaipal Credits (86eye2ccu) — the pure rules: grant precedence, the regime
// per subscription status, the refresh formula, bucket order, the refund
// decision, top-up eligibility, and the pack guard rule.
import { describe, expect, test } from "vitest";
import {
	cancelRefundDecision,
	creditLockAudience,
	creditLockMessage,
	creditRegime,
	type CreditRegimeInputs,
	creditsExhausted,
	debitBucket,
	dueCreditNotice,
	lowCreditLine,
	monthlyCreditGrant,
	refreshedPlanBalance,
	sellerRefundsLeft,
	topUpBlock,
} from "./credits";
import {
	BILLING_CURRENCIES,
	CREDIT_PACKS,
	creditPackById,
	FOUNDING_PRO_CREDIT_GRANT,
	PLAN_CREDIT_GRANT,
	PLAN_MONTHLY_PRICES,
	PLANS,
	SELLER_CANCEL_REFUNDS_PER_PERIOD,
	TRIAL_CREDIT_GRANT,
} from "./plans";

const NOW = Date.UTC(2026, 9, 10);

function inputs(over: Partial<CreditRegimeInputs> = {}): CreditRegimeInputs {
	return {
		status: "active",
		plan: "pro",
		comped: false,
		ownerIsAdmin: false,
		foundingEligible: false,
		override: undefined,
		annualGrant: undefined,
		now: NOW,
		...over,
	};
}

describe("the locked numbers", () => {
	test("grants: Starter 100 / Pro 200 / Scale 500, Founding Pro 300, trial 200", () => {
		expect(PLAN_CREDIT_GRANT).toEqual({ starter: 100, pro: 200, scale: 500 });
		expect(FOUNDING_PRO_CREDIT_GRANT).toBe(300);
		expect(TRIAL_CREDIT_GRANT).toBe(200);
	});

	test("packs: MY 50/RM45 + 200/RM160, SG 50/S$22 + 200/S$75 — one currency each", () => {
		expect(CREDIT_PACKS.MYR).toEqual([
			{ id: "p50", credits: 50, priceMinor: 4500, currency: "MYR" },
			{ id: "p200", credits: 200, priceMinor: 16000, currency: "MYR" },
		]);
		expect(CREDIT_PACKS.SGD).toEqual([
			{ id: "p50sg", credits: 50, priceMinor: 2200, currency: "SGD" },
			{ id: "p200sg", credits: 200, priceMinor: 7500, currency: "SGD" },
		]);
		for (const currency of BILLING_CURRENCIES) {
			for (const pack of CREDIT_PACKS[currency]) {
				expect(pack.currency).toBe(currency);
				expect(creditPackById(pack.id)).toEqual(pack);
			}
		}
		expect(creditPackById("nope")).toBeUndefined();
	});

	// The guard rule (register items 2 + 3): upgrading always beats topping up
	// at volume. A future price or grant change that breaks it fails CI.
	test("GUARD: the cheapest pack credit costs at least the dearest tier's implied per-order price", () => {
		for (const currency of BILLING_CURRENCIES) {
			const cheapestPackCredit = Math.min(
				...CREDIT_PACKS[currency].map((p) => p.priceMinor / p.credits),
			);
			const dearestTierOrder = Math.max(
				...PLANS.map(
					(plan) => PLAN_MONTHLY_PRICES[currency][plan] / PLAN_CREDIT_GRANT[plan],
				),
			);
			expect(cheapestPackCredit).toBeGreaterThanOrEqual(dearestTierOrder);
		}
	});
});

describe("monthlyCreditGrant — precedence", () => {
	test("the plan's grant by default", () => {
		for (const plan of PLANS)
			expect(monthlyCreditGrant(inputs({ plan }))).toBe(PLAN_CREDIT_GRANT[plan]);
	});

	test("founding Pro gets 300; a founding store on Scale keeps 500; Starter is unaffected", () => {
		expect(monthlyCreditGrant(inputs({ foundingEligible: true }))).toBe(300);
		expect(
			monthlyCreditGrant(inputs({ foundingEligible: true, plan: "scale" })),
		).toBe(500);
		expect(
			monthlyCreditGrant(inputs({ foundingEligible: true, plan: "starter" })),
		).toBe(100);
	});

	test("an annual lock holds inside its term and lapses after it", () => {
		const annualGrant = { grant: 250, until: NOW + 1000 };
		expect(monthlyCreditGrant(inputs({ annualGrant }))).toBe(250);
		expect(
			monthlyCreditGrant(inputs({ annualGrant, now: NOW + 1000 })),
		).toBe(200);
	});

	test("an admin override beats everything", () => {
		expect(
			monthlyCreditGrant(
				inputs({
					override: 1000,
					foundingEligible: true,
					annualGrant: { grant: 250, until: NOW + 1000 },
				}),
			),
		).toBe(1000);
		expect(monthlyCreditGrant(inputs({ override: 0 }))).toBe(0);
	});
});

describe("creditRegime — by subscription status", () => {
	test("active → monthly; trialing → the one-off trial grant", () => {
		expect(creditRegime(inputs())).toEqual({ kind: "monthly", grant: 200 });
		expect(creditRegime(inputs({ status: "trialing", plan: "starter" }))).toEqual(
			{ kind: "trial", grant: 200 },
		);
	});

	test("past_due, on_hold and cancelled earn nothing until they pay or resume", () => {
		for (const status of ["past_due", "on_hold", "cancelled"] as const)
			expect(creditRegime(inputs({ status }))).toEqual({ kind: "none" });
	});

	test("comped, admin-owned and the missing-row fail-safe are metered monthly whatever the status", () => {
		expect(creditRegime(inputs({ status: "past_due", comped: true }))).toEqual({
			kind: "monthly",
			grant: 200,
		});
		// An admin store sits in `trialing` forever — a one-off grant would turn
		// its honest meter into a debt that never refreshes.
		expect(
			creditRegime(inputs({ status: "trialing", ownerIsAdmin: true })),
		).toEqual({ kind: "monthly", grant: 200 });
		expect(creditRegime(inputs({ status: null }))).toEqual({
			kind: "monthly",
			grant: 200,
		});
	});
});

describe("refresh + spend order", () => {
	test("no rollover of a positive leftover; a debt always carries (at -15, Starter refreshes to 85)", () => {
		expect(refreshedPlanBalance(40, 100)).toBe(100);
		expect(refreshedPlanBalance(0, 100)).toBe(100);
		expect(refreshedPlanBalance(-15, 100)).toBe(85);
		expect(refreshedPlanBalance(-150, 100)).toBe(-50);
	});

	test("plan first, then purchased, then the plan bucket goes below zero", () => {
		expect(debitBucket(5, 50)).toBe("plan");
		expect(debitBucket(0, 50)).toBe("purchased");
		expect(debitBucket(-3, 50)).toBe("purchased");
		expect(debitBucket(0, 0)).toBe("plan");
		expect(debitBucket(-3, 0)).toBe("plan");
	});

	test("exhausted is the ONE check: total at or below zero", () => {
		expect(creditsExhausted(1)).toBe(false);
		expect(creditsExhausted(0)).toBe(true);
		expect(creditsExhausted(-5)).toBe(true);
	});
});

describe("cancelRefundDecision — only an order that never got going", () => {
	test("the system, the buyer and an admin always give the credit back", () => {
		for (const cause of ["system", "buyer", "admin"] as const) {
			expect(
				cancelRefundDecision({
					cause,
					statusAtCancel: "confirmed",
					sellerRefundsUsed: SELLER_CANCEL_REFUNDS_PER_PERIOD,
				}),
			).toEqual({ refund: true, countsAgainstAllowance: false });
		}
	});

	test("a seller cancel refunds a never-accepted order and counts against the allowance", () => {
		for (const statusAtCancel of ["pending", "booking_requested"]) {
			expect(
				cancelRefundDecision({ cause: "seller", statusAtCancel, sellerRefundsUsed: 0 }),
			).toEqual({ refund: true, countsAgainstAllowance: true });
		}
	});

	test("a seller cancel of an ACCEPTED order keeps its credit", () => {
		for (const statusAtCancel of ["confirmed", "packed", "shipped", "delivered"]) {
			expect(
				cancelRefundDecision({ cause: "seller", statusAtCancel, sellerRefundsUsed: 0 }),
			).toEqual({ refund: false, reason: "accepted" });
		}
	});

	test("the monthly allowance caps seller refunds", () => {
		expect(
			cancelRefundDecision({
				cause: "seller",
				statusAtCancel: "pending",
				sellerRefundsUsed: SELLER_CANCEL_REFUNDS_PER_PERIOD - 1,
			}),
		).toEqual({ refund: true, countsAgainstAllowance: true });
		expect(
			cancelRefundDecision({
				cause: "seller",
				statusAtCancel: "pending",
				sellerRefundsUsed: SELLER_CANCEL_REFUNDS_PER_PERIOD,
			}),
		).toEqual({ refund: false, reason: "allowance_used" });
		expect(sellerRefundsLeft(0)).toBe(SELLER_CANCEL_REFUNDS_PER_PERIOD);
		expect(sellerRefundsLeft(SELLER_CANCEL_REFUNDS_PER_PERIOD + 3)).toBe(0);
	});
});

describe("topUpBlock — credits top up a live subscription, never replace one", () => {
	test("active, comped and the fail-safe pass the subscription rule (T2 then refuses the last two as sponsored)", () => {
		expect(topUpBlock("active", false)).toBeNull();
		expect(topUpBlock("past_due", true)).toBeNull();
		expect(topUpBlock(null, false)).toBeNull();
	});

	test("trialing, past_due, on_hold and cancelled say why not", () => {
		for (const status of ["trialing", "past_due", "on_hold", "cancelled"] as const)
			expect(topUpBlock(status, false)).toBe(status);
	});
});

describe("the lock sentence speaks to what the reader can do (Credits T3 × T2)", () => {
	test("the owner gets every way back; a teammate who can only ask, the owner", () => {
		expect(
			creditLockAudience({ isMember: false, canBuyCredits: false, route: "topup" }),
		).toBe("owner");
		expect(
			creditLockAudience({ isMember: true, canBuyCredits: false, route: "topup" }),
		).toBe("member");
		expect(creditLockMessage("topup", "member")).toMatch(
			/^This store is out of credits.*Ask the store owner to add credits/,
		);
	});

	test("a teammate who may buy packs tops up — but billing ways back stay the owner's", () => {
		expect(
			creditLockAudience({ isMember: true, canBuyCredits: true, route: "topup" }),
		).toBe("member_topup");
		expect(creditLockMessage("topup", "member_topup")).toMatch(
			/^This store is out of credits.*Top up in Settings → Billing to carry on/,
		);
		for (const route of ["pick_plan", "pay_invoice", "resume", "subscribe"] as const)
			expect(
				creditLockAudience({ isMember: true, canBuyCredits: true, route }),
			).toBe("member");
	});

	test("every version says what's paused and what still works", () => {
		for (const audience of ["owner", "member_topup", "member"] as const) {
			const m = creditLockMessage("topup", audience);
			expect(m).toMatch(/accepting and updating orders and editing products are paused/);
			expect(m).toMatch(/New orders keep coming in, and you can still view, cancel and refund them\./);
		}
	});
});

describe("lowCreditLine — running low is the last 20% of the month's credits", () => {
	test("one line per grant, never a flat number", () => {
		expect(lowCreditLine(100)).toBe(20); // Starter
		expect(lowCreditLine(200)).toBe(40); // Pro, and the trial's 200
		expect(lowCreditLine(300)).toBe(60); // Founding Pro
		expect(lowCreditLine(500)).toBe(100);
		expect(lowCreditLine(7)).toBe(2); // a small custom grant rounds up
	});
	test("no grant this month, nothing to run low on", () => {
		expect(lowCreditLine(0)).toBe(0);
		expect(lowCreditLine(-5)).toBe(0);
	});
});

describe("dueCreditNotice — once per threshold, bursts collapse", () => {
	const base = {
		sent: [] as string[],
		refreshedWhileLocked: false,
		customGrant: false,
		lowLine: lowCreditLine(200),
	};
	test("45 → -3 in one burst is ONE lock notice, not low then locked", () => {
		expect(dueCreditNotice({ ...base, total: -3 })).toBe("locked");
	});
	test("low fires once, at the line; a custom allowance is never nudged", () => {
		expect(dueCreditNotice({ ...base, total: 41 })).toBeNull();
		expect(dueCreditNotice({ ...base, total: 40 })).toBe("low");
		expect(dueCreditNotice({ ...base, total: 9, sent: ["low"] })).toBeNull();
		expect(dueCreditNotice({ ...base, total: 5, customGrant: true })).toBeNull();
	});
	test("a store with no grant this month is never nudged — only a lock is news", () => {
		expect(dueCreditNotice({ ...base, lowLine: 0, total: 5 })).toBeNull();
		expect(dueCreditNotice({ ...base, lowLine: 0, total: 0 })).toBe("locked");
	});
	test("a refresh that leaves the store at or below zero says so once; back above zero unlocks", () => {
		const locked = { ...base, sent: ["locked"] };
		expect(dueCreditNotice({ ...locked, total: 0, refreshedWhileLocked: true })).toBe("still_locked");
		expect(
			dueCreditNotice({ ...locked, total: -4, refreshedWhileLocked: true, sent: ["locked", "still_locked"] }),
		).toBeNull();
		expect(dueCreditNotice({ ...locked, total: 1 })).toBe("unlocked");
	});
});
