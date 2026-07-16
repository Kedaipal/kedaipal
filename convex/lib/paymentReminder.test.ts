/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	isPaymentReminderDue,
	PAYMENT_REMINDER_AFTER_MS,
	type PaymentReminderOrderFields,
} from "./paymentReminder";

const NOW = 1_800_000_000_000;

function order(
	over: Partial<PaymentReminderOrderFields> = {},
): PaymentReminderOrderFields {
	return {
		status: "confirmed",
		createdAt: NOW - PAYMENT_REMINDER_AFTER_MS, // exactly day 11 — due
		customer: { waPhone: "60123456789" },
		...over,
	};
}

describe("isPaymentReminderDue", () => {
	test("due: confirmed, unpaid, unreminded, reachable, 11+ days old", () => {
		expect(isPaymentReminderDue(order(), NOW)).toBe(true);
		expect(isPaymentReminderDue(order({ status: "packed" }), NOW)).toBe(true);
		expect(isPaymentReminderDue(order({ status: "shipped" }), NOW)).toBe(true);
		expect(
			isPaymentReminderDue(order({ paymentStatus: "unpaid" }), NOW),
		).toBe(true);
	});

	test("delivered-but-unpaid is due — F&B credit/pay-later delivery", () => {
		// A seller who delivers stock on credit and settles at week's end: the
		// order is `delivered` yet payment was never claimed/received. Goods
		// arrived does NOT mean goods paid for (PR feedback, 86ey570am).
		expect(isPaymentReminderDue(order({ status: "delivered" }), NOW)).toBe(
			true,
		);
	});

	test("not due before day 11", () => {
		expect(
			isPaymentReminderDue(
				order({ createdAt: NOW - PAYMENT_REMINDER_AFTER_MS + 1 }),
				NOW,
			),
		).toBe(false);
	});

	test("pending (not yet confirmed) and cancelled orders are never nudged", () => {
		expect(isPaymentReminderDue(order({ status: "pending" }), NOW)).toBe(false);
		expect(isPaymentReminderDue(order({ status: "cancelled" }), NOW)).toBe(
			false,
		);
	});

	test("a pending delivery charge holds the nudge — the total isn't final", () => {
		expect(
			isPaymentReminderDue(order({ deliveryFeePending: true }), NOW),
		).toBe(false);
		// Resolved (flag cleared by setDeliveryFee) → back to due.
		expect(
			isPaymentReminderDue(order({ deliveryFeePending: false }), NOW),
		).toBe(true);
	});

	test("claimed / received payment is never nudged", () => {
		expect(
			isPaymentReminderDue(order({ paymentStatus: "claimed" }), NOW),
		).toBe(false);
		expect(
			isPaymentReminderDue(order({ paymentStatus: "received" }), NOW),
		).toBe(false);
	});

	test("closed mockup gate defers the nudge (payment isn't owed yet)", () => {
		expect(
			isPaymentReminderDue(order({ mockupStatus: "submitted" }), NOW),
		).toBe(false);
		// Gate open (approved / waived) → due again.
		expect(
			isPaymentReminderDue(order({ mockupStatus: "approved" }), NOW),
		).toBe(true);
		expect(
			isPaymentReminderDue(
				order({ mockupStatus: "pending", mockupWaivedAt: NOW }),
				NOW,
			),
		).toBe(true);
	});

	test("one nudge ever; unreachable buyers skipped", () => {
		expect(
			isPaymentReminderDue(order({ paymentReminderSentAt: NOW - 1 }), NOW),
		).toBe(false);
		expect(isPaymentReminderDue(order({ customer: {} }), NOW)).toBe(false);
	});
});
