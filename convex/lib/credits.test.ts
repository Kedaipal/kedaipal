// Kedaipal Credits (86eye2ccu) — the pure rules: grant precedence, the regime
// per subscription status, the refresh formula, bucket order, the refund
// decision, top-up eligibility, and the pack guard rule.
import { describe, expect, test } from "vitest";
import {
	cancelRefundDecision,
	creditLockAudience,
	creditLockExempt,
	creditLockExemption,
	creditLockMessage,
	creditRegime,
	type CreditRegimeInputs,
	creditsToUnlockOrder,
	debitBucket,
	debitIsFunded,
	fundingAdvance,
	dueCreditNotice,
	lowCreditLine,
	monthlyCreditGrant,
	orderCreditFunded,
	ordersAwaitingCredit,
	refreshedPlanBalance,
	sellerRefundsLeft,
	storeIsMetered,
	topUpBlock,
} from "./credits";
import {
	BILLING_CURRENCIES,
	CREDIT_PACKS,
	creditPackById,
	FOUNDING_PRO_CREDIT_GRANT,
	LISTED_PLANS,
	PLAN_CREDIT_GRANT,
	PLAN_MONTHLY_PRICES,
	SELLER_CANCEL_REFUNDS_PER_PERIOD,
	storeHasFullAccess,
	TRIAL_CREDIT_GRANT,
} from "./plans";

const NOW = Date.UTC(2026, 9, 10);

function inputs(over: Partial<CreditRegimeInputs> = {}): CreditRegimeInputs {
	return {
		status: "active",
		plan: "pro",
		foundingEligible: false,
		override: undefined,
		annualGrant: undefined,
		now: NOW,
		...over,
	};
}

describe("the locked numbers", () => {
	test("grants: Starter 100 / Pro 200, Founding Pro 300, trial 200 — Enterprise's is its contract's", () => {
		expect(PLAN_CREDIT_GRANT).toEqual({ starter: 100, pro: 200 });
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
				...LISTED_PLANS.map(
					(plan) => PLAN_MONTHLY_PRICES[currency][plan] / PLAN_CREDIT_GRANT[plan],
				),
			);
			expect(cheapestPackCredit).toBeGreaterThanOrEqual(dearestTierOrder);
		}
	});
});

