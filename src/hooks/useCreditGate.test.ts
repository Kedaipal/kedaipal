import { describe, expect, test } from "vitest";
import { creditGateView } from "./useCreditGate";

/**
 * `creditGateView` is the CLIENT's copy of the gate, and its whole job is to
 * agree with the server about which rows are closed. It must never grey out a
 * control the server would allow, nor offer one the server would refuse.
 */
const WHO = { isMember: false, isAdmin: false, canBuyCredits: true };

function retailer(over: Record<string, unknown> = {}) {
	return {
		creditGate: {
			exempt: false,
			fundedThrough: 5,
			creditsOwed: 2,
			ordersWaiting: 2,
			unlockRoute: "topup" as const,
			...over,
		},
	};
}

describe("creditGateView.gatesOrder", () => {
	test("an order past the watermark is gated; one at or below it is not", () => {
		const gate = creditGateView(retailer(), WHO);
		expect(gate.gatesOrder({ creditSeq: 6 })).toBe(true);
		expect(gate.gatesOrder({ creditSeq: 5 })).toBe(false);
		// No position at all — grandfathered, always workable (fails open).
		expect(gate.gatesOrder({})).toBe(false);
		expect(gate.gatesOrder(null)).toBe(false);
	});

	test("the server's `creditGated` flag OUTRANKS the comparison", () => {
		// Since `orders.neverFunded`, a row can be gated with its creditSeq at
		// or BELOW the watermark: a cancelled gated order, whose credit was
		// refunded and whose position the watermark then walked past. Comparing
		// alone would have the client call that row workable while every server
		// read redacts it.
		const gate = creditGateView(retailer(), WHO);
		expect(gate.gatesOrder({ creditSeq: 4, creditGated: true })).toBe(true);
		expect(gate.creditsToUnlock({ creditSeq: 4, creditGated: true })).toBe(1);
	});

	test("an EXEMPT store gates nothing, flag included", () => {
		// Admin-owned, comped and unmetered stores are never gated, and an
		// admin acting as a store has to be able to work the order they were
		// asked about.
		for (const source of [
			retailer({ exempt: true }),
			{ ...retailer(), actingAsAdmin: true },
		]) {
			const gate = creditGateView(source, WHO);
			expect(gate.gatesOrder({ creditSeq: 99, creditGated: true })).toBe(false);
			expect(gate.ordersWaiting).toBe(0);
		}
		const asAdmin = creditGateView(retailer(), { ...WHO, isAdmin: true });
		expect(asAdmin.gatesOrder({ creditSeq: 99, creditGated: true })).toBe(
			false,
		);
	});

	test("a missing payload gates nothing — nothing may flash closed on first paint", () => {
		for (const source of [undefined, null, {}]) {
			const gate = creditGateView(source, WHO);
			expect(gate.gatesOrder({ creditSeq: 99 })).toBe(false);
			expect(gate.anyWaiting).toBe(false);
		}
	});

	test("creditsToUnlock counts the distance, and never goes below 1 when gated", () => {
		const gate = creditGateView(retailer(), WHO);
		expect(gate.creditsToUnlock({ creditSeq: 6 })).toBe(1);
		expect(gate.creditsToUnlock({ creditSeq: 8 })).toBe(3);
		// Not gated ⇒ nothing to unlock.
		expect(gate.creditsToUnlock({ creditSeq: 5 })).toBe(0);
		expect(gate.creditsToUnlock({})).toBe(0);
	});
});
