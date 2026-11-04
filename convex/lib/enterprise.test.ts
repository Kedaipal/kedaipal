import { describe, expect, it } from "vitest";
import {
	enterpriseTermChangeBlocker, enterpriseContractCaps } from "./enterprise";
import { isUnlimited, PLAN_CAPS } from "./plans";

describe("enterpriseContractCaps — the tier's defaults, with this deal's overrides", () => {
	it("says nothing, gets the tier", () => {
		// A contract that doesn't mention seats doesn't quietly take Enterprise's
		// unlimited ones away, and one that doesn't mention broadcasts gets the
		// tier's quota — the contract OVERRIDES the table, it never replaces it.
		const caps = enterpriseContractCaps({});
		expect(caps).toEqual(PLAN_CAPS.enterprise);
		expect(isUnlimited(caps.userCap)).toBe(true);
	});

	it("adds the owner back exactly once", () => {
		// The admin types teammates (what the seller's team page counts);
		// `userCap` is total people. Off by one here is a seat the store either
		// can't fill or shouldn't have.
		expect(enterpriseContractCaps({ teammates: 0 }).userCap).toBe(1);
		expect(enterpriseContractCaps({ teammates: 12 }).userCap).toBe(13);
	});

	it("takes a broadcast quota of zero as an answer, not as absent", () => {
		// `?? ` not `|| ` — a deal that includes no broadcasts is a real term.
		expect(enterpriseContractCaps({ broadcastQuota: 0 }).broadcastQuota).toBe(
			0,
		);
	});

	it("never carries a per-deal order cap — credits are the meter", () => {
		// An Enterprise store's allowance is its contract's included credits,
		// metered by the ledger. A second copy of that number on the row is what
		// T6 refused to create.
		expect(enterpriseContractCaps({ teammates: 3 }).orderCap).toBe(
			PLAN_CAPS.enterprise.orderCap,
		);
	});
});

describe("enterpriseTermChangeBlocker names the bill it's blocking on (PR #326 review FYI)", () => {
	it("calls an Off-Season Hold bill a hold bill, not the plan it carries", () => {
		// Reachable: a held store whose hold bill went overdue is `past_due`, not
		// `on_hold`, so `setContract`'s up-front hold refusal passes it to here —
		// and the hold bill carries the sub's plan, which read as "it bills Pro".
		const msg = enterpriseTermChangeBlocker({
			pending: {
				invoiceNumber: "INV-202611-HOLD",
				plan: "pro",
				billingCycle: "monthly",
				kind: "hold",
			},
			billingCycle: "monthly",
		});
		expect(msg).toBe(
			"Settle or void INV-202611-HOLD first — it's an Off-Season Hold bill, not the contract.",
		);
		expect(msg).not.toMatch(/bills Pro/);
	});

	it("a plan bill at another tier still names the tier", () => {
		expect(
			enterpriseTermChangeBlocker({
				pending: {
					invoiceNumber: "INV-1",
					plan: "pro",
					billingCycle: "monthly",
					kind: "plan",
				},
				billingCycle: "monthly",
			}),
		).toMatch(/it bills Pro, not the contract/);
	});
});
