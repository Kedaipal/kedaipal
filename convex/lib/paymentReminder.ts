// Seller-triggered payment reminder — pure predicate + constants, no Convex
// imports so it unit-tests in isolation (same posture as fulfilmentDate.ts).
// See docs/payment-reminder.md.
//
// The standard (86eyd63r8 revision, Zaki 8 Aug 2026): Kedaipal never chases
// payment automatically — an order's ONE automatic WhatsApp is the
// confirmation push (docs/one-message-per-order.md). What remains is the
// seller's own "Send payment reminder" button on order detail, and it lives
// inside a hard window:
//
//   day 1–10    hidden — too soon to chase; the confirmation just went out
//   day 11–14   available, at most once per 24h (so max 4 sends, ever)
//   day 15+     closed forever — a debt this old is a conversation, not a
//               nudge; the seller settles or cancels the order by hand
//
// Day 11 is where the OLD automatic nudge used to fire (14-day open-payment
// window, 3-day lead), so the timing survives — only the finger on the
// button changed from cron to seller.

import { isMockupGateClosed, type MockupGateFields } from "./order";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The open-payment window the reminder copy references: 14 days from order
 * creation. Nothing auto-cancels when it lapses — it's a deadline for the
 * REMINDER, not an expiry for the order. */
export const OPEN_PAYMENT_WINDOW_DAYS = 14;

/** The reminder button unlocks at the start of day 11 (createdAt + 10 days) —
 * the same moment the retired automatic nudge used to fire. */
export const MANUAL_REMINDER_UNLOCK_AFTER_MS = 10 * DAY_MS;

/** …and closes for good when the 14-day window lapses. Past this, WhatsApp
 * nudges stop being useful — the seller resolves or cancels by hand. */
export const MANUAL_REMINDER_CLOSE_AFTER_MS = OPEN_PAYMENT_WINDOW_DAYS * DAY_MS;

/**
 * Minimum gap between two reminders on the same order: once per day. With the
 * 4-day window this caps the order's lifetime reminder count at 4 — the
 * "message budget" is enforced by geometry, not a counter (WABA per-seller
 * caps still apply on top).
 */
export const MANUAL_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type PaymentReminderOrderFields = MockupGateFields & {
	status:
		| "pending"
		| "confirmed"
		| "packed"
		| "shipped"
		| "delivered"
		| "cancelled";
	paymentStatus?: "unpaid" | "claimed" | "received";
	lastManualReminderAt?: number;
	// Delivery charge still to be confirmed by the seller — the payment ask is
	// held, so nudging the buyer to pay an unfinished total would contradict it.
	deliveryFeePending?: boolean;
	createdAt: number;
	customer: { waPhone?: string };
};

/**
 * Why the "Send payment reminder" can't fire right now — `null`-equivalent is
 * `{ ok: true }`. The blocks mirror the states where asking the buyer to pay
 * would be wrong, impossible, or outside the window:
 *  - `cancelled` / `pending` — no live confirmed order to chase (a pending
 *    order was never confirmed, so payment isn't owed yet);
 *  - `paid` — payment already received, nothing to chase;
 *  - `claimed` — the buyer tapped "I've paid" and is waiting on the SELLER;
 *  - `mockup_gated` — a custom item still needs approval; the buyer was told
 *    "no payment needed yet", so nudging contradicts the confirm copy;
 *  - `fee_pending` — the delivery charge isn't set, so the total isn't final;
 *  - `no_contact` — no buyer WhatsApp number on file;
 *  - `too_early` — before day 11 (carries `unlockAt`); the UI hides the
 *    button entirely here rather than parking a dead control for 10 days;
 *  - `window_closed` — past day 14, permanently;
 *  - `cooldown` — a reminder went out < 24h ago (carries `retryAt`).
 *
 * Order matters: terminal/status blocks answer first so an old PAID order
 * reads "paid", not "window closed".
 */
export type ManualReminderBlock =
	| "cancelled"
	| "pending"
	| "paid"
	| "claimed"
	| "mockup_gated"
	| "fee_pending"
	| "no_contact"
	| "too_early"
	| "window_closed"
	| "cooldown"
	/** Not an eligibility verdict — the send itself reached nobody (86eyrtz9t).
	 * Returned by the action, never by `manualReminderEligibility`, so the
	 * seller is never told "sent ✓" for a message the buyer never got. */
	| "send_failed";

export type ManualReminderEligibility =
	| { ok: true }
	| { ok: false; reason: ManualReminderBlock; retryAt?: number; unlockAt?: number };

/**
 * Pure eligibility check for the seller's manual payment reminder — the single
 * source of truth shared by the server mutation (the lock) and the dashboard
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
	if (order.deliveryFeePending === true) {
		return { ok: false, reason: "fee_pending" };
	}
	if (!order.customer.waPhone) return { ok: false, reason: "no_contact" };
	const age = now - order.createdAt;
	if (age < MANUAL_REMINDER_UNLOCK_AFTER_MS) {
		return {
			ok: false,
			reason: "too_early",
			unlockAt: order.createdAt + MANUAL_REMINDER_UNLOCK_AFTER_MS,
		};
	}
	if (age >= MANUAL_REMINDER_CLOSE_AFTER_MS) {
		return { ok: false, reason: "window_closed" };
	}
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