describe("monthlyCreditGrant — precedence", () => {
	test("the plan's grant by default", () => {
		for (const plan of LISTED_PLANS)
			expect(monthlyCreditGrant(inputs({ plan }))).toBe(PLAN_CREDIT_GRANT[plan]);
	});

	test("Enterprise is granted its contract's included credits — the override the contract writes (T6)", () => {
		expect(
			monthlyCreditGrant(inputs({ plan: "enterprise", override: 1500 })),
		).toBe(1500);
		// Should the override ever be missing, a contract customer keeps Pro's
		// allowance rather than dropping to zero and locking.
		expect(monthlyCreditGrant(inputs({ plan: "enterprise" }))).toBe(200);
	});

	test("founding Pro gets 300; Starter is unaffected", () => {
		expect(monthlyCreditGrant(inputs({ foundingEligible: true }))).toBe(300);
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

	test("the missing-row fail-safe is metered monthly despite having no status", () => {
		expect(creditRegime(inputs({ status: null }))).toEqual({
			kind: "monthly",
			grant: 200,
		});
	});
});

describe("unmetered stores (z8r3fdp4er + z8r3fdrph7)", () => {
	test("an admin's own store AND a sponsored one are unmetered — a comp means admin limits", () => {
		expect(storeIsMetered({ ownerIsAdmin: true, comped: false })).toBe(false);
		expect(storeIsMetered({ ownerIsAdmin: false, comped: true })).toBe(false);
		expect(storeIsMetered({ ownerIsAdmin: true, comped: true })).toBe(false);
		expect(storeIsMetered({ ownerIsAdmin: false, comped: false })).toBe(true);
	});

	test("unmetered IS the entitlement layer's full access — one predicate, no drift", () => {
		// z8r3fdp4er unmetered admin stores but left comped ones metered, so a
		// sponsored seller read "200 of 200" while `fullAccessCaps()` said
		// unlimited. Pinned as an equality so the two can never part again.
		for (const ownerIsAdmin of [true, false])
			for (const comped of [true, false])
				expect(storeIsMetered({ ownerIsAdmin, comped })).toBe(
					!storeHasFullAccess({ ownerIsAdmin, comped }),
				);
	});

	test("the missing-row fail-safe stays METERED — never locked, but it keeps a record", () => {
		// Deliberately NOT unmetered: a rowless store is a data fault, not a
		// granted sponsorship, so its volume still leaves a ledger behind.
		expect(storeIsMetered({ ownerIsAdmin: false, comped: false })).toBe(true);
		expect(creditLockExemption({ status: null })).toBe("sponsored");
		expect(creditLockExempt({ status: null })).toBe(true);
		expect(creditLockExemption({ status: "active" })).toBeNull();
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
	test("active and the fail-safe pass the subscription rule (T2 refuses the fail-safe as sponsored)", () => {
		expect(topUpBlock("active")).toBeNull();
		expect(topUpBlock(null)).toBeNull();
	});

	test("trialing, past_due, on_hold and cancelled say why not", () => {
		for (const status of ["trialing", "past_due", "on_hold", "cancelled"] as const)
			expect(topUpBlock(status)).toBe(status);
	});
});

describe("the gate sentence speaks to what the reader can do (Credits T3.1 × T2)", () => {
	test("the owner gets every way back; a teammate who can only ask, the owner", () => {
		expect(
			creditLockAudience({ isMember: false, canBuyCredits: false, route: "topup" }),
		).toBe("owner");
		expect(
			creditLockAudience({ isMember: true, canBuyCredits: false, route: "topup" }),
		).toBe("member");
		expect(creditLockMessage("topup", "member", 3)).toMatch(
			/^3 orders are waiting on credits.*Ask the store owner to add credits/,
		);
	});

	test("a teammate who may buy packs tops up — but billing ways back stay the owner's", () => {
		expect(
			creditLockAudience({ isMember: true, canBuyCredits: true, route: "topup" }),
		).toBe("member_topup");
		expect(creditLockMessage("topup", "member_topup", 2)).toMatch(
			/^2 orders are waiting on credits.*Top up in Settings → Billing to open them/,
		);
		for (const route of ["pick_plan", "pay_invoice", "resume", "subscribe"] as const)
			expect(
				creditLockAudience({ isMember: true, canBuyCredits: true, route }),
			).toBe("member");
	});

	test("every version names the ORDERS and says the rest of the store is fine", () => {
		// The store-wide sentence ("editing products are paused") was a promise
		// T3.1 makes false — the catalogue is never gated now, so a sentence
		// claiming otherwise would be the copy lying about the rule.
		for (const audience of ["owner", "member_topup", "member"] as const) {
			const m = creditLockMessage("topup", audience, 4);
			expect(m).toMatch(/4 orders are waiting on credits/);
			expect(m).toMatch(
				/Your other orders, your products and your settings all carry on as normal/,
			);
			expect(m).toMatch(/cancel a waiting order to release the buyer/);
			expect(m).not.toMatch(/editing products are paused/);
		}
	});

	test("one waiting order reads in the singular, on every route", () => {
		for (const route of [
			"topup",
			"pick_plan",
			"pay_invoice",
			"resume",
			"subscribe",
		] as const) {
			const m = creditLockMessage(route, "owner", 1);
			expect(m, route).toMatch(/^1 order is waiting on credits, so you can't open it yet/);
		}
	});
});

describe("the per-order gate's arithmetic (Credits T3.1)", () => {
	test("a debit that leaves the total AT zero paid for itself", () => {
		// The ticket said "unfunded iff the debit left the total at or below
		// zero", which gates the order that spent the store's last credit.
		expect(debitIsFunded(0)).toBe(true);
		expect(debitIsFunded(5)).toBe(true);
		expect(debitIsFunded(-1)).toBe(false);
	});

	test("no stamp means funded — the gate fails open", () => {
		// An order from before T3.1, or one whose debit faulted and was
		// deliberately kept. A bookkeeping fault must never hide a buyer's order.
		expect(orderCreditFunded(undefined, 0)).toBe(true);
		expect(creditsToUnlockOrder(undefined, 0)).toBe(0);
	});

	test("an order is funded at or below the watermark, and says its own position", () => {
		expect(orderCreditFunded(7, 7)).toBe(true);
		expect(orderCreditFunded(8, 7)).toBe(false);
		expect(creditsToUnlockOrder(8, 7)).toBe(1);
		expect(creditsToUnlockOrder(10, 7)).toBe(3);
		expect(creditsToUnlockOrder(7, 7)).toBe(0);
	});

	test("one credit in frees one waiting order — never more, never fewer", () => {
		// Zaki's worked example: 101 waiting, a 100-pack lands, 100 open.
		expect(fundingAdvance(101, 100)).toBe(100);
		// A pack bigger than the queue frees the queue and no more.
		expect(fundingAdvance(3, 100)).toBe(3);
		// Nothing waiting, nothing to free.
		expect(fundingAdvance(0, 100)).toBe(0);
		// Deliberately NOT "fill the balance to zero first": that would swallow
		// a seller's pack and unlock nothing when the debt came from an expired
		// lot or from before this gate shipped.
		expect(fundingAdvance(3, 1)).toBe(1);
	});

	test("the queue is the gap between the two counters", () => {
		expect(ordersAwaitingCredit(10, 7)).toBe(3);
		expect(ordersAwaitingCredit(7, 7)).toBe(0);
		// A watermark that somehow ran ahead reads as nothing waiting, never a
		// negative count.
		expect(ordersAwaitingCredit(5, 7)).toBe(0);
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
