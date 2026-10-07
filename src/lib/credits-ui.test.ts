// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
	bulkCreditSkipNote,
	CREDIT_RULES_LINE,
	cancelCreditLine,
	creditActivityLabel,
	creditRefreshLabel,
	creditStateLine,
	creditTone,
	downgradeCreditLine,
	gatedRowLine,
	includedCreditsLabel,
	lockCta,
	orderGatedLine,
	ordersBalanceLabel,
	ordersWaitingLabel,
	planPickCreditLine,
} from "./credits-ui";
import { formatShortDate } from "./format";

describe("the balance speaks in orders", () => {
	test("left, owed, and the singular", () => {
		expect(ordersBalanceLabel(42)).toBe("42 orders left");
		expect(ordersBalanceLabel(1)).toBe("1 order left");
		expect(ordersBalanceLabel(0)).toBe("0 orders left");
		expect(ordersBalanceLabel(-1)).toBe("1 order owed");
		expect(ordersBalanceLabel(-15)).toBe("15 orders owed");
	});

	test("amber in the last 20% of the month's credits — the banner's and the email's line — red at zero", () => {
		expect(creditTone(100, 200)).toBe("ok");
		expect(creditTone(40, 200)).toBe("low"); // 20% of 200
		expect(creditTone(41, 200)).toBe("ok");
		expect(creditTone(60, 300)).toBe("low"); // Founding Pro
		expect(creditTone(61, 300)).toBe("ok");
		// One rule, no flat floor: a small grant runs low at its own 20%.
		expect(creditTone(10, 20)).toBe("ok");
		expect(creditTone(4, 20)).toBe("low");
		expect(creditTone(1, 200)).toBe("low");
		expect(creditTone(0, 200)).toBe("out");
		expect(creditTone(-3, 200)).toBe("out");
	});

	test("the waiting count caps at 99+ and says nothing at zero", () => {
		expect(ordersWaitingLabel(0)).toBeNull();
		expect(ordersWaitingLabel(1)).toBe("1 order waiting on credits");
		expect(ordersWaitingLabel(3)).toBe("3 orders waiting on credits");
		expect(ordersWaitingLabel(99)).toBe("99+ orders waiting on credits");
	});

	test("every unlock route gets the one button that puts credits back", () => {
		expect(lockCta("topup")).toEqual({
			label: "Top up credits",
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

describe("the monthly reset reads as a reset, never as more on top", () => {
	const NOV_1 = Date.parse("2026-11-01T00:00:00+08:00");
	// The viewer's locale formats the date ("1 Nov 2026" in Malaysia).
	const d = formatShortDate(NOV_1);
	const at = (plan: number, nextGrant: number | null = 300) =>
		creditRefreshLabel({
			regime: "monthly",
			plan,
			nextGrant,
			refreshesAt: NOV_1,
		});

	test("back to the allowance — not '300 more'", () => {
		expect(at(10)).toBe(`Back to 300 on ${d}`);
		expect(at(0)).toBe(`Back to 300 on ${d}`);
		expect(at(10)).not.toMatch(/more/);
	});

	test("a debt comes off the refresh, and says so", () => {
		expect(at(-15)).toBe(`285 on ${d} — the 15 owed come off`);
		expect(at(-1)).toBe(`299 on ${d} — the 1 owed comes off`);
		expect(at(-300)).toBe(`0 on ${d} — the 300 owed use it all up`);
		expect(at(-320)).toBe(`Still 20 owed after ${d}`);
	});

	test("no monthly refresh coming — a trial, or no grant this month", () => {
		expect(
			creditRefreshLabel({
				regime: "trial",
				plan: 120,
				nextGrant: null,
				refreshesAt: null,
			}),
		).toBeNull();
		expect(
			creditRefreshLabel({
				regime: "none",
				plan: 0,
				nextGrant: null,
				refreshesAt: NOV_1,
			}),
		).toBeNull();
	});
});

describe("the meter's state line", () => {
	const base = {
		ordersWaiting: 0,
		total: 120,
		purchased: 0,
		regime: "monthly" as const,
		status: "active" as const,
		exempt: null,
		customGrant: false,
		nextGrant: 200,
	};

	test("a running monthly store needs no line", () => {
		expect(creditStateLine(base)).toBeNull();
	});

	test("an admin's own store is never asked to pay — whatever its status says", () => {
		for (const status of ["trialing", "past_due", "active"] as const) {
			const line = creditStateLine({ ...base, status, exempt: "admin_store" });
			expect(line).toMatch(/^Kedaipal admin stores aren't billed/);
			expect(line).not.toMatch(/Pay your invoice|Pick a plan/);
		}
	});

	test("a sponsored store is told it never locks", () => {
		expect(
			creditStateLine({ ...base, status: "past_due", exempt: "sponsored" }),
		).toMatch(/^Sponsored stores are never locked/);
	});

	test("bought credits never stand in for a plan — they're kept for when it's active", () => {
		expect(creditStateLine({ ...base, status: "past_due" })).toBe(
			"Pay your invoice and this month's credits land straight away.",
		);
		expect(
			creditStateLine({ ...base, status: "past_due", purchased: 150 }),
		).toBe(
			"Pay your invoice and this month's credits land straight away. Your 150 bought credits are kept, and work again once your plan is active.",
		);
		expect(
			creditStateLine({ ...base, status: "on_hold", purchased: 1 }),
		).toMatch(/Your 1 bought credit is kept, and works again/);
		expect(creditStateLine({ ...base, status: "cancelled" })).toMatch(
			/^Your plan has ended/,
		);
	});

	test("waiting orders outrank everything, and a debt says where it goes", () => {
		expect(
			creditStateLine({ ...base, ordersWaiting: 2, total: 0, exempt: null }),
		).toBe("2 orders are waiting on credits until you add credits.");
		expect(creditStateLine({ ...base, ordersWaiting: 3, total: -15 })).toMatch(
			/The 15 orders owed come off your next pack or your next monthly credits, oldest order first\./,
		);
		// It names the ORDERS, never the store: products and settings are paid
		// for by the subscription and are never gated (Credits T3.1).
		expect(
			creditStateLine({ ...base, ordersWaiting: 2, total: -2 }),
		).not.toMatch(/editing products/);
	});

	test("a trial and a custom allowance say what they are", () => {
		expect(
			creditStateLine({ ...base, regime: "trial", status: "trialing" }),
		).toMatch(/^Your free trial includes 200 orders/);
		expect(
			creditStateLine({ ...base, customGrant: true, nextGrant: 1000 }),
		).toBe("Your store has a custom allowance of 1000 orders a month.");
	});

	test("the rules name the order of use", () => {
		expect(CREDIT_RULES_LINE).toMatch(
			/Monthly credits are used first and reset on the 1st.*Bought credits are used next and last 12 months/,
		);
	});
});

describe("the per-order gate's copy names the ORDER, never the store (T3.1)", () => {
	test("a gated row says its own position, and leads to the fix", () => {
		// A seller buying one credit has to know whether it will be THIS order.
		expect(gatedRowLine(1)).toBe("Waiting on 1 credit — top up to open it");
		expect(gatedRowLine(3)).toBe("Waiting on 3 credits — top up to open it");
		// Never plural at one, never a store-wide sentence.
		expect(gatedRowLine(1)).not.toMatch(/credits/);
		for (const n of [1, 2, 9])
			expect(gatedRowLine(n)).not.toMatch(/store|products|paused/i);
	});

	test("the short form is the same answer, for a disabled control", () => {
		expect(orderGatedLine(1)).toBe("Waiting on 1 credit");
		expect(orderGatedLine(4)).toBe("Waiting on 4 credits");
		// 0 can't happen on a gated row, but a floor beats "Waiting on 0".
		expect(orderGatedLine(0)).toBe("Waiting on 1 credit");
	});

	test("the bulk bar says what WILL be skipped, and that cancel still works", () => {
		// Said before the tap. The batch skips rather than refusing, so the bar
		// stays enabled — a note, not a disabled control.
		expect(bulkCreditSkipNote(1)).toBe(
			"1 of these is waiting on credits and will be skipped. Cancelling works on all of them.",
		);
		expect(bulkCreditSkipNote(4)).toMatch(
			/^4 of these are waiting on credits and will be skipped\./,
		);
	});
});
