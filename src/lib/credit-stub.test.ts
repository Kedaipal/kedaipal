import { describe, expect, it } from "vitest";
import type { CreditBalanceView } from "../../convex/credits";
import {
	type CreditStubInput,
	creditStub,
	STUB_DOTS,
	stubDate,
} from "./credit-stub";

/**
 * The Kedaipal-credits stub in the profile menu and the avatar row's line
 * (z8r3fdx34j, the 2A torn receipt). Orders, never money.
 */

const NOV_1 = Date.UTC(2026, 9, 31, 16); // 1 Nov 00:00 MYT
const bal = (o: Partial<CreditBalanceView> = {}): CreditBalanceView =>
	({
		plan: 54,
		purchased: 0,
		total: 54,
		periodKey: "2026-10",
		periodGrant: 200,
		regime: "monthly",
		nextGrant: 200,
		refreshesAt: NOV_1,
		nextExpiry: null,
		exhaustedAt: null,
		sellerRefundsLeft: 3,
		customGrant: false,
		ordersThisPeriod: 146,
		lockExempt: null,
		ordersWaiting: 0,
		...o,
	}) as CreditBalanceView;
const input = (o: Partial<CreditStubInput> = {}): CreditStubInput => ({
	balance: bal(),
	ordersWaiting: 0,
	route: "topup",
	canAct: true,
	perDay: 6,
	topUpRefusal: null,
	topUpSold: true,
	sponsored: false,
	...o,
});

describe("creditStub", () => {
	it("healthy: orders left, the reset on the leader line, one Top up, no dot", () => {
		const s = creditStub(input());
		expect(s).toMatchObject({
			tone: "ok",
			stamp: null,
			headline: "54 orders left",
			leader: { label: "Resets", value: "1 Nov · 200" },
			button: { label: "Top up", disabledReason: null },
			triggerLine: "54 orders left",
			dot: null,
		});
		// Dots are the MONTH's grant: 54 of 200 → 5 of 20.
		expect(s.filled).toBe(5);
	});

	it("low: amber stamp, the runway on the leader and the trigger, an amber dot", () => {
		const s = creditStub(input({ balance: bal({ plan: 38, total: 38 }) }));
		expect(s).toMatchObject({
			tone: "low",
			stamp: "Low",
			leader: { label: "About 6 days", value: "1 Nov" },
			triggerLine: "38 orders left · about 6 days",
			dot: "low",
		});
	});

	it("orders waiting: red, every dot torn off, the lock's own way back", () => {
		const s = creditStub(
			input({
				balance: bal({ plan: -3, total: -3 }),
				ordersWaiting: 3,
				route: "pay_invoice",
			}),
		);
		expect(s).toMatchObject({
			tone: "out",
			stamp: "Waiting",
			headline: "3 orders waiting",
			filled: 0,
			button: { label: "Pay invoice" },
			dot: "out",
		});
		// The next refresh pays the debt first: 200 − 3.
		expect(s.leader.value).toBe("1 Nov · 197");
	});

	it("a teammate who can't act on the lock is told whose call it is", () => {
		const s = creditStub(input({ ordersWaiting: 2, canAct: false }));
		expect(s.button?.disabledReason).toMatch(/store owner/);
	});

	it("trial: no reset to aim at, so the leader is the trial and the button picks a plan", () => {
		const s = creditStub(
			input({
				balance: bal({
					plan: 163,
					total: 163,
					regime: "trial",
					nextGrant: null,
					refreshesAt: null,
				}),
			}),
		);
		expect(s).toMatchObject({
			stamp: "Trial",
			leader: { label: "Trial", value: "200 orders" },
			button: { label: "Pick a plan" },
		});
	});

	it("unmetered still gets the stub — '∞ orders', on us, no button", () => {
		const sponsored = creditStub(input({ balance: null, sponsored: true }));
		expect(sponsored).toMatchObject({
			tone: "onus",
			stamp: "On us",
			headline: "∞ orders",
			filled: STUB_DOTS,
			leader: { label: "Plan", value: "Sponsored" },
			button: null,
			dot: null,
		});
		expect(creditStub(input({ balance: null })).leader.value).toBe("Unlimited");
	});

	it("a reader who can't buy sees the button greyed with T2's reason", () => {
		const s = creditStub(
			input({ topUpRefusal: "Ask the store owner for credits access." }),
		);
		expect(s.button?.disabledReason).toBe(
			"Ask the store owner for credits access.",
		);
	});

	it("where packs aren't sold there's no top-up button at all", () => {
		expect(creditStub(input({ topUpSold: false })).button).toBeNull();
	});

	it("never speaks money: no currency, no 'wallet', no percentage", () => {
		for (const s of [
			creditStub(input()),
			creditStub(input({ balance: bal({ plan: 38, total: 38 }) })),
			creditStub(input({ balance: null })),
		]) {
			const words = JSON.stringify(s);
			expect(words).not.toMatch(/RM|S\$|wallet|%/i);
		}
	});

	it("the date is the 1st in Malaysia time on any device", () => {
		expect(stubDate(NOV_1)).toBe("1 Nov");
	});
});
