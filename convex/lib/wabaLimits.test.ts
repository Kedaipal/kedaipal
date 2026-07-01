import { describe, expect, test } from "vitest";
import {
	classifyOptOutKeyword,
	DAY_MS,
	DEFAULT_BURST_CAP_5MIN,
	isTransactional,
	NEW_ACCOUNT_DAILY_CAP,
	qualityBlocks,
	resolveSendingLimits,
} from "./wabaLimits";

const now = 1_900_000_000_000;
const old = now - 40 * DAY_MS; // >30 days → past the new-account ramp
const fresh = now - 5 * DAY_MS; // within first 30 days

describe("resolveSendingLimits", () => {
	test("new account is capped at the ramp regardless of tier", () => {
		expect(
			resolveSendingLimits({ plan: "pro", accountCreatedAt: fresh, now }).dailyCap,
		).toBe(NEW_ACCOUNT_DAILY_CAP);
		expect(
			resolveSendingLimits({ plan: "scale", accountCreatedAt: fresh, now })
				.dailyCap,
		).toBe(NEW_ACCOUNT_DAILY_CAP);
	});

	test("established account gets its tier cap", () => {
		expect(
			resolveSendingLimits({ plan: "starter", accountCreatedAt: old, now })
				.dailyCap,
		).toBe(50);
		expect(
			resolveSendingLimits({ plan: "pro", accountCreatedAt: old, now }).dailyCap,
		).toBe(200);
		expect(
			resolveSendingLimits({ plan: "scale", accountCreatedAt: old, now })
				.dailyCap,
		).toBe(500);
	});

	test("explicit overrides win", () => {
		const r = resolveSendingLimits({
			plan: "starter",
			accountCreatedAt: fresh,
			now,
			dailyCapOverride: 999,
			burstCapOverride: 7,
		});
		expect(r).toEqual({ dailyCap: 999, burstCap5min: 7 });
	});

	test("default burst cap", () => {
		expect(
			resolveSendingLimits({ plan: "pro", accountCreatedAt: old, now })
				.burstCap5min,
		).toBe(DEFAULT_BURST_CAP_5MIN);
	});
});

describe("qualityBlocks", () => {
	test("transactional is never blocked", () => {
		for (const r of ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const) {
			expect(qualityBlocks(r, "transactional")).toBe(false);
		}
	});

	test("LOW pauses all non-transactional", () => {
		expect(qualityBlocks("LOW", "session_message")).toBe(true);
		expect(qualityBlocks("LOW", "utility_template")).toBe(true);
		expect(qualityBlocks("LOW", "marketing_template")).toBe(true);
	});

	test("MEDIUM / UNKNOWN pause marketing only", () => {
		expect(qualityBlocks("MEDIUM", "marketing_template")).toBe(true);
		expect(qualityBlocks("MEDIUM", "session_message")).toBe(false);
		expect(qualityBlocks("UNKNOWN", "marketing_template")).toBe(true);
		expect(qualityBlocks("UNKNOWN", "session_message")).toBe(false);
	});

	test("HIGH blocks nothing", () => {
		expect(qualityBlocks("HIGH", "marketing_template")).toBe(false);
	});
});

describe("isTransactional", () => {
	test("only transactional", () => {
		expect(isTransactional("transactional")).toBe(true);
		expect(isTransactional("session_message")).toBe(false);
	});
});

describe("classifyOptOutKeyword", () => {
	test("opt-out keywords (EN + MS), case/space-insensitive exact match", () => {
		expect(classifyOptOutKeyword("STOP")).toEqual({
			kind: "out",
			source: "stop_keyword",
		});
		expect(classifyOptOutKeyword("  berhenti ")).toEqual({
			kind: "out",
			source: "berhenti_keyword",
		});
		expect(classifyOptOutKeyword("unsub")).toEqual({
			kind: "out",
			source: "unsub_keyword",
		});
	});

	test("opt-in keywords", () => {
		expect(classifyOptOutKeyword("START")).toEqual({ kind: "in" });
		expect(classifyOptOutKeyword("mula")).toEqual({ kind: "in" });
	});

	test("does not match a message that merely contains the word", () => {
		expect(classifyOptOutKeyword("please stop sending me this")).toBeNull();
		expect(classifyOptOutKeyword("ORD-1234")).toBeNull();
	});
});
