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

/**
 * Minimum gap between two MANUAL reminders on the same order. A seller can
 * re-send payment details on demand, but not hammer one buyer — the button is
 * disabled-with-reason for 6h after each send (WABA per-seller caps apply on
 * top). Short enough to re-nudge within a day, long enough to not annoy.
 */
export const MANUAL_REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000;

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
	lastManualReminderAt?: number;
	createdAt: number;
	customer: { waPhone?: string };
};

/**
 * Whether this order should receive the payment nudge now. Due when ALL hold:
 *  - confirmed/packed/shipped/**delivered** (a `pending` order was never
 *    confirmed in chat — payment isn't owed yet; `cancelled` is closed).
 *    **`delivered` counts** — F&B sellers routinely deliver stock on credit
 *    and settle at the end of the week/month, so "goods arrived" does NOT
 *    imply "goods paid for" (PR feedback, `86ey570am`);
 *  - payment neither claimed nor received (a buyer who tapped "I've paid" is
 *    waiting on the SELLER, not the other way round);
 *  - the mockup gate isn't closed (custom orders defer payment until the buyer
 *    approves the design — nagging before that contradicts the confirm copy);
 *  - never reminded before (one nudge, ever);
 *  - the seller didn't already MANUALLY nudge within the lead window — a manual
 *    re-send in the last 3 days makes the auto nudge redundant, and firing both
 *    back-to-back would double-message the buyer;
 *  - the buyer is reachable on WhatsApp;
 *  - the order is at least 11 days old.
 */
export function isPaymentReminderDue(
	order: PaymentReminderOrderFields,
	now: number,
): boolean {
	if (order.status === "pending" || order.status === "cancelled") {
		return false;
	}
	if (order.paymentStatus === "claimed" || order.paymentStatus === "received") {
		return false;
	}
	if (isMockupGateClosed(order)) return false;
	if (order.paymentReminderSentAt !== undefined) return false;
	if (
		order.lastManualReminderAt !== undefined &&
		now - order.lastManualReminderAt < PAYMENT_REMINDER_LEAD_DAYS * DAY_MS
	) {
		return false;
	}
	if (!order.customer.waPhone) return false;
	return now - order.createdAt >= PAYMENT_REMINDER_AFTER_MS;
}

/**
 * Why a manual "Send payment reminder" can't fire right now — `null` means it
 * CAN. The seller drives this button on demand, so unlike the auto nudge there's
 * no age gate and no once-ever cap; instead the blocks mirror the states where
 * asking the buyer to pay would be wrong or impossible:
 *  - `cancelled` / `pending` — no live confirmed order to chase (a pending order
 *    was never confirmed in chat, so the buyer's WhatsApp isn't even captured);
 *  - `paid` — payment already received, nothing to chase;
 *  - `claimed` — the buyer tapped "I've paid" and is waiting on the SELLER;
 *  - `mockup_gated` — a custom item still needs approval; the buyer was told
 *    "no payment needed yet", so nudging contradicts the confirm copy;
 *  - `no_contact` — no buyer WhatsApp number on file to message;
 *  - `cooldown` — a manual reminder went out < 6h ago (carries `retryAt`).
 */
export type ManualReminderBlock =
	| "cancelled"
	| "pending"
	| "paid"
	| "claimed"
	| "mockup_gated"
	| "no_contact"
	| "cooldown";

export type ManualReminderEligibility =
	| { ok: true }
	| { ok: false; reason: ManualReminderBlock; retryAt?: number };

/**
 * Pure eligibility check for the seller's manual payment reminder — the single
 * source of truth shared by the server action (the lock) and the dashboard
 * button (disabled-with-reason mirror). Returns the first failing reason so the
 * UI can render a specific message. See docs/payment-reminder.md.
 */
export function manualReminderEligibility(
	order: PaymentReminderOrderFields,
	now: number,
): ManualReminderEligibility {
	if (order.status === "cancelled") return { ok: false, reason: "cancelled" };
	if (order.status === "pending") return { ok: false, reason: "pending" };
	if (order.paymentStatus === "received") return { ok: false, reason: "paid" };
	if (order.paymentStatus === "claimed") return { ok: false, reason: "claimed" };
	if (isMockupGateClosed(order)) return { ok: false, reason: "mockup_gated" };
	if (!order.customer.waPhone) return { ok: false, reason: "no_contact" };
	if (
		order.lastManualReminderAt !== undefined &&
		now - order.lastManualReminderAt < MANUAL_REMINDER_COOLDOWN_MS
	) {
		return {
			ok: false,
			reason: "cooldown",
			retryAt: order.lastManualReminderAt + MANUAL_REMINDER_COOLDOWN_MS,
		};
	}
	return { ok: true };
}
