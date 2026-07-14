import { describe, expect, test } from "vitest";
import {
	formatOrderTimestamp,
	formatPriceCompact,
	normalizePriceInput,
	parsePriceInput,
	sanitizeIntInput,
} from "./format";

describe("sanitizeIntInput", () => {
	test("strips everything but digits", () => {
		expect(sanitizeIntInput("12")).toBe("12");
		expect(sanitizeIntInput("5.5")).toBe("55");
		expect(sanitizeIntInput("1,000")).toBe("1000");
		expect(sanitizeIntInput("abc7")).toBe("7");
		expect(sanitizeIntInput("-3")).toBe("3");
		expect(sanitizeIntInput("")).toBe("");
	});
});

describe("normalizePriceInput", () => {
	test("formats to 2 decimal places", () => {
		expect(normalizePriceInput("12")).toBe("12.00");
		expect(normalizePriceInput("12.5")).toBe("12.50");
		expect(normalizePriceInput("12.999")).toBe("13.00");
		expect(normalizePriceInput("0")).toBe("0.00");
	});

	test("blank stays blank", () => {
		expect(normalizePriceInput("")).toBe("");
		expect(normalizePriceInput("   ")).toBe("");
	});

	test("unparseable / negative values are returned unchanged for validation", () => {
		expect(normalizePriceInput("abc")).toBe("abc");
		expect(normalizePriceInput("-5")).toBe("-5");
	});

	test("comma input is normalized, not truncated", () => {
		// Decimal comma (MY/intl decimal keyboards) — was "1.00" under parseFloat.
		expect(normalizePriceInput("1,50")).toBe("1.50");
		expect(normalizePriceInput("1,5")).toBe("1.50");
		// Thousands comma — was "1.00" under parseFloat.
		expect(normalizePriceInput("1,200")).toBe("1200.00");
		expect(normalizePriceInput("1,234,567")).toBe("1234567.00");
		expect(normalizePriceInput("1,200.50")).toBe("1200.50");
	});
});

describe("parsePriceInput", () => {
	test("plain decimals", () => {
		expect(parsePriceInput("120")).toBe(120);
		expect(parsePriceInput("120.50")).toBe(120.5);
		expect(parsePriceInput("0")).toBe(0);
		expect(parsePriceInput("  12.5  ")).toBe(12.5);
	});

	test("decimal comma → decimal point (single trailing 1–2 digits)", () => {
		expect(parsePriceInput("1,50")).toBe(1.5);
		expect(parsePriceInput("1,5")).toBe(1.5);
		expect(parsePriceInput("0,99")).toBe(0.99);
	});

	test("thousands commas are stripped", () => {
		expect(parsePriceInput("1,200")).toBe(1200);
		expect(parsePriceInput("1,234,567")).toBe(1234567);
		expect(parsePriceInput("1,200.50")).toBe(1200.5);
	});

	test("rejects non-numeric / negative rather than truncating", () => {
		expect(parsePriceInput("")).toBeNull();
		expect(parsePriceInput("   ")).toBeNull();
		expect(parsePriceInput("abc")).toBeNull();
		expect(parsePriceInput("12abc")).toBeNull(); // parseFloat would give 12
		expect(parsePriceInput("1 200")).toBeNull(); // space-separated → reject
		expect(parsePriceInput("1.2.3")).toBeNull();
		expect(parsePriceInput("-5")).toBeNull();
	});
});

describe("formatPriceCompact", () => {
	// Intl separates "RM" from the number with a non-breaking space (U+00A0).
	const NB = " ";

	test("small amounts keep full precision (sen matter on an order)", () => {
		expect(formatPriceCompact(124_050, "MYR")).toBe(`RM${NB}1,240.50`);
		expect(formatPriceCompact(999_999, "MYR")).toBe(`RM${NB}9,999.99`);
	});

	test("RM 10k–1M drops sen (whole ringgit)", () => {
		expect(formatPriceCompact(3_772_003, "MYR")).toBe(`RM${NB}37,720`);
		expect(formatPriceCompact(1_000_000, "MYR")).toBe(`RM${NB}10,000`);
	});

	test("≥ RM 1M compacts (the customer-detail overflow case)", () => {
		// The exact figure from the report: RM 2,225,481.50 lifetime.
		expect(formatPriceCompact(222_548_150, "MYR")).toBe(`RM${NB}2.23M`);
		expect(formatPriceCompact(100_000_000, "MYR")).toBe(`RM${NB}1M`);
	});

	test("unknown currency falls back to a plain rounded number", () => {
		expect(formatPriceCompact(3_772_003, "NOPE")).toBe("NOPE 37,720");
	});
});

describe("formatOrderTimestamp", () => {
	// 12 Jul 2026, 3:45pm (local runtime TZ — assertions stay TZ-agnostic).
	const placedAt = new Date(2026, 6, 12, 15, 45).getTime();

	test("same-year stamp shows date + time, omits the year", () => {
		const s = formatOrderTimestamp(placedAt, new Date(2026, 0, 1).getTime());
		expect(s).toMatch(/Jul/);
		expect(s).toMatch(/12/);
		expect(s).toMatch(/(AM|PM|am|pm)/); // 12-hour time
		expect(s).not.toMatch(/2026/); // year dropped in the current year
	});

	test("different-year stamp includes the year", () => {
		const s = formatOrderTimestamp(placedAt, new Date(2027, 0, 1).getTime());
		expect(s).toMatch(/2026/);
	});
});
