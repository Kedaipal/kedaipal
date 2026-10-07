// The pure rules behind replacing a pending invoice (z8r3fdpm2p). The admin
// form reads these for its disabled-with-reason line and the server throws
// them, so a change here moves both at once.
import { describe, expect, it } from "vitest";
import {
	invoiceReplaceRefusal,
	replacementChargeNote,
	replacementKeepsAutoCharge,
} from "./invoiceReplace";

const refusal = (over: Partial<Parameters<typeof invoiceReplaceRefusal>[0]> = {}) =>
	invoiceReplaceRefusal({
		invoiceNumber: "INV-202610-AAAA",
		kind: "plan",
		chargeInFlight: false,
		...over,
	});

const keeps = (
	over: Partial<Parameters<typeof replacementKeepsAutoCharge>[0]> = {},
) =>
	replacementKeepsAutoCharge({
		replacedOrigin: "auto_renewal",
		replacedTotal: 14_900,
		newTotal: 7_900,
		autoChargeIdle: true,
		...over,
	});

describe("invoiceReplaceRefusal", () => {
	it("allows the ordinary case", () => {
		expect(refusal()).toBeNull();
	});

	it("refuses while a card charge hasn't reported back", () => {
		// `chargeDueRenewal` stamps BEFORE it calls HitPay and clears only on a
		// recorded outcome, so a standing stamp means a charge may have landed
		// and died before saying so. Voiding that row is a supported path — the
		// reconcile audits a stranded charge and switches auto-renew off — but
		// it is a safety net, not somewhere to walk on purpose.
		expect(refusal({ chargeInFlight: true })).toMatch(
			/hasn't reported back yet/,
		);
		expect(refusal({ chargeInFlight: true })).toContain("INV-202610-AAAA");
	});

	it("refuses a hold bill — it has no tier to change", () => {
		expect(refusal({ kind: "hold" })).toMatch(/Off-Season Hold/);
	});
});

describe("replacementKeepsAutoCharge", () => {
	it("carries the charge down to a cheaper correction", () => {
		// The seller's mandate is the amount already queued against their card;
		// a cheaper bill stays inside it, and letting it charge spares them a
		// bill nothing would pay and a lock on day 14.
		expect(keeps({ replacedTotal: 14_900, newTotal: 7_900 })).toBe(true);
	});

	it("carries it on an equal-priced correction", () => {
		expect(keeps({ replacedTotal: 14_900, newTotal: 14_900 })).toBe(true);
	});

	it("NEVER charges a card more than the bill it replaces", () => {
		// Kedaipal does not charge itself up on an admin's say-so, however the
		// change was agreed (Zaki, 7 Oct 2026). The bill still carries its
		// Pay-now link.
		expect(keeps({ replacedTotal: 14_900, newTotal: 88_800 })).toBe(false);
	});

	it("has nothing to carry when the bill was never auto-charged", () => {
		// Only `internalIssueRenewalInvoice` ever arms a charge, so every other
		// origin answers no because there was nothing to inherit.
		for (const origin of ["admin", "self_serve", "first_invoice"] as const)
			expect(keeps({ replacedOrigin: origin })).toBe(false);
	});

	it("never arms a charge on a store whose auto-charge isn't idle", () => {
		expect(keeps({ autoChargeIdle: false })).toBe(false);
	});
});

describe("replacementChargeNote", () => {
	const note = (
		over: Partial<Parameters<typeof replacementChargeNote>[0]> = {},
	) =>
		replacementChargeNote({
			replacedOrigin: "auto_renewal",
			replacedTotal: 14_900,
			newTotal: 7_900,
			autoChargeIdle: true,
			newTotalLabel: "RM 79.00",
			...over,
		});

	it("promises the charge only when it will actually happen", () => {
		expect(note()).toContain("RM 79.00");
		expect(note()).toMatch(/will be charged/);
	});

	it("says plainly that an increase will NOT be charged", () => {
		expect(note({ newTotal: 88_800 })).toMatch(/won't be charged/);
		expect(note({ newTotal: 88_800 })).toMatch(/Pay-now link/);
	});

	it("says nothing about a card for a bill no card was ever charging", () => {
		expect(note({ replacedOrigin: "admin" })).toBeNull();
	});
});
