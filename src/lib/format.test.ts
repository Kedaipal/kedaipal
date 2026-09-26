import { ConvexError } from "convex/values";
import { describe, expect, it, test } from "vitest";
import {
	convexErrorMessage,
	currencySymbol,
	formatDraftAmount,
	formatDraftPrice,
	formatDraftPriceRange,
	formatMobile,
	formatOrderTimestamp,
	formatPrice,
	formatPriceCompact,
	GENERIC_SERVER_FAILURE,
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

describe("formatMobile", () => {
	it("groups a 10-digit MY mobile as +60 1X-XXX XXXX", () => {
		expect(formatMobile("60123456789")).toBe("+60 12-345 6789");
	});

	it("groups an 11-digit MY mobile (011/015) as +60 1X-XXXX XXXX", () => {
		expect(formatMobile("601159399791")).toBe("+60 11-5939 9791");
		expect(formatMobile("601549882211")).toBe("+60 15-4988 2211");
	});

	it("groups an SG mobile as +65 XXXX XXXX (86eynw28q)", () => {
		// Keys off the stored digits — an SG number renders as SG wherever it
		// appears, no country parameter to thread through display surfaces.
		expect(formatMobile("6591234567")).toBe("+65 9123 4567");
		expect(formatMobile("6581815321")).toBe("+65 8181 5321");
	});

	it("tolerates formatting already present in the input", () => {
		expect(formatMobile("+60 11-5939 9791")).toBe("+60 11-5939 9791");
		expect(formatMobile("+65 9123 4567")).toBe("+65 9123 4567");
	});

	it("falls back to a plain +digits for unexpected shapes", () => {
		// Unbroken on purpose, even though the code is known: `toNationalPhoneInput`
		// peels a seller field's plate by string prefix, and "+60 312345678"
		// would seed the field with the country code dropped.
		expect(formatMobile("60312345678")).toBe("+60312345678"); // MY landline
		expect(formatMobile("6512345678")).toBe("+6512345678"); // not an 8/9 SG mobile
		expect(formatMobile("")).toBe("");
	});

	it("splits any other country's number as +CC NATIONAL (z8r3fdh274)", () => {
		// Buyers can pick any country — the code they picked reads apart from
		// the number they typed, so a wrong code is visible at a glance.
		expect(formatMobile("447911123456")).toBe("+44 791 112 3456");
		expect(formatMobile("14155550123")).toBe("+1 415 555 0123");
		expect(formatMobile("+81 90-1234-5678")).toBe("+81 901 234 5678");
	});

	it("an unknown calling code still falls back to +digits", () => {
		expect(formatMobile("99912345678")).toBe("+99912345678");
	});
});

describe("convexErrorMessage — rate-limit payload", () => {
	// The limiter throws ConvexError with an OBJECT payload. Before this was
	// handled the generic branch stringified it and a throttled buyer read the
	// literal "[object Object]" at checkout. Delete the isRateLimitError branch
	// in format.ts and this test goes red on exactly that string.
	function rateLimitError(retryAfterMs: number, name = "orderCreate") {
		return new ConvexError({
			kind: "RateLimited",
			name,
			retryAfter: retryAfterMs,
		});
	}

	it("renders a human retry message, never [object Object]", () => {
		const msg = convexErrorMessage(rateLimitError(4200));
		expect(msg).not.toContain("[object Object]");
		expect(msg).toContain("5s");
	});

	it("floors the wait at 1s so it never says 0s", () => {
		expect(convexErrorMessage(rateLimitError(120))).toContain("1s");
	});

	// The daily order ceiling (orderCreateDaily) makes long retryAfter values
	// reachable — "try again in 5400s" is a number nobody converts under
	// checkout stress, so the wait renders in the largest sensible unit.
	it("renders minute-scale waits in minutes, hour-scale in hours", () => {
		expect(convexErrorMessage(rateLimitError(5 * 60_000))).toContain(
			"5 minutes",
		);
		// 90s is the seconds/minutes boundary: 90s stays readable as "2 minutes".
		expect(convexErrorMessage(rateLimitError(90_000))).toContain("2 minutes");
		expect(convexErrorMessage(rateLimitError(89_000))).toContain("89s");
		expect(convexErrorMessage(rateLimitError(3 * 60 * 60_000))).toContain(
			"3 hours",
		);
		// Singulars read as words, not "1 hours".
		expect(convexErrorMessage(rateLimitError(91 * 60_000))).toContain(
			"2 hours",
		);
		expect(convexErrorMessage(rateLimitError(60.4 * 60_000))).toContain(
			"61 minutes",
		);
	});

	it("names the store, not 'the system', when the daily ceiling fires", () => {
		// The burst limiter says "busy right now"; the daily order ceiling says
		// what a buyer can act on — this store can't take more orders just yet.
		const msg = convexErrorMessage(rateLimitError(180_000, "orderCreateDaily"));
		expect(msg).toContain("getting a lot of orders");
		expect(msg).toContain("3 minutes");
		expect(msg).not.toContain("Busy right now");
		// Every other limiter keeps the generic copy.
		expect(convexErrorMessage(rateLimitError(4200, "paymentClaim"))).toContain(
			"Busy right now",
		);
	});

	it("still passes a plain string payload straight through", () => {
		expect(convexErrorMessage(new ConvexError("Only 2 in stock"))).toBe(
			"Only 2 in stock",
		);
	});
});

describe("convexErrorMessage — the Convex server wrapper never reaches a person", () => {
	// Exactly the shape the Convex client puts on `err.message` when a function
	// throws. A teammate refused by a permission check read this, stack frames
	// and all, in the 25 Sep Chrome round.
	function wrapped(thrown: string, fn = "products:save") {
		return new Error(
			`[CONVEX M(${fn})] [Request ID: 9c2f8b1a] Server Error\n` +
				`${thrown}\n` +
				`    at requireRetailerAccess (../convex/lib/auth.ts:156:9)\n` +
				`    at async handler (../convex/products.ts:220:3)\n\n` +
				`  Called by client`,
		);
	}

	it("keeps the sentence a deliberate throw carries, and nothing else", () => {
		expect(
			convexErrorMessage(wrapped("Uncaught Error: Maps URL must use https")),
		).toBe("Maps URL must use https");
	});

	it("never leaks the request id, the frames or the word Uncaught", () => {
		const msg = convexErrorMessage(
			wrapped("Uncaught Error: Slug must be at most 32 characters"),
		);
		expect(msg).not.toContain("[CONVEX");
		expect(msg).not.toContain("Request ID");
		expect(msg).not.toContain("Uncaught");
		expect(msg).not.toContain("    at ");
		expect(msg).not.toContain("Called by client");
	});

	// A ConvexError thrown server-side normally arrives as a real ConvexError
	// instance; if the class identity is ever lost crossing a bundle boundary,
	// the copy still has to survive — that is the whole point of throwing it.
	it("recovers a ConvexError's copy even without the class", () => {
		expect(
			convexErrorMessage(
				wrapped(
					"Uncaught ConvexError: You don't have permission to change products — ask the store owner for edit access from Settings → Team.",
					"team:updatePermissions",
				),
			),
		).toBe(
			"You don't have permission to change products — ask the store owner for edit access from Settings → Team.",
		);
	});

	// The CLASS decides, never the wording: a TypeError is the runtime telling
	// us we have a bug, and "Cannot read properties of undefined" is not
	// something a seller can act on.
	it("turns a runtime crash into a sentence instead of repeating it", () => {
		const msg = convexErrorMessage(
			wrapped("Uncaught TypeError: Cannot read properties of undefined"),
		);
		expect(msg).toBe(GENERIC_SERVER_FAILURE);
		expect(msg).not.toContain("undefined");
	});

	it("falls back when the wrapper carries no thrown line at all", () => {
		expect(
			convexErrorMessage(
				new Error("[CONVEX M(products:save)] [Request ID: 9c2f] Server Error"),
			),
		).toBe(GENERIC_SERVER_FAILURE);
	});

	// Half the validators in convex/lib also run in the browser, where the throw
	// never crosses the wire and the message is already clean. Unwrapping must
	// not touch those.
	it("leaves a client-side throw exactly as it is", () => {
		expect(convexErrorMessage(new Error("Pick your check-out date"))).toBe(
			"Pick your check-out date",
		);
	});
});

describe("currencySymbol", () => {
	test("returns the same symbol formatPrice puts in front of an amount", () => {
		// The pairing is the whole point: a field's prefix and the total it
		// feeds must not disagree ("RM" input, "S$ 41.00" total).
		for (const currency of ["MYR", "SGD", "THB"]) {
			expect(
				formatPrice(4_100, currency).startsWith(currencySymbol(currency)),
			).toBe(true);
		}
	});

	test("MYR is RM and SGD is S$", () => {
		expect(currencySymbol("MYR")).toBe("RM");
		expect(currencySymbol("SGD")).toBe("S$");
	});

	test("an unknown code falls back to the code itself, never a guess", () => {
		// Mirrors formatPrice's fallback — an input prefixed with a made-up
		// symbol would be worse than one prefixed with the code.
		expect(currencySymbol("ZZZ")).toBe("ZZZ");
	});
});

describe("formatDraftPrice — seller-typed amounts in summaries", () => {
	const NB = "\u00a0";

	test("the store's SYMBOL from its ISO code, never the code itself", () => {
		// The bug this exists for: both product forms printed "MYR 12".
		expect(formatDraftPrice(12, "MYR")).toBe(`RM${NB}12`);
		expect(formatDraftPrice(12, "SGD")).toBe(`S$${NB}12`);
	});

	test("spelled like formatPrice — same prefix, same grouping — minus a trailing .00", () => {
		for (const currency of ["MYR", "SGD"]) {
			const draft = formatDraftPrice(1250, currency);
			const stored = formatPrice(125_000, currency);
			expect(stored.startsWith(draft)).toBe(true); // "RM 1,250" ⊂ "RM 1,250.00"
		}
		expect(formatDraftPrice(12.5, "MYR")).toBe(`RM${NB}12.50`);
		expect(formatDraftPrice(0, "SGD")).toBe(`S$${NB}0`);
	});

	test("the number half groups, and keeps sen only when there are some", () => {
		expect(formatDraftAmount(10_000)).toBe("10,000");
		expect(formatDraftAmount(28.5)).toBe("28.50");
		expect(formatDraftAmount(28)).toBe("28");
	});

	test("a range says the symbol once; meeting ends collapse to one price", () => {
		expect(formatDraftPriceRange(12, 28.5, "MYR")).toBe(`RM${NB}12–28.50`);
		expect(formatDraftPriceRange(12, 12, "SGD")).toBe(`S$${NB}12`);
	});
});
