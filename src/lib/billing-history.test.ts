import { describe, expect, it } from "vitest";
import { mergeBillingHistory } from "./billing-history";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 1);

describe("mergeBillingHistory (Credits T2)", () => {
	it("one timeline, newest first, each row dated by what it shows", () => {
		const rows = mergeBillingHistory(
			[
				// Issued on day 0, paid on day 10 — dated by the payment.
				{ _id: "inv_paid", createdAt: T0, markedPaidAt: T0 + 10 * DAY },
				{ _id: "inv_void", createdAt: T0 - 5 * DAY, voidedAt: T0 - 4 * DAY },
			],
			[
				{ _id: "cp_new", createdAt: T0 + 20 * DAY, paidAt: T0 + 20 * DAY },
				{ _id: "cp_mid", createdAt: T0 + 3 * DAY, paidAt: T0 + 3 * DAY },
			],
		);
		expect(rows.map((r) => r.key)).toEqual([
			"cp_new",
			"inv_paid",
			"cp_mid",
			"inv_void",
		]);
		expect(rows[0].kind).toBe("credit_purchase");
		expect(rows[1]).toMatchObject({ kind: "invoice", at: T0 + 10 * DAY });
	});

	it("either list may be empty", () => {
		expect(mergeBillingHistory([], [])).toEqual([]);
		expect(
			mergeBillingHistory([], [{ _id: "cp", createdAt: T0, paidAt: T0 }]),
		).toHaveLength(1);
	});
});
