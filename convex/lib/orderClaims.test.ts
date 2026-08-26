import { describe, expect, test } from "vitest";
import {
	CLAIM_MAX_SENDS,
	CLAIM_RESEND_COOLDOWN_MS,
	claimResendState,
	DEFAULT_CLAIM_WINDOW_MINUTES,
	describeClaimWindow,
	effectiveClaimStatus,
	MAX_CLAIM_WINDOW_MINUTES,
	MIN_CLAIM_WINDOW_MINUTES,
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
