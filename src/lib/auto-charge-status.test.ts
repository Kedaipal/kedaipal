import { describe, expect, it } from "vitest";
import type { AdminAutoChargeState } from "../../convex/lib/hitpayBilling";
import { describeAutoCharge, IN_FLIGHT_GRACE_MS } from "./auto-charge-status";

const NOW = Date.UTC(2026, 8, 30, 3, 30);
const HOUR = 60 * 60 * 1000;

const state = (
	over: Partial<AdminAutoChargeState> = {},
): AdminAutoChargeState => ({
	method: "card",
	failedAttempts: 0,
	...over,
});

const stranded = {
	invoiceNumber: "INV-OLD",
	amountSen: 14900,
	currency: "MYR",
	paymentId: "reconciled:rb_1:1",
	at: NOW - HOUR,
};

describe("describeAutoCharge — one reading for both admin lists", () => {
	it("healthy: the plain Auto-renew pill and nothing to say", () => {
		expect(describeAutoCharge(state(), NOW)).toEqual({
			tone: "healthy",
			pill: "Auto-renew",
			detail: null,
		});
	});

	it("stopped leads with the money and the voided bill, then both ways out, then the HitPay ref", () => {
		const d = describeAutoCharge(state({ stranded }), NOW);
		expect(d.tone).toBe("stopped");
		expect(d.pill).toBe("Auto-charge stopped");
		expect(d.lead).toMatch(/^HitPay took RM.149\.00 for voided INV-OLD/);
		expect(d.detail).toContain("refund it in HitPay");
		expect(d.detail).toContain("marking their open bill paid");
		expect(d.detail).toContain("resumes once a bill is settled");
		// The id the admin pastes into HitPay — its own field, so it can be
		// shown whole and copied rather than broken across a sentence.
		expect(d.reference).toBe("reconciled:rb_1:1");
	});

	it("only stopped carries a lead or a reference", () => {
		for (const s of [
			state(),
			state({ failedAttempts: 1 }),
			state({ unresolvedAttemptAt: NOW - 2 * HOUR }),
		]) {
			const d = describeAutoCharge(s, NOW);
			expect(d.lead).toBeUndefined();
			expect(d.reference).toBeUndefined();
		}
	});

	it("stopped outranks every other state — a human has to act", () => {
		const d = describeAutoCharge(
			state({
				stranded,
				failedAttempts: 2,
				unresolvedAttemptAt: NOW - 2 * HOUR,
			}),
			NOW,
		);
		expect(d.tone).toBe("stopped");
	});

	it("a stamp inside the in-flight grace is just a charge running — no alarm", () => {
		const d = describeAutoCharge(
			state({ unresolvedAttemptAt: NOW - IN_FLIGHT_GRACE_MS + 1000 }),
			NOW,
		);
		expect(d.tone).toBe("healthy");
	});

	it("past the grace it is UNCONFIRMED, and says the retry asks HitPay before charging", () => {
		const d = describeAutoCharge(
			state({
				unresolvedAttemptAt: NOW - IN_FLIGHT_GRACE_MS - 1000,
				nextRetryAt: NOW + 20 * HOUR,
				lastChargeError: "network failure — outcome unknown",
			}),
			NOW,
		);
		expect(d.tone).toBe("unconfirmed");
		expect(d.pill).toBe("Charge unconfirmed");
		expect(d.detail).toContain("never got an answer from HitPay");
		expect(d.detail).toContain("(network failure — outcome unknown)");
		expect(d.detail).toContain("asks HitPay first, so it can't charge twice");
	});

	it("an attempt that died with no retry scheduled points at the daily run", () => {
		const d = describeAutoCharge(
			state({ unresolvedAttemptAt: NOW - 30 * HOUR }),
			NOW,
		);
		expect(d.detail).toContain("The next daily run asks HitPay first");
	});

	it("unconfirmed outranks a decline count — it is the newer fact", () => {
		const d = describeAutoCharge(
			state({ failedAttempts: 1, unresolvedAttemptAt: NOW - 2 * HOUR }),
			NOW,
		);
		expect(d.tone).toBe("unconfirmed");
	});

	it("failed keeps the dunning line: last error, then the next retry or the manual rail", () => {
		const retrying = describeAutoCharge(
			state({
				failedAttempts: 1,
				lastChargeError: "charge status: failed",
				nextRetryAt: NOW + 48 * HOUR,
			}),
			NOW,
		);
		expect(retrying.pill).toBe("Auto-charge failed ×1");
		expect(retrying.detail).toMatch(
			/^Last error: charge status: failed\. Next retry /,
		);

		const exhausted = describeAutoCharge(state({ failedAttempts: 3 }), NOW);
		expect(exhausted.detail).toBe(
			"Retries exhausted — the seller is on the manual rail.",
		);
	});
});
