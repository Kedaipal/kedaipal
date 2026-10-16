import { describe, expect, test } from "vitest";
import { countdownStage, formatTimeLeft } from "./countdown";

const MIN = 60_000;

/**
 * The stage thresholds are the one rule every countdown surface shares
 * (claim bar, flash-sale bar — z8r3fdr60v / z8r3fdcw72). The absolute caps
 * are load-bearing: delete them (fraction-only staging) and the 24h cases
 * below go red.
 */
describe("countdownStage", () => {
	test("15-minute window: ok → low at 25% → critical at 10%", () => {
		const total = 15 * MIN;
		expect(countdownStage(10 * MIN, total)).toBe("ok");
		expect(countdownStage(4 * MIN, total)).toBe("ok");
		// 25% of 15 min = 3:45 — at or under flips low.
		expect(countdownStage(3.75 * MIN, total)).toBe("low");
		expect(countdownStage(2 * MIN, total)).toBe("low");
		// 10% of 15 min = 90s, but critical is capped at 60s.
		expect(countdownStage(89_000, total)).toBe("low");
		expect(countdownStage(60_000, total)).toBe("critical");
		expect(countdownStage(0, total)).toBe("critical");
		expect(countdownStage(-5_000, total)).toBe("critical");
	});

	test("24-hour window: urgency keys on time remaining, never fraction alone", () => {
		const total = 24 * 60 * MIN;
		// 25% of 24h is 6h — without the 10-min cap these would sit amber all
		// afternoon.
		expect(countdownStage(6 * 60 * MIN, total)).toBe("ok");
		expect(countdownStage(20 * MIN, total)).toBe("ok");
		expect(countdownStage(11 * MIN, total)).toBe("ok");
		expect(countdownStage(10 * MIN, total)).toBe("low");
		expect(countdownStage(2 * MIN, total)).toBe("low");
		expect(countdownStage(60_000, total)).toBe("critical");
	});

	test("short window: fraction tightens the caps, not the other way round", () => {
		const total = 10 * MIN;
		// low = min(2.5 min, 10 min) = 2.5 min.
		expect(countdownStage(3 * MIN, total)).toBe("ok");
		expect(countdownStage(2.5 * MIN, total)).toBe("low");
	});

	test("malformed zero window falls back to the absolute caps", () => {
		expect(countdownStage(15 * MIN, 0)).toBe("ok");
		expect(countdownStage(5 * MIN, 0)).toBe("low");
		expect(countdownStage(30_000, 0)).toBe("critical");
	});
});

describe("formatTimeLeft", () => {
	test("hours read as 23h 59m, the urgency zone keeps ticking seconds", () => {
		expect(formatTimeLeft(24 * 60 * MIN - MIN)).toBe("23h 59m");
		expect(formatTimeLeft(59 * MIN + 32_000)).toBe("59:32");
	});
});
