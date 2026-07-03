// Unpaid-order payment reminder — pure predicate + constants, no Convex
// imports so it unit-tests in isolation (same posture as fulfilmentDate.ts).
// See docs/payment-reminder.md.
//
// The standard: an order has a 14-day open-payment window from creation. If
// payment was never claimed/received by day 11 (3 days before the window
// closes) the buyer gets ONE WhatsApp nudge. Nothing auto-cancels at day 14 —
// the window is a reminder deadline, not an expiry (auto-expiry is a separate
// product decision).

import { isMockupGateClosed, type MockupGateFields } from "./order";

const DAY_MS = 24 * 60 * 60 * 1000;

export const OPEN_PAYMENT_WINDOW_DAYS = 14;
export const PAYMENT_REMINDER_LEAD_DAYS = 3;

/** Age at which the reminder becomes due: day 11 (14 − 3). */
export const PAYMENT_REMINDER_AFTER_MS =
	(OPEN_PAYMENT_WINDOW_DAYS - PAYMENT_REMINDER_LEAD_DAYS) * DAY_MS;

/**
 * How far back the daily cron scans for due-but-unsent orders. Bounded at the
 * full window: an order older than 14 days is past the deadline the reminder
 * references, so nudging it would be noise — but anything inside [day 11,
 * day 14] still catches up after missed cron runs.
 */
export const PAYMENT_REMINDER_SCAN_WINDOW_MS = OPEN_PAYMENT_WINDOW_DAYS * DAY_MS;

export type PaymentReminderOrderFields = MockupGateFields & {
	status:
		| "pending"
		| "confirmed"
		| "packed"
		| "shipped"
		| "delivered"
		| "cancelled";
	paymentStatus?: "unpaid" | "claimed" | "received";
	paymentReminderSentAt?: number;
	createdAt: number;
	customer: { waPhone?: string };
};

/**
 * Whether this order should receive the payment nudge now. Due when ALL hold:
 *  - confirmed/packed/shipped (a `pending` order was never confirmed in chat —
 *    payment isn't owed yet; delivered/cancelled orders are closed);
 *  - payment neither claimed nor received (a buyer who tapped "I've paid" is
 *    waiting on the SELLER, not the other way round);
 *  - the mockup gate isn't closed (custom orders defer payment until the buyer
 *    approves the design — nagging before that contradicts the confirm copy);
 *  - never reminded before (one nudge, ever);
 *  - the buyer is reachable on WhatsApp;
 *  - the order is at least 11 days old.
 */
export function isPaymentReminderDue(
	order: PaymentReminderOrderFields,
	now: number,
): boolean {
	if (
		order.status !== "confirmed" &&
		order.status !== "packed" &&
		order.status !== "shipped"
	) {
		return false;
	}
	if (order.paymentStatus === "claimed" || order.paymentStatus === "received") {
		return false;
	}
	if (isMockupGateClosed(order)) return false;
	if (order.paymentReminderSentAt !== undefined) return false;
	if (!order.customer.waPhone) return false;
	return now - order.createdAt >= PAYMENT_REMINDER_AFTER_MS;
}
