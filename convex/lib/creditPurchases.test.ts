// Kedaipal Credits T2 (z8r3fdf8ht): the pure rules of a top-up — who may buy,
// what they're told when they can't, the checkout's lifetime, the purchase
// reference. The dashboard's disabled-with-reason line and the server's
// refusal both come from `topUpRefusalMessage`, so its copy is pinned here.
import { describe, expect, test } from "vitest";
import {
	CREDIT_PURCHASE_HITPAY_EXPIRY,
	CREDIT_PURCHASE_TTL_MS,
	creditPackLabel,
	generatePurchaseNumber,
	topUpRefusal,
	topUpRefusalMessage,
} from "./creditPurchases";

describe("the checkout's lifetime", () => {
	test("HitPay's expiry and the purchase's own timer are the same 24 hours", () => {
		const match = /^(\d+) mins$/.exec(CREDIT_PURCHASE_HITPAY_EXPIRY);
		expect(match).not.toBeNull();
		expect(Number(match?.[1]) * 60 * 1000).toBe(CREDIT_PURCHASE_TTL_MS);
		expect(CREDIT_PURCHASE_TTL_MS).toBe(24 * 60 * 60 * 1000);
	});
});

describe("topUpRefusal — who may buy", () => {
	const base = { comped: false, ownerIsAdmin: false };

	test("an active store, a comped store and the missing-row fail-safe can buy", () => {
		expect(topUpRefusal({ ...base, status: "active" })).toBeNull();
		expect(topUpRefusal({ ...base, status: "past_due", comped: true })).toBeNull();
		expect(topUpRefusal({ ...base, status: null })).toBeNull();
	});

	test("every other status refuses, by name", () => {
		for (const status of ["trialing", "past_due", "on_hold", "cancelled"] as const)
			expect(topUpRefusal({ ...base, status })).toBe(status);
	});

	test("a Kedaipal admin's own store outranks its status — it sits in trialing forever", () => {
		expect(topUpRefusal({ ...base, status: "trialing", ownerIsAdmin: true })).toBe(
			"admin_store",
		);
		expect(topUpRefusal({ ...base, status: "active", ownerIsAdmin: true })).toBe(
			"admin_store",
		);
	});
});

describe("topUpRefusalMessage — every refusal names the way out", () => {
	test("the owner is told what to do", () => {
		expect(topUpRefusalMessage("trialing", { audience: "owner" })).toMatch(
			/Pick a plan first/,
		);
		expect(
			topUpRefusalMessage("past_due", {
				audience: "owner",
				invoiceNumber: "INV-202610-AB12",
			}),
		).toBe(
			"Your invoice INV-202610-AB12 is overdue. Pay it first — this month's credits land the moment it's paid.",
		);
		expect(topUpRefusalMessage("past_due", { audience: "owner" })).toMatch(
			/You have an overdue invoice/,
		);
		expect(topUpRefusalMessage("on_hold", { audience: "owner" })).toMatch(
			/Resume it first/,
		);
		expect(topUpRefusalMessage("cancelled", { audience: "owner" })).toMatch(
			/Choose a plan first/,
		);
	});

	test("a teammate can't take the way out themselves — they're pointed at the owner", () => {
		for (const refusal of ["trialing", "past_due", "on_hold", "cancelled"] as const) {
			const message = topUpRefusalMessage(refusal, { audience: "member" });
			expect(message).toMatch(/Ask the store owner/);
			expect(message).not.toMatch(/\bYour\b/);
		}
	});

	test("never money-balance language — order counts only", () => {
		const all = (["trialing", "past_due", "on_hold", "cancelled", "admin_store"] as const)
			.flatMap((r) => [
				topUpRefusalMessage(r, { audience: "owner" }),
				topUpRefusalMessage(r, { audience: "member" }),
			])
			.join(" ");
		expect(all).not.toMatch(/wallet|commission|pay as you go|%|\bfee\b/i);
	});
});

describe("naming", () => {
	test("a pack is named by its credits", () => {
		expect(creditPackLabel(50)).toBe("50-credit pack");
		expect(creditPackLabel(200)).toBe("200-credit pack");
	});

	test("purchase numbers read CRD-YYYYMM-XXXX on the invoice number's clock", () => {
		const oct = Date.parse("2026-10-10T12:00:00+08:00");
		for (let i = 0; i < 50; i++)
			expect(generatePurchaseNumber(oct)).toMatch(/^CRD-202610-[A-Z0-9]{4}$/);
	});
});
