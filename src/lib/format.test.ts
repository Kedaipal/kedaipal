import { describe, expect, it, test } from "vitest";
import {
	formatMyMobile,
	formatOrderTimestamp,
	formatPrice,
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

	test("SGD uses the pinned S$ symbol at every magnitude (SG-lite)", () => {
		expect(formatPriceCompact(124_050, "SGD")).toBe(`S$${NB}1,240.50`);
		expect(formatPriceCompact(3_772_003, "SGD")).toBe(`S$${NB}37,720`);
		expect(formatPriceCompact(222_548_150, "SGD")).toBe(`S$${NB}2.23M`);
	});
});

describe("formatPrice", () => {
	// Intl separates "RM" from the number with a non-breaking space (U+00A0).
	const NB = " ";

	test("MYR stays on the Intl path, byte-identical to before", () => {
		expect(formatPrice(123_450, "MYR")).toBe(`RM${NB}1,234.50`);
		expect(formatPrice(0, "MYR")).toBe(`RM${NB}0.00`);
	});

	test("SGD renders the human symbol, not the bare code (SG-lite)", () => {
		// en-MY Intl would say "SGD 41.00"; the PDF renderer says "S$ 41.00" —
		// the web must agree with the receipt (convex/lib/pdf/document.ts).
		expect(formatPrice(4_100, "SGD")).toBe(`S$${NB}41.00`);
		expect(formatPrice(123_450, "SGD")).toBe(`S$${NB}1,234.50`);
	});

	test("unmapped currency keeps the code prefix", () => {
		expect(formatPrice(4_100, "THB")).toBe(`THB${NB}41.00`);
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

describe("formatMyMobile", () => {
	it("groups a 10-digit local mobile as +60 1X-XXX XXXX", () => {
		expect(formatMyMobile("60123456789")).toBe("+60 12-345 6789");
	});

	it("groups an 11-digit local mobile (011/015) as +60 1X-XXXX XXXX", () => {
		expect(formatMyMobile("601159399791")).toBe("+60 11-5939 9791");
		expect(formatMyMobile("601549882211")).toBe("+60 15-4988 2211");
	});

	it("tolerates formatting already present in the input", () => {
		expect(formatMyMobile("+60 11-5939 9791")).toBe("+60 11-5939 9791");
	});

	it("falls back to a plain +digits for non-MY / unexpected shapes", () => {
		expect(formatMyMobile("6581815321")).toBe("+6581815321");
		expect(formatMyMobile("60312345678")).toBe("+60312345678");
		expect(formatMyMobile("")).toBe("");
	});
});
