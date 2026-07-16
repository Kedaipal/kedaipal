/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
	isPaymentReminderDue,
	MANUAL_REMINDER_COOLDOWN_MS,
	manualReminderEligibility,
	PAYMENT_REMINDER_AFTER_MS,
	PAYMENT_REMINDER_LEAD_DAYS,
	type PaymentReminderOrderFields,
} from "./paymentReminder";

const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

	test("a recent MANUAL reminder suppresses the auto nudge (no back-to-back)", () => {
		// Seller manually reminded 1 day ago → within the 3-day lead window → the
		// cron skips so the buyer isn't double-messaged.
		expect(
			isPaymentReminderDue(order({ lastManualReminderAt: NOW - DAY_MS }), NOW),
		).toBe(false);
		// Manual reminder older than the lead window → the auto nudge fires again.
		expect(
			isPaymentReminderDue(
				order({
					lastManualReminderAt:
						NOW - (PAYMENT_REMINDER_LEAD_DAYS + 1) * DAY_MS,
				}),
				NOW,
			),
		).toBe(true);
	});
});

describe("manualReminderEligibility", () => {
	// Manual reminders have no age gate and no once-ever cap — the seller drives
	// them. `order()` defaults to a confirmed, unpaid, reachable order (eligible).
	test("eligible: confirmed/packed/shipped/delivered, unpaid, reachable", () => {
		for (const status of [
			"confirmed",
			"packed",
			"shipped",
			"delivered",
		] as const) {
			expect(manualReminderEligibility(order({ status }), NOW)).toEqual({
				ok: true,
			});
		}
	});

	test("eligible regardless of order age (no day-11 gate)", () => {
		// Freshly created — the auto nudge wouldn't be due, but the seller can
		// manually re-send (e.g. the buyer never got the first bot reply).
		expect(
			manualReminderEligibility(order({ createdAt: NOW - 1000 }), NOW),
		).toEqual({ ok: true });
	});

	test("blocked: cancelled / pending", () => {
		expect(manualReminderEligibility(order({ status: "cancelled" }), NOW)).toEqual(
			{ ok: false, reason: "cancelled" },
		);
		expect(manualReminderEligibility(order({ status: "pending" }), NOW)).toEqual({
			ok: false,
			reason: "pending",
		});
	});

	test("blocked: already paid / claimed", () => {
		expect(
			manualReminderEligibility(order({ paymentStatus: "received" }), NOW),
		).toEqual({ ok: false, reason: "paid" });
		expect(
			manualReminderEligibility(order({ paymentStatus: "claimed" }), NOW),
		).toEqual({ ok: false, reason: "claimed" });
	});

	test("blocked: mockup gate closed (payment not owed yet)", () => {
		expect(
			manualReminderEligibility(order({ mockupStatus: "submitted" }), NOW),
		).toEqual({ ok: false, reason: "mockup_gated" });
	});

	test("blocked: no buyer WhatsApp on file", () => {
		expect(manualReminderEligibility(order({ customer: {} }), NOW)).toEqual({
			ok: false,
			reason: "no_contact",
		});
	});

	test("blocked within the 6h cooldown, with retryAt; allowed after it elapses", () => {
		const justNow = manualReminderEligibility(
			order({ lastManualReminderAt: NOW - 60_000 }),
			NOW,
		);
		expect(justNow).toEqual({
			ok: false,
			reason: "cooldown",
			retryAt: NOW - 60_000 + MANUAL_REMINDER_COOLDOWN_MS,
		});
		// Exactly one cooldown ago → eligible again (boundary is inclusive-open).
		expect(
			manualReminderEligibility(
				order({ lastManualReminderAt: NOW - MANUAL_REMINDER_COOLDOWN_MS }),
				NOW,
			),
		).toEqual({ ok: true });
	});

	test("cancelled takes precedence over cooldown (most-closed reason first)", () => {
		expect(
			manualReminderEligibility(
				order({ status: "cancelled", lastManualReminderAt: NOW - 60_000 }),
				NOW,
			),
		).toEqual({ ok: false, reason: "cancelled" });
	});
});
