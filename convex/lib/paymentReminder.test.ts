import { describe, expect, test } from "vitest";
import {
	MANUAL_REMINDER_CLOSE_AFTER_MS,
	MANUAL_REMINDER_COOLDOWN_MS,
	MANUAL_REMINDER_UNLOCK_AFTER_MS,
	manualReminderEligibility,
	type PaymentReminderOrderFields,
} from "./paymentReminder";

const DAY = 24 * 60 * 60 * 1000;
const CREATED = 1_785_000_000_000;

/** An order sitting squarely inside the day-11–14 window, otherwise remindable. */
function order(
	over: Partial<PaymentReminderOrderFields> = {},
): PaymentReminderOrderFields {
	return {
		status: "confirmed",
		paymentStatus: "unpaid",
		createdAt: CREATED,
		customer: { waPhone: "60123456789" },
		...over,
	};
}

const DAY_12 = CREATED + 11 * DAY; // inside the window

describe("manualReminderEligibility — the day-11–14 window (86eyd63r8 revision)", () => {
	test("day 10 is too early, and says when it unlocks", () => {
		const at = CREATED + MANUAL_REMINDER_UNLOCK_AFTER_MS - 1;
		expect(manualReminderEligibility(order(), at)).toEqual({
			ok: false,
			reason: "too_early",
			unlockAt: CREATED + MANUAL_REMINDER_UNLOCK_AFTER_MS,
		});
	});

	test("the exact start of day 11 unlocks it", () => {
		const at = CREATED + MANUAL_REMINDER_UNLOCK_AFTER_MS;
		expect(manualReminderEligibility(order(), at)).toEqual({ ok: true });
	});

	test("the last moment of day 14 is still open; the lapse closes it forever", () => {
		expect(
			manualReminderEligibility(
				order(),
				CREATED + MANUAL_REMINDER_CLOSE_AFTER_MS - 1,
			),
		).toEqual({ ok: true });
		expect(
			manualReminderEligibility(
				order(),
				CREATED + MANUAL_REMINDER_CLOSE_AFTER_MS,
			),
		).toEqual({ ok: false, reason: "window_closed" });
		// A year later it's exactly as closed — no wraparound, no reopening.
		expect(
			manualReminderEligibility(order(), CREATED + 365 * DAY),
		).toEqual({ ok: false, reason: "window_closed" });
	});

	test("the 24h cooldown caps the window at one send per day (max 4 ever)", () => {
		const sentAt = DAY_12;
		const o = order({ lastManualReminderAt: sentAt });
		expect(manualReminderEligibility(o, sentAt + 1)).toEqual({
			ok: false,
			reason: "cooldown",
			retryAt: sentAt + MANUAL_REMINDER_COOLDOWN_MS,
		});
		expect(
			manualReminderEligibility(o, sentAt + MANUAL_REMINDER_COOLDOWN_MS),
		).toEqual({ ok: true });
	});

	test("a cooldown that outlives the window resolves to window_closed at retry time", () => {
		// Sent late on day 14 → the 24h retry moment falls past the close, so by
		// the time the cooldown lifts the answer is the terminal one.
		const sentAt = CREATED + MANUAL_REMINDER_CLOSE_AFTER_MS - 1;
		const o = order({ lastManualReminderAt: sentAt });
		expect(
			manualReminderEligibility(o, sentAt + MANUAL_REMINDER_COOLDOWN_MS),
		).toEqual({ ok: false, reason: "window_closed" });
	});
});

describe("manualReminderEligibility — state blocks answer before the window", () => {
	test("paid / claimed / cancelled / pending on an ANCIENT order name the state, not the window", () => {
		const at = CREATED + 60 * DAY;
		expect(
			manualReminderEligibility(order({ paymentStatus: "received" }), at),
		).toEqual({ ok: false, reason: "paid" });
		expect(
			manualReminderEligibility(order({ paymentStatus: "claimed" }), at),
		).toEqual({ ok: false, reason: "claimed" });
		expect(
			manualReminderEligibility(order({ status: "cancelled" }), at),
		).toEqual({ ok: false, reason: "cancelled" });
		expect(manualReminderEligibility(order({ status: "pending" }), at)).toEqual(
			{ ok: false, reason: "pending" },
		);
	});

	test("price holds block inside the window: mockup gate + pending delivery fee", () => {
		expect(
			manualReminderEligibility(order({ mockupStatus: "submitted" }), DAY_12),
		).toEqual({ ok: false, reason: "mockup_gated" });
		expect(
			manualReminderEligibility(order({ deliveryFeePending: true }), DAY_12),
		).toEqual({ ok: false, reason: "fee_pending" });
		// A waived mockup is settled — remindable again.
		expect(
			manualReminderEligibility(
				order({ mockupStatus: "submitted", mockupWaivedAt: CREATED }),
				DAY_12,
			),
		).toEqual({ ok: true });
	});

	test("no buyer phone → no_contact, even mid-window", () => {
		expect(
			manualReminderEligibility(order({ customer: {} }), DAY_12),
		).toEqual({ ok: false, reason: "no_contact" });
	});

	test("delivered still counts as remindable — goods arrived ≠ goods paid for", () => {
		expect(
			manualReminderEligibility(order({ status: "delivered" }), DAY_12),
		).toEqual({ ok: true });
	});
});
