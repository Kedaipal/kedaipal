import { describe, expect, test } from "vitest";
import { DAY_MS } from "./wabaLimits";
import {
	ADMIN_AUDIT_LOG_RETENTION_MS,
	OUTBOUND_MESSAGE_LOG_RETENTION_MS,
	WABA_HEALTH_RETENTION_MS,
	mytMonthKey,
} from "./retention";

describe("mytMonthKey", () => {
	test("formats an epoch as the MYT calendar month", () => {
		// 2026-06-15 12:00 UTC = 20:00 MYT, squarely inside June.
		expect(mytMonthKey(Date.UTC(2026, 5, 15, 12, 0, 0))).toBe("2026-06");
	});

	test("a late-UTC timestamp already belongs to the next MYT month", () => {
		// 2026-07-31 17:30 UTC = 2026-08-01 01:30 MYT — August in Malaysia.
		expect(mytMonthKey(Date.UTC(2026, 6, 31, 17, 30, 0))).toBe("2026-08");
		// …while 15:30 UTC is still 23:30 MYT on 31 July.
		expect(mytMonthKey(Date.UTC(2026, 6, 31, 15, 30, 0))).toBe("2026-07");
	});
});

describe("retention windows (the stated decisions)", () => {
	test("outbound log + waba health = 90 days; admin audit = 24 months", () => {
		expect(OUTBOUND_MESSAGE_LOG_RETENTION_MS).toBe(90 * DAY_MS);
		expect(WABA_HEALTH_RETENTION_MS).toBe(90 * DAY_MS);
		expect(ADMIN_AUDIT_LOG_RETENTION_MS).toBe(730 * DAY_MS);
	});
});
