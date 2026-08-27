import { describe, expect, test } from "vitest";
import {
	CLAIM_MAX_SENDS,
	CLAIM_PAYMENT_RUNWAY_MS,
	CLAIM_RESEND_COOLDOWN_MS,
	claimResendState,
	claimResendVisible,
	DEFAULT_CLAIM_WINDOW_MINUTES,
	describeClaimWindow,
	effectiveClaimStatus,
	extendedPaymentDue,
	GATEWAY_SESSION_GRACE_MS,
	isAutoCancelDue,
	isPaymentWindowLocked,
	MAX_CLAIM_WINDOW_MINUTES,
	MIN_CLAIM_WINDOW_MINUTES,
	paymentDueAtCommit,
	sanitizeClaimWindowMinutes,
} from "./orderClaims";

const NOW = 1_756_000_000_000;

describe("effectiveClaimStatus", () => {
	test("open before the deadline stays open; past it reads expired", () => {
		const claim = { status: "open" as const, expiresAt: NOW + 1000 };
		expect(effectiveClaimStatus(claim, NOW)).toBe("open");
		expect(effectiveClaimStatus(claim, NOW + 1001)).toBe("expired");
	});

	test("the deadline moment itself is still open (inclusive)", () => {
		expect(
			effectiveClaimStatus({ status: "open", expiresAt: NOW }, NOW),
		).toBe("open");
	});

	test("settled statuses never flip, whatever the clock says", () => {
		for (const status of ["completed", "cancelled", "expired"] as const) {
			expect(
				effectiveClaimStatus({ status, expiresAt: NOW - 5000 }, NOW),
			).toBe(status);
		}
	});
});

describe("claimResendState", () => {
	test("fresh send is cooled down, then allowed", () => {
		const claim = { sentCount: 1, lastSentAt: NOW };
		const blocked = claimResendState(claim, NOW + 1000);
		expect(blocked).toEqual({
			canResend: false,
			reason: "cooldown",
			nextAt: NOW + CLAIM_RESEND_COOLDOWN_MS,
		});
		expect(
			claimResendState(claim, NOW + CLAIM_RESEND_COOLDOWN_MS),
		).toEqual({ canResend: true });
	});

	test("the hard cap wins even after the cooldown", () => {
		const claim = { sentCount: CLAIM_MAX_SENDS, lastSentAt: NOW };
		expect(
			claimResendState(claim, NOW + CLAIM_RESEND_COOLDOWN_MS * 10),
		).toEqual({ canResend: false, reason: "max_sends" });
	});
});

describe("sanitizeClaimWindowMinutes", () => {
	test("accepts the dialog's choices and the bounds", () => {
		for (const m of [
			MIN_CLAIM_WINDOW_MINUTES,
			15,
			60,
			DEFAULT_CLAIM_WINDOW_MINUTES,
			MAX_CLAIM_WINDOW_MINUTES,
		]) {
			expect(sanitizeClaimWindowMinutes(m)).toBe(m);
		}
	});

	test("rejects non-integers and out-of-bounds windows", () => {
		expect(() => sanitizeClaimWindowMinutes(14.5)).toThrow();
		expect(() =>
			sanitizeClaimWindowMinutes(MIN_CLAIM_WINDOW_MINUTES - 1),
		).toThrow();
		expect(() =>
			sanitizeClaimWindowMinutes(MAX_CLAIM_WINDOW_MINUTES + 1),
		).toThrow();
	});
});

describe("describeClaimWindow", () => {
	test("EN wording: minutes / hours / days", () => {
		expect(describeClaimWindow(15)).toBe("15 minutes");
		expect(describeClaimWindow(60)).toBe("1 hour");
		expect(describeClaimWindow(120)).toBe("2 hours");
		expect(describeClaimWindow(90)).toBe("90 minutes");
		expect(describeClaimWindow(24 * 60)).toBe("24 hours");
		expect(describeClaimWindow(2 * 24 * 60)).toBe("2 days");
	});

	test("MS wording rides the template language arm", () => {
		expect(describeClaimWindow(15, "ms")).toBe("15 minit");
		expect(describeClaimWindow(60, "ms")).toBe("1 jam");
		expect(describeClaimWindow(24 * 60, "ms")).toBe("24 jam");
		expect(describeClaimWindow(2 * 24 * 60, "ms")).toBe("2 hari");
	});
});

describe("paymentDueAtCommit / extendedPaymentDue", () => {
	test("a long window carries through unchanged; a nearly-spent one is floored to the runway", () => {
		const dayOut = NOW + 20 * 60 * 60 * 1000;
		expect(paymentDueAtCommit(dayOut, NOW)).toBe(dayOut);
		// Buyer spent 14 of 15 minutes on the form — they still get a real
		// chance to pay.
		expect(paymentDueAtCommit(NOW + 60_000, NOW)).toBe(
			NOW + CLAIM_PAYMENT_RUNWAY_MS,
		);
	});

	test("extension never shortens, and re-arms a nearly-dead clock", () => {
		const farOut = NOW + 10 * CLAIM_PAYMENT_RUNWAY_MS;
		expect(extendedPaymentDue(farOut, NOW)).toBe(farOut);
		expect(extendedPaymentDue(NOW + 40_000, NOW)).toBe(
			NOW + CLAIM_PAYMENT_RUNWAY_MS,
		);
	});
});

describe("isAutoCancelDue", () => {
	const due = {
		paymentDueAt: NOW - 1000,
		status: "confirmed",
		paymentStatus: "unpaid" as const,
	};

	test("a due, unpaid, payable order cancels", () => {
		expect(isAutoCancelDue(due, NOW)).toBe(true);
		expect(isAutoCancelDue({ ...due, status: "pending" }, NOW)).toBe(true);
		// paymentStatus unset reads as unpaid (legacy posture).
		expect(
			isAutoCancelDue({ ...due, paymentStatus: undefined }, NOW),
		).toBe(true);
	});

	test("no deadline / not yet due — never", () => {
		expect(isAutoCancelDue({ ...due, paymentDueAt: undefined }, NOW)).toBe(
			false,
		);
		expect(isAutoCancelDue({ ...due, paymentDueAt: NOW + 1 }, NOW)).toBe(
			false,
		);
	});

	test("an 'I've paid' claim pauses the clock — a human verdict must never race a robot", () => {
		expect(isAutoCancelDue({ ...due, paymentStatus: "claimed" }, NOW)).toBe(
			false,
		);
		expect(isAutoCancelDue({ ...due, paymentStatus: "received" }, NOW)).toBe(
			false,
		);
	});

	test("a seller who started fulfilling an unpaid order made a call — the robot keeps out", () => {
		for (const status of ["packed", "shipped", "delivered", "cancelled"]) {
			expect(isAutoCancelDue({ ...due, status }, NOW)).toBe(false);
		}
	});

	test("unpayable states suspend it: fee pending / gateway issue", () => {
		expect(isAutoCancelDue({ ...due, deliveryFeePending: true }, NOW)).toBe(
			false,
		);
		expect(
			isAutoCancelDue({ ...due, gatewayPaymentIssue: { kind: "x" } }, NOW),
		).toBe(false);
	});

	test("a live HitPay session shields the order; a stale one does not", () => {
		expect(
			isAutoCancelDue({ ...due, gatewayRequestedAt: NOW - 30 * 60_000 }, NOW),
		).toBe(false);
		expect(
			isAutoCancelDue(
				{ ...due, gatewayRequestedAt: NOW - GATEWAY_SESSION_GRACE_MS - 1 },
				NOW,
			),
		).toBe(true);
	});
});

describe("claimResendVisible", () => {
	// Resend is a retry, not a nudge — every WhatsApp send is billed.
	test("a delivered send offers nothing to retry", () => {
		expect(claimResendVisible("sent")).toBe(false);
	});

	test("only the outcomes a retry could actually fix are offered", () => {
		expect(claimResendVisible("failed")).toBe(true);
		expect(claimResendVisible("blocked")).toBe(true);
	});

	// Both of these would be suppressed identically on the way out: offering a
	// retry would charge for a guaranteed failure.
	test("hopeless outcomes are not offered a retry", () => {
		expect(claimResendVisible("opted_out")).toBe(false);
		expect(claimResendVisible("unavailable")).toBe(false);
	});

	test("a row from before outcomes were recorded keeps its retry", () => {
		expect(claimResendVisible(undefined)).toBe(true);
	});
});

describe("isPaymentWindowLocked", () => {
	const inWindow = {
		paymentDueAt: NOW + 10 * 60_000,
		status: "pending",
		paymentStatus: "unpaid",
	};

	test("an unpaid order with a live deadline is frozen", () => {
		expect(isPaymentWindowLocked(inWindow)).toBe(true);
		expect(isPaymentWindowLocked({ ...inWindow, status: "confirmed" })).toBe(
			true,
		);
	});

	// A passed-but-unswept deadline is an order about to be auto-cancelled —
	// still not a moment to move the date, which is why the predicate is
	// deliberately time-free.
	test("a passed deadline stays frozen until the sweep clears it", () => {
		expect(
			isPaymentWindowLocked({ ...inWindow, paymentDueAt: NOW - 60_000 }),
		).toBe(true);
	});

	test("payment landing releases it", () => {
		expect(
			isPaymentWindowLocked({ ...inWindow, paymentStatus: "received" }),
		).toBe(false);
		// `claimed` is the buyer saying they've transferred — money hasn't been
		// verified, so the deal stays put.
		expect(
			isPaymentWindowLocked({ ...inWindow, paymentStatus: "claimed" }),
		).toBe(true);
	});

	test("an order with no payment window is never frozen", () => {
		expect(
			isPaymentWindowLocked({ status: "pending", paymentStatus: "unpaid" }),
		).toBe(false);
	});

	test("cancelled and shipped orders are past the point of freezing", () => {
		expect(isPaymentWindowLocked({ ...inWindow, status: "cancelled" })).toBe(
			false,
		);
		expect(isPaymentWindowLocked({ ...inWindow, status: "shipped" })).toBe(
			false,
		);
	});
});
